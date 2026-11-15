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
  choices,
  entryCurrency,
  accountId,
  typed,
  onAccount,
  onTyped,
}: {
  label: string;
  verb: 'left' | 'reached';
  choices: readonly PaidFromChoice[];
  entryCurrency: string;
  accountId: string;
  typed: string;
  onAccount: (id: string) => void;
  onTyped: (text: string) => void;
}) {
  if (choices.length === 0) return null;
  const chosen = choices.find((choice) => choice.id === accountId) ?? null;
  const other = chosen !== null && chosen.currency !== entryCurrency;
  const symbol = chosen === null ? '' : chosen.currency === 'INR' ? '₹' : chosen.currency;
  return (
    <>
      <div className="w-full sm:w-[220px] sm:shrink-0">
        <Select
          label={label}
          value={accountId}
          hint="Optional. It lets a month close count this as invested, not spent."
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
