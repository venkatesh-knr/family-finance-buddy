/**
 * The way from Money to Accounts, which is behind More (docs/design/ledger-income.md section 1a; the owner, 15 November 2026).
 *
 * The third of the three actions in the month card, beside *+ Money in* and the close: a link, *Accounts* with a count and a chevron, once there are some,
 * and *Add accounts* while none is in use, with a line under the row that says what they give. A household that never adds an account never closes a month
 * from balances, so the first is asked for in words and not only in a button.
 */

import { hashFor } from '../../app/route.ts';
import { Chevron } from '../../ui/primitives.tsx';
import type { AccountsNudge as Nudge } from './accountsNudge.ts';
import { accountsBadgeName } from './monthFooter.ts';

export function AccountsAction({ nudge }: { nudge: Nudge }) {
  if (nudge === null) return null;
  // A link, and not a button, because it goes to a place: the Accounts tab. The count is a badge with its own name, so the link reads *Accounts 3 accounts*.
  return (
    <a className="month-link" href={hashFor('accounts')}>
      {nudge.kind === 'add' ? (
        'Add accounts'
      ) : (
        <>
          Accounts
          <span className="month-badge" role="img" aria-label={accountsBadgeName(nudge.count)}>
            {String(nudge.count)}
          </span>
        </>
      )}
      <Chevron />
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
