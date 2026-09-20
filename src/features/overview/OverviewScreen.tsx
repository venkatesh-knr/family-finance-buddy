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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  allocationByKind,
  assetTotals,
  readingGaps,
  type HoldingInput,
  type ValuationInput,
} from '../../domain/networth.ts';
import { isQualified, type History } from '../../domain/position.ts';
import { closeMonth, listHoldings, listPersonalHoldingTotals } from '../../repo/holdings.ts';
import {
  costForHolding,
  historyForHolding,
  RETURN_REFUSED_BECAUSE,
  shortPositions as shortPositionsPhrase,
  unitsText,
} from '../holdings/history.ts';
import { addRate, listRates, type FxRate } from '../../repo/rates.ts';
import { listPlan } from '../../repo/planning.ts';
import { netWorth } from '../../domain/fx.ts';
import { Field } from '../../ui/primitives.tsx';
import { istCalendarDate } from '../../lib/dates.ts';
import { exactMoney, formatMoney } from '../../lib/money.ts';
import {
  NoHouseholdError,
  type HoldingListing,
  type PersonalHoldingTotal,
} from '../../repo/types.ts';
import { Button, Card, Caveat, Delta, EyeIcon, Notice, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { kindLabel } from '../../ui/labels.ts';
import { JoinHousehold } from '../household/JoinHousehold.tsx';

/** Chart colours come from tokens in order, so a class keeps its colour. */
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)'];

export function OverviewScreen({
  privacy,
  onPrivacy,
  householdId,
  displayCurrency,
  onOpenHoldings,
}: {
  privacy: boolean;
  /**
   * The same switch as the one in the top bar, offered again beside the
   * figure it hides. That is where somebody is looking when they decide they
   * want it covered, and asking them to go back up to the chrome to do it is
   * the sort of small friction that means it never gets used.
   */
  onPrivacy: () => void;
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
  const [listing, setListing] = useState<HoldingListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  // The rate form is the answer to a question the page only sometimes asks, so
  // it waits behind the sentence that asks it.
  const [addingRate, setAddingRate] = useState(false);
  const [noHousehold, setNoHousehold] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<{ carried: number; unread: number } | null>(null);
  const [rates, setRates] = useState<readonly FxRate[]>([]);
  const [debts, setDebts] = useState<
    readonly {
      amount: import('../../lib/money.ts').Money;
      name: string;
      /** Null is a household debt — everybody's, so it stays in a personal view too. */
      memberId: string | null;
      asOf: string;
    }[]
  >([]);
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

  /**
   * Other members' personal holdings, as one sum each.
   *
   * The household figure is short without these — a personal holding is
   * invisible to everybody but its member, so the assets the client can add up
   * are only part of what the family owns. This is the definer function that
   * returns the sums and never the rows.
   */
  const [personalTotals, setPersonalTotals] = useState<readonly PersonalHoldingTotal[]>([]);
  const [personalTotalsFailed, setPersonalTotalsFailed] = useState(false);

  // Read once at the edge. Every calculation below takes it as an argument.
  const [today] = useState(() => istCalendarDate(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listHoldings(householdId === null ? {} : { householdId });
      setListing(next);
      setProblem(null);
      setNoHousehold(false);

      // Rates and debts separately, and neither may take the screen down. The
      // asset figures stand on their own; these only add the conversion and
      // the subtraction on top of them.
      const [rateResult, planResult, personalResult] = await Promise.allSettled([
        listRates(next.household.id),
        listPlan({ householdId: next.household.id, fy: Number(today.slice(0, 4)) }),
        listPersonalHoldingTotals(next.household.id),
      ]);
      setRates(rateResult.status === 'fulfilled' ? rateResult.value : []);
      setDebts(
        planResult.status === 'fulfilled'
          ? planResult.value.liabilities
              .filter((l) => !l.isClosed && l.outstanding !== null)
              .map((l) => ({
                amount: l.outstanding as import('../../lib/money.ts').Money,
                name: l.name,
                memberId: l.memberId,
                asOf: l.outstandingAsOf ?? '',
              }))
          : [],
      );

      // A failure here is not an empty result, and the difference is the whole
      // point: silently treating it as "no private holdings" would show a
      // household total short by an amount nobody can see. So it is recorded
      // and said on the figure.
      setPersonalTotals(personalResult.status === 'fulfilled' ? personalResult.value : []);
      setPersonalTotalsFailed(personalResult.status === 'rejected');
    } catch (error) {
      if (error instanceof NoHouseholdError) setNoHousehold(true);
      else setProblem(error instanceof Error ? error.message : 'Could not load the overview.');
    } finally {
      setLoading(false);
    }
  }, [householdId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = listing?.viewer.memberId ?? null;

  /**
   * Whether each position's purchases account for the units its statement
   * reported. Worked out once here, because the totals, the allocation and the
   * notice all need the answer and must not each derive their own.
   */
  const histories = useMemo<ReadonlyMap<string, History>>(
    () =>
      listing === null
        ? new Map()
        : new Map(listing.holdings.map((h) => [h.id, historyForHolding(listing, h)])),
    [listing],
  );

  const holdings = useMemo<readonly HoldingInput[]>(
    () =>
      (listing === null ? [] : listing.holdings)
        .filter((h) => scope === 'household' || h.member.id === mine)
        .map((h) => ({
          id: h.id,
          memberId: h.member.id,
          memberName: h.member.displayName,
          kind: h.instrument.kind,
          currency: h.instrument.currency,
          // Derived from the purchases where there are any, exactly as the
          // holdings screen does. This used to read the holding's own column,
          // which an import leaves empty, so a household with imported funds
          // showed less invested here than on the screen beside it.
          cost: costForHolding(listing as HoldingListing, h),
          isArchived: h.isArchived,
          costIsShort: isQualified(histories.get(h.id) ?? { kind: 'unstated' }),
        })),
    [listing, scope, mine, histories],
  );

  /** The positions in view whose cost covers only part of their units, named. */
  const shortPositions = useMemo(
    () =>
      (listing?.holdings ?? [])
        .filter((h) => !h.isArchived && (scope === 'household' || h.member.id === mine))
        .flatMap((h) => {
          const history = histories.get(h.id);
          if (history === undefined || history.kind === 'unstated' || !isQualified(history)) return [];
          return [
            `${h.instrument.name} · ${h.member.displayName} — ${unitsText(history.lotUnits)} of ${unitsText(history.statedUnits)} units`,
          ];
        }),
    [listing, scope, mine, histories],
  );

  const valuations = useMemo<readonly ValuationInput[]>(
    () => {
      // Kept in step with the holdings above. A reading whose holding has been
      // filtered out is not a smaller number, it is a number for something not
      // on screen — and assetTotals would count it.
      const shown = new Set(holdings.map((h) => h.id));
      return (listing?.valuations ?? [])
        .filter((v) => shown.has(v.holdingId))
        .map((v) => ({
          holdingId: v.holdingId,
          date: v.date,
          amount: v.amount,
        }));
    },
    [listing, holdings],
  );

  const totals = useMemo(() => assetTotals({ holdings, valuations }), [holdings, valuations]);

  /**
   * Allocation, grouped by the currency it is an allocation within.
   *
   * Shares are meaningless across currencies without a rate, which is the same
   * reason there is no single net worth figure — so the grouping is the
   * arithmetic being honest, not a layout choice. A currency nothing has been
   * valued in is left out entirely rather than shown as an empty chart.
   */
  const allocation = useMemo(
    () =>
      totals
        .map((total) => ({
          currency: total.currency,
          rows: allocationByKind({ holdings, valuations, currency: total.currency }),
        }))
        .filter((group) => group.rows.length > 0),
    [totals, holdings, valuations],
  );
  const gaps = useMemo(
    () => readingGaps({ holdings, valuations, year: Number(today.slice(0, 4)), today }),
    [holdings, valuations, today],
  );

  // The most recent reading anywhere, which is what "valued as of" means.
  const asOf = useMemo(
    () => valuations.reduce<string | null>((latest, v) => (latest === null || v.date > latest ? v.date : latest), null),
    [valuations],
  );

  const lastMonthEnd = useMemo(() => {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return end.toISOString().slice(0, 10);
  }, [today]);

  const base = listing?.household.baseCurrency ?? 'INR';
  // What this device reads in. The household's own currency until somebody
  // says otherwise, and a rate reads both ways, so USD works from the one row
  // a household records for USD to INR.
  const display = displayCurrency === '' ? base : displayCurrency;

  /**
   * Assets minus debt, in the household's own currency — or a refusal naming
   * the rates it lacks. Converted at the date of the latest reading rather
   * than today, because that is the date the figures are true on.
   */
  const shownDebts = useMemo(
    () =>
      // A debt with no member is the household's, so it belongs in both views.
      // Filtering it out of a personal one would make somebody's own figure
      // better than it is by the size of the mortgage.
      debts.filter((d) => scope === 'household' || d.memberId === null || d.memberId === mine),
    [debts, scope, mine],
  );

  /**
   * What the client cannot see, added back.
   *
   * Only in the household view, and only other members' — the caller's own
   * personal holdings are already rows in `holdings` above, and adding the sum
   * as well would count them twice.
   */
  const hiddenAssets = useMemo(
    () => (scope === 'household' ? personalTotals : []),
    [scope, personalTotals],
  );

  const hiddenUnvalued = useMemo(
    () => hiddenAssets.reduce((sum, entry) => sum + entry.unvalued, 0),
    [hiddenAssets],
  );

  const worth = useMemo(() => {
    return netWorth({
      // One amount per currency, already summed. Converting the totals rather
      // than each holding is the same arithmetic with fewer roundings.
      assets: [...totals.map((t) => t.value), ...hiddenAssets.map((entry) => entry.total)],
      debts: shownDebts.map((d) => d.amount),
      base: display,
      rates,
      on: asOf ?? today,
    });
  }, [totals, hiddenAssets, shownDebts, display, rates, asOf, today]);

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
    if (listing === null) return;
    setClosing(true);
    setProblem(null);
    try {
      setClosed(await closeMonth({ householdId: listing.household.id, monthEnd: lastMonthEnd }));
      await load();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not close the month.');
    } finally {
      setClosing(false);
    }
  }, [listing, lastMonthEnd, load]);

  if (loading) return <p className="note py-4.5">Loading…</p>;
  if (noHousehold) return <JoinHousehold onJoined={() => void load()} />;
  if (problem !== null && listing === null) return <Problem>{problem}</Problem>;
  if (listing === null) return null;

  return (
    <div className="flex flex-col gap-4.5">
      {problem !== null && <Problem>{problem}</Problem>}

      {/*
        Assets first, net worth second.

        It used to be the other way round, which reads well for a household
        holding one currency and badly for one holding two: the first thing on
        the screen was a red paragraph explaining why there was no figure,
        above the figures that did exist. What somebody opens this screen to
        find out is what they have. Whether it adds into a single number is the
        next question, not the first — and when the answer is no, that belongs
        on the figure as a mark rather than as a paragraph shouted above it.
      */}
      <Card
        title="Assets"
        aside={
          <span className="flex flex-wrap items-center gap-2.5">
            {/*
              Two questions people ask separately — "are we on track" and
              "what is mine" — so two answers rather than arithmetic done in
              somebody's head. A group of pressed buttons, not tabs: nothing
              here is a panel, and an incomplete tab pattern announces a
              promise it does not keep.
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
              <span className="note">as at {asOf}</span>
            )}
            {/*
              Said once, on the heading, rather than as a paragraph under every
              figure it describes. Somebody who adds these up and finds they do
              not match a statement needs it; everybody else has read it once.
            */}
            <Caveat tone="info" label="How these totals are put together">
              Totalled per currency, untouched by any rate. These are what each holding is actually
              worth in what it is actually priced in, which is the number that does not move when a
              rate is corrected.
            </Caveat>
            <button
              type="button"
              className="iconbtn"
              aria-pressed={privacy}
              aria-label={privacy ? 'Amounts hidden. Show them.' : 'Amounts shown. Hide them.'}
              onClick={onPrivacy}
            >
              <EyeIcon crossed={privacy} />
            </button>
          </span>
        }
      >
        {totals.length === 0 ? (
          <p className="note">
            No holdings yet. Add one on the Holdings screen and record what it is worth; the figures
            here follow from those readings and from nothing else.
          </p>
        ) : (
          <div className="flex flex-col gap-4.5">
            {totals.map((total) => (
              <div key={total.currency}>
                <p
                  className="figure"
                  style={{ color: 'var(--ink)' }}
                  title={exactMoney(total.value, privacy) ?? undefined}
                >
                  {formatMoney(total.value, { privacy, compact: true })}
                  {total.unvalued > 0 && (
                    <Caveat tone="warn" label={`Why this ${total.currency} total is short`}>
                      {total.unvalued} {total.unvalued === 1 ? 'holding has' : 'holdings have'} never
                      been valued, so this total is short by whatever they are worth. The gain is
                      measured only against what was valued, not against everything bought.
                    </Caveat>
                  )}
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-9 gap-y-2.5">
                  <Stat label="Invested">
                    {formatMoney(total.investedValued, { privacy })}
                    {total.costShort > 0 && (
                      <Caveat tone="warn" label={`Why this ${total.currency} cost is short`}>
                        {shortPositionsPhrase(total.costShort)} a statement that covers only part of
                        the history, so what was paid for the earlier units is not in this figure.
                        It is the sum of the purchases that were recorded, and nothing has been made
                        up to fill the rest.
                      </Caveat>
                    )}
                  </Stat>
                  {total.gain === null ? (
                    // Said where the figure would be. Empty space would read as
                    // a portfolio with no return, and a number as one that made
                    // a fortune; neither happened.
                    <Stat label="Unrealised gain">
                      <span className="note">not shown</span>
                      <Caveat tone="warn" label={`Why there is no ${total.currency} gain`}>
                        {shortPositionsPhrase(total.costShort)} a statement that covers only part of
                        the history. {RETURN_REFUSED_BECAUSE} The total above is right, because the
                        units are the statement&rsquo;s own count; it is the cost that is short.
                      </Caveat>
                    </Stat>
                  ) : (
                    <>
                      <Stat
                        label={total.gain.minor < 0n ? 'Unrealised loss' : 'Unrealised gain'}
                        tone={total.gain.minor < 0n ? 'loss' : 'gain'}
                      >
                        {formatMoney(total.gain, { privacy })}
                      </Stat>
                      <div className="stat">
                        <dt className="micro-label">Change</dt>
                        <dd>
                          <Delta
                            direction={total.gain.minor > 0n ? 'up' : total.gain.minor < 0n ? 'down' : 'flat'}
                          >
                            {total.investedValued.minor === 0n
                              ? 'no cost recorded'
                              : `${String(
                                  Math.round(
                                    (Number(total.gain.minor) / Number(total.investedValued.minor)) * 1000,
                                  ) / 10,
                                )}% on cost`}
                          </Delta>
                        </dd>
                      </div>
                    </>
                  )}
                </dl>

              </div>
            ))}
          </div>
        )}

      </Card>

      <Card
        title="Net worth"
        aside={asOf === null ? undefined : <span className="note">as at {asOf}</span>}
      >
        {worth.ok ? (
          <>
            <p
              className="figure"
              style={{ color: worth.amount.minor < 0n ? 'var(--coral)' : 'var(--ink)' }}
              // The unabbreviated figure, for anybody who wants the digits.
              // Null under privacy: a tooltip that gives away what the bullets
              // hide would make the whole mode decorative.
              title={exactMoney(worth.amount, privacy) ?? undefined}
            >
              {formatMoney(worth.amount, { privacy, compact: true })}
              {/*
                Both of these qualify this number and neither is decoration, so
                they ride on it rather than under the card.
              */}
              {personalTotalsFailed && (
                <Caveat tone="warn" label="Why this total may be short">
                  The private holdings of other members could not be read, so this figure may be
                  short by whatever they are worth. It is not that there are none — the request
                  failed. Reload before relying on this number.
                </Caveat>
              )}
              {!personalTotalsFailed && hiddenUnvalued > 0 && scope === 'household' && (
                <Caveat tone="warn" label="Why this household total is short">
                  {hiddenUnvalued}{' '}
                  {hiddenUnvalued === 1
                    ? 'private holding of another member has'
                    : 'private holdings of other members have'}{' '}
                  never been valued, so this total is short by whatever they are worth. Only they
                  can record a value for them.
                </Caveat>
              )}
            </p>
            <p className="note mt-2">
              {scope === 'household'
                ? 'Everything the household owns'
                : 'Everything you own, and the debts in your name'}
              , converted at the rate for {asOf ?? today}, less everything owed.
              {display !== base && ` Read in ${display}; this household's own currency is ${base}.`}
              {shownDebts.length === 0 && ' No outstanding balances have been recorded, so nothing is subtracted.'}
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
            </p>
          </>
        ) : (
          <>
            {/*
              The figures that exist, and the reason they do not add up, on
              them. The refusal is what it always was — a total short by an
              amount nobody can see is worse than no total — but it is a mark
              on the number now rather than a paragraph standing in place of
              one.
            */}
            <p className="figure" style={{ color: 'var(--ink)' }}>
              {totals.length === 0
                ? 'nothing valued yet'
                : totals
                    .map((total) => formatMoney(total.value, { privacy, compact: true }))
                    .join('  +  ')}
              <Caveat tone="warn" label="Why these do not add into one figure">
                {worth.missing.length === 1
                  ? 'One rate is missing: '
                  : String(worth.missing.length) + ' rates are missing: '}
                {worth.missing.map((pair) => pair.base + ' to ' + pair.quote).join(', ')}. Rather
                than show a total that quietly leaves the unconvertible holdings out, there is no
                total — a number short by an amount nobody can see is worse than no number.
              </Caveat>
            </p>
            <p className="note mt-2">
              Held in{' '}
              {totals.length === 2 ? 'two currencies' : String(totals.length) + ' currencies'} with
              no rate between them. Record one and these become a single figure, less everything
              owed.
            </p>

            {canClose && (
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
                placeholder="88.45"
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
              {savingRate ? 'Saving…' : `Record for ${asOf ?? today}`}
            </Button>
            <Caveat tone="info" label="What date this rate applies from">
              Recorded against {asOf ?? today} and used only for figures on or after it. An earlier
              total keeps the rate it was converted at, so last year does not move because the rupee
              did today.
            </Caveat>
          </div>
        )}

        {shownDebts.length > 0 && (
          <dl className="mt-3.5 flex flex-wrap gap-x-9 gap-y-2.5">
            {shownDebts.map((debt) => (
              <Stat key={debt.name} label={debt.name} tone="loss">
                {formatMoney(debt.amount, { privacy })}
              </Stat>
            ))}
          </dl>
        )}
      </Card>

      {allocation.length > 0 && (
        <Card
          title="Allocation"
          aside={
            <Caveat tone="info" label="What these shares are of">
              Shares are of what has been valued, within each currency. A holding nobody has read is
              not here at all — it would need a value to have a share.
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
                {allocation.length > 1 && <p className="micro-label">{group.currency}</p>}
                <ul className={allocation.length > 1 ? 'mt-1.5' : undefined}>
                  {group.rows.map((row, index) => (
                    <li key={row.kind} className="alloc-row">
                      <span
                        className="alloc-dot"
                        aria-hidden="true"
                        style={{ background: SERIES[index % SERIES.length] ?? 'var(--c1)' }}
                      />
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
                        <span className="alloc-value">{formatMoney(row.value, { privacy })}</span>
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
                            {(row.returnOnCost * 100).toFixed(1)}%
                          </Delta>
                        )}
                        {/*
                          A refused return says so. The column is otherwise
                          silent for a class with no cost recorded, and this is
                          a different silence: there is a cost, and it is short.
                        */}
                        {row.costShort > 0 && (
                          <Caveat tone="warn" label={`Why there is no return for ${kindLabel(row.kind)}`}>
                            {shortPositionsPhrase(row.costShort)} a statement that covers only part
                            of the history. {RETURN_REFUSED_BECAUSE}
                          </Caveat>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Needs attention"
        aside={<span className="note">{today.slice(0, 4)}</span>}
      >
        {gaps.missingMonths.length === 0 && gaps.neverRead.length === 0 && shortPositions.length === 0 ? (
          <p className="note">
            Every finished month this year has a reading. That is what makes the year&rsquo;s peak a
            figure rather than a lower bound.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {gaps.missingMonths.length > 0 && (
              <Notice tone="due" names={[...gaps.missingMonths]} namesLabel="Which months">
                {gaps.missingMonths.length}{' '}
                {gaps.missingMonths.length === 1 ? 'month has' : 'months have'} no reading at all, so
                this year&rsquo;s peak is a lower bound rather than the figure. A peak cannot be
                reconstructed from a year-end statement, which is why the gap matters now and not in
                April.
              </Notice>
            )}
            {gaps.neverRead.length > 0 && (
              <Notice>
                {gaps.neverRead.length}{' '}
                {gaps.neverRead.length === 1 ? 'holding has' : 'holdings have'} never been valued.
                They are absent from every total above rather than counted as zero.
              </Notice>
            )}
            {shortPositions.length > 0 && (
              <Notice tone="due" names={shortPositions} namesLabel="Which positions">
                {shortPositionsPhrase(shortPositions.length)} a statement that covers only part of
                the history. Once valued, {shortPositions.length === 1 ? 'it counts' : 'they count'}{' '}
                in net worth in full, because the units are the registrar&rsquo;s own count; the
                cost, the gain and the history are what is incomplete, and no return is shown for{' '}
                {shortPositions.length === 1 ? 'it' : 'them'}. A statement requested from before
                the first purchase fills the gap without doubling anything already recorded.
              </Notice>
            )}
          </div>
        )}

        {canClose && (
          <div className="mt-3.5 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={closing} onClick={() => void close()}>
                {closing ? 'Closing…' : `Close ${lastMonthEnd.slice(0, 7)}`}
              </Button>
              <Caveat tone="info" label="What closing a month does">
                Closing carries each holding&rsquo;s latest reading in that month to the month end and
                marks it <Pill tone="warn">backfill</Pill> — a defensible approximation, weaker than a
                reading taken on the day. It values nothing it was not told, so a holding nobody read
                stays unread. Nothing is overwritten, and running it twice does nothing.
              </Caveat>
              {closed !== null && (
                <span className="note">
                  {closed.carried === 0
                    ? 'Nothing to carry.'
                    : `Carried ${String(closed.carried)} ${closed.carried === 1 ? 'reading' : 'readings'} to the month end.`}
                  {closed.unread > 0 && ` ${String(closed.unread)} unread.`}
                </span>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
