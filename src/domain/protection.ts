/**
 * Protection: what a policy has cost, what is falling due, and the cover gap
 * (docs/design/protection-and-flow.md §1, §5).
 *
 * A policy has a cover and no value. Nothing here is ever added to money the household owns, and nothing
 * here reads a holding's value except to set it against what was paid for the policy that cites it. The
 * cover gap is a stated calculation: every input comes in as an argument, so every input can be shown on
 * the screen, and it returns the arithmetic and not a recommendation.
 *
 * Pure, with the date passed in.
 */

import { daysBetween, type IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';
import type { Cadence } from './annual-expense.ts';

/** How many times a year each cadence comes round. */
export function premiumsPerYear(cadence: Cadence): number {
  return { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 }[cadence];
}

const MONTHS_PER_PAYMENT: Record<Cadence, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

/**
 * What has been paid into a policy so far: the premium, once for the start date and once more each time
 * the cadence has come round since. Null where the premium or the start is not recorded, or the policy
 * has not started: an amount nobody recorded is not an amount of zero, and a gap computed from it would
 * be a number that never happened.
 *
 * It counts what was due, not what was paid. A household that lets a premium lapse and pays it later
 * has the same total at the end, and one that skipped one has a policy that lapsed, which is a status
 * and not an arithmetic.
 */
export function cumulativePremiums(options: {
  readonly premium: Money | null;
  readonly cadence: Cadence;
  readonly startedOn: IsoDate | null;
  readonly today: IsoDate;
}): Money | null {
  const { premium, cadence, startedOn, today } = options;
  if (premium === null || startedOn === null) return null;

  const [sy, sm, sd] = startedOn.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  // Whole months from the start date to today: a month is not complete until its day has come round.
  const months = (ty - sy) * 12 + (tm - sm) - (td < sd ? 1 : 0);
  if (months < 0) return null;

  const payments = BigInt(Math.floor(months / MONTHS_PER_PAYMENT[cadence]) + 1);
  return money(premium.minor * payments, premium.currency);
}

/**
 * Paid in, less what the policy would pay out today (PF-C4). Positive is the household behind. The two
 * are both facts and the gap between them is the single most useful thing the app can say about a ULIP
 * or an endowment, so it is shown and not editorialised. Null where either side is missing or they are
 * in different currencies.
 */
export function surrenderGap(options: {
  readonly paidIn: Money | null;
  readonly surrenderValue: Money | null;
}): Money | null {
  const { paidIn, surrenderValue } = options;
  if (paidIn === null || surrenderValue === null) return null;
  if (paidIn.currency !== surrenderValue.currency) return null;
  return money(paidIn.minor - surrenderValue.minor, paidIn.currency);
}

export interface CoverGap {
  /** Outstanding liabilities, as given. */
  readonly liabilities: Money;
  /** Annual expenses times the years of dependency. */
  readonly expensesOverYears: Money;
  /** Liquid corpus, as given. */
  readonly liquidCorpus: Money;
  /** Liabilities plus expenses over the years, less liquid money, and not below nothing. */
  readonly suggested: Money;
  /** Term cover in force, as given. */
  readonly termCover: Money;
  /** What is suggested less what is in force. Negative means in force is above it. */
  readonly gap: Money;
  /** The gap where there is one, and zero where there is not. */
  readonly short: Money;
}

/**
 * The cover gap (PF-C12): a stated calculation, never a recommendation.
 *
 *   suggested = liabilities + annual expenses x years of dependency - liquid corpus
 *   gap       = suggested - term cover in force
 *
 * Every input is the caller's, in one currency, so every input can be put on the face of the screen
 * beside its default. Years is a household setting and the app does not know how old the children are or
 * when the mortgage ends. Null in mixed currencies and for a number of years that is not a whole number
 * of zero or more. Health cover has no suggested figure at all and is not an input.
 */
export function coverGap(options: {
  readonly liabilities: Money;
  readonly annualExpenses: Money;
  readonly years: number;
  readonly liquidCorpus: Money;
  readonly termCover: Money;
}): CoverGap | null {
  const { liabilities, annualExpenses, years, liquidCorpus, termCover } = options;
  const currency = liabilities.currency;
  if (![annualExpenses, liquidCorpus, termCover].every((amount) => amount.currency === currency)) return null;
  if (!Number.isInteger(years) || years < 0) return null;

  const expensesOverYears = annualExpenses.minor * BigInt(years);
  const raw = liabilities.minor + expensesOverYears - liquidCorpus.minor;
  const suggested = raw > 0n ? raw : 0n;
  const gap = suggested - termCover.minor;

  return {
    liabilities,
    expensesOverYears: money(expensesOverYears, currency),
    liquidCorpus,
    suggested: money(suggested, currency),
    termCover,
    gap: money(gap, currency),
    short: money(gap > 0n ? gap : 0n, currency),
  };
}

export interface PolicyForRenewal {
  readonly id: string;
  readonly name: string;
  readonly renewalOn: IsoDate | null;
  readonly isLapsed: boolean;
}

export interface RenewalDue {
  readonly id: string;
  readonly name: string;
  readonly renewalOn: IsoDate;
  /** Negative once the date has passed. */
  readonly daysLeft: number;
  readonly overdue: boolean;
}

/** The notice period: the same thirty days a maturity is called out within. */
export const RENEWAL_NOTICE_DAYS = 30;

/**
 * The renewals that are due within thirty days, or already past, soonest first. A lapsed policy has
 * nothing to renew and one with no date has nothing to call out; neither is listed.
 */
export function renewalsDue(policies: readonly PolicyForRenewal[], today: IsoDate): readonly RenewalDue[] {
  return policies
    .flatMap((policy) => {
      if (policy.isLapsed || policy.renewalOn === null) return [];
      const daysLeft = daysBetween(today, policy.renewalOn);
      if (daysLeft > RENEWAL_NOTICE_DAYS) return [];
      return [
        { id: policy.id, name: policy.name, renewalOn: policy.renewalOn, daysLeft, overdue: daysLeft < 0 },
      ];
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
