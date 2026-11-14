/**
 * The Accounts tab's rows (docs/design/ledger-income.md section 1a; the MoneyAccounts board): what each line says, in words.
 *
 * Pure: the people and the balances are passed in, and nothing here reads a database or a clock. A name is what a ledger line shows, and
 * the last four digits follow it when there are some (LI-I24). A balance is as at a day and is the account's newest; a card's is what is
 * owed, so it is shown with a minus sign and the word *owed* and never as money held.
 */

import { formatShortDate } from '../../lib/dates.ts';
import { formatMoney, money } from '../../lib/money.ts';
import type { Account, AccountBalance, AccountType, Member } from '../../repo/types.ts';

export const TYPE_WORD: Readonly<Record<AccountType, string>> = {
  savings: 'Savings',
  current: 'Current',
  card: 'Card',
};

export interface AccountRow {
  readonly title: string;
  readonly sub: string;
  /** A private account carries a lock. */
  readonly private: boolean;
  /** The figure, or the words that say there is none. */
  readonly value: string;
  readonly note: string;
  readonly hasBalance: boolean;
}

/** The name, then the last four digits when there are some: "HDFC Savings ••4021", or "Salary account" alone. */
export function titleOf(account: Pick<Account, 'name' | 'last4'>): string {
  return account.last4 === null || account.last4 === '' ? account.name : `${account.name} ••${account.last4}`;
}

/** One row. `balance` is the account's newest, or null for an account that has none. */
export function accountRow(
  account: Account,
  context: { readonly members: readonly Member[]; readonly viewerMemberId: string; readonly balance: AccountBalance | null; readonly privacy?: boolean },
): AccountRow {
  const owner = context.members.find((member) => member.id === account.memberId);
  const isPrivate = account.visibility === 'personal';
  const seen = isPrivate ? (account.memberId === context.viewerMemberId ? 'only you see it' : 'only its owner sees it') : 'the household sees it';
  const parts = [TYPE_WORD[account.type], owner?.displayName ?? 'a member', seen];
  if (account.last4 === null || account.last4 === '') parts.push('no last four');
  if (account.isForeign) parts.push('held outside India');

  if (context.balance === null) {
    return { title: titleOf(account), sub: parts.join(' · '), private: isPrivate, value: 'no balance yet', note: 'not in a close yet', hasBalance: false };
  }
  const { balance } = context.balance;
  const day = formatShortDate(context.balance.asAt);
  const privacy = context.privacy === true;
  if (account.type === 'card') {
    // A card's balance is the amount due, held as a positive figure; it is owed, so it reads as a minus. Below nothing the card was
    // overpaid and the bank owes the household: that is money held, in credit, and it is not shown as owed.
    if (balance.minor < 0n) {
      return { title: titleOf(account), sub: parts.join(' · '), private: isPrivate, value: formatMoney(money(-balance.minor, balance.currency), { privacy }), note: `in credit, ${day}`, hasBalance: true };
    }
    const owed = formatMoney(balance, { privacy });
    return { title: titleOf(account), sub: parts.join(' · '), private: isPrivate, value: privacy ? owed : `−${owed}`, note: `owed, ${day}`, hasBalance: true };
  }
  return { title: titleOf(account), sub: parts.join(' · '), private: isPrivate, value: formatMoney(balance, { privacy }), note: day, hasBalance: true };
}

/** The newest balance of each account. On the same day a statement's balance beats a typed one, as the month close prefers it. */
export function latestBalances(balances: readonly AccountBalance[]): ReadonlyMap<string, AccountBalance> {
  const latest = new Map<string, AccountBalance>();
  for (const next of balances) {
    const held = latest.get(next.accountId);
    if (held === undefined || next.asAt > held.asAt || (next.asAt === held.asAt && next.source === 'statement' && held.source !== 'statement')) {
      latest.set(next.accountId, next);
    }
  }
  return latest;
}

/** The accounts in use, and the archived ones that are folded away. Each keeps the order it came in. */
export function splitAccounts(accounts: readonly Account[]): { readonly active: readonly Account[]; readonly archived: readonly Account[] } {
  return { active: accounts.filter((account) => !account.isArchived), archived: accounts.filter((account) => account.isArchived) };
}
