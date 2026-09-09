/**
 * What a position cost, what it has realised, and the workings behind both.
 *
 * The two figures at the top are the answer; the fold underneath is where the
 * answer comes from. That order is deliberate — a purchase list is not what
 * anybody opens this screen for, but it is what they need the moment a number
 * looks wrong.
 *
 * Three things this component takes care to say out loud:
 *
 *   Which kind of cost figure it is showing. A cost derived from recorded
 *   acquisitions and a single number typed in before lots existed are not the
 *   same sort of fact, and showing them identically would be the app being
 *   confidently vague.
 *
 *   That a sale it could not match is a sale it could not match. The matcher
 *   refuses to invent a zero cost; the screen has to refuse to hide the
 *   refusal, or the honesty stops at the module boundary.
 *
 *   That every parcel here is derived, not stored — so a forgotten purchase
 *   entered today changes what it says about a sale from last year, and that
 *   is correct rather than alarming.
 */

import { useCallback, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, minorUnitExponent, money, parseAmountToMinor } from '../../lib/money.ts';
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts';
import type { Disposal, HoldingListing, Lot, NewDisposal, NewLot } from '../../repo/types.ts';
import { Button, Field, Notice, Pill, Problem } from '../../ui/primitives.tsx';
import type { HoldingRow } from './useHoldings.ts';

export function CostAndGains({
  row,
  listing,
  privacy,
  today,
  canWrite,
  onLot,
  onSale,
  onEditLot,
  onEditSale,
}: {
  row: HoldingRow;
  listing: HoldingListing;
  privacy: boolean;
  today: string;
  canWrite: boolean;
  onLot: (lot: NewLot) => Promise<void>;
  onSale: (sale: NewDisposal) => Promise<void>;
  onEditLot: (id: string, patch: { quantity: string; costMinor: bigint; acquiredOn: string }) => Promise<void>;
  onEditSale: (id: string, patch: { quantity: string; proceedsMinor: bigint; disposedOn: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { holding, cost, realisedGain, parcels, shortfalls } = row;
  const currency = holding.instrument.currency;

  const lots = listing.lots.filter((lot) => lot.holdingId === holding.id);
  const sales = listing.disposals.filter((sale) => sale.holdingId === holding.id);

  return (
    <div className="mt-3.5 border-t pt-3.5" style={{ borderColor: 'var(--line)' }}>
      <dl className="flex flex-wrap gap-x-9 gap-y-2.5">
        <div>
          <dt className="micro-label">
            Cost of units held{' '}
            {cost.source === 'holding' && (
              <Pill tone="warn">from the sheet</Pill>
            )}
          </dt>
          <dd className="num" style={{ color: 'var(--ink)' }}>
            {cost.amount === null ? (
              <span className="note">not recorded</span>
            ) : (
              formatMoney(cost.amount, { privacy })
            )}
          </dd>
        </div>

        <div>
          <dt className="micro-label">Realised</dt>
          <dd
            className="num"
            style={{
              color:
                realisedGain === null
                  ? 'var(--ink)'
                  : realisedGain.minor < 0n
                    ? 'var(--coral)'
                    : 'var(--ink)',
            }}
          >
            {realisedGain === null ? (
              <span className="note">nothing sold</span>
            ) : (
              <>
                {/* The sign carries it, never the colour alone. */}
                {realisedGain.minor < 0n ? '−' : realisedGain.minor > 0n ? '+' : ''}
                {formatMoney(
                  money(realisedGain.minor < 0n ? -realisedGain.minor : realisedGain.minor, currency),
                  { privacy },
                )}{' '}
                <span className="note">
                  over {parcels.length === 1 ? '1 parcel' : `${String(parcels.length)} parcels`}
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>

      {cost.source === 'holding' && cost.amount !== null && (
        <div className="mt-3">
          <Notice tone="gap">
            This is the single cost figure entered for the whole position, not a cost derived from
            purchases. A gain cannot be computed from it, because it does not say which units cost
            what. Record the purchases and this figure is replaced by their arithmetic.
          </Notice>
        </div>
      )}

      {shortfalls.length > 0 && (
        <div className="mt-3">
          <Notice tone="due">
            {shortfalls.length === 1 ? 'A sale has' : `${String(shortfalls.length)} sales have`}{' '}
            more units than the recorded purchases account for
            {shortfalls.some((s) => s.reason === 'currency-mismatch') &&
              ', or were made in a different currency from the purchase'}
            . No gain is shown for the uncovered part: costing it at zero would read as a
            hundred-percent gain and put a tax bill on this screen that nobody owes.
          </Notice>
        </div>
      )}

      <button
        type="button"
        className="note mt-3 underline"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {open
          ? 'Hide the workings'
          : `Show the workings (${plural(lots.length, 'purchase')}, ${plural(sales.length, 'sale')})`}
      </button>

      {open && (
        <Workings
          lots={lots}
          sales={sales}
          parcels={parcels}
          currency={currency}
          privacy={privacy}
          canWrite={canWrite}
          onEditLot={onEditLot}
          onEditSale={onEditSale}
        />
      )}

      {canWrite && (
        <div className="mt-3.5 flex flex-col gap-3">
          <RecordEvent
            what="purchase"
            amountLabel={`Cost (${currency})`}
            currency={currency}
            today={today}
            onSubmit={async (quantity, minor, date) => {
              await onLot({
                householdId: listing.household.id,
                holdingId: holding.id,
                acquiredOn: date,
                quantity,
                cost: money(minor, currency),
              });
            }}
          />
          <RecordEvent
            what="sale"
            amountLabel={`Proceeds (${currency})`}
            currency={currency}
            today={today}
            onSubmit={async (quantity, minor, date) => {
              await onSale({
                householdId: listing.household.id,
                holdingId: holding.id,
                disposedOn: date,
                quantity,
                proceeds: money(minor, currency),
              });
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The derivation, laid out.
 *
 * Purchases and sales are what was recorded; parcels are what the matcher made
 * of them. Keeping the three apart on screen is what makes the middle step
 * inspectable — "why is this gain what it is" is answered by reading down the
 * parcel list, not by trusting the total above it.
 */
function Workings({
  lots,
  sales,
  parcels,
  currency,
  privacy,
  canWrite,
  onEditLot,
  onEditSale,
}: {
  lots: readonly Lot[];
  sales: readonly Disposal[];
  parcels: HoldingRow['parcels'];
  currency: string;
  privacy: boolean;
  canWrite: boolean;
  onEditLot: (id: string, patch: { quantity: string; costMinor: bigint; acquiredOn: string }) => Promise<void>;
  onEditSale: (id: string, patch: { quantity: string; proceedsMinor: bigint; disposedOn: string }) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="mt-3 flex flex-col gap-4">
      <Ledger
        heading="Purchases"
        empty="No purchases recorded. Until there are, this holding has no cost basis a gain can be computed from."
        rows={lots.map((lot) => ({
          id: lot.id,
          date: lot.acquiredOn,
          quantity: showQuantity(lot.quantity),
          amount: lot.cost,
          tag: lot.kind === 'purchase' ? null : lot.kind,
        }))}
        amountLabel="Cost"
        privacy={privacy}
        canWrite={canWrite}
        editing={editing}
        setEditing={setEditing}
        currency={currency}
        onSave={async (id, quantity, minor, date) => {
          await onEditLot(id, { quantity, costMinor: minor, acquiredOn: date });
        }}
      />

      <Ledger
        heading="Sales"
        empty="Nothing sold."
        rows={sales.map((sale) => ({
          id: sale.id,
          date: sale.disposedOn,
          quantity: showQuantity(sale.quantity),
          amount: sale.proceeds,
          tag: sale.kind === 'sale' ? null : sale.kind,
        }))}
        amountLabel="Proceeds"
        privacy={privacy}
        canWrite={canWrite}
        editing={editing}
        setEditing={setEditing}
        currency={currency}
        onSave={async (id, quantity, minor, date) => {
          await onEditSale(id, { quantity, proceedsMinor: minor, disposedOn: date });
        }}
      />

      {parcels.length > 0 && (
        <div>
          <h4 className="micro-label">Matched parcels</h4>
          <p className="note mt-1">
            First in, first out, as the Act requires for demat shares and fund units. These are
            worked out fresh every time and never stored: entering a purchase you had forgotten
            changes how the sales after it match, which is the point.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="micro-label text-left">Bought</th>
                  <th className="micro-label text-left">Sold</th>
                  <th className="micro-label text-right">Units</th>
                  <th className="micro-label text-right">Cost</th>
                  <th className="micro-label text-right">Proceeds</th>
                  <th className="micro-label text-right">Gain</th>
                  <th className="micro-label text-right">Held</th>
                </tr>
              </thead>
              <tbody>
                {parcels.map((parcel) => (
                  <tr key={`${parcel.lotId}-${parcel.disposalId}`}>
                    <td className="note py-1">{formatIsoDate(parcel.acquiredOn)}</td>
                    <td className="note py-1">{formatIsoDate(parcel.disposedOn)}</td>
                    <td className="num py-1 text-right">{formatQuantity(parcel.quantity)}</td>
                    <td className="num py-1 text-right">
                      {formatMoney(parcel.cost, { privacy })}
                    </td>
                    <td className="num py-1 text-right">
                      {formatMoney(parcel.proceeds, { privacy })}
                    </td>
                    <td
                      className="num py-1 text-right"
                      style={{ color: parcel.gain.minor < 0n ? 'var(--coral)' : 'var(--ink)' }}
                    >
                      {parcel.gain.minor < 0n ? '−' : parcel.gain.minor > 0n ? '+' : ''}
                      {formatMoney(
                        money(
                          parcel.gain.minor < 0n ? -parcel.gain.minor : parcel.gain.minor,
                          parcel.gain.currency,
                        ),
                        { privacy },
                      )}
                    </td>
                    {/*
                      Days, not "long term" or "short term". The threshold is a
                      dated rule that has moved and will move again, and a prior
                      year must recompute on the rule that applied then — so it
                      lives in tax_rule, which does not exist yet.
                    */}
                    <td className="num py-1 text-right">{String(parcel.heldDays)} d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface LedgerRow {
  readonly id: string;
  readonly date: string;
  readonly quantity: string;
  readonly amount: { readonly minor: bigint; readonly currency: string };
  readonly tag: string | null;
}

function Ledger({
  heading,
  empty,
  rows,
  amountLabel,
  privacy,
  canWrite,
  editing,
  setEditing,
  currency,
  onSave,
}: {
  heading: string;
  empty: string;
  rows: readonly LedgerRow[];
  amountLabel: string;
  privacy: boolean;
  canWrite: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
  currency: string;
  onSave: (id: string, quantity: string, minor: bigint, date: string) => Promise<void>;
}) {
  return (
    <div>
      <h4 className="micro-label">{heading}</h4>
      {rows.length === 0 ? (
        <p className="note mt-1">{empty}</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {rows.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id}>
                <EditRow
                  entry={entry}
                  currency={currency}
                  amountLabel={amountLabel}
                  onCancel={() => {
                    setEditing(null);
                  }}
                  onSave={async (quantity, minor, date) => {
                    await onSave(entry.id, quantity, minor, date);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="note">{formatIsoDate(entry.date)}</span>
                <span className="num">{entry.quantity} units</span>
                <span className="num" style={{ color: 'var(--ink)' }}>
                  {formatMoney(money(entry.amount.minor, entry.amount.currency), { privacy })}
                </span>
                {entry.tag !== null && <Pill tone="neutral">{entry.tag}</Pill>}
                {canWrite && (
                  <button
                    type="button"
                    className="note underline"
                    onClick={() => {
                      setEditing(entry.id);
                    }}
                  >
                    Correct
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Correcting one row.
 *
 * There is no delete on either table, deliberately — removing a purchase
 * silently re-matches every sale after it. That makes editing in place the
 * only way out of a typo, so it cannot be left for later: a mistyped cost with
 * no correction and no deletion would be a wrong gain forever.
 */
function EditRow({
  entry,
  currency,
  amountLabel,
  onCancel,
  onSave,
}: {
  entry: LedgerRow;
  currency: string;
  amountLabel: string;
  onCancel: () => void;
  onSave: (quantity: string, minor: bigint, date: string) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(entry.quantity);
  const [amount, setAmount] = useState(() => toAmountInput(entry.amount.minor, currency));
  const [date, setDate] = useState(entry.date);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setProblem(null);
    let minor: bigint;
    try {
      minor = parseAmountToMinor(amount, currency);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That is not an amount.');
      return;
    }

    setBusy(true);
    try {
      await onSave(quantity, minor, date);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }, [amount, currency, date, onSave, quantity]);

  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <div className="w-full sm:w-[110px] sm:shrink-0">
        <Field
          label="Units"
          numeric
          inputMode="decimal"
          value={quantity}
          onChange={(event) => {
            setQuantity(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[130px] sm:shrink-0">
        <Field
          label={amountLabel}
          numeric
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[150px] sm:shrink-0">
        <Field
          label="Date"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      <Button type="button" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      <button type="button" className="note underline" onClick={onCancel}>
        Cancel
      </button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </div>
  );
}

function RecordEvent({
  what,
  amountLabel,
  currency,
  today,
  onSubmit,
}: {
  what: 'purchase' | 'sale';
  amountLabel: string;
  currency: string;
  today: string;
  onSubmit: (quantity: string, minor: bigint, date: string) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setProblem(null);

      let minor: bigint;
      try {
        minor = parseAmountToMinor(amount, currency);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'That is not an amount.');
        return;
      }

      setBusy(true);
      try {
        await onSubmit(quantity, minor, date);
        setQuantity('');
        setAmount('');
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not record that.');
      } finally {
        setBusy(false);
      }
    },
    [amount, currency, date, onSubmit, quantity],
  );

  return (
    <form
      className="flex flex-wrap items-end gap-2.5"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[110px] sm:shrink-0">
        <Field
          label="Units"
          numeric
          inputMode="decimal"
          placeholder="0"
          required
          value={quantity}
          onChange={(event) => {
            setQuantity(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[130px] sm:shrink-0">
        <Field
          label={amountLabel}
          numeric
          inputMode="decimal"
          placeholder="0.00"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>
      <div className="w-full sm:w-[150px] sm:shrink-0">
        <Field
          label={what === 'purchase' ? 'Bought on' : 'Sold on'}
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy || quantity.trim() === '' || amount.trim() === ''}>
        {busy ? 'Saving…' : what === 'purchase' ? 'Add purchase' : 'Add sale'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The stored scale is not the read scale.
 *
 * `numeric(28, 8)` hands back "60.00000000", which is eight places of nothing
 * and reads as false precision — as though somebody had measured the position
 * to a hundred-millionth. The formatter trims the padding and keeps every
 * significant digit, so a genuinely fractional holding still shows in full.
 */
function showQuantity(stored: string): string {
  try {
    return formatQuantity(parseQuantity(stored));
  } catch {
    // A quantity the parser refuses is one worth seeing exactly as stored.
    return stored;
  }
}

/** Minor units back into something editable: 45175 → "451.75". */
function toAmountInput(minor: bigint, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  if (exponent === 0) return digits;
  return `${digits.slice(0, digits.length - exponent)}.${digits.slice(digits.length - exponent)}`;
}
