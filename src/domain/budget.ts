/**
 * Budget against actual, and the pace between them.
 *
 * The plan says what a household means to spend; the ledger says what it did.
 * This is where the two meet — and the interesting part is not the difference
 * at the end of the month but the rate on the way there:
 *
 *     pace = actual / (planned x days_elapsed / days_in_period)
 *
 * "Pace above 1.0 flags a category mid-month, rather than after the
 * overspend." (§530) A month-end comparison tells you what happened; a pace
 * tells you while there is still something to do about it.
 *
 * Pure, and the elapsed days are given rather than measured. A pace that read
 * the clock would change while somebody was looking at it.
 */

import { money, type Money } from '../lib/money.ts';
import type { IsoDate } from '../lib/dates.ts';

// ─── period boundaries ────────────────────────────────────────────────────

/** Days from one calendar date to another, counting both ends. */
export function daysInclusive(start: IsoDate, end: IsoDate): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000) + 1;
}

/**
 * The Indian tax year, named by the calendar year it starts in.
 *
 * 2026 is 1 April 2026 to 31 March 2027. Anchored in UTC arithmetic on plain
 * calendar dates, so no timezone can shift a boundary by a day.
 */
export function taxYearBounds(fy: number): { start: IsoDate; end: IsoDate } {
  return { start: `${String(fy)}-04-01`, end: `${String(fy + 1)}-03-31` };
}

/** The calendar month containing a date, first day to last. */
export function monthBounds(date: IsoDate): { start: IsoDate; end: IsoDate } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  // Day zero of the next month is the last day of this one, which is how the
  // length of February stops being a special case.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${String(year)}-${mm}-01`, end: `${String(year)}-${mm}-${String(lastDay)}` };
}

/**
 * How much of a period has passed, counting today.
 *
 * Clamped at both ends: a date before the period has elapsed nothing, and one
 * after it has elapsed the whole thing. A past month is complete, which is
 * what makes its pace a verdict rather than a projection.
 */
export function daysElapsedIn(
  period: { start: IsoDate; end: IsoDate },
  today: IsoDate,
): number {
  if (today < period.start) return 0;
  if (today > period.end) return daysInclusive(period.start, period.end);
  return daysInclusive(period.start, today);
}

// ─── the comparison ───────────────────────────────────────────────────────

export type PaceState = 'unplanned' | 'under' | 'on-track' | 'over';

/**
 * The rate of spending against the rate of time.
 *
 * Null rather than a number when the question does not apply: no plan to
 * measure against, or no elapsed calendar to measure over. Infinity renders as
 * a number and means nothing, which is worse than an honest absence.
 */
export function budgetPace(
  planned: Money | null,
  actual: Money,
  daysElapsed: number,
  daysInPeriod: number,
): number | null {
  if (planned === null || planned.minor <= 0n) return null;
  if (daysElapsed <= 0 || daysInPeriod <= 0) return null;

  // Rearranged to divide once, at the end: actual x days_in_period over
  // planned x days_elapsed. Both products stay integers, so nothing rounds
  // before the single division that has to produce a ratio.
  const numerator = actual.minor * BigInt(daysInPeriod);
  const denominator = planned.minor * BigInt(daysElapsed);
  return Number(numerator) / Number(denominator);
}

/**
 * What a pace means, with a margin around the middle.
 *
 * Nobody spends evenly across a month — a grocery run lands on one day — so a
 * pace of 1.03 is not news. The band exists so the flag means something when
 * it appears, which is the whole value of flagging early.
 */
export function paceState(pace: number | null): PaceState {
  if (pace === null) return 'unplanned';
  if (pace > 1.05) return 'over';
  if (pace < 0.95) return 'under';
  return 'on-track';
}

export interface CategoryPlanned {
  readonly categoryId: string;
  readonly name: string;
  readonly nature: 'fixed' | 'variable';
  /** Null when nobody has budgeted it. Not the same as zero. */
  readonly planned: Money | null;
}

export interface CategoryActual {
  /** Null for spending with no category, which is a real state. */
  readonly categoryId: string | null;
  readonly spent: Money;
}

export interface BudgetComparison {
  readonly categoryId: string | null;
  readonly name: string;
  readonly nature: 'fixed' | 'variable' | null;
  readonly planned: Money | null;
  readonly spent: Money;
  /** Negative once the plan is exceeded. Null when there is no plan. */
  readonly remaining: Money | null;
  readonly pace: number | null;
  readonly state: PaceState;
}

export function compareToBudget(options: {
  readonly planned: readonly CategoryPlanned[];
  readonly actuals: readonly CategoryActual[];
  readonly daysElapsed: number;
  readonly daysInPeriod: number;
}): readonly BudgetComparison[] {
  const { planned, actuals, daysElapsed, daysInPeriod } = options;

  const currency =
    planned.find((p) => p.planned !== null)?.planned?.currency ??
    actuals[0]?.spent.currency ??
    'INR';
  const spentByCategory = new Map<string | null, bigint>();
  for (const actual of actuals) {
    spentByCategory.set(
      actual.categoryId,
      (spentByCategory.get(actual.categoryId) ?? 0n) + actual.spent.minor,
    );
  }

  const rows: BudgetComparison[] = planned.map((category) => {
    const spent = money(spentByCategory.get(category.categoryId) ?? 0n, currency);
    const pace = budgetPace(category.planned, spent, daysElapsed, daysInPeriod);

    return {
      categoryId: category.categoryId,
      name: category.name,
      nature: category.nature,
      planned: category.planned,
      spent,
      remaining:
        category.planned === null ? null : money(category.planned.minor - spent.minor, currency),
      pace,
      state: paceState(pace),
    };
  });

  // Spending with no category cannot be compared with anything, and dropping
  // it would make these totals disagree with the ledger — which is a worse
  // problem than an awkward row.
  const uncategorised = spentByCategory.get(null);
  if (uncategorised !== undefined && uncategorised !== 0n) {
    rows.push({
      categoryId: null,
      name: 'Uncategorised',
      nature: null,
      planned: null,
      spent: money(uncategorised, currency),
      remaining: null,
      pace: null,
      state: 'unplanned',
    });
  }

  return rows;
}
