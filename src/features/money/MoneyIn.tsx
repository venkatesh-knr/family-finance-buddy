/**
 * The "+ Money in" button on the Ledger, and the form it opens (docs/design/ledger-income.md section 1 and 2).
 *
 * It reads the household's accounts when the Ledger opens, so the form has them at once, and shows the button only to someone who can
 * record: a viewer sees none. After a credit is saved it says what was written, in a status line, and the form is closed.
 */

import { useState } from 'react';
import { CREDIT_LABEL } from '../../domain/credit.ts';
import { formatShortDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import { AddCredit, type AddedCredit } from './AddCredit.tsx';
import { useAccounts } from './useAccounts.ts';

export function MoneyIn({ householdId, privacy }: { householdId: string | null; privacy: boolean }) {
  const { data, add, change } = useAccounts(householdId);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<AddedCredit | null>(null);

  if (data === null || !data.viewer.canRecord) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        className="btn btn-quiet add-pill"
        onClick={() => {
          setAdded(null);
          setOpen(true);
        }}
      >
        + Money in
      </button>
      {added !== null && (
        <p className="note" role="status">
          Added {CREDIT_LABEL[added.category]}, {formatMoney(money(added.minor, added.currency), { privacy })}, {formatShortDate(added.date)}.
        </p>
      )}
      {open && (
        <AddCredit
          data={data}
          onAddAccount={add}
          onChangeAccount={change}
          onSaved={(credit) => {
            setAdded(credit);
            setOpen(false);
          }}
          onCancel={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
