/**
 * Holdings, and the month-end readings that make disclosure possible.
 *
 * The screen's real job is the second card: recording a value takes a few
 * seconds and cannot be done retrospectively, so it is put in front of you
 * rather than behind a menu. The gaps are shown for the same reason — a missing
 * month is only fixable while you can still remember to fix it.
 */

import { useCallback, useMemo, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, money, parseAmountToMinor } from '../../lib/money.ts';
import type { HoldingListing, InstrumentKind } from '../../repo/types.ts';
import { INSTRUMENT_KINDS } from '../../repo/types.ts';
import { Button, Card, Field, Pill, Problem } from '../../ui/primitives.tsx';
import { useHoldings, type HoldingRow } from './useHoldings.ts';

export function HoldingsScreen({ privacy }: { privacy: boolean }) {
  const { listing, rows, year, setYear, today, loading, problem, add, record } = useHoldings();

  if (loading) return <p className="note px-4.5 py-4.5">Loading…</p>;

  if (problem !== null && listing === null) {
    return (
      <div className="px-4.5 py-4.5">
        <Problem>{problem}</Problem>
      </div>
    );
  }
  if (listing === null) return null;

  const canWrite = listing.viewer.canRecord;

  return (
    <div className="flex flex-col gap-4.5">
      {canWrite && <AddHolding listing={listing} onAdd={add} />}

      <Card
        title="Holdings"
        aside={
          <label className="flex items-center gap-2">
            <span className="micro-label">Peak for</span>
            <select
              className="field w-[92px]"
              value={year}
              onChange={(event) => {
                setYear(Number(event.target.value));
              }}
            >
              {yearsAround(today).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {rows.length === 0 ? (
          <p className="note">
            Nothing recorded yet. Add a holding above, then record what it is worth at each month
            end — that reading is the only way the year&rsquo;s peak can ever be known.
          </p>
        ) : (
          <div className="flex flex-col gap-4.5">
            {rows.map((row) => (
              <HoldingCard
                key={row.holding.id}
                row={row}
                listing={listing}
                privacy={privacy}
                today={today}
                canWrite={canWrite}
                onRecord={record}
              />
            ))}
          </div>
        )}
      </Card>

      <p className="note">
        Foreign-asset disclosure asks for the highest value a holding reached during the calendar
        year — January to December — not its closing value, and not the tax year. It cannot be
        reconstructed from a year-end statement, which is why the readings matter.
      </p>
    </div>
  );
}

function yearsAround(today: string): readonly number[] {
  const current = Number(today.slice(0, 4));
  return [current, current - 1, current - 2];
}

function HoldingCard({
  row,
  listing,
  privacy,
  today,
  canWrite,
  onRecord,
}: {
  row: HoldingRow;
  listing: HoldingListing;
  privacy: boolean;
  today: string;
  canWrite: boolean;
  onRecord: (valuation: Parameters<ReturnType<typeof useHoldings>['record']>[0]) => Promise<void>;
}) {
  const { holding, latest, peak } = row;
  const currency = holding.instrument.currency;

  return (
    <section
      className="rounded p-3.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{holding.instrument.name}</span>
          {holding.instrument.symbol !== null && (
            <span className="num note">{holding.instrument.symbol}</span>
          )}
          {holding.instrument.isForeignAsset && <Pill tone="own">Foreign asset</Pill>}
          {holding.instrument.currency !== holding.instrument.exposureCurrency && (
            <Pill tone="neutral">
              {holding.instrument.currency} · tracks {holding.instrument.exposureCurrency}
            </Pill>
          )}
        </div>
        <span className="num note">
          {holding.quantity} units · {holding.member.displayName}
        </span>
      </header>

      <dl className="mt-3 flex flex-wrap gap-x-9 gap-y-2.5">
        <div>
          <dt className="micro-label">Latest reading</dt>
          <dd className="num" style={{ color: 'var(--ink)' }}>
            {latest === null ? (
              <span className="note">none yet</span>
            ) : (
              <>
                {formatMoney(money(latest.amountMinor, currency), { privacy })}{' '}
                <span className="note">{formatIsoDate(latest.date)}</span>
              </>
            )}
          </dd>
        </div>

        <div>
          <dt className="micro-label">
            Peak {peak.year}
            {peak.isProvisional && ' (provisional)'}
          </dt>
          <dd className="num" style={{ color: 'var(--ink)' }}>
            {peak.peak === null ? (
              <span className="note">not known</span>
            ) : (
              <>
                {formatMoney(peak.peak, { privacy })}{' '}
                {peak.peakDate !== null && (
                  <span className="note">{formatIsoDate(peak.peakDate)}</span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      {peak.missingMonths.length > 0 && <MissingMonths months={peak.missingMonths} />}

      {canWrite && (
        <RecordReading
          listing={listing}
          holdingId={holding.id}
          quantity={holding.quantity}
          currency={currency}
          today={today}
          onRecord={onRecord}
        />
      )}
    </section>
  );
}

/**
 * The gaps, named rather than counted.
 *
 * A peak taken across months that were never recorded is too low, and too low
 * on a disclosure is a wrong figure rather than a missing one. Saying which
 * months are absent is what lets someone go and find them.
 */
function MissingMonths({ months }: { months: readonly string[] }) {
  const label = months.length === 1 ? '1 month has no reading' : `${String(months.length)} months have no reading`;

  return (
    <p
      className="mt-3 rounded px-2.5 py-2 text-caption"
      style={{ background: 'var(--coral-soft)', color: 'var(--coral)' }}
    >
      <span aria-hidden="true">▲</span> {label}, so this peak is a lower bound, not the figure:{' '}
      <span className="num">{months.join(', ')}</span>
    </p>
  );
}

function RecordReading({
  listing,
  holdingId,
  quantity,
  currency,
  today,
  onRecord,
}: {
  listing: HoldingListing;
  holdingId: string;
  quantity: string;
  currency: string;
  today: string;
  onRecord: (valuation: Parameters<ReturnType<typeof useHoldings>['record']>[0]) => Promise<void>;
}) {
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
        await onRecord({
          householdId: listing.household.id,
          holdingId,
          date,
          quantity,
          amount: money(minor, currency),
          // A reading taken now is 'manual'; one reconstructed from a statement
          // later is 'backfill', and should be visibly weaker.
          source: date === today ? 'manual' : 'backfill',
        });
        setAmount('');
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not record that.');
      } finally {
        setBusy(false);
      }
    },
    [amount, currency, date, holdingId, listing.household.id, onRecord, quantity, today],
  );

  return (
    <form
      className="mt-3.5 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[140px] sm:shrink-0">
        <Field
          label={`Value (${currency})`}
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
          label="As at"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={busy || amount.trim() === ''}>
        {busy ? 'Saving…' : 'Record'}
      </Button>
      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </form>
  );
}

function AddHolding({
  listing,
  onAdd,
}: {
  listing: HoldingListing;
  onAdd: (holding: Parameters<ReturnType<typeof useHoldings>['add']>[0]) => Promise<void>;
}) {
  // Same rule as expenses: a contributor records only against their own
  // holdings, so that is all the form offers.
  const selectableMembers = useMemo(
    () =>
      listing.viewer.canFileForOthers
        ? listing.members.filter((member) => !member.isArchived)
        : listing.members.filter((member) => member.id === listing.viewer.memberId),
    [listing.members, listing.viewer.canFileForOthers, listing.viewer.memberId],
  );

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [kind, setKind] = useState<InstrumentKind>('etf');
  const [currency, setCurrency] = useState('USD');
  const [exposure, setExposure] = useState('USD');
  const [isForeign, setIsForeign] = useState(true);
  const [quantity, setQuantity] = useState('');
  const [memberId, setMemberId] = useState(listing.viewer.memberId);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setProblem(null);

      if (!/^\d+(\.\d+)?$/.test(quantity.trim())) {
        setProblem('Quantity must be a number. Fractional shares are fine — 12.5 or 0.734.');
        return;
      }

      setBusy(true);
      try {
        await onAdd({
          householdId: listing.household.id,
          memberId,
          instrument: {
            name: name.trim(),
            kind,
            symbol: symbol.trim() === '' ? null : symbol.trim().toUpperCase(),
            currency: currency.trim().toUpperCase(),
            exposureCurrency: exposure.trim().toUpperCase(),
            isForeignAsset: isForeign,
          },
          quantity: quantity.trim(),
        });
        setName('');
        setSymbol('');
        setQuantity('');
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not add that.');
      } finally {
        setBusy(false);
      }
    },
    [currency, exposure, isForeign, kind, listing.household.id, memberId, name, onAdd, quantity, symbol],
  );

  return (
    <Card title="Add a holding" aside={<span className="note">{listing.household.name}</span>}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="w-full sm:w-auto sm:min-w-[180px] sm:flex-1">
          <Field
            label="Name"
            placeholder="Vanguard S&P 500 ETF"
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>

        <div className="w-full sm:w-[110px] sm:shrink-0">
          <Field
            label="Symbol"
            placeholder="VOO"
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value);
            }}
          />
        </div>

        <label className="flex w-full sm:w-[130px] sm:shrink-0 flex-col gap-1.5">
          <span className="micro-label">Kind</span>
          <select
            className="field"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as InstrumentKind);
            }}
          >
            {INSTRUMENT_KINDS.map((option) => (
              <option key={option} value={option}>
                {option.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>

        <div className="w-full sm:w-[92px] sm:shrink-0">
          <Field
            label="Currency"
            numeric
            maxLength={3}
            required
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value.toUpperCase());
            }}
          />
        </div>

        <div className="w-full sm:w-[104px] sm:shrink-0">
          <Field
            label="Tracks"
            numeric
            maxLength={3}
            required
            hint="Exposure"
            value={exposure}
            onChange={(event) => {
              setExposure(event.target.value.toUpperCase());
            }}
          />
        </div>

        <div className="w-full sm:w-[120px] sm:shrink-0">
          <Field
            label="Quantity"
            numeric
            inputMode="decimal"
            placeholder="12.5"
            required
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
        </div>

        <label className="flex w-full sm:w-[150px] sm:shrink-0 flex-col gap-1.5">
          <span className="micro-label">Member</span>
          <select
            className="field"
            value={memberId}
            onChange={(event) => {
              setMemberId(event.target.value);
            }}
          >
            {selectableMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" disabled={busy || name.trim() === '' || quantity.trim() === ''}>
          {busy ? 'Adding…' : 'Add'}
        </Button>

        {problem !== null && (
          <div className="w-full">
            <Problem>{problem}</Problem>
          </div>
        )}
      </form>

      <label className="mt-3 flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1"
          checked={isForeign}
          onChange={(event) => {
            setIsForeign(event.target.checked);
          }}
        />
        <span className="note">
          <strong>Foreign asset for disclosure.</strong> A US stock or ETF bought through a US
          broker is. An Indian fund that merely tracks a US index is not — it is an Indian asset
          for tax, even though its value moves with the dollar. This is a tax question, not a
          currency one, so the app will not guess it.
        </span>
      </label>
    </Card>
  );
}
