/**
 * The way from Money to Accounts, which is behind More (docs/design/ledger-income.md section 1a; the owner, 15 November 2026).
 *
 * With no account in use it is a card that says what accounts give and opens them, because a household that never adds one never closes a month
 * from balances. Afterwards it is one quiet line, with how many there are, to manage them.
 */

import { hashFor } from '../../app/route.ts';
import type { AccountsNudge as Nudge } from './accountsNudge.ts';

export function AccountsNudge({ nudge }: { nudge: Nudge }) {
  if (nudge === null) return null;
  if (nudge.kind === 'add') {
    return (
      <section className="card flex flex-col gap-2" aria-labelledby="add-accounts-heading">
        <h2 className="label" id="add-accounts-heading">
          Add your accounts
        </h2>
        <p className="note">
          Add the bank accounts and cards your money moves through. With them, closing a month takes about two minutes and says what was really spent, from
          balances, and not only what was written down.
        </p>
        <a className="btn btn-quiet add-pill inline-flex items-center justify-center" href={hashFor('accounts')}>
          Add accounts
        </a>
      </section>
    );
  }
  return (
    <p className="note">
      <a className="flat-link inline-flex items-center" href={hashFor('accounts')}>
        Accounts · {String(nudge.count)} · Manage
      </a>
    </p>
  );
}
