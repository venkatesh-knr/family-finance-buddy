/**
 * Physical gold's own screen (docs/design/gold.md sections 2, 3 and 6; the GoldPhysical board of docs/design/vibrant-canvas.html).
 *
 * Its value is its grams at the household's typed rate for its purity, never a typed value (GD-I3). The screen shows the sum, what was
 * paid, how far the value is from it, the rate and the day it is for, a way to type a newer one, and a plain link to IBJA's published rate
 * (nothing is fetched, and nothing of the household's goes in the link). With no rate for its purity it says it is not valued: it is not
 * counted as zero and it is not counted at what was paid.
 *
 * What was paid for jewellery includes making charges and GST, so the value starts below it. The screen puts the two side by side and does
 * not call the gap a loss.
 *
 * The value net worth counts is the latest reading, as for every holding (HD-I1). A reading is written when a rate is typed and when the
 * grams change; where the sum here differs from the latest reading, the screen says so and offers to record it.
 */

import { useMemo, useState } from 'react';
import { formatGrams, gramsHeld, physicalGoldValue, ratePerGram, rateIsStale } from '../../domain/gold.ts';
import { formatIsoDate, isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, parseAmountToMinor } from '../../lib/money.ts';
import { parseQuantity } from '../../lib/quantity.ts';
import { recordGoldRate, revalueGold } from '../../repo/gold.ts';
import type { GoldPurity, HoldingListing, NewDisposal, NewLot } from '../../repo/types.ts';
import { Button, Caveat, Delta, Field, Problem } from '../../ui/primitives.tsx';
import { amountOf, GOLD_CURRENCY, GoldCost, gramsOf, workedCost, type CostBy } from './GoldCost.tsx';
import type { GoldData } from './useGold.ts';
import type { HoldingRow } from './useHoldings.ts';

/** Today's rate, published every working day by the India Bullion and Jewellers Association. A plain link: nothing is added to it. */
export const IBJA_URL = 'https://ibjarates.com';

interface Shared {
  readonly row: HoldingRow;
  readonly listing: HoldingListing;
  readonly gold: GoldData;
  readonly today: IsoDate;
  readonly privacy: boolean;
  readonly canWrite: boolean;
  readonly onChanged: () => Promise<void>;
}

/** Physical gold worked out on the day: the grams, the purity, what the rate gives, and what was paid. */
function useWorked({ row, listing, gold, today }: Pick<Shared, 'row' | 'listing' | 'gold' | 'today'>) {
  return useMemo(() => {
    const holding = row.holding;
    const purity = holding.instrument.goldPurity;
    const grams = row.unitsHeld;
    const lots = listing.lots.filter((lot) => lot.holdingId === holding.id);
    const value =
      purity === null || gold.rates === null
        ? null
        : physicalGoldValue({ grams, purity, currency: holding.instrument.currency }, gold.rates, today);
    // The rate row itself, for who typed it and when.
    const typed =
      value !== null && value.ok
        ? (gold.rows ?? []).find(
            (candidate) => candidate.purity === value.rate.purity && candidate.asAt === value.rate.asOf && candidate.typedAt === value.rate.typedAt,
          ) ?? null
        : null;
    return { purity, grams, lots, value, typed, allGifts: lots.length > 0 && lots.every((lot) => lot.kind === 'gift') };
  }, [row, listing.lots, gold.rates, gold.rows, today]);
}

/** In the value card: the sum, what was paid, the rate and how to type a newer one, and the caveat. */
export function PhysicalGoldValue(props: Shared) {
  const { row, listing, gold, today, privacy, canWrite, onChanged } = props;
  const worked = useWorked(props);
  const [typing, setTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { purity, grams, lots, value, typed, allGifts } = worked;
  const currency = row.holding.instrument.currency;
  const label = purity === null ? 'gold' : purity.toUpperCase();
  const mayTypeRate = listing.viewer.role === 'owner' || listing.viewer.role === 'partner';

  if (gold.failed) {
    return (
      <div className="mt-2">
        <Problem>The gold rate could not be read, so this is not valued here. Reload to try again.</Problem>
      </div>
    );
  }
  if (value === null) return <p className="note mt-2">Reading the rate…</p>;

  const paid = row.cost.amount;
  const firstBought = lots.length === 0 ? null : lots.map((lot) => lot.acquiredOn).sort()[0] ?? null;
  const sinceMinor = value.ok && paid !== null ? value.value.minor - paid.minor : null;
  const inNetWorth = row.latest !== null && value.ok && row.latest.amountMinor === value.value.minor;

  return (
    <div className="mt-2 flex flex-col gap-3" data-testid="gold-worked">
      {value.ok ? (
        <p className="note tabular-nums" data-testid="gold-sum">
          {formatGrams(grams)} g × {formatMoney(money(value.rate.perGramMinor, value.rate.currency), { privacy })} a gram
        </p>
      ) : (
        <p className="note" role="status" data-testid="gold-not-valued">
          {value.reason === 'no-rate'
            ? `Not valued: add today's ${label} rate. Gold is worth its grams at the day's rate, and is never counted at zero or at what was paid.`
            : 'Not valued: the rate is in another currency than the gold.'}
        </p>
      )}

      <dl className="term-stats">
        <div className="stat">
          <dt className="label">{allGifts ? 'Received' : `Paid${firstBought === null ? '' : `, ${formatIsoDate(firstBought)}`}`}</dt>
          <dd className="tabular-nums" data-testid="gold-paid">
            {allGifts ? (
              <span className="note">a gift, cost not known</span>
            ) : paid === null ? (
              <span className="note">not recorded</span>
            ) : (
              formatMoney(paid, { privacy })
            )}
          </dd>
        </div>
        {!allGifts && sinceMinor !== null && value.ok && (
          <div className="stat">
            <dt className="label">{sinceMinor < 0n ? 'Below the price paid' : 'Up since'}</dt>
            <dd className="tabular-nums" data-testid="gold-up-since">
              {sinceMinor < 0n ? (
                // Not a loss: the price of jewellery includes making charges and GST, which the gold rate does not. So the gap is shown with
                // its arrow, in the ordinary ink and not the loss colour.
                <span>▼ {formatMoney(money(-sinceMinor, currency), { privacy })}</span>
              ) : (
                <Delta direction={sinceMinor > 0n ? 'up' : 'flat'}>{formatMoney(money(sinceMinor, currency), { privacy })}</Delta>
              )}
            </dd>
          </div>
        )}
      </dl>

      {value.ok && !inNetWorth && (
        <div className="worked-out">
          <p className="worked-out-line worked-out-sub">
            <span>
              not in net worth until recorded
              <Caveat tone="info" label="Why this is not in net worth yet">
                Net worth counts the latest reading. The gold is worth this at the rate, and recording it makes it today&rsquo;s reading.
              </Caveat>
            </span>
          </p>
          {canWrite && (
            <Button
              type="button"
              disabled={recording}
              onClick={() => {
                setRecording(true);
                setProblem(null);
                revalueGold(listing.household.id, today, null, row.holding.id)
                  .then(onChanged)
                  .catch((error: unknown) => {
                    setProblem(error instanceof Error ? error.message : 'Could not record that.');
                  })
                  .finally(() => {
                    setRecording(false);
                  });
              }}
            >
              Record as today’s reading
            </Button>
          )}
        </div>
      )}

      {/* The rate: what it is, the day it is for, who may type a newer one, and where it is read from. */}
      <section aria-label={`${label} rate`} data-testid="gold-rate-card">
        <h3 className="label">
          {label} rate
          {value.ok && <> · {formatMoney(money(value.rate.perGramMinor, value.rate.currency), { privacy })} a gram</>}
        </h3>
        {value.ok ? (
          <p className="note" data-testid="gold-rate-line">
            typed{' '}
            <span className={rateIsStale(value.rate.asOf, today) ? 'rate-stale' : undefined} data-testid="gold-rate-date">
              {formatIsoDate(value.rate.asOf)}
              {rateIsStale(value.rate.asOf, today) && ' (over 30 days ago)'}
            </span>
            {typed !== null && typed.typedBy === listing.viewer.accountId && ' by you'} · used for all your {label} gold
          </p>
        ) : (
          <p className="note">No {label} rate has been typed yet.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {mayTypeRate && purity !== null && (
            <Button
              type="button"
              variant="quiet"
              aria-expanded={typing}
              onClick={() => {
                setTyping((was) => !was);
              }}
            >
              {typing ? 'Cancel' : value.ok ? 'Update rate' : `Add today's ${label} rate`}
            </Button>
          )}
          {/* A plain link: opens in a new tab, and carries nothing of the household's. Nothing is fetched from it. */}
          <a className="quiet-button" href={IBJA_URL} target="_blank" rel="noopener noreferrer">
            Today&rsquo;s rate on IBJA <span className="note">· opens in a new tab</span>
          </a>
        </div>
        {!mayTypeRate && <p className="note mt-1.5">An owner or a partner types the rate.</p>}
        {mayTypeRate && typing && purity !== null && (
          <RateForm
            householdId={listing.household.id}
            purity={purity}
            today={today}
            onDone={async () => {
              setTyping(false);
              await gold.reload();
              await onChanged();
            }}
          />
        )}
      </section>

      {problem !== null && <Problem>{problem}</Problem>}

      {/* Always, in either detail mode: it is what makes the figure honest (DL-I4). */}
      <p className="note" data-testid="gold-caveat">
        Not counted in your emergency fund or liquid money.
        {!allGifts && ' The price paid included making charges, which the gold rate does not.'}
      </p>
    </div>
  );
}

function RateForm({
  householdId,
  purity,
  today,
  onDone,
}: {
  householdId: string;
  purity: GoldPurity;
  today: IsoDate;
  onDone: () => Promise<void>;
}) {
  const [rate, setRate] = useState('');
  const [asAt, setAsAt] = useState<string>(today);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = purity.toUpperCase();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      const minor = amountOf(rate);
      if (minor === null) throw new Error('The rate is above nothing, in rupees for a gram.');
      if (!isIsoDate(asAt) || Number(asAt.slice(0, 4)) < 1990) throw new Error('That date is not one this can be: check the year.');
      if (asAt > today) throw new Error('A rate cannot be dated after today.');
      setBusy(true);
      await recordGoldRate({ householdId, purity, perGram: money(minor, GOLD_CURRENCY), asAt }, today);
      await onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form mt-3 flex flex-wrap items-end gap-3"
      aria-label={`Update the ${label} rate`}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[11rem] sm:shrink-0">
        <Field
          label={`${label} rate per gram (${GOLD_CURRENCY})`}
          numeric
          inputMode="decimal"
          required
          hint="From IBJA's published rate."
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
        <Field
          label="For the day"
          type="date"
          required
          value={asAt}
          onChange={(event) => {
            setAsAt(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save rate'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

/** Below the value card: the purchases, and a way to add one or record a sale; then what the screen is given (purpose, archive). */
export function PhysicalGoldCards(props: Shared & { readonly onLot: (lot: NewLot) => Promise<void>; readonly onSale: (sale: NewDisposal) => Promise<void>; readonly children?: React.ReactNode }) {
  const { row, listing, privacy, today, canWrite, onLot, onSale, children } = props;
  const worked = useWorked(props);
  const [adding, setAdding] = useState<'purchase' | 'sale' | null>(null);
  const currency = row.holding.instrument.currency;
  const { lots } = worked;
  const sales = listing.disposals.filter((sale) => sale.holdingId === row.holding.id);

  return (
    <>
      <section className="card" aria-label="Purchases">
        <h2 className="label">Purchases</h2>
        <p className="note mt-1">{lots.length}</p>
        {lots.length === 0 ? (
          <p className="note mt-1.5">None recorded yet.</p>
        ) : (
          <ul className="row-separated mt-1" data-testid="gold-purchases">
            {[...lots]
              .sort((a, b) => (a.acquiredOn < b.acquiredOn ? 1 : -1))
              .map((lot) => {
                const perGram = lot.cost.minor === 0n ? null : ratePerGram(lot.cost.minor, parseQuantity(lot.quantity));
                return (
                  <li key={lot.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      {formatIsoDate(lot.acquiredOn)}
                      <span className="note"> · {formatGrams(parseQuantity(lot.quantity))} g{lot.kind === 'gift' ? ' · a gift' : ''}</span>
                    </span>
                    <span className="tabular-nums">
                      {lot.kind === 'gift' && lot.cost.minor === 0n ? (
                        <span className="note">cost not known</span>
                      ) : (
                        <>
                          {formatMoney(lot.cost, { privacy })}
                          {perGram !== null && <span className="note"> · {formatMoney(money(perGram, currency), { privacy })}/g</span>}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        )}
        {sales.length > 0 && (
          <>
            <h3 className="label mt-3">Sales</h3>
            <ul className="row-separated mt-1" data-testid="gold-sales">
              {[...sales]
                .sort((a, b) => (a.disposedOn < b.disposedOn ? 1 : -1))
                .map((sale) => (
                  <li key={sale.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      {formatIsoDate(sale.disposedOn)}
                      <span className="note"> · {formatGrams(parseQuantity(sale.quantity))} g</span>
                    </span>
                    <span className="tabular-nums">{formatMoney(sale.proceeds, { privacy })}</span>
                  </li>
                ))}
            </ul>
          </>
        )}
        {canWrite && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="quiet"
              aria-expanded={adding === 'purchase'}
              onClick={() => {
                setAdding((was) => (was === 'purchase' ? null : 'purchase'));
              }}
            >
              {adding === 'purchase' ? 'Cancel this purchase' : 'Add a purchase'}
            </Button>
            <Button
              type="button"
              variant="quiet"
              aria-expanded={adding === 'sale'}
              onClick={() => {
                setAdding((was) => (was === 'sale' ? null : 'sale'));
              }}
            >
              {adding === 'sale' ? 'Cancel this sale' : 'Record a sale'}
            </Button>
          </div>
        )}
        {canWrite && adding === 'purchase' && (
          <PurchaseForm
            householdId={listing.household.id}
            holdingId={row.holding.id}
            today={today}
            onLot={onLot}
            onDone={() => {
              setAdding(null);
            }}
          />
        )}
        {canWrite && adding === 'sale' && (
          <SaleForm
            householdId={listing.household.id}
            holdingId={row.holding.id}
            held={gramsHeld(
              lots.map((lot) => parseQuantity(lot.quantity)),
              sales.map((sale) => parseQuantity(sale.quantity)),
            )}
            today={today}
            onSale={onSale}
            onDone={() => {
              setAdding(null);
            }}
          />
        )}
      </section>

      {children}
    </>
  );
}

function PurchaseForm({
  householdId,
  holdingId,
  today,
  onLot,
  onDone,
}: {
  householdId: string;
  holdingId: string;
  today: IsoDate;
  onLot: (lot: NewLot) => Promise<void>;
  onDone: () => void;
}) {
  const [date, setDate] = useState<string>(today);
  const [weight, setWeight] = useState('');
  const [costBy, setCostBy] = useState<CostBy>('price');
  const [typed, setTyped] = useState('');
  const [gift, setGift] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const grams = gramsOf(weight);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (!isIsoDate(date) || Number(date.slice(0, 4)) < 1990) throw new Error('That date is not one this can be: check the year.');
      if (date > today) throw new Error('A purchase cannot be dated after today.');
      if (grams === null) throw new Error('The weight is in grams, above nothing, to three decimals at most.');
      const cost = workedCost({ gift, costBy, typed, grams });
      if (cost === null) throw new Error(costBy === 'rate' ? 'The rate per gram is needed.' : 'What it cost is needed. If it was a gift, say so.');
      setBusy(true);
      await onLot({
        householdId,
        holdingId,
        acquiredOn: date,
        quantity: weight.trim(),
        cost: money(cost, GOLD_CURRENCY),
        kind: gift ? 'gift' : 'purchase',
        note: gift ? 'A gift: what it cost is not known.' : 'Price paid.',
      });
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form mt-3 flex flex-wrap items-end gap-3"
      aria-label="Add a purchase"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
        <Field
          label="Bought on"
          type="date"
          required
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[8rem] sm:shrink-0">
        <Field
          label="Weight (g)"
          numeric
          inputMode="decimal"
          required
          value={weight}
          onChange={(event) => {
            setWeight(event.target.value);
          }}
        />
      </div>
      <GoldCost grams={grams} gift={gift} costBy={costBy} typed={typed} onCostBy={setCostBy} onTyped={setTyped} />
      <label className="flex w-full items-center gap-2">
        <input
          type="checkbox"
          checked={gift}
          onChange={(event) => {
            setGift(event.target.checked);
          }}
        />
        <span>A gift or inherited, cost not known</span>
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? 'Recording…' : 'Record'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

function SaleForm({
  householdId,
  holdingId,
  held,
  today,
  onSale,
  onDone,
}: {
  householdId: string;
  holdingId: string;
  held: bigint;
  today: IsoDate;
  onSale: (sale: NewDisposal) => Promise<void>;
  onDone: () => void;
}) {
  const [date, setDate] = useState<string>(today);
  const [weight, setWeight] = useState('');
  const [proceeds, setProceeds] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      if (!isIsoDate(date) || Number(date.slice(0, 4)) < 1990) throw new Error('That date is not one this can be: check the year.');
      if (date > today) throw new Error('A sale cannot be dated after today.');
      const grams = gramsOf(weight);
      if (grams === null) throw new Error('The weight is in grams, above nothing, to three decimals at most.');
      if (grams > held) throw new Error(`Only ${formatGrams(held)} g is held, so more than that cannot be sold.`);
      if (proceeds.trim() === '') throw new Error('What it sold for is needed.');
      const minor = parseAmountToMinor(proceeds, GOLD_CURRENCY);
      if (minor < 0n) throw new Error('Proceeds are not negative.');
      setBusy(true);
      await onSale({ householdId, holdingId, disposedOn: date, quantity: weight.trim(), proceeds: money(minor, GOLD_CURRENCY) });
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inset-form mt-3 flex flex-wrap items-end gap-3"
      aria-label="Record a sale"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
        <Field
          label="Sold on"
          type="date"
          required
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[8rem] sm:shrink-0">
        <Field
          label="Weight sold (g)"
          numeric
          inputMode="decimal"
          required
          value={weight}
          onChange={(event) => {
            setWeight(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[10rem] sm:shrink-0">
        <Field
          label={`Sold for (${GOLD_CURRENCY})`}
          numeric
          inputMode="decimal"
          required
          hint="After the costs of selling."
          value={proceeds}
          onChange={(event) => {
            setProceeds(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Recording…' : 'Record'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}
