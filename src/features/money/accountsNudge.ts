/**
 * What the Money screen says about Accounts, which is behind More (docs/design/ledger-income.md section 1a; the owner, 15 November 2026).
 *
 * With Accounts out of Money's tab strip, nothing on the screen would lead to it, and a household that never adds an account never closes a
 * month. So the screen asks for the first account in words and with a button, and afterwards keeps one quiet line to manage them. Pure: it reads
 * the accounts already loaded and decides which of the two, or neither.
 */

import type { Account } from '../../repo/types.ts';

export type AccountsNudge = { readonly kind: 'add' } | { readonly kind: 'manage'; readonly count: number } | null;

export function accountsNudge(input: { readonly accounts: readonly Account[]; readonly canRecord: boolean }): AccountsNudge {
  if (!input.canRecord) return null;
  const inUse = input.accounts.filter((account) => !account.isArchived).length;
  return inUse === 0 ? { kind: 'add' } : { kind: 'manage', count: inUse };
}
