import { useCallback, useState } from 'react';
import { formatMoney, minorUnitExponent, parseAmountToMinor, type Money } from '../../lib/money.ts';

/** Minor units back into something editable, in bigint: 4517500 → "45175.00", 1000000000 → "10000000". */
export function toAmountInput(minor: bigint, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : digits.slice(digits.length - exponent);
  const text = /^0*$/.test(fraction) ? whole : `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

/**
 * One amount, edited in place, on an editable row.
 *
 * Blank means not recorded, which is not the same as nothing: an empty field says nobody has said, and a
 * zero says somebody decided nothing. Nothing is written on a keystroke; Enter or leaving the field saves,
 * Escape puts back what is stored.
 *
 * A figure typed into a box is its digits in the markup, so privacy mode, which removes an amount and does
 * not hide it, shows the masked text in the box's place while it is on. The same for a role that cannot
 * edit. Switch privacy off to change the figure.
 */
export function MoneyField({
  label,
  current,
  currency,
  privacy,
  editable,
  onSave,
  onProblem,
}: {
  label: string;
  current: Money | null;
  currency: string;
  privacy: boolean;
  editable: boolean;
  /** `null` clears the figure. */
  onSave: (next: Money | null) => Promise<void>;
  /** Told what went wrong, so the row's owner can say it where a person looks. */
  onProblem: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = current === null ? '' : toAmountInput(current.minor, current.currency);

  const commit = useCallback(async () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === shown) return;

    setBusy(true);
    try {
      if (text === '') {
        await onSave(null);
      } else {
        await onSave({ minor: parseAmountToMinor(text, currency), currency });
      }
    } catch (error) {
      // The field goes back to the stored value, and the row says why.
      onProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }, [draft, shown, onSave, onProblem, currency]);

  if (!editable || privacy) {
    return (
      <span className="w-[8rem] shrink-0">
        <span className="label">{label}</span>
        {/* A word is not a figure: it is set in the face a word takes, and only the figure in the figures' one. */}
        <span className="block" style={{ color: 'var(--ink-2)' }}>
          {current === null ? (
            <span className="note">not recorded</span>
          ) : (
            <span className="num">{formatMoney(current, { privacy })}</span>
          )}
        </span>
      </span>
    );
  }

  return (
    <label className="flex w-[8rem] shrink-0 flex-col gap-1">
      <span className="label">{label}</span>
      <input
        className="field field-num"
        inputMode="decimal"
        placeholder="not recorded"
        disabled={busy}
        value={draft ?? shown}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={() => {
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}
