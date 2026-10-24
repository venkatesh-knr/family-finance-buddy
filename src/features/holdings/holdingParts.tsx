/**
 * The parts of the Holdings screens that more than one of them uses: the forms that add, record and archive, the
 * quoted value and the price refresh, and the way a gap in the readings is named. Moved out of `HoldingsScreen`
 * unchanged when the list and the detail view became two components.
 */

import { useCallback, useMemo, useState } from 'react';
import { formatIsoDate } from '../../lib/dates.ts';
import { formatMoney, isKnownCurrency, knownCurrencyCodes, money, parseAmountToMinor } from '../../lib/money.ts';
import { quantityToNumeric } from '../../lib/quantity.ts';
import type { HoldingListing, InstrumentKind } from '../../repo/types.ts';
import { INSTRUMENT_KINDS } from '../../repo/types.ts';
import { Button, Card, Caveat, Field, Problem, RowAction } from '../../ui/primitives.tsx';
import { archiveHolding } from '../../repo/holdings.ts';
import { type HoldingRow, type useHoldings } from './useHoldings.ts';

/**
 * The gaps, named rather than counted.
 *
 * A peak taken across months that were never recorded is too low, and too low
 * on a disclosure is a wrong figure rather than a missing one. Saying which
 * months are absent is what lets someone go and find them.
 */
export function MissingMonths({ months }: { months: readonly string[] }) {
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

export function RecordReading({
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
      className="inset-form mt-3.5 flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="w-full sm:w-[8.75rem] sm:shrink-0">
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
      <div className="w-full sm:w-[9.375rem] sm:shrink-0">
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

export function AddHolding({
  listing,
  onAdd,
  initialKind = 'etf',
}: {
  listing: HoldingListing;
  onAdd: (holding: Parameters<ReturnType<typeof useHoldings>['add']>[0]) => Promise<void>;
  /** The class the list was filtered to, so Add starts where the person already is. */
  initialKind?: InstrumentKind;
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
  const [kind, setKind] = useState<InstrumentKind>(initialKind);
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
          <span className="label">Kind</span>
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
          <span className="label">Priced in</span>
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
          <span className="label">
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
            aria-label="Tracks"
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

        <label className="flex w-full sm:w-[9.375rem] sm:shrink-0 flex-col gap-1.5">
          <span className="label">Member</span>
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
          <strong>Foreign asset for disclosure.</strong>
          {/*
            Four sentences beside a checkbox, every time. The first one is the
            decision; the rest is why, which is worth reading once.
          */}
          <Caveat tone="info" label="Which holdings count as a foreign asset">
            A US stock or ETF bought through a US broker is. An Indian fund that merely tracks a US
            index is not — it is an Indian asset for tax, even though its value moves with the
            dollar. This is a tax question, not a currency one, so the app will not guess it.
          </Caveat>
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
export function CurrencyOptions() {
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
export function ArchiveHolding({
  row,
  onDone,
  button = false,
  confirming: confirmingProp,
  onConfirmingChange,
}: {
  row: HoldingRow;
  onDone: ReturnType<typeof useHoldings>['reload'];
  /** A visible button named for the holding, as on a holding's own screen, in place of the icon on a card. */
  button?: boolean;
  /**
   * Whether the question is being asked, held by the screen when the screen can rebuild what this sits in (a deposit's
   * own screen swaps its placeholder for its terms when they arrive, and a question asked in between must survive).
   */
  confirming?: boolean;
  onConfirmingChange?: (confirming: boolean) => void;
}) {
  const [ownConfirming, setOwnConfirming] = useState(false);
  const confirming = confirmingProp ?? ownConfirming;
  const setConfirming = onConfirmingChange ?? setOwnConfirming;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!confirming) {
    return (
      <>
        {button ? (
          // "Archive" and its icon, as the board draws it; the holding's whole name is what a screen reader hears.
          <button
            type="button"
            className="quiet-button archive-button"
            aria-label={`Archive ${row.holding.instrument.name}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
              <path d="M10 12h4" />
            </svg>
            Archive
          </button>
        ) : (
          <RowAction
            icon="archive"
            label={`Archive ${row.holding.instrument.name}, ${row.holding.member.displayName}`}
            onClick={() => {
              setConfirming(true);
            }}
          />
        )}
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
          className="quiet-button"
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
export function QuotedValue({
  row,
  canWrite,
  today,
  privacy,
  onRecord,
  listing,
}: {
  row: HoldingRow;
  canWrite: boolean;
  today: string;
  privacy: boolean;
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
    <div className="worked-out">
      <p className="worked-out-line">
        <span>Quoted</span>
        <span className="tabular-nums">{formatMoney(quoted.value, { privacy })}</span>
      </p>
      <p className="worked-out-line worked-out-sub">
        {/* A net asset value is a fund's: a gold or a currency quote is a price. */}
        <span className="tabular-nums">
          {row.holding.instrument.priceSource === 'amfi' ? 'NAV' : 'Price'} {quoted.price.value} on{' '}
          {formatIsoDate(quoted.price.asOf)}
        </span>
        {already ? <span>already recorded</span> : null}
      </p>

      {already ? null : (
        canWrite && (
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setProblem(null);
              void onRecord({
                householdId: listing.household.id,
                holdingId: row.holding.id,
                date: quoted.price.asOf,
                quantity: quantityToNumeric(row.unitsHeld),
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
export function RefreshPrices({
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

/**
 * One holding's price, fetched on its own screen beside Record a value (docs/design/vibrant-canvas.html, the fund).
 *
 * The same call as the list's Fetch prices, for the one feed this holding is linked to, and a button for the same
 * reason: a screen that quietly reaches a vendor is harder to trust than one that says what it is about to do. It
 * says what happened, because nothing new and an unreachable vendor look the same from outside.
 */
export function FetchPrice({
  externalId,
  onFetch,
}: {
  externalId: string;
  onFetch: ReturnType<typeof useHoldings>['refreshOne'];
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className="quiet-button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setSaid(null);
          onFetch(externalId)
            .then((result) => {
              setSaid(
                result.note ??
                  (result.written === 0
                    ? 'Nothing new to record.'
                    : `${String(result.written)} price${result.written === 1 ? '' : 's'} recorded.`),
              );
            })
            .catch((error: unknown) => {
              setSaid(error instanceof Error ? error.message : 'Could not fetch the price.');
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v5h-5" />
        </svg>
        {busy ? 'Fetching…' : 'Fetch price'}
      </button>
      {said !== null && (
        <span className="note w-full" role="status">
          {said}
        </span>
      )}
    </>
  );
}
