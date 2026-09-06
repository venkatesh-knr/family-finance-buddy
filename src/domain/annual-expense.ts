/**
 * The approximate annual expense.
 *
 * This is what the workbook's `M&Y Total` computes, and it is the figure the
 * FIRE number is built on — `fire_profile.annual_expense_basis` (§215)
 * multiplied by 25, 30 or 50. An error here is not off by a rupee; it is off by
 * twenty-five times a rupee, in a number somebody plans a decade around.
 *
 * It has three sources, and the workbook has all three on one sheet for a
 * reason: the categories above the line, and the loans and policies below it.
 * Leaving the second block out is the mistake that makes a retirement target
 * look comfortable — a home loan instalment is usually the largest single
 * outgoing a household has.
 *
 * Pure, like every calculation here: no I/O, no clock.
 */

import { money, type Money } from '../lib/money.ts';

export type Cadence = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

/** How many times a year each cadence comes round. */
const OCCURRENCES: Record<Cadence, bigint> = {
  monthly: 12n,
  quarterly: 4n,
  half_yearly: 2n,
  yearly: 1n,
};

export type OutgoingSource = 'category' | 'liability' | 'policy';

export interface PlannedOutgoing {
  readonly label: string;
  /** Null when nobody has planned this yet — unknown, which is not zero. */
  readonly amount: Money | null;
  readonly cadence: Cadence;
  readonly source: OutgoingSource;
  /**
   * Whether the household could simply stop spending it — "fixed means
   * compulsory expense and variable means depends on need".
   *
   * Commitments default to compulsory: a loan instalment is not optional, and
   * a lapsed policy is not a saving.
   */
  readonly compulsory?: boolean;
}

export interface AnnualExpense {
  readonly total: Money;
  /** The part the household cannot stop. What a FIRE floor is built on. */
  readonly compulsory: Money;
  readonly bySource: Record<OutgoingSource, Money>;
  /** Labels with no planned figure, so a screen can say what the estimate omits. */
  readonly unplanned: readonly string[];
}

/** One year of an amount that recurs at the given cadence. */
export function annualise(amount: Money, cadence: Cadence): Money {
  return money(amount.minor * OCCURRENCES[cadence], amount.currency);
}

export function annualPlannedExpense(outgoings: readonly PlannedOutgoing[]): AnnualExpense {
  const planned = outgoings.filter((outgoing) => outgoing.amount !== null);
  const unplanned = outgoings
    .filter((outgoing) => outgoing.amount === null)
    .map((outgoing) => outgoing.label);

  // Summing across currencies would produce a number that looks like money and
  // means nothing. Conversion happens at each figure's own date, elsewhere.
  const currencies = new Set(planned.map((outgoing) => outgoing.amount?.currency));
  if (currencies.size > 1) {
    throw new Error(
      `Cannot total an annual expense across currencies: ${[...currencies].sort().join(', ')}.`,
    );
  }

  // Nothing planned at all still has to answer in some currency; the household
  // base is the only sensible default, and the caller passes real figures in
  // every other case.
  const currency = [...currencies][0] ?? 'INR';

  let total = 0n;
  let compulsory = 0n;
  const bySource: Record<OutgoingSource, bigint> = { category: 0n, liability: 0n, policy: 0n };

  for (const outgoing of planned) {
    if (outgoing.amount === null) continue;
    const yearly = annualise(outgoing.amount, outgoing.cadence).minor;

    total += yearly;
    bySource[outgoing.source] += yearly;

    // A commitment is compulsory unless something says otherwise; a category
    // says so for itself through its fixed/variable nature.
    const isCompulsory = outgoing.compulsory ?? outgoing.source !== 'category';
    if (isCompulsory) compulsory += yearly;
  }

  return {
    total: money(total, currency),
    compulsory: money(compulsory, currency),
    bySource: {
      category: money(bySource.category, currency),
      liability: money(bySource.liability, currency),
      policy: money(bySource.policy, currency),
    },
    unplanned,
  };
}
