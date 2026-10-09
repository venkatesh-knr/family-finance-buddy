/**
 * Overview — what the household owns, and what the app has not been told.
 *
 * This screen showed assets per currency for a long time, and refused the
 * words "net worth", because the schema could not honour them: `liability`
 * recorded an instalment rather than an outstanding balance, and there was no
 * `fx_rate` table to turn a dollar holding into rupees. A headline reading
 * "net worth" would have been wrong by the size of the mortgage and would have
 * picked an exchange rate nobody chose.
 *
 * Both landed in `20260908130000_fx_rate_and_liability_balance.sql`, so the
 * headline is now the real thing. The refusal survives in a different form:
 * `netWorth` returns the figure or the list of rates it is missing, never a
 * total with the unconvertible parts quietly dropped, and a liability with no
 * recorded balance is subtracted from nothing rather than guessed at. The
 * screen still says what it has not been told — it just says it beside a
 * number now rather than in place of one.
 *
 * The second half of the screen is the part that actually decays. "Every month
 * that passes before the app starts snapshotting is a month of peak data
 * gone" (§606), so the gaps get equal billing with the totals.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  STALE_AFTER_DAYS,
} from '../../domain/networth.ts';
import { closeMonth } from '../../repo/holdings.ts';
import {
  RETURN_REFUSED_BECAUSE,
  shortPositions as shortPositionsPhrase,
  costMissing as costMissingPhrase,
  COST_MISSING_REFUSED_BECAUSE,
} from '../holdings/history.ts';
import { addRate } from '../../repo/rates.ts';
import { recordComputedReadings } from '../../repo/fixedIncome.ts';
import { monthEndReadings } from '../../domain/fixed-income.ts';
import {
  buildPosition,
  daysPhrase,
} from '../holdings/fixedIncomeRows.ts';
import { assetHistory, movementSince } from '../../domain/history.ts';
import { AllocationDonut } from './AllocationDonut.tsx';
import { useOverviewData } from './useOverviewData.ts';
import { AssetsOverTime } from './AssetsOverTime.tsx';
import { Field } from '../../ui/primitives.tsx';
import { formatIsoDate } from '../../lib/dates.ts';
import { exactMoney, formatMoney, money, percentOfCost, type Money } from '../../lib/money.ts';
import { Absent, Button, Card, Caveat, Delta, Amount, Attention, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { AssetTile } from '../../ui/AssetTile.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { JoinHousehold } from '../household/JoinHousehold.tsx';

/** "Sep 2026" for a date in September 2026. */
function monthYear(date: string): string {
  return new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** What Close month left out, named: "1 renewal not recorded yet, 2 paid out". */
function notWorkedOut(left: { projected: number; notStarted: number; unvaluable: number; paidOut: number }): string {
  return [
    left.projected > 0 && `${String(left.projected)} renewal${left.projected === 1 ? '' : 's'} not recorded yet`,
    left.paidOut > 0 && `${String(left.paidOut)} paid out`,
    left.notStarted > 0 && `${String(left.notStarted)} not started`,
    left.unvaluable > 0 && `${String(left.unvaluable)} could not be valued`,
  ]
    .filter((part): part is string => part !== false)
    .join(', ');
}

/** A gain with its sign: a tint alone means nothing to somebody who cannot see it. */
function signed(value: Money, privacy: boolean): string {
  const text = formatMoney(value, { privacy });
  return privacy || value.minor <= 0n ? text : `+${text}`;
}

/** Up to three holdings by name, then a count of the rest. */
function namesFor(ids: readonly string[], nameOf: (id: string) => string): string {
  const shown = ids.slice(0, 3).map(nameOf).join(', ');
  return ids.length > 3 ? `${shown} and ${String(ids.length - 3)} more` : shown;
}

export function OverviewScreen({
  privacy,
  householdId,
  displayCurrency,
  onOpenHoldings,
}: {
  privacy: boolean;
  householdId: string | null;
  /**
   * Which currency to read in, or empty for the household's own.
   *
   * A device setting (§366), never written to a row: "a separate display
   * toggle lets anyone read the whole app in USD without changing a stored
   * value or a target" (§602). It changes what this screen converts into and
   * nothing else — the per-currency asset figures above stay in the currency
   * each holding is actually priced in.
   */
  displayCurrency: string;
  /**
   * Take me to the holdings behind this figure.
   *
   * An allocation row is a total; what it is a total of lives on the other
   * screen. Somebody clicking "Bonds" is asking to see them, and a row that
   * looks like a row and does nothing is worse than one that plainly is not a
   * link.
   */
  onOpenHoldings: (filter: { kind: string; currency: string }) => void;
}) {
  // The rate form is the answer to a question the page only sometimes asks, so
  // it waits behind the sentence that asks it.
  const [addingRate, setAddingRate] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<{
    carried: number;
    unread: number;
    /** Deposits and bonds worked out from their terms and written. */
    worked: number;
    /** What was left out, and why: each is named, not folded into the unread count. */
    left: { projected: number; notStarted: number; unvaluable: number; paidOut: number };
  } | null>(null);
  const [newRate, setNewRate] = useState('');
  const [savingRate, setSavingRate] = useState(false);

  /**
   * Whose figures these are.
   *
   * 'household' is everything the family owns; 'mine' is one member's own
   * share of it. Two questions people genuinely ask separately — "are we on
   * track" and "what is mine" — and answering only the first made the second
   * arithmetic somebody did in their head.
   *
   * Not persisted. Which one you want depends on what you opened the app to
   * find out, not on a preference, and a remembered scope is how somebody
   * reads a personal figure believing it is the household one.
   */
  const [scope, setScope] = useState<'household' | 'mine'>('household');

  const {
    listing,
    loading,
    problem,
    setProblem,
    noHousehold,
    rates,
    plansFailed,
    ratesFailed,
    fixedIncome,
    fixedIncomeFailed,
    ratingsFailed,
    fixedIncomeSettled,
    today,
    load,
    holdings,
    shortPositions,
    valuations,
    totals,
    allocation,
    alerts,
    maturities,
    renewals,
    downgrades,
    ratingNotices,
    gaps,
    staleness,
    asOf,
    holdingName,
    lastMonthEnd,
    base,
    display,
    shownDebts,
    shownUnbalanced,
    hiddenAssets,
    heroWarnings,
    worth,
  } = useOverviewData({ householdId, displayCurrency, scope });

  const privateLeftOut = scope === 'household' && hiddenAssets.length > 0;
  const privateSums = hiddenAssets.map((entry) => formatMoney(entry.total, { privacy })).join(' + ');

  /**
   * What was held, month by month. Follows the same scope as everything else
   * on the screen, and is drawn from the readings the client can see: another
   * member's private holdings arrive as a sum with no dates, so they are named
   * as missing from the line rather than added to it.
   */
  const history = useMemo(() => {
    return assetHistory({
      holdings: holdings.map((h) => ({
        id: h.id,
        currency: h.currency,
        openedOn: h.openedOn,
        isArchived: h.isArchived,
        archivedOn: h.archivedOn,
      })),
      readings: valuations,
      rates,
      display,
      asOf: asOf ?? today,
    });
  }, [holdings, valuations, rates, display, asOf, today]);

  /** What assets did since the last month-end, from the same points as the line. Null with fewer than two. */
  const movement = useMemo(() => (history.ok ? movementSince(history.points) : null), [history]);

  const saveRate = useCallback(
    async (pair: { base: string; quote: string }) => {
      if (listing === null) return;
      setSavingRate(true);
      setProblem(null);
      try {
        await addRate({
          householdId: listing.household.id,
          base: pair.base,
          quote: pair.quote,
          rate: newRate,
          asOf: asOf ?? today,
        });
        setNewRate('');
        await load();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not save that rate.');
      } finally {
        setSavingRate(false);
      }
    },
    [listing, newRate, asOf, today, load],
  );

  const canClose = listing?.viewer.role === 'owner' || listing?.viewer.role === 'partner';

  const close = useCallback(async () => {
    // Closing without having read them would carry a stale mid-month reading into the month-end
    // slot of a deposit, for good: the worked-out figure is never written over a reading.
    if (listing === null || fixedIncome === null) return;
    setClosing(true);
    setProblem(null);
    try {
      // Deposits and bonds first. They have no reading to carry, their value is a function of
      // their terms, so it is worked out for the month end and written; and written before the
      // function below runs, which would otherwise carry a stale mid-month reading into the
      // month-end slot and leave the worked-out figure with nowhere to go.
      let worked = 0;
      const left = { projected: 0, notStarted: 0, unvaluable: 0, paidOut: 0 };
      {
        const seen = new Set(listing.holdings.filter((h) => !h.isArchived).map((h) => h.id));
        const { readings, skipped } = monthEndReadings(
          fixedIncome.terms
            .filter((terms) => seen.has(terms.holdingId))
            .map((terms) => buildPosition(terms, fixedIncome.renewals)),
          lastMonthEnd,
        );
        worked = await recordComputedReadings({
          householdId: listing.household.id,
          date: lastMonthEnd,
          readings,
        });
        left.projected = skipped.filter((s) => s.why === 'projected').length;
        left.notStarted = skipped.filter((s) => s.why === 'not-started').length;
        left.unvaluable = skipped.filter((s) => s.why === 'unvaluable').length;
        left.paidOut = skipped.filter((s) => s.why === 'matured').length;
      }
      const carried = await closeMonth({ householdId: listing.household.id, monthEnd: lastMonthEnd });
      setClosed({ ...carried, worked, left });
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not close the month.');
    } finally {
      setClosing(false);
    }
  }, [listing, fixedIncome, lastMonthEnd, load]);

  if (loading && listing === null) return <p className="note py-4.5">Loading…</p>;
  if (noHousehold) return <JoinHousehold onJoined={() => void load()} />;
  if (problem !== null && listing === null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Problem>{problem}</Problem>
        <Button type="button" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }
  if (listing === null) return null;

  return (
    /*
      One column on a phone, in the order the cards are written. From 1024px two
      columns, placed explicitly so the order a phone reads does not change:
      net worth, the assets and the allocation on the left; the line and what
      needs attention on the right. Each block keeps its own height, and a
      wrapper with nothing in it takes no room.
    */
    <div className="flex flex-col gap-4.5 lg:grid lg:grid-cols-2 lg:items-start">
      {problem !== null && (
        <div className="lg:col-span-2">
          <Problem>{problem}</Problem>
        </div>
      )}

      {/*
        Net worth first, and the only hero figure on the screen.

        docs/tokens.md §3 names net worth as the hero, and a hero only works if
        one figure per screen uses that step: with three of them the person
        opening the app had to read all three to find out how they were doing.

        Assets used to sit above it. That was a fair answer to a real problem —
        the first thing on the screen was a red paragraph explaining why there
        was no total, printed above the figures that did exist — but the refusal
        is a mark on the figure now, not a paragraph in place of one, so the
        reason is gone. When there is still no total the hero slot carries the
        per-currency figures with the refusal marked on them, exactly as before,
        and the Assets card below carries the same figures as stat tiles.

        The Household / Mine switch is here because it governs the whole screen, not
        a card. There is no privacy switch: the top bar has the one, and two
        controls for one state is the problem the currency control was folded to
        avoid.
      */}
      <div className="lg:col-start-1 lg:row-start-1">
        <Card
          lift
          title="Net worth"
          aside={
            <span className="flex flex-wrap items-center gap-2.5">
              {/*
                Two questions people ask separately — "are we on track" and
                "what is mine" — so two answers rather than arithmetic done in
                a head. A group of pressed buttons, not tabs: nothing here is a
                panel, and an incomplete tab pattern announces a promise it does
                not keep.
              */}
              <span className="segmented" role="group" aria-label="Whose figures">
                {(['household', 'mine'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={scope === option}
                    onClick={() => {
                      setScope(option);
                    }}
                  >
                    {option === 'household' ? 'Household' : 'Mine'}
                  </button>
                ))}
              </span>
              {asOf === null ? (
                <span className="note">nothing valued yet</span>
              ) : (
                <span className="note">as at {formatIsoDate(asOf)}</span>
              )}
              {display !== base && <span className="note">read in {display}</span>}
              {/*
                What net worth IS, said once, on the heading. It was four lines of
                prose in the card body, larger than the figure it described.
              */}
              <Caveat tone="info" label="What net worth is">
                {scope === 'household'
                  ? 'Everything the household owns'
                  : 'Everything you own, and the debts in your name'}
                , converted at the rate for {formatIsoDate(asOf ?? today)}, less everything owed.
                {display !== base && ` Read in ${display}; this household's own currency is ${base}.`}
                {scope === 'household' && hiddenAssets.length > 0 && (
                  <>
                    {' '}
                    Private holdings of other members are counted as one figure each, without the
                    detail.
                  </>
                )}
                {scope === 'mine' && (
                  <>
                    {' '}
                    A debt in nobody&rsquo;s name is the household&rsquo;s and is counted here too —
                    leaving it out would make your own figure better than it is.
                  </>
                )}
                {staleness.oldest !== null && staleness.oldest !== staleness.newest && (
                  <p className="mt-2">
                    Each holding is carried at its own latest reading, which runs from{' '}
                    {formatIsoDate(staleness.oldest)} to{' '}
                    {formatIsoDate(staleness.newest ?? staleness.oldest)}.
                    {staleness.stale.length > 0 &&
                      ` ${String(staleness.stale.length)} of them ${staleness.stale.length === 1 ? 'is' : 'are'} more than ${String(STALE_AFTER_DAYS)} days behind the newest; they are named under Needs attention.`}
                  </p>
                )}
                {!plansFailed && shownUnbalanced === 0 && shownDebts.length === 0 && (
                  <p className="mt-2">
                    No debts are recorded, so nothing is subtracted. If the household owes anything,
                    record it under loans on FIRE and it comes off this figure.
                  </p>
                )}
              </Caveat>
            </span>
          }
        >
          {asOf === null && hiddenAssets.length === 0 ? (
            /*
              Every holding unread. Adding them up gives 0, or minus the debts, and
              a figure somebody would act on; the rest of the screen already
              refuses in this state, and so does the hero.
            */
            <div className="figure" style={{ color: 'var(--ink)' }}>
              <Absent label="Why there is no net worth yet">
                Nothing has been valued, so there is nothing to add up, and a total of zero would say
                the household owns nothing. Record a value on Holdings and it appears here
                {shownDebts.length > 0 ? ', less what is owed' : ''}.
              </Absent>
            </div>
          ) : worth.ok ? (
            <>
            {/*
              A div and not a p: a caveat opens a popover, and a div may not sit
              inside a paragraph.
            */}
            <div
              className="figure"
              style={{ color: worth.amount.minor < 0n ? 'var(--coral)' : 'var(--ink)' }}
              // The unabbreviated figure, for anybody who wants the digits.
              // Null under privacy: a tooltip that gives away what the bullets
              // hide would make the whole mode decorative.
              title={exactMoney(worth.amount, privacy) ?? undefined}
            >
              <Amount value={worth.amount} privacy={privacy} compact />
              {/*
                Each of these qualifies this number and none is decoration, so
                they ride on it, and each appears only when it applies.
              */}
              {heroWarnings.length > 0 && (
                <Caveat tone="warn" label="Why this figure may be wrong">
                  {heroWarnings.length === 1 ? (
                    heroWarnings[0]
                  ) : (
                    <ul className="list-disc pl-4.5">
                      {heroWarnings.map((warning, index) => (
                        <li key={index} className="mt-1.5 first:mt-0">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  )}
                </Caveat>
              )}
            </div>
            {/*
              What the assets did since the last month-end, from the points the line over
              time is drawn from. Assets and not net worth, and it says so: a debt has no
              history to move from. Absent until there are two points, which is when the
              line itself appears.
            */}
            {movement !== null && (
              <p className="hero-move">
                <Delta direction={movement.change.minor > 0n ? 'up' : movement.change.minor < 0n ? 'down' : 'flat'}>
                  {privacy
                    ? formatMoney(movement.change, { privacy })
                    : `${movement.change.minor > 0n ? '+' : ''}${formatMoney(movement.change, { compact: true })}`}
                </Delta>
                <span className="note">
                  change in assets since {formatIsoDate(movement.from)}, money added included
                  {movement.percent !== null ? ` · ${movement.percent}` : ''}
                </span>
              </p>
            )}
            </>
          ) : (
            <>
              {/*
                The figures that exist, and the reason they do not add up, on
                them. The refusal is what it always was — a total short by an
                amount nobody can see is worse than no total — but it is a mark
                on the number rather than a paragraph standing in place of one.
              */}
              <div className="figure" style={{ color: 'var(--ink)' }}>
                {totals.length === 0
                  ? 'nothing valued yet'
                  : totals.map((total, index) => (
                      <span key={total.currency}>
                        {index > 0 && '  +  '}
                        <Amount value={total.value} privacy={privacy} compact />
                      </span>
                    ))}
                <Caveat tone="warn" label="Why these do not add into one figure">
                  {ratesFailed ? (
                    <>
                      The exchange rates could not be read, so these cannot be added into one figure.
                      It is not that a rate is missing: the request failed. Reload to try again.
                    </>
                  ) : (
                    <>
                  {worth.missing.length === 1
                    ? 'One rate is missing: '
                    : String(worth.missing.length) + ' rates are missing: '}
                  {worth.missing.map((pair) => pair.base + ' to ' + pair.quote).join(', ')}. Rather
                  than show a total that quietly leaves the unconvertible holdings out, there is no
                  total — a number short by an amount nobody can see is worse than no number. Record
                  one and these become a single figure, less everything owed.
                    </>
                  )}
                </Caveat>
              </div>

              {canClose && !ratesFailed && (
                <button
                  type="button"
                  className="note mt-3 underline"
                  aria-expanded={addingRate}
                  onClick={() => {
                    setAddingRate((was) => !was);
                  }}
                >
                  {addingRate ? 'Cancel this rate' : 'Add the missing rate'}
                </button>
              )}
            </>
          )}

          {!worth.ok && canClose && addingRate && (
            <div className="mt-3.5 flex flex-wrap items-end gap-3">
              <div className="w-[160px]">
                <Field
                  hint="dated"
                  label={`1 ${worth.missing[0]?.base ?? ''} in ${worth.missing[0]?.quote ?? ''}`}
                  numeric
                  inputMode="decimal"
                  value={newRate}
                  onChange={(event) => {
                    setNewRate(event.target.value);
                  }}
                />
              </div>
              <Button
                type="button"
                disabled={savingRate || newRate.trim() === '' || worth.missing[0] === undefined}
                onClick={() => {
                  const pair = worth.missing[0];
                  if (pair !== undefined) void saveRate(pair);
                }}
              >
                {savingRate ? 'Saving…' : `Record for ${formatIsoDate(asOf ?? today)}`}
              </Button>
              <Caveat tone="info" label="What date this rate applies from">
                Recorded against {formatIsoDate(asOf ?? today)} and used only for figures on or after it. An earlier
                total keeps the rate it was converted at, so last year does not move because the rupee
                did today.
              </Caveat>
            </div>
          )}

          {shownDebts.length > 0 && (
            <dl className="mt-3.5 flex flex-wrap gap-x-9 gap-y-2.5">
              {shownDebts.map((debt) => (
                <Stat key={debt.name} label={debt.name} tone="loss">
                  {privacy ? formatMoney(debt.amount, { privacy }) : `-${formatMoney(debt.amount)}`}
                </Stat>
              ))}
            </dl>
          )}
        </Card>

      </div>

      <div className="empty:hidden lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <AssetsOverTime
          history={history}
          display={display}
          privacy={privacy}
          otherPrivate={hiddenAssets.length > 0}
        />

      </div>

      {/*
        What is held, per currency, at the stat step — 17px, not the hero's.
        Totalled in the currency each holding is priced in, untouched by any rate.
      */}
      <div className="lg:col-start-1 lg:row-start-2">
        {totals.length === 0 ? (
          <Card title="Assets">
            <p className="note">
              No holdings yet. Add one on the Holdings screen and record what it is worth; the figures
              here follow from those readings and from nothing else.
            </p>
          </Card>
        ) : (
          /*
            What is held, one card per currency, at the stat step and not the hero's. Totalled in the
            currency each holding is priced in, untouched by any rate. A household's own currency is
            India and any other is abroad, with the code beside it so a second foreign currency is
            not mistaken for the first.
          */
          <div className="stat-cards">
            {totals.map((total, index) => (
              <section
                key={total.currency}
                className="card stat-card"
                aria-label={`Assets in ${total.currency}`}
              >
                <h3 className="stat-card-label">
                  {total.currency === base ? 'India' : 'Abroad'} · {total.currency}
                  {index === 0 && (
                    <Caveat
                      tone={privateLeftOut ? 'warn' : 'info'}
                      label={privateLeftOut ? 'What these totals leave out' : 'How these totals are put together'}
                    >
                      Totalled per currency, untouched by any rate. These are what each holding is
                      actually worth in what it is actually priced in, which is the number that does not
                      move when a rate is corrected.
                      {privateLeftOut && (
                        <>
                          {' '}
                          <strong>Other members&rsquo; private holdings are not in them.</strong> Net
                          worth above counts those as one sum each ({privateSums}), without the detail,
                          so the two do not add up to each other.
                        </>
                      )}
                    </Caveat>
                  )}
                </h3>
                <div className="stat-card-value" title={exactMoney(total.value, privacy) ?? undefined}>
                  <Amount value={total.value} privacy={privacy} compact />
                  {total.unvalued > 0 && (
                    <Caveat tone="warn" label={`Why this ${total.currency} total is short`}>
                      {total.unvalued} {total.unvalued === 1 ? 'holding has' : 'holdings have'} never been
                      valued, so this total is short by whatever they are worth. The gain is measured
                      only against what was valued, not against everything bought.
                    </Caveat>
                  )}
                </div>
                <div className="stat-card-sub">
                  invested <Amount value={total.investedValued} privacy={privacy} compact />
                  {(total.costShort > 0 || total.costMissing > 0) && (
                    <Caveat tone="warn" label={`Why this ${total.currency} cost is short`}>
                      {total.costShort > 0 && (
                        <>
                          {shortPositionsPhrase(total.costShort)} a statement that covers only part of the
                          history, so what was paid for the earlier units is not in this figure.{' '}
                        </>
                      )}
                      {total.costMissing > 0 && (
                        <>
                          {costMissingPhrase(total.costMissing)} no cost recorded, so nothing for{' '}
                          {total.costMissing === 1 ? 'it is' : 'them is'} in this figure.{' '}
                        </>
                      )}
                      It is the sum of the costs that were recorded, and nothing has been made up to fill
                      the rest.
                    </Caveat>
                  )}
                </div>
                {total.gain === null ? (
                  // Said where the figure would be. Empty space would read as a portfolio with no
                  // return, and a number as one that made a fortune; neither happened.
                  <div className="stat-card-sub">
                    Unrealised gain{' '}
                    <Absent label={`Why there is no ${total.currency} gain`}>
                      {total.costShort > 0 && (
                        <>
                          {shortPositionsPhrase(total.costShort)} a statement that covers only part of the
                          history. {RETURN_REFUSED_BECAUSE}{' '}
                        </>
                      )}
                      {total.costMissing > 0 && (
                        <>
                          {costMissingPhrase(total.costMissing)} no cost recorded.{' '}
                          {COST_MISSING_REFUSED_BECAUSE}{' '}
                        </>
                      )}
                      The value above is right; it is the cost that is not all there.
                    </Absent>
                  </div>
                ) : (
                  <div className="stat-card-gain">
                    <Delta
                      direction={total.gain.minor > 0n ? 'up' : total.gain.minor < 0n ? 'down' : 'flat'}
                    >
                      {percentOfCost(total.gain.minor, total.investedValued.minor) === null
                        ? 'on a cost of nothing'
                        : `${percentOfCost(total.gain.minor, total.investedValued.minor) ?? ''} on cost`}
                    </Delta>
                    <span className={total.gain.minor < 0n ? 'stat-card-loss' : 'stat-card-gainfig'}>
                      {signed(total.gain, privacy)}
                    </span>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}

      </div>

      <div className="empty:hidden lg:col-start-1 lg:row-start-3">
        {allocation.length > 0 && (
          <Card
            title="Allocation"
            aside={
              <Caveat tone={privateLeftOut ? 'warn' : 'info'} label="What these shares are of">
                Shares are of what has been valued, within each currency. A holding nobody has read is
                not here at all — it would need a value to have a share.
                {privateLeftOut && (
                  <>
                    {' '}
                    <strong>Other members&rsquo; private holdings are not here either</strong> ({privateSums}
                    ). A split of them by class would let a member&rsquo;s private figure be worked out,
                    so they are one sum in net worth and left out of the shares.
                  </>
                )}
              </Caveat>
            }
          >
            {/*
              One card, a section per currency. Two cards both titled
              "Allocation" made the page look like it was repeating itself, and
              said nothing about the second being a different currency rather
              than more of the first.
            */}
            <div className="flex flex-col gap-4.5">
              {allocation.map((group) => (
                <div key={group.currency}>
                  <p className="alloc-head">
                    <span className="label">{group.currency}</span>
                    <span className="note">
                      <Amount
                        value={money(group.rows.reduce((sum, row) => sum + row.value.minor, 0n), group.currency)}
                        privacy={privacy}
                        compact
                      />
                    </span>
                  </p>
                  {/* The ring beside the rows, not instead of them: it shows size, and the rows show what it is of. */}
                  <div className="alloc-layout mt-1.5">
                    <AllocationDonut rows={group.rows} currency={group.currency} privacy={privacy} />
                    <ul className="alloc-rows">
                      {group.rows.map((row) => (
                        <li key={row.kind} className="alloc-row">
                          <AssetTile kind={row.kind} />
                          <span className="min-w-0">
                            {/*
                              A name worth clicking. A class here is a total; the
                              holdings behind it are on the other screen, and
                              somebody clicking "Bonds" is asking to see them.
                            */}
                            <button
                              type="button"
                              className="alloc-name block underline"
                              onClick={() => {
                                onOpenHoldings({ kind: row.kind, currency: group.currency });
                              }}
                            >
                              {kindLabel(row.kind)}
                            </button>
                            <span className="alloc-share block">
                              {(row.share * 100).toFixed(1)}% of what is valued
                            </span>
                          </span>
                          <span className="alloc-figures">
                            <span className="alloc-value" title={exactMoney(row.value, privacy) ?? undefined}>
                              {formatMoney(row.value, { privacy, compact: true })}
                            </span>
                            {/*
                              A return only where a cost was recorded. Null is not 0% —
                              one is silence about a figure nobody entered, the other
                              is a claim that it has gone nowhere.
                            */}
                            {row.returnOnCost !== null && row.gain !== null && (
                              <Delta
                                direction={
                                  row.gain.minor > 0n ? 'up' : row.gain.minor < 0n ? 'down' : 'flat'
                                }
                              >
                                {percentOfCost(row.gain.minor, row.invested.minor)}
                              </Delta>
                            )}
                            {/*
                              A refused return says so. The column is otherwise
                              silent for a class with no cost recorded, and this is
                              a different silence: there is a cost, and it is short.
                            */}
                            {(row.costShort > 0 || row.costMissing > 0) && (
                              <Caveat tone="warn" label={`Why there is no return for ${kindLabel(row.kind)}`}>
                                {row.costShort > 0 && (
                                  <>
                                    {shortPositionsPhrase(row.costShort)} a statement that covers only
                                    part of the history. {RETURN_REFUSED_BECAUSE}{' '}
                                  </>
                                )}
                                {row.costMissing > 0 && (
                                  <>
                                    {costMissingPhrase(row.costMissing)} no cost recorded.{' '}
                                    {COST_MISSING_REFUSED_BECAUSE}
                                  </>
                                )}
                              </Caveat>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

      </div>

      <div className="lg:col-start-2 lg:row-start-3">
        <Card
          title="Needs attention"
          aside={<span className="note">{today.slice(0, 4)}</span>}
        >
          {gaps.peak.missingMonths.length === 0 &&
          gaps.line.missingMonths.length === 0 &&
          gaps.neverRead.length === 0 &&
          staleness.stale.length === 0 &&
          alerts.length === 0 &&
          !fixedIncomeFailed &&
          !ratingsFailed &&
          shortPositions.length === 0 ? (
            <p className="note">
              Every holding has a reading in every finished month this year it was held. That is what
              makes the year&rsquo;s peak a figure rather than a lower bound.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {/*
                Three things, three lines. The two months with no reading are the
                one that cannot be put right later — a peak cannot be rebuilt from
                a year-end statement — so it keeps the coral fill and the others
                sit on a quiet surface. Everything else is behind the line.
              */}
              {gaps.peak.missingMonths.length > 0 && (
                <Attention
                  tone="due"
                  headline={
                    <>
                      {gaps.peak.missingMonths.length}{' '}
                      {gaps.peak.missingMonths.length === 1 ? 'month has' : 'months have'} a foreign
                      holding with no reading, so this year&rsquo;s peak is a lower bound
                    </>
                  }
                  names={gaps.peak.missing.map((gap) => `${gap.month}: ${namesFor(gap.holdingIds, holdingName)}`)}
                  namesLabel="Which months, and which holdings"
                >
                  A peak cannot be reconstructed from a year-end statement, which is why the gap
                  matters now and not in April.
                </Attention>
              )}
              {gaps.line.missingMonths.length > 0 && (
                <Attention
                  headline={
                    <>
                      {gaps.line.missingMonths.length}{' '}
                      {gaps.line.missingMonths.length === 1 ? 'month has' : 'months have'} a holding
                      with no reading, so the line over time steps there
                    </>
                  }
                  names={gaps.line.missing.map((gap) => `${gap.month}: ${namesFor(gap.holdingIds, holdingName)}`)}
                  namesLabel="Which months, and which holdings"
                >
                  These are Indian holdings, which have no peak to disclose; a reading for the month
                  keeps the line honest.
                </Attention>
              )}
              {gaps.neverRead.length > 0 && (
                <Attention
                  headline={
                    <>
                      {gaps.neverRead.length}{' '}
                      {gaps.neverRead.length === 1 ? 'holding has' : 'holdings have'} never been
                      valued, and {gaps.neverRead.length === 1 ? 'is' : 'are'} left out of every total
                    </>
                  }
                  names={gaps.neverRead.map(holdingName)}
                  namesLabel="Which holdings"
                >
                  They are absent from every total above rather than counted as zero.
                </Attention>
              )}
              {downgrades.length > 0 && (
                <Attention
                  tone="due"
                  headline={
                    <>
                      {downgrades.length} {downgrades.length === 1 ? 'bond has' : 'bonds have'} been
                      downgraded recently
                    </>
                  }
                  names={downgrades.map(
                    (a) =>
                      `${holdingName(a.holdingId)} — ${a.from ?? 'unrated'} to ${a.to ?? 'unrated'} on ${formatIsoDate(a.on)}`,
                  )}
                  namesLabel="Which bonds"
                >
                  A lower rating is a higher chance of not being repaid. Check the issuer&rsquo;s latest
                  disclosure, and whether to hold it to maturity. The bond&rsquo;s own row on Holdings keeps
                  its rating history.
                </Attention>
              )}
              {maturities.length > 0 && (
                <Attention
                  headline={
                    <>
                      {maturities.length}{' '}
                      {maturities.length === 1 ? 'deposit or bond matures' : 'deposits and bonds mature'} within
                      thirty days
                    </>
                  }
                  names={maturities.map(
                    (a) =>
                      `${holdingName(a.holdingId)} — ${formatIsoDate(a.on)}, ${daysPhrase(a.daysAway ?? 0)}`,
                  )}
                  namesLabel="Which"
                >
                  The money comes back. Decide where it goes before it does, and add it as a new deposit or
                  bond when it is placed.
                </Attention>
              )}
              {renewals.length > 0 && (
                <Attention
                  headline={
                    <>
                      {renewals.length} {renewals.length === 1 ? 'deposit renews' : 'deposits renew'} itself
                      within thirty days
                    </>
                  }
                  names={renewals.map(
                    (a) =>
                      `${holdingName(a.holdingId)} — ${formatIsoDate(a.on)}, ${daysPhrase(a.daysAway ?? 0)}`,
                  )}
                  namesLabel="Which"
                >
                  The money is not coming back: these renew on their own. The bank&rsquo;s advice will give
                  the new rate and amount; record each renewal on Holdings when it arrives.
                </Attention>
              )}
              {ratingNotices.length > 0 && (
                <Attention
                  headline={
                    <>
                      {ratingNotices.length}{' '}
                      {ratingNotices.length === 1 ? 'bond has' : 'bonds have'} a rating change to look at
                    </>
                  }
                  names={ratingNotices.map((a) =>
                    a.kind === 'rating-removed'
                      ? `${holdingName(a.holdingId)} — rating removed on ${formatIsoDate(a.on)}; it was ${a.from ?? 'unrated'}`
                      : `${holdingName(a.holdingId)} — ${a.from ?? 'unrated'} to ${a.to ?? 'unrated'} on ${formatIsoDate(a.on)}, which way is not known`,
                  )}
                  namesLabel="Which bonds"
                >
                  This app reads long-term grades such as AA+, and says so when a change is a short-term
                  rating or something it does not recognise, rather than call it no change. A rating that
                  was removed is not good news either. Check each with the agency&rsquo;s letter.
                </Attention>
              )}
              {(fixedIncomeFailed || ratingsFailed) && (
                <Attention
                  headline={
                    <>
                      {fixedIncomeFailed
                        ? 'Deposits and bonds could not be read'
                        : 'The rating history of bonds could not be read'}
                    </>
                  }
                >
                  {fixedIncomeFailed
                    ? 'A maturity close by would not show here, and the month cannot be closed. '
                    : 'A downgrade would not show here. '}
                  It is not that there are none: the request failed. Reload to try again.
                </Attention>
              )}
              {staleness.stale.length > 0 && (
                <Attention
                  headline={
                    <>
                      {staleness.stale.length}{' '}
                      {staleness.stale.length === 1 ? 'reading is' : 'readings are'} more than{' '}
                      {STALE_AFTER_DAYS} days behind the newest
                    </>
                  }
                  names={staleness.stale.map(
                    (entry) => `${holdingName(entry.holdingId)} — last read ${formatIsoDate(entry.lastRead)}`,
                  )}
                  namesLabel="Which holdings"
                >
                  They are in every total at the value last read, so the total is only as current as
                  its oldest part.
                </Attention>
              )}
              {shortPositions.length > 0 && (
                <Attention
                  headline={
                    <>
                      {shortPositionsPhrase(shortPositions.length)} a statement that covers only part
                      of the history, so no return is shown
                    </>
                  }
                  names={shortPositions}
                  namesLabel="Which positions"
                >
                  Once valued, {shortPositions.length === 1 ? 'it counts' : 'they count'} in net worth
                  in full, because the units are the registrar&rsquo;s own count; the cost, the gain
                  and the history are what is incomplete. A statement requested from before the first
                  purchase fills the gap without doubling anything already recorded.
                </Attention>
              )}
            </div>
          )}

          {canClose && (
            <div className="mt-3.5 flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={closing || !fixedIncomeSettled || fixedIncomeFailed}
                  onClick={() => void close()}
                >
                  {closing ? 'Closing…' : `Close ${monthYear(lastMonthEnd)}`}
                </Button>
                <Caveat tone="info" label="What closing a month does">
                  Closing carries each holding&rsquo;s latest reading in that month to the month end and
                  marks it <Pill tone="warn">backfill</Pill> — a defensible approximation, weaker than a
                  reading taken on the day. A deposit or bond has no reading to carry, so its value is
                  worked out from its terms for the month end and written the same way; a renewal not
                  yet recorded is an estimate and is left unread. Anything else it was not told stays
                  unread. Nothing is overwritten, and running it twice does nothing.
                </Caveat>
                {fixedIncomeFailed && (
                  <span className="note">
                    Deposits and bonds could not be read, so the month cannot be closed: it would carry a
                    stale reading in place of each one&rsquo;s worked-out value, for good. Reload to try again.
                  </span>
                )}
                {closed !== null && (
                  <span className="note">
                    {closed.carried === 0
                      ? closed.worked > 0
                        ? ''
                        : 'Nothing to carry.'
                      : `Carried ${String(closed.carried)} ${closed.carried === 1 ? 'reading' : 'readings'} to the month end.`}
                    {closed.worked > 0 &&
                      ` Worked out ${String(closed.worked)} ${closed.worked === 1 ? 'deposit or bond' : 'deposits and bonds'} from ${closed.worked === 1 ? 'its' : 'their'} terms.`}
                    {notWorkedOut(closed.left) !== '' && ` Not worked out: ${notWorkedOut(closed.left)}.`}
                    {closed.unread > 0 && ` ${String(closed.unread)} unread in all.`}
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
