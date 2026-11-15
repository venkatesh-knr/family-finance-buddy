/**
 * The way from Money to Accounts, which is behind More (docs/design/ledger-income.md section 1a; the owner, 15 November 2026).
 *
 * The third of the three actions in the month card, beside *+ Money in* and the close: *Accounts · 3 · Manage* once there are some, and *Add
 * accounts* while none is in use, with a line under the row that says what they give. A household that never adds an account never closes a month
 * from balances, so the first is asked for in words and not only in a button.
 */

import { hashFor } from '../../app/route.ts';
import type { AccountsNudge as Nudge } from './accountsNudge.ts';

export function AccountsAction({ nudge }: { nudge: Nudge }) {
  if (nudge === null) return null;
  return (
    <a className="btn btn-quiet" href={hashFor('accounts')}>
      {nudge.kind === 'add' ? 'Add accounts' : `Accounts · ${String(nudge.count)} · Manage`}
    </a>
  );
}

/** What accounts give, under the row, while none is in use. */
export function AccountsHint({ nudge }: { nudge: Nudge }) {
  if (nudge === null || nudge.kind !== 'add') return null;
  return (
    <p className="note">
      Add the bank accounts and cards your money moves through. With them, closing a month takes about two minutes and says what was really spent, from
      balances, and not only what was written down.
    </p>
  );
}
