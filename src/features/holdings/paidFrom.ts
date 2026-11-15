/**
 * Which account a purchase, a sale or a PPF entry names, and what moved through it (docs/design/ledger-income.md section 4a; LI-I28).
 *
 * Optional: nothing chosen is nothing said. The account is in its own currency, and the entry may be in another (a dollar purchase paid from a rupee
 * account), in which case the amount that left it, as its statement shows it, is typed, and never worked out. When the two are the same currency the
 * entry's own amount is what moved, and nothing more is asked. Pure.
 */

import { parseAmountToMinor, money, type Money } from '../../lib/money.ts';
import type { Account, EntryAccount } from '../../repo/types.ts';
import { titleOf } from '../money/accountRows.ts';

export interface PaidFromChoice {
  readonly id: string;
  readonly label: string;
  readonly currency: string;
}

/**
 * The accounts that can be named: those in use, the one named most recently first (`recent`, most recent first), then the rest in the order given. An
 * archived account is not offered for a new entry.
 */
export function paidFromChoices(accounts: readonly Account[], recent: readonly string[] = []): PaidFromChoice[] {
  const rank = (id: string): number => {
    const at = recent.indexOf(id);
    return at === -1 ? recent.length : at;
  };
  return accounts
    .filter((account) => !account.isArchived)
    .map((account, order) => ({ account, order }))
    .sort((a, b) => rank(a.account.id) - rank(b.account.id) || a.order - b.order)
    .map(({ account }) => ({ id: account.id, label: titleOf(account), currency: account.currency }));
}

/** The accounts the entries named, the most recently named first, each once: from the rows already read, each with the day it was entered. */
export function recentlyNamed(entries: readonly { readonly date: string; readonly accountId: string | null }[]): string[] {
  const seen: string[] = [];
  for (const entry of [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    if (entry.accountId !== null && !seen.includes(entry.accountId)) seen.push(entry.accountId);
  }
  return seen;
}

export type PaidViaResult = { readonly ok: true; readonly value: EntryAccount | null } | { readonly ok: false; readonly problem: string };

export function paidViaOf(input: {
  readonly accountId: string;
  readonly typed: string;
  readonly accounts: readonly Account[];
  /** The entry's own amount: the cost, the proceeds, or the payment as a positive figure. */
  readonly entry: Money;
  /** *left* for money paid out of the account, *reached* for money paid into it. */
  readonly verb?: 'left' | 'reached';
}): PaidViaResult {
  if (input.accountId === '') return { ok: true, value: null };
  const account = input.accounts.find((each) => each.id === input.accountId);
  if (account === undefined || account.isArchived) return { ok: false, problem: 'That account is not one this can be paid through.' };
  if (account.currency === input.entry.currency) return { ok: true, value: { accountId: account.id, amount: input.entry } };

  const symbol = account.currency === 'INR' ? '₹' : account.currency;
  const problem = `Say what ${input.verb ?? 'left'} ${titleOf(account)}, in ${symbol}, as its statement shows it.`;
  if (input.typed.trim() === '') return { ok: false, problem };
  try {
    const minor = parseAmountToMinor(input.typed, account.currency);
    if (minor <= 0n) return { ok: false, problem };
    return { ok: true, value: { accountId: account.id, amount: money(minor, account.currency) } };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : problem };
  }
}
