/**
 * What a credit is, and what a month's credits come to (docs/design/ledger-income.md sections 1 and 4).
 *
 * A credit is money that came in, with exactly one category. *Came in* is every category but the refund; a refund (Refund or money
 * back) takes away from spent and is never income (LI-I1, LI-I3). Money is integer minor units with a currency, a month is an IST
 * calendar month (`YYYY-MM`), and nothing is added across currencies (LI-I5). Pure: no I/O and no clock.
 */

import type { IsoDate } from '../lib/dates.ts';
import type { Money } from '../lib/money.ts';

/** The seven categories, in the order the screen offers them. `business` is shown as Business income, `refund` as Refund or money back. */
export const CREDIT_CATEGORIES = ['salary', 'business', 'interest', 'rent', 'dividend', 'other_income', 'refund'] as const;
export type CreditCategory = (typeof CREDIT_CATEGORIES)[number];

export const CREDIT_LABEL: Readonly<Record<CreditCategory, string>> = {
  salary: 'Salary',
  business: 'Business income',
  interest: 'Interest',
  rent: 'Rent',
  dividend: 'Dividend',
  other_income: 'Other income',
  refund: 'Refund or money back',
};

/** Whether a credit of this category is income. Every category but the refund. */
export function isIncome(category: CreditCategory): boolean {
  return category !== 'refund';
}

export interface CreditLike {
  readonly category: CreditCategory;
  readonly amount: Money;
  readonly date: IsoDate;
}

export interface CameIn {
  readonly currency: string;
  /** Salary, business, interest, rent, dividend and other income, and never a refund (LI-I1). */
  readonly cameIn: bigint;
  /** Refund or money back: it takes away from spent in the month it is credited (LI-I3). */
  readonly refunds: bigint;
}

const byCurrency = (a: string, b: string): number => (a === b ? 0 : a === 'INR' ? -1 : b === 'INR' ? 1 : a < b ? -1 : 1);

/**
 * What came in and what was refunded in a month, per currency, rupees first. A currency with no credit in the month has no line, so a
 * screen can tell nothing from zero.
 */
export function cameInByCurrency(credits: readonly CreditLike[], month: string): CameIn[] {
  const sums = new Map<string, { cameIn: bigint; refunds: bigint }>();
  for (const credit of credits) {
    if (credit.date.slice(0, 7) !== month) continue;
    const line = sums.get(credit.amount.currency) ?? { cameIn: 0n, refunds: 0n };
    if (isIncome(credit.category)) line.cameIn += credit.amount.minor;
    else line.refunds += credit.amount.minor;
    sums.set(credit.amount.currency, line);
  }
  return [...sums.entries()].sort(([a], [b]) => byCurrency(a, b)).map(([currency, line]) => ({ currency, ...line }));
}

/** The kinds of line the money screen lists (ledger-income.md section 1). */
export type LedgerKind = 'spending' | 'income' | 'refund' | 'move' | 'into-holding' | 'out-of-holding';

/**
 * Direction is a sign and a word, as well as an icon and a colour, and never a colour alone (LI-I16). A move has no sign: it is neither
 * money in nor money out of the household.
 */
export function ledgerWord(kind: LedgerKind): { readonly word: string; readonly sign: '+' | '−' | '' } {
  switch (kind) {
    case 'spending':
      return { word: 'spent', sign: '−' };
    case 'income':
      return { word: 'came in', sign: '+' };
    case 'refund':
      return { word: 'takes away from spent', sign: '+' };
    case 'move':
      return { word: 'moved · not spent', sign: '' };
    case 'into-holding':
      return { word: 'into a holding', sign: '−' };
    case 'out-of-holding':
      return { word: 'out of a holding', sign: '+' };
  }
}
