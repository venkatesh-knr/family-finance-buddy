import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { fireLadder, fireTarget } from './fire.ts';

/**
 * The FIRE target, and the ladder of what it becomes as prices rise.
 *
 * Taken from the workbook's rows 80 to 84 and the row of years beside them:
 * a Final Expense figure, multiplied by 25, 30 and 50, then compounded at 6%
 * a year for a decade.
 *
 * The fixtures below are that sheet's own numbers. This module replaces its
 * arithmetic and therefore has to agree with it — where it disagrees, one of
 * the two is wrong and somebody should find out which before trusting either.
 */

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const rupees = (m: { minor: bigint }) => Number(m.minor) / 100;

// Row 80: Final Expense.
const FINAL_EXPENSE = inr(1_793_800);

describe('fireTarget', () => {
  it('matches the sheet at 25x, 30x and 50x', () => {
    expect(rupees(fireTarget(FINAL_EXPENSE, 25))).toBe(44_845_000);
    expect(rupees(fireTarget(FINAL_EXPENSE, 30))).toBe(53_814_000);
    expect(rupees(fireTarget(FINAL_EXPENSE, 50))).toBe(89_690_000);
  });

  it('is zero when nothing is planned, rather than a number that looks reassuring', () => {
    expect(rupees(fireTarget(inr(0), 25))).toBe(0);
  });

  it('refuses a multiplier that is not positive', () => {
    expect(() => fireTarget(FINAL_EXPENSE, 0)).toThrow(/multiplier/i);
    expect(() => fireTarget(FINAL_EXPENSE, -25)).toThrow(/multiplier/i);
  });
});

describe('fireLadder', () => {
  it('matches the sheet year by year at 6%', () => {
    // The workbook compounds each year off the one before: 4,48,45,000 then
    // +6%, +6%, and so on along row 82.
    const ladder = fireLadder({
      annualExpense: FINAL_EXPENSE,
      multiplier: 25,
      inflationPct: 6,
      fromYear: 2023,
      years: 10,
    });

    expect(ladder).toHaveLength(11); // the base year, then ten more
    expect(ladder[0]).toEqual({ year: 2023, target: fireTarget(FINAL_EXPENSE, 25) });

    // Cells from row 82, to the paisa.
    expect(rupees(ladder[1]!.target)).toBe(47_535_700);
    expect(rupees(ladder[2]!.target)).toBe(50_387_842);
    expect(rupees(ladder[3]!.target)).toBe(53_411_112.52);
  });

  it('agrees with the sheet to within a rupee after a decade of compounding', () => {
    // It does not agree exactly, and should not. Excel carries fractional
    // paise in a float; this truncates to whole paise each year, because there
    // is no such thing as a third of a paisa. Ten rounds of that leaves us
    // three paise below the sheet — ours being the defensible figure, and the
    // gap being worth an assertion so nobody later mistakes it for a bug.
    const ladder = fireLadder({
      annualExpense: FINAL_EXPENSE,
      multiplier: 25,
      inflationPct: 6,
      fromYear: 2023,
      years: 10,
    });

    const sheetAt2033 = 80_310_564.9514643;
    const oursAt2033 = rupees(ladder[10]!.target);

    expect(oursAt2033).toBe(80_310_564.92);
    expect(Math.abs(oursAt2033 - sheetAt2033)).toBeLessThan(1);
  });

  it('labels the years the way the sheet does', () => {
    const ladder = fireLadder({
      annualExpense: FINAL_EXPENSE,
      multiplier: 25,
      inflationPct: 6,
      fromYear: 2023,
      years: 10,
    });
    expect(ladder.map((step) => step.year)).toEqual([
      2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033,
    ]);
  });

  it('compounds rather than adding the same amount each year', () => {
    // A flat 6% of the base would give 2,69,07,000 of growth over ten years;
    // compounding gives more, and the difference is what makes a target set a
    // decade ago look small.
    const compounded = fireLadder({
      annualExpense: FINAL_EXPENSE,
      multiplier: 25,
      inflationPct: 6,
      fromYear: 2023,
      years: 10,
    });
    const flat = 44_845_000 + 44_845_000 * 0.06 * 10;
    expect(rupees(compounded[10]!.target)).toBeGreaterThan(flat);
  });

  it('stands still at zero inflation rather than dividing by anything', () => {
    const ladder = fireLadder({
      annualExpense: FINAL_EXPENSE,
      multiplier: 25,
      inflationPct: 0,
      fromYear: 2026,
      years: 3,
    });
    expect(ladder.every((step) => rupees(step.target) === 44_845_000)).toBe(true);
  });

  it('never reads the clock: the base year is given, not assumed', () => {
    const options = {
      annualExpense: FINAL_EXPENSE,
      multiplier: 25,
      inflationPct: 6,
      fromYear: 2026,
      years: 2,
    } as const;
    expect(fireLadder(options)).toEqual(fireLadder(options));
    expect(fireLadder(options)[0]?.year).toBe(2026);
  });

  it('refuses a negative span rather than returning nothing quietly', () => {
    expect(() =>
      fireLadder({
        annualExpense: FINAL_EXPENSE,
        multiplier: 25,
        inflationPct: 6,
        fromYear: 2026,
        years: -1,
      }),
    ).toThrow(/years/i);
  });
});
