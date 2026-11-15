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
import type { RuleDraft } from './ruleForm.ts';
import type { AccountsData } from './useAccounts.ts';

export function MoneyIn({
  data,
  privacy,
  onAddAccount,
  onChangeAccount,
  onSaved,
  onSaid,
  onRepeat,
  canRepeat,
}: {
  data: AccountsData | null;
  privacy: boolean;
  onAddAccount: Parameters<typeof AddCredit>[0]['onAddAccount'];
  onChangeAccount: Parameters<typeof AddCredit>[0]['onChangeAccount'];
  /** A credit was written: the list reads it again. */
  onSaved: () => void;
  /** What was written, in a sentence, for the screen's status line. */
  onSaid: (message: string) => void;
  /** *Repeats every month* was on: the rule form opens with this. */
  onRepeat: (draft: RuleDraft) => void;
  /** Whether *Repeats every month* is offered: only an owner or a partner makes a rule. */
  canRepeat: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (data === null || !data.viewer.canRecord) return null;

  const said = (added: AddedCredit): string =>
    added.move === true
      ? `Moved ${formatMoney(money(added.minor, added.currency), { privacy })}, ${formatShortDate(added.date)}. It is in neither came in nor spent.`
      : `Added ${CREDIT_LABEL[added.category]}, ${formatMoney(money(added.minor, added.currency), { privacy })}, ${formatShortDate(added.date)}.`;

  return (
    <>
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          setOpen(true);
        }}
      >
        + Money in
      </button>
      {open && (
        <AddCredit
          data={data}
          canRepeat={canRepeat}
          onAddAccount={onAddAccount}
          onChangeAccount={onChangeAccount}
          onSaved={(credit) => {
            setOpen(false);
            onSaved();
            onSaid(said(credit));
            if (credit.repeat !== undefined) onRepeat(credit.repeat);
          }}
          onCancel={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
