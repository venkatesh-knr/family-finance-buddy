import { useState } from 'react';
import { formatIsoDate, isIsoDate, type IsoDate } from '../../lib/dates.ts';

/**
 * A date, edited in place, saved when the field is left.
 *
 * A date input fires a change for every keystroke, and typing the year 2027 passes through 0002, 0020 and
 * 0202, each of them a valid date. Saved as they came, one edit would be four writes and four rows in an
 * append-only log. So, as with `MoneyField`: nothing is written on a keystroke, Enter or leaving the field
 * saves, and Escape puts back what is stored. A year outside 1990 to 2100 is a typing slip and is refused
 * with a sentence.
 */
export function DateField({
  label,
  value,
  editable,
  onSave,
  onProblem,
}: {
  label: string;
  value: IsoDate | null;
  editable: boolean;
  onSave: (next: IsoDate | null) => Promise<void>;
  onProblem: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = async (): Promise<void> => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text === (value ?? '')) return;
    if (text !== '') {
      const year = Number(text.slice(0, 4));
      if (!isIsoDate(text) || year < 1990 || year > 2100) {
        onProblem('That date is not one this can be: check the year.');
        return;
      }
    }
    try {
      await onSave(text === '' ? null : (text as IsoDate));
    } catch (error) {
      onProblem(error instanceof Error ? error.message : 'Could not save that.');
    }
  };

  if (!editable) {
    return (
      <span className="w-[9.5rem] shrink-0">
        <span className="label">{label}</span>
        <span className="block" style={{ color: 'var(--ink-2)' }}>
          {value === null ? <span className="note">not recorded</span> : <span className="num">{formatIsoDate(value)}</span>}
        </span>
      </span>
    );
  }

  return (
    <label className="flex w-[9.5rem] shrink-0 flex-col gap-1">
      <span className="label">{label}</span>
      <input
        type="date"
        className="field"
        value={draft ?? value ?? ''}
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
