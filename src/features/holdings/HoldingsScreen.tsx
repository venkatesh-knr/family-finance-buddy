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
import {
  exactMoney,
  formatMoney,
  percentOfCost,
  isKnownCurrency,
  knownCurrencyCodes,
  money,
  parseAmountToMinor,
} from '../../lib/money.ts';
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts';
import type { HoldingListing, InstrumentKind } from '../../repo/types.ts';
import { INSTRUMENT_KINDS } from '../../repo/types.ts';
import { Button, Card, Caveat, Field, Pill, Problem, Stat } from '../../ui/primitives.tsx';
import { CostAndGains } from './CostAndGains.tsx';
import { EditHolding } from './EditHolding.tsx';
import { updateDisposal, updateLot } from '../../repo/lots.ts';
import { archiveHolding } from '../../repo/holdings.ts';
import { useHoldings, type HoldingRow } from './useHoldings.ts';

type SortBy = 'value' | 'name' | 'member';

export function HoldingsScreen({ privacy, householdId }: { privacy: boolean; householdId: string | null }) {
  const { listing, rows, year, setYear, today, loading, problem, add, record, recordLot, recordSale, reload, taxRules, refresh } =
    useHoldings(householdId);
  const [sortBy, setSortBy] = useState<SortBy>('value');

  /**
   * Totals per currency, on the same terms as Overview: never summed across
   * currencies, and a holding nobody has read is absent rather than zero.
   */
  const totals = useMemo(() => {
    const byCurrency = new Map<string, { value: bigint; invested: bigint; unread: number }>();
    for (const row of rows) {
      const currency = row.holding.instrument.currency;
      const bucket = byCurrency.get(currency) ?? { value: 0n, invested: 0n, unread: 0 };
      // The row's cost, not the holding's: where lots exist it is derived from
      // them net of sales, which is the figure that is actually still invested.
      bucket.invested += row.cost.amount?.minor ?? 0n;
      if (row.latest === null) bucket.unread += 1;
      else bucket.value += row.latest.amountMinor;
      byCurrency.set(currency, bucket);
    }
    return [...byCurrency.entries()].map(([currency, b]) => ({ currency, ...b }));
  }, [rows]);

  // Biggest first by default: on a list of twenty, the largest position is
  // almost always the one the question is about.
  const ordered = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortBy === 'name') {
        return a.holding.instrument.name.localeCompare(b.holding.instrument.name);
      }
      if (sortBy === 'member') {
        return (
          a.holding.member.displayName.localeCompare(b.holding.member.displayName) ||
          a.holding.instrument.name.localeCompare(b.holding.instrument.name)
        );
      }
      const av = a.latest?.amountMinor ?? -1n;
      const bv = b.latest?.amountMinor ?? -1n;
      return bv > av ? 1 : bv < av ? -1 : 0;
    });
    return copy;
  }, [rows, sortBy]);

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

      {totals.length > 0 && (
        <Card
          title="Portfolio"
          aside={
            <span className="flex flex-wrap items-center gap-2.5">
              <span className="note">latest readings</span>
              {canWrite && <RefreshPrices onRefresh={refresh} />}
            </span>
          }
        >
          <div className="flex flex-col gap-4.5">
            {totals.map((total) => {
              const gain = total.value - total.invested;
              return (
                <div key={total.currency}>
                  <p
                    className="figure"
                    style={{ color: 'var(--ink)' }}
                    title={exactMoney(money(total.value, total.currency), privacy) ?? undefined}
                  >
                    {formatMoney(money(total.value, total.currency), { privacy, compact: true })}
                  </p>
                  <dl className="mt-3 flex flex-wrap gap-x-9 gap-y-2.5">
                    <Stat label="Invested">
                      {formatMoney(money(total.invested, total.currency), { privacy })}
                    </Stat>
                    <Stat label={gain < 0n ? 'Total loss' : 'Total return'} tone={gain < 0n ? 'loss' : 'gain'}>
                      {formatMoney(money(gain, total.currency), { privacy })}
                      {/*
                        The percentage beside the amount, because ₹67,500 says
                        nothing about whether it was a good year until you know
                        what was staked to get it. The sign carries the
                        direction; the colour only agrees with it.
                      */}
                      {percentOfCost(gain, total.invested) !== null && (
                        <span className="note"> {percentOfCost(gain, total.invested)}</span>
                      )}
                    </Stat>
                    {total.unread > 0 && (
                      <Stat label="Unread">
                        {total.unread} {total.unread === 1 ? 'holding' : 'holdings'}
                      </Stat>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
          <p className="note mt-3.5">
            Each currency on its own, and a holding nobody has read is not in these figures at all
            — counting it as zero would make the total look complete while being short.
          </p>
        </Card>
      )}

      <Card
        title={rows.length === 0 ? 'Holdings' : `Holdings (${String(rows.length)})`}
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
          <>
            <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
              <span className="micro-label">Sort</span>
              <span className="segmented" role="group" aria-label="Sort holdings">
                {(['value', 'name', 'member'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={sortBy === option}
                    onClick={() => {
                      setSortBy(option);
                    }}
                  >
                    {option === 'value' ? 'Largest' : option === 'name' ? 'Name' : 'Member'}
                  </button>
                ))}
              </span>
            </div>

            <div className="flex flex-col gap-4.5">
              {ordered.map((row) => (
                <HoldingCard
                  key={row.holding.id}
                  row={row}
                  listing={listing}
                  privacy={privacy}
                  today={today}
                  canWrite={canWrite}
                  onRecord={record}
                  onLot={recordLot}
                  onSale={recordSale}
                  onReload={reload}
                  taxRules={taxRules}
                />
              ))}
            </div>
          </>
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
  onLot,
  onSale,
  onReload,
  taxRules,
}: {
  row: HoldingRow;
  listing: HoldingListing;
  privacy: boolean;
  today: string;
  canWrite: boolean;
  onRecord: (valuation: Parameters<ReturnType<typeof useHoldings>['record']>[0]) => Promise<void>;
  taxRules: ReturnType<typeof useHoldings>['taxRules'];
  onLot: ReturnType<typeof useHoldings>['recordLot'];
  onSale: ReturnType<typeof useHoldings>['recordSale'];
  onReload: ReturnType<typeof useHoldings>['reload'];
}) {
  const { holding, latest, peak } = row;
  const currency = holding.instrument.currency;
  const [editing, setEditing] = useState(false);

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
          {/*
            "A privacy control nobody can observe working is indistinguishable
            from one that does nothing" (§20). A holding reaching this screen
            at all is one the caller may read, so a personal one here is always
            their own — and without this the toggle in the editor saved a state
            with nothing on the screen to show for it.
          */}
          {holding.visibility === 'personal' && <Pill tone="own">Private</Pill>}
          {holding.instrument.currency !== holding.instrument.exposureCurrency && (
            <Pill tone="neutral">
              {holding.instrument.currency} · tracks {holding.instrument.exposureCurrency}
            </Pill>
          )}
        </div>
        <span className="num note">
          {formatQuantity(parseQuantity(holding.quantity))} units · {holding.member.displayName}
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
                {/*
                  On the figure, not under the card. A peak taken across months
                  that were never read is too low, and too low on a disclosure
                  is a wrong figure rather than a missing one — so the number
                  itself has to carry the mark, or somebody reads it as clean.
                */}
                {peak.missingMonths.length > 0 && (
                  <Caveat tone="warn" label={`Why this ${String(peak.year)} peak is a lower bound`}>
                    <MissingMonths months={peak.missingMonths} />
                  </Caveat>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      {row.quoted !== null && (
        <QuotedValue row={row} canWrite={canWrite} today={today} onRecord={onRecord} listing={listing} />
      )}

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

      {canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-3.5">
          <button
            type="button"
            className="note underline"
            onClick={() => {
              setEditing((was) => !was);
            }}
          >
            {editing ? 'Cancel correction' : 'Correct this holding'}
          </button>
          <ArchiveHolding row={row} onDone={onReload} />
        </div>
      )}

      {canWrite && editing && (
        <EditHolding
          holding={holding}
          isMine={holding.member.id === listing.viewer.memberId}
          // Readings, purchases or sales already denominated in this currency.
          // Changing it would leave them behind in the old one.
          hasHistory={
            latest !== null ||
            listing.lots.some((lot) => lot.holdingId === holding.id) ||
            listing.disposals.some((sale) => sale.holdingId === holding.id)
          }
          currencyOptions={<CurrencyOptions />}
          onDone={async () => {
            setEditing(false);
            await onReload();
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      )}

      <CostAndGains
        taxRules={taxRules}
        row={row}
        listing={listing}
        privacy={privacy}
        today={today}
        canWrite={canWrite}
        onLot={onLot}
        onSale={onSale}
        onEditLot={async (id, patch) => {
          await updateLot(id, patch);
          await onReload();
        }}
        onEditSale={async (id, patch) => {
          await updateDisposal(id, patch);
          await onReload();
        }}
      />
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

  // The months are named rather than counted, because naming them is what lets
  // somebody go and find the readings. They live inside the caveat now: the
  // mark on the figure says the number is a lower bound, and this says why and
  // which months to go looking for.
  return (
    <>
      <span>{label}, so this peak is a lower bound, not the figure.</span>
      <ul className="notice-names">
        {months.map((month) => (
          <li key={month}>{month}</li>
        ))}
      </ul>
    </>
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

      // The selects cannot offer a bad code, but a runtime without ICU falls
      // back to the shape test and would let one through again.
      if (!isKnownCurrency(currency) || !isKnownCurrency(exposure)) {
        setProblem('Choose real currencies. Both must be ISO codes like INR or USD.');
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
    <Card
      title="Add a holding"
      // Folded by default. A holding is added a handful of times a year and
      // read every week, so the form was costing a screen of scrolling on
      // every visit to pay for something almost nobody was there to do.
      collapsible
      defaultOpen={false}
      summary="Open to record a new instrument and position."
      aside={<span className="note">{listing.household.name}</span>}
    >
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

        {/*
          Chosen, not typed. These were free-text three-character boxes, and a
          testing round put "ABC" in one: three capitals is what the shape test
          asks for, and the field asked for three capitals. A list cannot
          produce a currency that does not exist.
        */}
        <label className="flex w-full sm:w-[116px] sm:shrink-0 flex-col gap-1.5">
          <span className="micro-label">Priced in</span>
          <select
            className="field"
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
            }}
          >
            <CurrencyOptions />
          </select>
        </label>

        <label className="flex w-full sm:w-[116px] sm:shrink-0 flex-col gap-1.5">
          <span className="micro-label">
            Tracks
            {/*
              The distinction that made the two boxes look broken beside each
              other: an Indian feeder fund is priced in rupees and moves with
              the dollar, so these are genuinely two answers and neither
              follows from the other.
            */}
            <Caveat tone="info" label="What Tracks means, and how it differs from Priced in">
              What the value actually follows. An Indian fund tracking a US index is priced in INR
              and tracks USD — its rupee value moves when the dollar does. A US stock bought
              directly is USD and USD. Leave it the same as the currency unless the two genuinely
              differ.
            </Caveat>
          </span>
          <select
            className="field"
            value={exposure}
            onChange={(event) => {
              setExposure(event.target.value);
            }}
          >
            <CurrencyOptions />
          </select>
        </label>

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

/**
 * Every currency this runtime knows, with the two this household actually uses
 * first.
 *
 * A hundred and sixty codes in alphabetical order is a list, not a chooser —
 * INR and USD are the answer almost every time, so they go where the thumb
 * already is, and the rest follow for the once a year they do not.
 */
function CurrencyOptions() {
  const all = knownCurrencyCodes();
  const common = ['INR', 'USD'].filter((code) => all.length === 0 || all.includes(code));
  const rest = all.filter((code) => !common.includes(code));

  return (
    <>
      {common.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
      {rest.length > 0 && (
        <optgroup label="Everything else">
          {rest.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

/**
 * Retiring a holding you no longer own — or one that should never have been
 * entered.
 *
 * Archive rather than delete, and the button says so, because the two are
 * different promises and somebody clicking this is entitled to know which one
 * they are getting. The readings stay: they are the only record of what this
 * was worth on the dates they cover, and a calendar-year peak cannot be
 * reconstructed from anything else once they are gone.
 *
 * Behind a confirmation, and the confirmation says what is not yet possible —
 * there is no screen that lists archived holdings, so bringing one back needs
 * somebody with database access. That is worth saying before the click rather
 * than discovering after it.
 */
function ArchiveHolding({
  row,
  onDone,
}: {
  row: HoldingRow;
  onDone: ReturnType<typeof useHoldings>['reload'];
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!confirming) {
    return (
      <>
        <button
          type="button"
          className="note underline"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Archive this holding
        </button>
        {problem !== null && (
          <div className="mt-2 w-full">
            <Problem>{problem}</Problem>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-caption" style={{ color: 'var(--ink-2)' }}>
        Archive <strong>{row.holding.instrument.name}</strong>? It leaves every total and every
        screen. Nothing is deleted — its readings, purchases and sales stay, because they are the
        record of what it was worth on the dates they cover. There is no screen yet that lists
        archived holdings, so bringing it back would need database access.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setProblem(null);
            archiveHolding(row.holding.id)
              .then(onDone)
              .catch((error: unknown) => {
                setProblem(error instanceof Error ? error.message : 'Could not archive that.');
              })
              .finally(() => {
                setBusy(false);
                setConfirming(false);
              });
          }}
        >
          {busy ? 'Archiving…' : 'Yes, archive it'}
        </Button>
        <button
          type="button"
          className="note underline"
          onClick={() => {
            setConfirming(false);
          }}
        >
          Keep it
        </button>
      </div>
      {problem !== null && (
        <div className="mt-2">
          <Problem>{problem}</Problem>
        </div>
      )}
    </div>
  );
}

/**
 * What the driver says this is worth, offered rather than assumed.
 *
 * The figure is not a reading until somebody records it, and that distinction
 * is the point rather than an extra click. A valuation is a statement the
 * household makes about its own position — §606's whole argument is that these
 * readings are the record, and a record that wrote itself from a feed is a
 * different kind of claim from one a person stood behind. It also keeps the
 * feed auditable: every stored valuation has a member and a moment attached.
 *
 * The date the price is FOR is shown, not the date it was fetched. A NAV for
 * Friday read on Monday is Friday's figure, and showing Monday would quietly
 * misdate every valuation taken from it.
 */
function QuotedValue({
  row,
  canWrite,
  today,
  onRecord,
  listing,
}: {
  row: HoldingRow;
  canWrite: boolean;
  today: string;
  onRecord: (valuation: Parameters<ReturnType<typeof useHoldings>['record']>[0]) => Promise<void>;
  listing: HoldingListing;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const quoted = row.quoted;
  if (quoted === null) return null;

  // Already recorded for that date, so there is nothing to offer.
  const already = row.latest !== null && row.latest.date >= quoted.price.asOf;

  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      <span className="micro-label">Quoted</span>
      <span className="num" style={{ color: 'var(--ink)' }}>
        {formatMoney(quoted.value, { privacy: false })}
      </span>
      <span className="note">
        {quoted.price.value} on {formatIsoDate(quoted.price.asOf)}
      </span>

      {already ? (
        <span className="note">already recorded</span>
      ) : (
        canWrite && (
          <button
            type="button"
            className="note underline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem(null);
              void onRecord({
                householdId: listing.household.id,
                holdingId: row.holding.id,
                date: quoted.price.asOf,
                quantity: row.holding.quantity,
                amount: quoted.value,
                // Recorded on the date the price is for. 'manual' when that is
                // today, 'backfill' when it is an earlier day being caught up
                // — the same rule a typed reading follows, and the weaker
                // label is the honest one for a figure reconstructed later.
                source: quoted.price.asOf === today ? 'manual' : 'backfill',
              })
                .catch((error: unknown) => {
                  setProblem(error instanceof Error ? error.message : 'Could not record that.');
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {busy ? 'Recording…' : 'Record this as the reading'}
          </button>
        )
      )}

      {problem !== null && (
        <div className="w-full">
          <Problem>{problem}</Problem>
        </div>
      )}
    </div>
  );
}

/**
 * Ask the driver to fetch.
 *
 * A button rather than something the screen does on load, for the same reason
 * the month-end close is: "a screen that quietly writes rows is harder to
 * trust than one that says what it is about to do". This one reaches a vendor
 * as well, which is a second reason not to do it behind somebody's back on
 * every page view.
 *
 * It reports what happened rather than just finishing. Nothing written because
 * nothing is linked to a feed, and nothing written because the vendor was
 * unreachable, look identical from the outside and mean entirely different
 * things.
 */
function RefreshPrices({
  onRefresh,
}: {
  onRefresh: ReturnType<typeof useHoldings>['refresh'];
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className="note underline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setSaid(null);
          onRefresh()
            .then((result) => {
              setSaid(
                result.note ??
                  (result.written === 0
                    ? 'Nothing new to record.'
                    : `${String(result.written)} price${result.written === 1 ? '' : 's'} recorded.`),
              );
            })
            .catch((error: unknown) => {
              setSaid(error instanceof Error ? error.message : 'Could not fetch prices.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? 'Fetching…' : 'Fetch prices'}
      </button>
      {said !== null && <span className="note">{said}</span>}
    </>
  );
}
