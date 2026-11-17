/**
 * *Paid from* on a purchase, *Paid into* on a sale (docs/design/ledger-income.md section 4a). Optional, and not asked when the household has no account.
 * When the account chosen is in another currency than the entry, one more field asks for what moved through it, typed from its statement.
 */

import { Select } from '../../ui/Select.tsx';
import { Field } from '../../ui/primitives.tsx';
import type { PaidFromChoice } from './paidFrom.ts';

export function PaidFromField({
  label,
  verb,
  hint: reason,
  choices,
  entryCurrency,
  accountId,
  typed,
  failed = false,
  onAccount,
  onTyped,
}: {
  label: string;
  verb: 'left' | 'reached';
  /** What the field says it is for, when it is not a holding's reason. */
  hint?: string;
  choices: readonly PaidFromChoice[];
  entryCurrency: string;
  accountId: string;
  typed: string;
  /** The accounts could not be read: said, rather than the field being left out as if the household had none. */
  failed?: boolean;
  onAccount: (id: string) => void;
  onTyped: (text: string) => void;
}) {
  if (choices.length === 0) {
    return failed ? <p className="note w-full">The accounts could not be read just now, so this will be saved without one.</p> : null;
  }
  const chosen = choices.find((choice) => choice.id === accountId) ?? null;
  const other = chosen !== null && chosen.currency !== entryCurrency;
  const symbol = chosen === null ? '' : chosen.currency === 'INR' ? '₹' : chosen.currency;
  return (
    <>
      <div className="w-full sm:w-[220px] sm:shrink-0">
        <Select
          label={label}
          value={accountId}
          hint={
            reason ??
            (verb === 'left'
              ? 'Optional. It lets a month close count this as money put into a holding, not as spent.'
              : 'Optional. It lets a month close count this as money in to that account, not as income.')
          }
          onChange={(event) => {
            onAccount(event.target.value);
          }}
        >
          <option value="">Not said</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </Select>
      </div>
      {other && (
        <div className="w-full sm:w-[190px] sm:shrink-0">
          <Field
            label={`What ${verb} the account (${symbol})`}
            numeric
            inputMode="decimal"
            placeholder="0.00"
            required
            hint={`In ${chosen.currency}, as its statement shows it.`}
            value={typed}
            onChange={(event) => {
              onTyped(event.target.value);
            }}
          />
        </div>
      )}
    </>
  );
}
