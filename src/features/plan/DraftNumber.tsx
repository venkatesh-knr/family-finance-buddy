import { useState } from 'react';
import { draftPattern, parseDraft, type DraftRange } from './draftNumber.ts';

/**
 * A number field that keeps what is typed until it is left (docs: `draftNumber.ts` says why).
 *
 * Shows the stored value until somebody starts typing, then their draft; Enter or leaving the field saves
 * it when it is a figure, held to `range`, and Escape or anything that is not a figure puts back what is
 * stored. Nothing is written on a keystroke.
 */
export function DraftNumber({
  value,
  range,
  onSave,
  className,
  ariaLabel,
  disabled = false,
}: {
  value: number;
  range: DraftRange;
  onSave: (next: number) => void;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    if (draft === null) return;
    const next = parseDraft(draft, range);
    setDraft(null);
    if (next !== null && next !== value) onSave(next);
  };

  return (
    <input
      className={className}
      inputMode={range.integer ? 'numeric' : 'decimal'}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(event) => {
        if (draftPattern(range.integer).test(event.target.value)) setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}
