/**
 * A contributor's month (docs/design/spending-capture.md section 11.4; the MoneyMonthStated board, screen 7).
 *
 * A contributor reads their own entries and no household total, so what their card shows is what they spent themselves, *itemised by you*, and never a stated
 * figure or a close (SC-I19). Pure: the entries, the member and the month's bounds are passed in. Per currency, as entered, never converted (LI-I5).
 */

import { money, type Money } from '../../lib/money.ts';
import type { Credit, Expense } from '../../repo/types.ts';

/**
 * What the member spent in the month, in each currency, the one being read first even when nothing was spent in it. Voided entries and other members' are not
 * counted. A refund they recorded in the month takes away from it in its own currency (LI-I3), as it does on the owner's card, so the same word means the same
 * thing from every source.
 */
export function ownMonthSpend(input: {
  readonly expenses: readonly Expense[];
  readonly memberId: string;
  readonly bounds: { readonly start: string; readonly end: string };
  readonly currency: string;
  /** The credits the member can read; only their own refunds in the month are used. */
  readonly refunds?: readonly Credit[];
}): readonly Money[] {
  const totals = new Map<string, bigint>([[input.currency, 0n]]);
  for (const expense of input.expenses) {
    if (expense.isVoided || expense.member.id !== input.memberId) continue;
    if (expense.date < input.bounds.start || expense.date > input.bounds.end) continue;
    const code = expense.amount.currency;
    totals.set(code, (totals.get(code) ?? 0n) + expense.amount.minor);
  }
  for (const credit of input.refunds ?? []) {
    if (credit.isVoided || credit.category !== 'refund' || credit.memberId !== input.memberId) continue;
    if (credit.date < input.bounds.start || credit.date > input.bounds.end) continue;
    const code = credit.amount.currency;
    totals.set(code, (totals.get(code) ?? 0n) - credit.amount.minor);
  }
  return [...totals.entries()].map(([code, minor]) => money(minor, code));
}
