/**
 * Deposits and bonds, as a ladder.
 *
 * The prototype puts the fixed-income ladder on the investments screen rather than on a
 * tab of its own, and so does this: a deposit is a holding, and it lives where holdings do.
 * What differs is how it is known. The app asks for the terms (principal, rate, dates,
 * compounding) and works the value out on a day, so there is no figure to type every month
 * and none to go stale. A renewal the bank has made is recorded from its advice; one it
 * has not is projected, and said to be a projection.
 *
 * Nothing worked out here is stored unless somebody asks. "Record as today's reading"
 * writes the day's value as an ordinary reading, which is how a deposit comes to be in
 * net worth, the line over time and the month close without any of them learning about
 * terms. A projected renewal is an estimate, and is not offered for recording.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fixedIncomeView,
  MATURITY_NOTICE_DAYS,
  trimRate,
  type FixedIncomePosition,
  type FixedIncomeRefusal,
} from '../../domain/fixed-income.ts';
import { formatIsoDate, istCalendarDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { DOWNGRADE_NOTICE_DAYS, ratingMoves, ratingWatch, type RatingWatch } from '../../domain/ratings.ts';
import { buildPosition, daysPhrase } from './fixedIncomeRows.ts';
import { listFixedIncome, listRatingChanges } from '../../repo/fixedIncome.ts';
import { recordValuation } from '../../repo/holdings.ts';
import type {
  DepositRenewal,
  FixedIncomeListing,
  FixedIncomeTerms,
  Holding,
  HoldingListing,
  RatingChange,
} from '../../repo/types.ts';
import { Button, Card, Caveat, EditButton, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { COMPOUNDING_LABEL, FREQUENCY_LABEL, REPAY_LABEL, RenewalForm, TermsForm } from './FixedIncomeForms.tsx';

const REFUSAL: Record<FixedIncomeRefusal, string> = {
  'before-start': 'It has not started yet, so there is nothing to value.',
  'broken-chain':
    'The renewals recorded do not follow on from one another: there is a gap or an overlap. It is not valued until the dates are put right.',
  'cannot-project':
    'Its term is not a whole number of months, so a renewal cannot be projected. Record the renewal from the bank’s advice.',
  'invalid-terms': 'Its terms cannot be read, so it is not valued.',
};

interface Row {
  readonly holdingId: string;
  readonly holding: Holding;
  readonly terms: FixedIncomeTerms;
  /** The renewals recorded, oldest first. */
  readonly renewals: readonly DepositRenewal[];
  /** This bond's rating changes, oldest first. */
  readonly ratingChanges: readonly RatingChange[];
  /** What to call out about the rating: a downgrade, a change not judged, a removal. */
  readonly watch: RatingWatch | null;
  readonly name: string;
  readonly member: string;
  readonly position: FixedIncomePosition;
  readonly institution: string | null;
  readonly last4: string | null;
  readonly rating: string | null;
  readonly view: ReturnType<typeof fixedIncomeView>;
  /** The end of the last recorded term: where a renewal begins. */
  readonly lastEnd: IsoDate;
}

export function FixedIncome({
  listing,
  privacy,
  canWrite,
  onChanged,
}: {
  listing: HoldingListing;
  privacy: boolean;
  canWrite: boolean;
  /** Called after a write that changes holdings or readings, so the screen above reloads. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<FixedIncomeListing | null>(null);
  const [ratings, setRatings] = useState<readonly RatingChange[]>([]);
  const [ratingsFailed, setRatingsFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [giving, setGiving] = useState<Holding | null>(null);
  const [loading, setLoading] = useState(true);

  // Read once at the edge; the calculation takes it as an argument.
  const [today] = useState(() => istCalendarDate(new Date()));

  const householdId = listing.household.id;
  const load = useCallback(async () => {
    try {
      setData(await listFixedIncome(householdId));
      setProblem(null);
      // Apart from the terms, and its failure said rather than read as no changes: a log
      // that could not be read is not a log with nothing in it, and a downgrade would pass.
      try {
        setRatings(await listRatingChanges(householdId));
        setRatingsFailed(false);
      } catch {
        setRatingsFailed(true);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not read the deposits and bonds.');
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<readonly Row[]>(() => {
    if (data === null) return [];
    const holdings = new Map(listing.holdings.map((h) => [h.id, h]));
    const built: Row[] = [];
    for (const terms of data.terms) {
      const holding = holdings.get(terms.holdingId);
      // Archived, or another member's private holding: not here, and not asked about.
      if (holding === undefined) continue;
      const recorded = data.renewals.filter((r) => r.holdingId === terms.holdingId);
      const position: FixedIncomePosition = buildPosition(terms, recorded);
      const renewals = position.renewals;
      const ratingChanges = ratings
        .filter((c) => c.holdingId === terms.holdingId)
        .sort((a, b) => a.seq - b.seq);
      const ends = [terms.maturity, ...renewals.map((r) => r.maturity)].sort();
      built.push({
        holdingId: terms.holdingId,
        holding,
        terms,
        renewals: recorded,
        ratingChanges,
        watch: ratingWatch(
          ratingChanges.map((c) => ({ seq: c.seq, from: c.from, to: c.to, changedOn: c.changedOn })),
          today,
          DOWNGRADE_NOTICE_DAYS,
        ),
        name: holding.instrument.name,
        member: holding.member.displayName,
        position,
        institution: terms.institution,
        last4: terms.accountLast4,
        rating: terms.rating,
        view: fixedIncomeView(position, today),
        lastEnd: ends[ends.length - 1] ?? terms.maturity,
      });
    }
    // A ladder: what matures first, first. Matured ones after, and what could not be valued last.
    const rank = (row: Row): number => (!row.view.ok ? 2 : row.view.matured ? 1 : 0);
    const when = (row: Row): string =>
      row.view.ok && row.view.kind === 'deposit' && row.view.nextMaturity !== null
        ? row.view.nextMaturity
        : row.view.ok && row.view.kind === 'bond' && !row.view.matured
          ? row.position.maturity
          : row.lastEnd;
    return built.sort((a, b) => rank(a) - rank(b) || (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0));
  }, [data, ratings, listing.holdings, today]);

  /**
   * Deposits and bonds the household already holds, entered before there were terms.
   * Adding one again would be a second holding beside the first, counted twice, so each
   * is offered its terms instead.
   */
  const withoutTerms = useMemo(() => {
    const have = new Set((data?.terms ?? []).map((t) => t.holdingId));
    return listing.holdings.filter(
      (h) => (h.instrument.kind === 'deposit' || h.instrument.kind === 'bond') && !have.has(h.id),
    );
  }, [data, listing.holdings]);

  const totals = useMemo(() => {
    const byCurrency = new Map<string, { value: bigint; projected: number; refused: number }>();
    for (const row of rows) {
      const currency = row.position.principal.currency;
      const bucket = byCurrency.get(currency) ?? { value: 0n, projected: 0, refused: 0 };
      if (row.view.ok) {
        // Paid out is not held: the money is somewhere else now.
        if (!row.view.matured) bucket.value += row.view.value.minor;
        if (row.view.kind === 'deposit' && row.view.projected) bucket.projected += 1;
      } else {
        bucket.refused += 1;
      }
      byCurrency.set(currency, bucket);
    }
    return [...byCurrency.entries()];
  }, [rows]);

  if (loading) {
    return (
      <Card title="Deposits and bonds">
        <p className="note">Loading…</p>
      </Card>
    );
  }

  if (problem !== null && data === null) {
    return (
      <Card title="Deposits and bonds">
        <Problem>{problem}</Problem>
        <div className="mt-3">
          <Button type="button" variant="quiet" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  // Nothing recorded and nobody who can record: the card has nothing to say.
  if (rows.length === 0 && !canWrite) return null;

  return (
    <Card
      title="Deposits and bonds"
      aside={
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="note">worked out from the terms, as at {formatIsoDate(today)}</span>
          <Caveat tone="info" label="How these are valued">
            You give the terms, not a value: principal, rate, dates and how it compounds. The value
            is worked out for the day, so it does not go stale. A deposit that renews itself is a
            chain of terms; a renewal you have recorded is the bank’s figure, and one you have
            not is projected on the same term and marked as a projection. A bond is valued at par,
            its face plus the interest accrued since the last coupon, because there is no market
            price for it. A bond that pays its coupons out is valued at par plus the interest since the
            last coupon; a cumulative one, which pays everything at maturity, as interest that keeps
            compounding at the frequency it is credited. Interest is counted term by term, so a bank that
            pays interest out and renews the principal does not make the first term disappear.
          </Caveat>
        </span>
      }
    >
      {problem !== null && <Problem>{problem}</Problem>}
      {ratingsFailed && (
        <Problem>
          The rating history could not be read, so a downgrade would not show here. It is not that there
          are none: the request failed. Reload to try again.
        </Problem>
      )}

      {canWrite && (
        <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="quiet"
            aria-expanded={adding}
            onClick={() => {
              setAdding((was) => !was);
            }}
          >
            {adding ? 'Cancel' : 'Add a deposit or bond'}
          </Button>
        </div>
      )}

      {canWrite && adding && (
        <TermsForm
          listing={listing}
          mode={{ kind: 'new' }}
          onCancel={() => {
            setAdding(false);
          }}
          onDone={() => {
            setAdding(false);
            void load();
            onChanged();
          }}
        />
      )}

      {rows.length > 0 && (
        <p className="note mb-3">
          These are worked out here and are <strong>not in net worth</strong> until each is recorded as
          a reading, with the button on its row.{' '}
          {listing.viewer.role === 'owner' || listing.viewer.role === 'partner'
            ? 'Closing the month on the Overview also records each one’s value at that month end, apart from an assumed renewal, one that has paid out, or one it cannot value.'
            : ''}
        </p>
      )}

      {canWrite && giving !== null && (
        <TermsForm
          key={giving.id}
          listing={listing}
          mode={{ kind: 'existing', holding: giving }}
          onCancel={() => {
            setGiving(null);
          }}
          onDone={() => {
            setGiving(null);
            void load();
            onChanged();
          }}
        />
      )}

      {rows.length === 0 ? (
        <p className="note">
          None recorded. Give the terms of a fixed deposit or a bond and it is valued from them,
          today and on any day.
        </p>
      ) : (
        <>
          {totals.map(([currency, bucket]) => (
            <dl key={currency} className="mb-3.5 flex flex-wrap gap-x-9 gap-y-2.5">
              <Stat label={totals.length > 1 ? `Worked out, ${currency}` : 'Worked out'}>
                {formatMoney(money(bucket.value, currency), { privacy })}
                {(bucket.projected > 0 || bucket.refused > 0) && (
                  <Caveat tone="warn" label="What this total contains">
                    {bucket.projected > 0 && (
                      <>
                        {bucket.projected}{' '}
                        {bucket.projected === 1 ? 'deposit is' : 'deposits are'} in a renewal that has
                        not been recorded yet, so {bucket.projected === 1 ? 'its' : 'their'} value is an
                        assumption, not the bank’s figure.{' '}
                      </>
                    )}
                    {bucket.refused > 0 && (
                      <>
                        {bucket.refused} could not be valued and {bucket.refused === 1 ? 'is' : 'are'} not
                        in it; each says why below.
                      </>
                    )}
                  </Caveat>
                )}
              </Stat>
            </dl>
          ))}

          <ul className="row-separated">
            {rows.map((row) => (
              <li key={row.holdingId} className="py-3">
                <PositionRow
                  row={row}
                  listing={listing}
                  today={today}
                  privacy={privacy}
                  canWrite={canWrite}
                  householdId={householdId}
                  onChanged={() => {
                    void load();
                    onChanged();
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {canWrite && withoutTerms.length > 0 && (
        <div className="mt-4 border-t pt-3.5" style={{ borderColor: 'var(--line)' }}>
          <p className="label">Held, with no terms yet</p>
          <p className="note mt-1">
            Entered before terms were asked for. Give one its terms and it is valued from them; adding
            it again would make a second holding and count it twice.
          </p>
          <ul className="row-separated mt-2">
            {withoutTerms.map((holding) => (
              <li key={holding.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {holding.instrument.name} <span className="note">{holding.member.displayName}</span>
                </span>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => {
                    setAdding(false);
                    setGiving(holding);
                  }}
                >
                  Give its terms
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function PositionRow({
  row,
  listing,
  today,
  privacy,
  canWrite,
  householdId,
  onChanged,
}: {
  row: Row;
  listing: HoldingListing;
  today: IsoDate;
  privacy: boolean;
  canWrite: boolean;
  householdId: string;
  onChanged: () => void;
}) {
  const { position, view } = row;
  const [renewing, setRenewing] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  const [editingRenewal, setEditingRenewal] = useState<DepositRenewal | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const terms =
    position.kind === 'deposit'
      ? `${trimRate(position.ratePct)}% · ${COMPOUNDING_LABEL[position.compounding ?? 'yearly'].toLowerCase()}`
      : position.repayMode === 'cumulative'
        ? `${trimRate(position.ratePct)}% · ${REPAY_LABEL.cumulative.toLowerCase()} · credited ${FREQUENCY_LABEL[position.couponFrequency ?? 'yearly'].toLowerCase()}`
        : `${trimRate(position.ratePct)}% coupon · ${FREQUENCY_LABEL[position.couponFrequency ?? 'yearly'].toLowerCase()}`;

  const record = async () => {
    if (!view.ok) return;
    setBusy(true);
    setProblem(null);
    try {
      await recordValuation({
        householdId,
        holdingId: row.holdingId,
        date: today,
        quantity: '1',
        amount: view.value,
        source: 'manual',
        note: 'Worked out from the terms',
      });
      setRecorded(true);
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0">
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{row.name}</span>{' '}
          {canWrite && (
            <EditButton
              label={`Correct the terms of ${row.name}`}
              expanded={editingTerms}
              onClick={() => {
                setEditingTerms((was) => !was);
                setRenewing(false);
                setEditingRenewal(null);
              }}
            />
          )}{' '}
          <span className="note">
            {[row.member, row.institution, row.last4 === null ? null : `…${row.last4}`]
              .filter((part) => part !== null)
              .join(' · ')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="neutral">{position.kind === 'deposit' ? 'Deposit' : 'Bond'}</Pill>
          {row.rating !== null && <Pill tone="neutral">{row.rating}</Pill>}
          {row.watch?.kind === 'downgrade' && <Pill tone="due">▼ Downgraded</Pill>}
          {row.watch?.kind === 'unclear' && <Pill tone="warn">Rating changed</Pill>}
          {row.watch?.kind === 'withdrawn' && <Pill tone="warn">Rating removed</Pill>}
          {position.autoRenew && <Pill tone="neutral">Renews itself</Pill>}
          {view.ok && view.matured && <Pill tone="neutral">Matured</Pill>}
          {view.ok && view.kind === 'deposit' && view.projected && <Pill tone="warn">Projected renewal</Pill>}
        </span>
      </div>

      <p className="note">
        {terms} · {position.autoRenew ? 'first term ' : ''}
        {formatIsoDate(position.start)} to {formatIsoDate(position.maturity)}
        {position.autoRenew && position.renewals.length > 0 && ` · renewed ${String(position.renewals.length)}×`}
      </p>

      {!view.ok ? (
        <p className="note" style={{ color: 'var(--ink-2)' }}>
          {REFUSAL[view.reason]}
        </p>
      ) : view.matured ? (
        /*
          Paid out. The bank has the money back in an account, so it is no longer worth
          anything as a holding: no "value today", nothing in the total, and nothing to
          record as a reading. What was paid, and what comes next.
        */
        <>
          <dl className="flex flex-wrap gap-x-9 gap-y-2.5">
            <Stat label={view.kind === 'bond' && view.repay === 'payout' ? 'Repaid at par' : 'Paid out'}>
              {formatMoney(view.value, { privacy })}
            </Stat>
            {view.kind === 'deposit' && (
              <Stat label="Interest earned">{formatMoney(view.interestToDate, { privacy })}</Stat>
            )}
            {view.kind === 'bond' && view.repay === 'cumulative' && (
              <Stat label="Interest earned">{formatMoney(view.accrued, { privacy })}</Stat>
            )}
            <Stat label="Matured on">{formatIsoDate(view.kind === 'deposit' ? row.lastEnd : position.maturity)}</Stat>
          </dl>
          <p className="note">
            It has paid out, so it is no longer a holding and is left out of the total. Record where
            the money went, then archive this.
          </p>
        </>
      ) : (
        <dl className="flex flex-wrap gap-x-9 gap-y-2.5">
          <Stat label={view.kind === 'bond' && view.repay === 'payout' ? 'Value at par' : 'Value today'}>
            {formatMoney(view.value, { privacy })}
          </Stat>
          {view.kind === 'deposit' ? (
            <>
              <Stat label={view.matured ? 'Paid out' : 'This term pays'}>
                {formatMoney(view.maturityValue, { privacy })}
              </Stat>
              <Stat label="Interest so far">{formatMoney(view.interestToDate, { privacy })}</Stat>
              {view.nextMaturity !== null && view.daysToMaturity !== null && (
                <Stat label="Matures">
                  {formatIsoDate(view.nextMaturity)}{' '}
                  <span className="note">{daysPhrase(view.daysToMaturity)}</span>
                </Stat>
              )}
            </>
          ) : (
            <>
              <Stat label={view.repay === 'cumulative' ? 'Interest so far' : 'Accrued'}>
                {formatMoney(view.accrued, { privacy })}
              </Stat>
              {view.repay === 'cumulative' && (
                <Stat label="Pays at maturity">{formatMoney(view.maturityValue, { privacy })}</Stat>
              )}
              {view.nextCoupon !== null && view.couponAmount !== null && (
                <Stat label="Next coupon">
                  {formatIsoDate(view.nextCoupon)}{' '}
                  <span className="note">{formatMoney(view.couponAmount, { privacy })}</span>
                </Stat>
              )}
              {view.daysToMaturity !== null && (
                <Stat label="Matures">
                  {formatIsoDate(position.maturity)}{' '}
                  <span className="note">{daysPhrase(view.daysToMaturity)}</span>
                </Stat>
              )}
            </>
          )}
        </dl>
      )}

      {row.watch !== null && (
        <p
          className="text-caption rounded px-3 py-2"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
        >
          {row.watch.kind === 'downgrade' && (
            <>
              <strong>
                ▼ Downgraded from {row.watch.from ?? 'unrated'} to {row.watch.to ?? 'unrated'} on{' '}
                {formatIsoDate(row.watch.changedOn)}.
              </strong>{' '}
              A lower rating is a higher chance of not being repaid. Check the issuer’s latest
              disclosure before deciding whether to hold it to maturity.
            </>
          )}
          {row.watch.kind === 'unclear' && (
            <>
              <strong>
                The rating changed from {row.watch.from ?? 'unrated'} to {row.watch.to ?? 'unrated'} on{' '}
                {formatIsoDate(row.watch.changedOn)}, and this app could not tell which way.
              </strong>{' '}
              It reads long-term grades such as AA+ and not short-term ones or anything it does not
              recognise. Check the change with the agency’s letter.
            </>
          )}
          {row.watch.kind === 'withdrawn' && (
            <>
              <strong>
                The rating was removed on {formatIsoDate(row.watch.changedOn)}; it was{' '}
                {row.watch.from ?? 'unrated'}.
              </strong>{' '}
              An agency withdrawing a rating is not good news. Check why with the issuer, and enter the
              new rating if there is one.
            </>
          )}
        </p>
      )}

      {view.ok && !view.matured && view.daysToMaturity !== null && view.daysToMaturity <= MATURITY_NOTICE_DAYS && (
        /*
          The prompt the design calls for. It names the decision rather than making it:
          what to do with the money is the household's, and the app only has to make sure
          it is not discovered a month late.
        */
        <p
          className="text-caption rounded px-3 py-2"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--ink)' }}
        >
          <strong>
            {position.kind === 'deposit' && position.autoRenew ? 'Renews' : 'Matures'}{' '}
            {daysPhrase(view.daysToMaturity)}.
          </strong>{' '}
          {position.kind === 'deposit' && position.autoRenew
            ? 'The bank’s advice will give the new rate and amount; record the renewal when it arrives.'
            : 'Decide where the money goes. When it is placed again, add it here as a new deposit or bond, and archive this one.'}
        </p>
      )}

      {problem !== null && <Problem>{problem}</Problem>}

      {row.ratingChanges.length > 0 && (
        <details className="note">
          <summary className="cursor-pointer">
            Rating history ({row.ratingChanges.length})
          </summary>
          <ul className="row-separated mt-1.5">
            {[...ratingMoves(row.ratingChanges.map((c) => ({ seq: c.seq, from: c.from, to: c.to, changedOn: c.changedOn })))]
              .reverse()
              .map((judged) => (
                <li key={judged.seq} className="py-1.5">
                  {formatIsoDate(judged.changedOn)} ·{' '}
                  {judged.move === 'first'
                    ? 'first recorded'
                    : (row.ratingChanges.find((c) => c.seq === judged.seq)?.from ?? 'rated again')}{' '}
                  → {judged.to ?? 'removed'} <strong>{MOVE_WORDS[judged.move]}</strong>
                </li>
              ))}
          </ul>
        </details>
      )}

      {row.renewals.length > 0 && (
        <details className="note">
          <summary className="cursor-pointer">
            {row.renewals.length === 1 ? '1 renewal recorded' : `${String(row.renewals.length)} renewals recorded`}
          </summary>
          <ul className="row-separated mt-1.5">
            {row.renewals.map((renewal) => (
              <li key={renewal.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {formatIsoDate(renewal.start)} to {formatIsoDate(renewal.maturity)} ·{' '}
                  {trimRate(renewal.ratePct)}% · {formatMoney(renewal.principal, { privacy })}
                </span>
                {canWrite && (
                  <EditButton
                    label={`Correct the renewal starting ${formatIsoDate(renewal.start)}`}
                    expanded={editingRenewal?.id === renewal.id}
                    onClick={() => {
                      setEditingRenewal((was) => (was?.id === renewal.id ? null : renewal));
                      setEditingTerms(false);
                      setRenewing(false);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          {view.ok && !view.matured && !(view.kind === 'deposit' && view.projected) && (
            recorded ? (
              // The confirmation is a statement and not a greyed-out control: at the opacity of a disabled
              // button it measured under 3:1, on the one line that says the save worked.
              <span className="note" role="status">
                Recorded as today’s reading
              </span>
            ) : (
              <button type="button" className="quiet-button" disabled={busy} onClick={() => void record()}>
                Record as today’s reading
              </button>
            )
          )}
          {view.ok && view.kind === 'deposit' && view.projected && (
            <span className="note">A projection is not offered as a reading.</span>
          )}
          {position.kind === 'deposit' && (
            <button
              type="button"
              className="quiet-button"
              aria-expanded={renewing}
              onClick={() => {
                setRenewing((was) => !was);
                setEditingTerms(false);
                setEditingRenewal(null);
              }}
            >
              {renewing ? 'Cancel the renewal' : 'Record a renewal'}
            </button>
          )}
        </div>
      )}

      {editingTerms && (
        <TermsForm
          key={row.holdingId}
          listing={listing}
          mode={{ kind: 'edit', holding: row.holding, terms: row.terms }}
          onCancel={() => {
            setEditingTerms(false);
          }}
          onDone={() => {
            setEditingTerms(false);
            onChanged();
          }}
        />
      )}

      {(renewing || editingRenewal !== null) && position.kind === 'deposit' && (
        <RenewalForm
          key={editingRenewal?.id ?? 'new'}
          holdingId={row.holdingId}
          householdId={householdId}
          currency={position.principal.currency}
          defaultCompounding={position.compounding ?? 'yearly'}
          defaultStart={row.lastEnd}
          {...(editingRenewal === null ? {} : { editing: editingRenewal })}
          onCancel={() => {
            setRenewing(false);
            setEditingRenewal(null);
          }}
          onDone={() => {
            setRenewing(false);
            setEditingRenewal(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Said in words and a mark, so a move is never only a colour. */
const MOVE_WORDS: Record<ReturnType<typeof ratingMoves>[number]['move'], string> = {
  upgrade: '▲ upgrade',
  downgrade: '▼ downgrade',
  'same-grade': '— same grade',
  first: '',
  withdrawn: '— withdrawn',
  unknown: '? could not tell which way',
};

