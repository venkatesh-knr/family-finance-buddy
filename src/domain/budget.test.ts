import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import {
  budgetPace,
  compareToBudget,
  daysInclusive,
  monthBounds,
  paceState,
  taxYearBounds,
  type CategoryActual,
  type CategoryPlanned,
} from './budget.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');

/**
 * Period boundaries first, because everything below divides by them.
 *
 * The Indian tax year runs 1 April to 31 March, and this app also carries
 * calendar years for Schedule FA. Getting a boundary wrong here would not
 * produce an error — it would produce a plausible pace computed over the wrong
 * number of days, which is the kind of wrong nobody notices.
 */
describe('taxYearBounds', () => {
  it('runs April to March', () => {
    expect(taxYearBounds(2026)).toEqual({ start: '2026-04-01', end: '2027-03-31' });
  });

  it('is 365 days in an ordinary year', () => {
    const { start, end } = taxYearBounds(2026);
    expect(daysInclusive(start, end)).toBe(365);
  });

  it('is 366 when the February inside it is a leap February', () => {
    // FY 2027-28 contains February 2028, which has 29 days.
    const { start, end } = taxYearBounds(2027);
    expect(daysInclusive(start, end)).toBe(366);
  });
});

describe('monthBounds', () => {
  it('covers a whole month whatever day it is given', () => {
    expect(monthBounds('2026-09-06')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('knows how long each month is', () => {
    expect(daysInclusive(...Object.values(monthBounds('2026-02-10')) as [string, string])).toBe(28);
    expect(daysInclusive(...Object.values(monthBounds('2028-02-10')) as [string, string])).toBe(29);
    expect(daysInclusive(...Object.values(monthBounds('2026-12-25')) as [string, string])).toBe(31);
  });
});

/**
 * "pace = actual / (planned x days_elapsed / days_in_period). Pace above 1.0
 * flags a category mid-month, rather than after the overspend." (§530)
 */
describe('budgetPace', () => {
  it('is 1.0 when spending exactly tracks the days elapsed', () => {
    // Half the month gone, half the budget spent.
    expect(budgetPace(inr(10_000), inr(5_000), 15, 30)).toBe(1);
  });

  it('is above 1.0 when spending is ahead of the calendar', () => {
    // Ten days into a thirty-day month, two thirds already spent.
    expect(budgetPace(inr(9_000), inr(6_000), 10, 30)).toBe(2);
  });

  it('is below 1.0 when spending is behind it', () => {
    expect(budgetPace(inr(10_000), inr(2_500), 15, 30)).toBe(0.5);
  });

  it('flags an overspend on the first day rather than waiting for the month', () => {
    // The whole budget gone on day one is a pace of 30, and the point of the
    // formula is that it says so now rather than on the 31st.
    expect(budgetPace(inr(10_000), inr(10_000), 1, 30)).toBe(30);
  });

  it('is zero when nothing has been spent', () => {
    expect(budgetPace(inr(10_000), inr(0), 15, 30)).toBe(0);
  });

  it('is null rather than infinite when nothing was planned', () => {
    // Dividing by a plan of zero would give Infinity, which renders as a
    // number and means nothing. Unplanned is a state, not a ratio.
    expect(budgetPace(inr(0), inr(5_000), 15, 30)).toBeNull();
    expect(budgetPace(null, inr(5_000), 15, 30)).toBeNull();
  });

  it('is null on the day a period begins, before any time has passed', () => {
    // Zero days elapsed divides by zero. A pace needs some elapsed calendar to
    // be a pace at all.
    expect(budgetPace(inr(10_000), inr(1_000), 0, 30)).toBeNull();
  });

  it('does not drift on figures a float would round', () => {
    // 1,00,000 / 3 spent, a third of the way through: exactly 1.0.
    expect(budgetPace(inr(100_000), inr(33_333.33), 10, 30)).toBeCloseTo(0.9999999, 6);
  });
});

describe('paceState', () => {
  it('calls a category over when it is ahead of the calendar', () => {
    expect(paceState(1.2)).toBe('over');
  });

  it('allows a margin around exactly on track, because nobody spends evenly', () => {
    expect(paceState(1.0)).toBe('on-track');
    expect(paceState(1.04)).toBe('on-track');
    expect(paceState(0.96)).toBe('on-track');
  });

  it('calls it under when comfortably behind', () => {
    expect(paceState(0.5)).toBe('under');
  });

  it('says nothing at all when there is no pace to judge', () => {
    expect(paceState(null)).toBe('unplanned');
  });
});

describe('compareToBudget', () => {
  const planned: readonly CategoryPlanned[] = [
    { categoryId: 'c1', name: 'Grocery', nature: 'fixed', planned: inr(12_000) },
    { categoryId: 'c2', name: 'Restaurants', nature: 'variable', planned: inr(3_000) },
    { categoryId: 'c3', name: 'Dress', nature: 'variable', planned: null },
  ];

  const actuals: readonly CategoryActual[] = [
    { categoryId: 'c1', spent: inr(6_000) },
    { categoryId: 'c2', spent: inr(2_900) },
    { categoryId: null, spent: inr(450) }, // uncategorised
  ];

  it('pairs each plan with what was actually spent', () => {
    const rows = compareToBudget({ planned, actuals, daysElapsed: 15, daysInPeriod: 30 });
    const grocery = rows.find((r) => r.categoryId === 'c1');

    expect(grocery?.planned?.minor).toBe(1_200_000n);
    expect(grocery?.spent.minor).toBe(600_000n);
    expect(grocery?.remaining?.minor).toBe(600_000n);
    expect(grocery?.pace).toBe(1);
    expect(grocery?.state).toBe('on-track');
  });

  it('flags a category running ahead of the month', () => {
    const rows = compareToBudget({ planned, actuals, daysElapsed: 15, daysInPeriod: 30 });
    const restaurants = rows.find((r) => r.categoryId === 'c2');

    // 2,900 of 3,000 at the halfway point.
    expect(restaurants?.state).toBe('over');
    expect(restaurants?.pace).toBeCloseTo(1.933, 3);
  });

  it('shows an unplanned category as unplanned rather than as overspent', () => {
    const rows = compareToBudget({
      planned,
      actuals: [...actuals, { categoryId: 'c3', spent: inr(4_000) }],
      daysElapsed: 15,
      daysInPeriod: 30,
    });
    const dress = rows.find((r) => r.categoryId === 'c3');

    // Spending against no plan is not an overspend — nobody said what it
    // should be. Calling it "over" would invent a limit that was never set.
    expect(dress?.state).toBe('unplanned');
    expect(dress?.pace).toBeNull();
    expect(dress?.remaining).toBeNull();
    expect(dress?.spent.minor).toBe(400_000n);
  });

  it('keeps uncategorised spending as its own row rather than hiding it', () => {
    const rows = compareToBudget({ planned, actuals, daysElapsed: 15, daysInPeriod: 30 });
    const uncategorised = rows.find((r) => r.categoryId === null);

    // It cannot be compared with anything, and dropping it would make the
    // totals disagree with the ledger — which is worse than an awkward row.
    expect(uncategorised?.name).toBe('Uncategorised');
    expect(uncategorised?.spent.minor).toBe(45_000n);
    expect(uncategorised?.state).toBe('unplanned');
  });

  it('shows a planned category with no spending at all', () => {
    const rows = compareToBudget({
      planned,
      actuals: [{ categoryId: 'c1', spent: inr(6_000) }],
      daysElapsed: 15,
      daysInPeriod: 30,
    });
    const restaurants = rows.find((r) => r.categoryId === 'c2');

    expect(restaurants?.spent.minor).toBe(0n);
    expect(restaurants?.pace).toBe(0);
    expect(restaurants?.state).toBe('under');
  });

  it('reports remaining as negative once the plan is exceeded', () => {
    const rows = compareToBudget({
      planned,
      actuals: [{ categoryId: 'c1', spent: inr(14_000) }],
      daysElapsed: 30,
      daysInPeriod: 30,
    });
    const grocery = rows.find((r) => r.categoryId === 'c1');

    // Two thousand over, said as a negative rather than clamped to zero: the
    // overspend is the number somebody needs.
    expect(grocery?.remaining?.minor).toBe(-200_000n);
  });

  it('totals the period, plan and actual alike', () => {
    const rows = compareToBudget({ planned, actuals, daysElapsed: 15, daysInPeriod: 30 });
    const totalPlanned = rows.reduce((sum, r) => sum + (r.planned?.minor ?? 0n), 0n);
    const totalSpent = rows.reduce((sum, r) => sum + r.spent.minor, 0n);

    // 12,000 + 3,000 planned; 6,000 + 2,900 + 450 spent, the last of it
    // uncategorised and counted all the same.
    expect(totalPlanned).toBe(1_500_000n);
    expect(totalSpent).toBe(935_000n);
  });

  it('never reads the clock: the elapsed days are given', () => {
    const input = { planned, actuals, daysElapsed: 15, daysInPeriod: 30 };
    expect(compareToBudget(input)).toEqual(compareToBudget(input));
  });
});
