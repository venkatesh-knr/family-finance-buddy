/**
 * Correcting a holding.
 *
 * One editor covering the position and the instrument behind it, because they
 * are one thing to a person: "12.5 units of Vanguard Total Stock Market ETF"
 * is a single fact, and being asked which of two records the typo lives in is
 * the app leaking its own schema.
 *
 * Until this existed the only fix for a wrong character was to archive the
 * whole position and enter it again — quantity, member, dates and all. That is
 * how a fund with `ABC` as its currency ended up being retired rather than
 * corrected.
 *
 * The currency fields are guarded rather than free, for the same reason the
 * add form's are: a list cannot offer a code that does not exist. And changing
 * a currency is refused outright once there are readings or purchases in the
 * old one — those rows carry their own currency and would not move with it,
 * leaving a position whose history is denominated in something it no longer
 * uses. Archiving and re-entering is the honest answer there, and the form
 * says so instead of writing a figure nobody can interpret.
 */

import { useCallback, useState } from 'react';
import { isKnownCurrency, minorUnitExponent, parseAmountToMinor, money } from '../../lib/money.ts';
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts';
import { updateHolding, type HoldingPatch } from '../../repo/holdings.ts';
import { INSTRUMENT_KINDS, type Holding, type InstrumentKind } from '../../repo/types.ts';
import { Button, Caveat, Field, Problem } from '../../ui/primitives.tsx';

export function EditHolding({
  holding,
  isMine,
  /** Whether anything is already denominated in the current currency. */
  hasHistory,
  currencyOptions,
  onDone,
  onCancel,
}: {
  holding: Holding;
  isMine: boolean;
  hasHistory: boolean;
  currencyOptions: React.ReactNode;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(holding.instrument.name);
  const [symbol, setSymbol] = useState(holding.instrument.symbol ?? '');
  const [kind, setKind] = useState<InstrumentKind>(holding.instrument.kind);
  const [currency, setCurrency] = useState(holding.instrument.currency);
  const [exposure, setExposure] = useState(holding.instrument.exposureCurrency);
  const [isForeign, setIsForeign] = useState(holding.instrument.isForeignAsset);
  const [quantity, setQuantity] = useState(() => formatQuantity(parseQuantity(holding.quantity)));
  const [cost, setCost] = useState(() =>
    holding.cost === null ? '' : toAmountInput(holding.cost.minor, holding.cost.currency),
  );
  const [openedOn, setOpenedOn] = useState(holding.openedOn ?? '');
  const [personal, setPersonal] = useState(holding.visibility === 'personal');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useCallback(async () => {
    setProblem(null);

    if (name.trim() === '') {
      setProblem('A holding needs a name.');
      return;
    }
    if (!isKnownCurrency(currency) || !isKnownCurrency(exposure)) {
      setProblem('Choose real currencies. Both must be ISO codes like INR or USD.');
      return;
    }

    let quantityValue: bigint;
    try {
      quantityValue = parseQuantity(quantity);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That is not a quantity.');
      return;
    }
    if (quantityValue <= 0n) {
      setProblem('A holding is of some quantity. Archive it instead of setting it to zero.');
      return;
    }

    let costValue: { minor: bigint; currency: string } | null = null;
    if (cost.trim() !== '') {
      try {
        costValue = money(parseAmountToMinor(cost, currency), currency);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'That is not an amount.');
        return;
      }
    }

    const patch: HoldingPatch = {
      quantity,
      cost: costValue,
      openedOn: openedOn === '' ? null : openedOn,
      // Only where it is yours to set. The policy refuses making somebody
      // else's holding private — "privacy is a decision about your own record;
      // it is not something that can be done to you" — so it is not offered.
      ...(isMine ? { visibility: (personal ? 'personal' : 'household') as 'personal' | 'household' } : {}),
      instrument: {
        name,
        symbol: symbol.trim() === '' ? null : symbol,
        kind,
        // Left out entirely when there is history, so a stray keystroke in a
        // disabled-looking field cannot become a write.
        ...(hasHistory ? {} : { currency, exposureCurrency: exposure }),
        isForeignAsset: isForeign,
      },
    };

    setBusy(true);
    try {
      await updateHolding(holding.id, holding.instrument.id, patch);
      await onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }, [
    cost, currency, exposure, hasHistory, holding.id, holding.instrument.id, isForeign, isMine,
    kind, name, onDone, openedOn, personal, quantity, symbol,
  ]);

  return (
    <div
      className="mt-3 rounded p-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="w-full sm:w-auto sm:min-w-[170px] sm:flex-1">
          <Field
            label="Name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>

        <div className="w-full sm:w-[100px] sm:shrink-0">
          <Field
            label="Symbol"
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value);
            }}
          />
        </div>

        <label className="flex w-full sm:w-[128px] sm:shrink-0 flex-col gap-1.5">
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
            label={`Cost (${currency})`}
            numeric
            inputMode="decimal"
            placeholder="not recorded"
            value={cost}
            onChange={(event) => {
              setCost(event.target.value);
            }}
          />
        </div>

        <div className="w-full sm:w-[150px] sm:shrink-0">
          <Field
            label="Held since"
            type="date"
            value={openedOn}
            onChange={(event) => {
              setOpenedOn(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
        <label className="flex w-full sm:w-[116px] sm:shrink-0 flex-col gap-1.5">
          <span className="micro-label">
            Priced in
            {hasHistory && (
              <Caveat tone="info" label="Why the currency cannot be changed">
                This holding already has readings, purchases or sales recorded in {currency}. Those
                rows carry their own currency and would not move with it, leaving a history
                denominated in something the holding no longer uses. If the currency is wrong,
                archive this holding and enter it again.
              </Caveat>
            )}
          </span>
          <select
            className="field"
            value={currency}
            disabled={hasHistory}
            onChange={(event) => {
              setCurrency(event.target.value);
            }}
          >
            {currencyOptions}
          </select>
        </label>

        <label className="flex w-full sm:w-[116px] sm:shrink-0 flex-col gap-1.5">
          <span className="micro-label">Tracks</span>
          <select
            className="field"
            value={exposure}
            disabled={hasHistory}
            onChange={(event) => {
              setExposure(event.target.value);
            }}
          >
            {currencyOptions}
          </select>
        </label>

        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <button type="button" className="note underline" onClick={onCancel}>
          Cancel
        </button>
      </div>

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
          <strong>Foreign asset for disclosure.</strong> A tax question, not a currency one — an
          Indian fund tracking a US index is not one, even though its value moves with the dollar.
        </span>
      </label>

      {isMine && (
        <label className="mt-2.5 flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-1"
            checked={personal}
            onChange={(event) => {
              setPersonal(event.target.checked);
            }}
          />
          <span className="note">
            <strong>Keep this private.</strong> Only you will see it, its readings and what it cost.
            Its value still counts in the household total, shown to everyone else as one figure per
            member without the detail.
          </span>
        </label>
      )}

      {problem !== null && (
        <div className="mt-3">
          <Problem>{problem}</Problem>
        </div>
      )}
    </div>
  );
}

/** Minor units back into something editable: 45175 → "451.75". */
function toAmountInput(minor: bigint, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  if (exponent === 0) return digits;
  return `${digits.slice(0, digits.length - exponent)}.${digits.slice(digits.length - exponent)}`;
}
