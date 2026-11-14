/**
 * What the Add money in form works out for itself (docs/design/ledger-income.md section 2; the AddCredit and AddCredit2 boards).
 *
 * Pure: the amount as typed, the date, which accounts are offered, whose income it starts as, who can see the row, and the line about a
 * private credit on an account the household sees. Nothing here reads a database or a clock; the form passes in what it has.
 */

import { isIsoDate } from '../../lib/dates.ts';
import { parseAmountToMinor } from '../../lib/money.ts';
import { defaultVisibility, type CreditCategory } from '../../domain/credit.ts';
import type { Account, Visibility } from '../../repo/types.ts';
import { titleOf } from './accountRows.ts';

export type AmountReading =
  | { readonly ok: true; readonly minor: bigint }
  | { readonly ok: false; readonly problem: string; readonly blank: boolean };

/** The amount as typed, in minor units, or what is wrong with it in words. A blank is flagged so a form can wait to say so until it is tried. */
export function creditAmount(text: string, currency: string): AmountReading {
  if (text.trim() === '') return { ok: false, problem: 'Enter what came in, such as 1,42,000.', blank: true };
  try {
    const minor = parseAmountToMinor(text, currency);
    if (minor <= 0n) return { ok: false, problem: 'The amount is above nothing, such as 1,42,000.', blank: false };
    return { ok: true, minor };
  } catch (error) {
    const said = error instanceof Error ? error.message : '';
    // The parser's own sentence where it says something a person can act on; otherwise ours.
    if (said.includes('decimal places') || said.includes('whole number')) return { ok: false, problem: said, blank: false };
    if (said.startsWith('An expense is')) return { ok: false, problem: 'The amount is above nothing, such as 1,42,000.', blank: false };
    return { ok: false, problem: 'The amount is a number, such as 1,42,000.', blank: false };
  }
}

/** What is wrong with the date it was credited, or null. A calendar date in a year anyone means. */
export function creditDateProblem(date: string): string | null {
  const year = Number(date.slice(0, 4));
  if (!isIsoDate(date) || year < 1990 || year > 2100) return 'Enter the date it was credited.';
  return null;
}

export interface AccountChoice {
  readonly id: string;
  readonly label: string;
}

/** The accounts the picker offers: the ones in use, in the order given. An archived account cannot be chosen for a new entry. */
export function accountChoices(accounts: readonly Account[]): AccountChoice[] {
  return accounts.filter((account) => !account.isArchived).map((account) => ({ id: account.id, label: titleOf(account) }));
}

/**
 * Whose income it starts as: the account's member, when one is chosen, the viewer may file for others and that member can be chosen (an
 * archived member cannot, and a default the person was never shown is not one); otherwise the viewer.
 */
export function creditMember(
  account: Pick<Account, 'memberId'> | null,
  viewer: { readonly memberId: string; readonly canFileForOthers: boolean },
  chooseable: readonly string[],
): string {
  if (account === null || !viewer.canFileForOthers || !chooseable.includes(account.memberId)) return viewer.memberId;
  return account.memberId;
}

/**
 * Who can see the row. What the person chose, else what the category says (income private, a refund the household's). Somebody else's
 * income is the household's whatever was chosen: only the member a row belongs to can make it private, so the policy would refuse it and
 * nobody could read it back.
 */
export function creditVisibility(input: { readonly category: CreditCategory; readonly chosen: Visibility | null; readonly mine: boolean }): Visibility {
  if (!input.mine) return 'household';
  return input.chosen ?? defaultVisibility(input.category);
}

/** AddCredit2, state 1: a private credit on an account the household sees is private in the list only, and the form says so. */
export function sharedAccountNote(account: Pick<Account, 'name' | 'last4' | 'visibility'> | null, visibility: Visibility): string | null {
  if (account === null || account.visibility !== 'household' || visibility !== 'personal') return null;
  return `${titleOf(account)} is shared with the household. Its balance is seen by the household, so a private credit there is private in this list only.`;
}
