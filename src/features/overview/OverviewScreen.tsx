/**
 * Overview — what the household owns, and what the app has not been told.
 *
 * The prototype calls this screen "Net worth". It is not called that here, and
 * the difference is not modesty. Net worth is assets minus debt converted to
 * one currency, and this schema can do neither yet: `liability` records an
 * instalment rather than an outstanding balance, and there is no `fx_rate`
 * table to convert a dollar holding into rupees. A headline reading "Net
 * worth" would be wrong by the size of the mortgage and would silently pick an
 * exchange rate nobody chose.
 *
 * So it says what it can stand behind — assets, per currency — and names the
 * two things missing. That is a screen you can trust with the next figure it
 * shows you; the other kind is not.
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
import { closeMonth, listHoldings } from '../../repo/holdings.ts';
import { addRate, listRates, type FxRate } from '../../repo/rates.ts';
import { listPlan } from '../../repo/planning.ts';
import { netWorth } from '../../domain/fx.ts';
import { Field } from '../../ui/primitives.tsx';
import { istCalendarDate } from '../../lib/dates.ts';
import { formatMoney } from '../../lib/money.ts';
import { NoHouseholdError, type HoldingListing } from '../../repo/types.ts';
import { Bar, Button, Card, Delta, Notice, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { JoinHousehold } from '../household/JoinHousehold.tsx';

const KIND_LABEL: Record<string, string> = {
  equity: 'Equity',
  etf: 'ETF',
  mutual_fund: 'Mutual funds',
  bond: 'Bonds',
  deposit: 'Deposits',
  other: 'Other',
};

/** Chart colours come from tokens in order, so a class keeps its colour. */
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)'];

export function OverviewScreen({
  privacy,
  householdId,
}: {
  privacy: boolean;
  householdId: string | null;
}) {
  const [listing, setListing] = useState<HoldingListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [noHousehold, setNoHousehold] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState<{ carried: number; unread: number } | null>(null);
  const [rates, setRates] = useState<readonly FxRate[]>([]);
  const [debts, setDebts] = useState<readonly { amount: import('../../lib/money.ts').Money; name: string; asOf: string }[]>([]);
  const [newRate, setNewRate] = useState('');
  const [savingRate, setSavingRate] = useState(false);

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
      const [rateResult, planResult] = await Promise.allSettled([
        listRates(next.household.id),
        listPlan({ householdId: next.household.id, fy: Number(today.slice(0, 4)) }),
      ]);
      setRates(rateResult.status === 'fulfilled' ? rateResult.value : []);
      setDebts(
        planResult.status === 'fulfilled'
          ? planResult.value.liabilities
              .filter((l) => !l.isClosed && l.outstanding !== null)
              .map((l) => ({
                amount: l.outstanding as import('../../lib/money.ts').Money,
                name: l.name,
                asOf: l.outstandingAsOf ?? '',
              }))
          : [],
      );
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

  const holdings = useMemo<readonly HoldingInput[]>(
    () =>
      (listing?.holdings ?? []).map((h) => ({
        id: h.id,
        memberId: h.member.id,
        memberName: h.member.displayName,
        kind: h.instrument.kind,
        currency: h.instrument.currency,
        cost: h.cost,
        isArchived: h.isArchived,
      })),
    [listing],
  );

  const valuations = useMemo<readonly ValuationInput[]>(
    () =>
      (listing?.valuations ?? []).map((v) => ({
        holdingId: v.holdingId,
        date: v.date,
        amount: v.amount,
      })),
    [listing],
  );

  const totals = useMemo(() => assetTotals({ holdings, valuations }), [holdings, valuations]);
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

  /**
   * Assets minus debt, in the household's own currency — or a refusal naming
   * the rates it lacks. Converted at the date of the latest reading rather
   * than today, because that is the date the figures are true on.
   */
  const worth = useMemo(() => {
    return netWorth({
      // One amount per currency, already summed. Converting the totals rather
      // than each holding is the same arithmetic with fewer roundings.
      assets: totals.map((t) => t.value),
      debts: debts.map((d) => d.amount),
      base,
      rates,
      on: asOf ?? today,
    });
  }, [totals, debts, base, rates, asOf, today]);

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

      <Card
        title="Net worth"
        aside={asOf === null ? undefined : <span className="note">as at {asOf}</span>}
      >
        {worth.ok ? (
          <>
            <p
              className="figure"
              style={{ color: worth.amount.minor < 0n ? 'var(--coral)' : 'var(--ink)' }}
            >
              {formatMoney(worth.amount, { privacy })}
            </p>
            <p className="note mt-2">
              Everything owned, converted at the rate for {asOf ?? today}, less everything owed.
              {debts.length === 0 && ' No outstanding balances have been recorded, so nothing is subtracted.'}
            </p>
          </>
        ) : (
          <Notice tone="due" names={worth.missing.map((m) => `${m.base} to ${m.quote}`)} namesLabel="Which rates">
            There is no single figure until every currency can be converted. Rather than show a
            total that quietly leaves the unconvertible holdings out, this says which rates are
            missing — a number short by an amount nobody can see is worse than no number.
          </Notice>
        )}

        {!worth.ok && canClose && (
          <div className="mt-3.5 flex flex-wrap items-end gap-3">
            <div className="w-[160px]">
              <Field
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
            <p className="note w-full">
              Recorded against {asOf ?? today} and used only for figures on or after it. An earlier
              total keeps the rate it was converted at, so last year does not move because the rupee
              did today.
            </p>
          </div>
        )}

        {debts.length > 0 && (
          <dl className="mt-3.5 flex flex-wrap gap-x-9 gap-y-2.5">
            {debts.map((debt) => (
              <Stat key={debt.name} label={debt.name} tone="loss">
                {formatMoney(debt.amount, { privacy })}
              </Stat>
            ))}
          </dl>
        )}
      </Card>

      <Card
        title="Assets"
        aside={
          asOf === null ? (
            <span className="note">nothing valued yet</span>
          ) : (
            <span className="note">valued as at {asOf}</span>
          )
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
                <p className="figure" style={{ color: 'var(--ink)' }}>
                  {formatMoney(total.value, { privacy })}
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-9 gap-y-2.5">
                  <Stat label="Invested">{formatMoney(total.investedValued, { privacy })}</Stat>
                  <Stat
                    label={total.gain.minor < 0n ? 'Unrealised loss' : 'Unrealised gain'}
                    tone={total.gain.minor < 0n ? 'loss' : 'gain'}
                  >
                    {formatMoney(total.gain, { privacy })}
                  </Stat>
                  <div className="stat">
                    <dt className="micro-label">Change</dt>
                    <dd>
                      <Delta direction={total.gain.minor > 0n ? 'up' : total.gain.minor < 0n ? 'down' : 'flat'}>
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
                </dl>

                {total.unvalued > 0 && (
                  <div className="mt-3">
                    <Notice>
                      {total.unvalued} {total.unvalued === 1 ? 'holding has' : 'holdings have'} never
                      been valued, so this total is short by whatever they are worth. The gain is
                      measured only against what was valued, not against everything bought.
                    </Notice>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/*
          Said plainly rather than left for somebody to discover by adding the
          figures up themselves and finding they do not match a bank statement.
        */}
        <div className="mt-3.5">
          <Notice>
            Totalled per currency, untouched by any rate. The converted figure is above; these are
            what each holding is actually worth in what it is actually priced in, which is the
            number that does not move when a rate is corrected.
          </Notice>
        </div>
      </Card>

      {totals.map((total) => {
        const rows = allocationByKind({ holdings, valuations, currency: total.currency });
        if (rows.length === 0) return null;
        return (
          <Card key={total.currency} title="Allocation" aside={<span className="note">{total.currency}</span>}>
            <ul className="flex flex-col gap-2.5">
              {rows.map((row, index) => (
                <li key={row.kind} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2.5">
                    <span style={{ color: 'var(--ink)' }}>{KIND_LABEL[row.kind] ?? row.kind}</span>
                    <span className="num note">
                      {formatMoney(row.value, { privacy })} · {(row.share * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Bar
                    value={row.share}
                    target={1}
                    label={`${KIND_LABEL[row.kind] ?? row.kind}, ${(row.share * 100).toFixed(1)} per cent`}
                    colour={SERIES[index % SERIES.length] ?? 'var(--c1)'}
                  />
                </li>
              ))}
            </ul>
            <p className="note mt-3.5">
              Shares are of what has been valued in {total.currency}. A holding nobody has read is
              not in this chart at all — it would need a value to have a share.
            </p>
          </Card>
        );
      })}

      <Card
        title="Needs attention"
        aside={<span className="note">{today.slice(0, 4)}</span>}
      >
        {gaps.missingMonths.length === 0 && gaps.neverRead.length === 0 ? (
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
          </div>
        )}

        {canClose && (
          <div className="mt-3.5 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={closing} onClick={() => void close()}>
                {closing ? 'Closing…' : `Close ${lastMonthEnd.slice(0, 7)}`}
              </Button>
              {closed !== null && (
                <span className="note">
                  {closed.carried === 0
                    ? 'Nothing to carry.'
                    : `Carried ${String(closed.carried)} ${closed.carried === 1 ? 'reading' : 'readings'} to the month end.`}
                  {closed.unread > 0 && ` ${String(closed.unread)} unread.`}
                </span>
              )}
            </div>
            <p className="note">
              Closing carries each holding&rsquo;s latest reading in that month to the month end and
              marks it <Pill tone="warn">backfill</Pill> — a defensible approximation, weaker than a
              reading taken on the day. It values nothing it was not told, so a holding nobody read
              stays unread. Nothing is overwritten, and running it twice does nothing.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
