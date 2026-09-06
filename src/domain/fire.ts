/**
 * The FIRE target, and the ladder of what it becomes as prices rise.
 *
 * The workbook does this at rows 80 to 84: a Final Expense figure, multiplied
 * by 25, 30 and 50, then compounded at 6% a year along a row of years. This
 * module replaces that arithmetic and its fixtures are the sheet's own numbers,
 * so the two can be compared rather than merely trusted.
 *
 * "The FIRE parameters — 25x, 30x, 50x and 6% inflation as the starting
 * profile." (§1009) Starting profile: every one of them is an input here, not
 * a constant, because a rule that lives in code is a rule nobody can change
 * when the world does.
 *
 * Pure, and the base year is an argument. A projection that read the clock
 * would give a different answer in January than in December of the same
 * financial year, which is the sort of thing nobody notices until it matters.
 */

import { money, type Money } from '../lib/money.ts';

/**
 * The corpus that supports a given annual expense at a given multiple.
 *
 * 25x is the four-percent rule, 30x a more cautious reading of it, 50x the
 * figure for someone who wants the withdrawal to be almost irrelevant. The app
 * offers all three and recommends none: which multiple is right is a judgement
 * about risk, and that is advice rather than arithmetic.
 */
export function fireTarget(annualExpense: Money, multiplier: number): Money {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error(`A FIRE multiplier must be a positive number, not ${String(multiplier)}.`);
  }

  // Scaled integer arithmetic rather than a float: the multiplier may be
  // fractional (33.3x is a defensible reading of a 3% withdrawal rate), and
  // money must not pass through a double on the way to a target somebody plans
  // a decade around.
  const scale = 1_000_000n;
  const scaled = BigInt(Math.round(multiplier * Number(scale)));
  return money((annualExpense.minor * scaled) / scale, annualExpense.currency);
}

export interface LadderStep {
  readonly year: number;
  readonly target: Money;
}

export interface FireLadderOptions {
  readonly annualExpense: Money;
  readonly multiplier: number;
  /** Per cent a year. 6 is the blueprint's starting figure, not a constant. */
  readonly inflationPct: number;
  /** The base year, given rather than read from the clock. */
  readonly fromYear: number;
  /** How many years beyond the base. Ten gives an eleven-step ladder. */
  readonly years: number;
}

/**
 * What the target becomes, year by year, as prices rise.
 *
 * Compounded, not added: the sheet does `previous + previous x 6%` along the
 * row, and over ten years the difference between that and a flat percentage of
 * the base is large. It is the whole reason the ladder is worth showing — a
 * target set once and never revisited quietly stops being enough.
 */
export function fireLadder(options: FireLadderOptions): readonly LadderStep[] {
  const { annualExpense, multiplier, inflationPct, fromYear, years } = options;

  if (!Number.isInteger(years) || years < 0) {
    throw new Error(`The number of years must be zero or more, not ${String(years)}.`);
  }
  if (!Number.isFinite(inflationPct) || inflationPct < 0) {
    throw new Error(`Inflation must be zero or more, not ${String(inflationPct)}.`);
  }

  const base = fireTarget(annualExpense, multiplier);

  // Kept in scaled integers throughout. Ten rounds of x1.06 through a double
  // would drift, and the drift lands in a figure that gets read as a target.
  const scale = 1_000_000n;
  const factor = scale + BigInt(Math.round((inflationPct / 100) * Number(scale)));

  const steps: LadderStep[] = [];
  let minor = base.minor;

  for (let offset = 0; offset <= years; offset++) {
    steps.push({ year: fromYear + offset, target: money(minor, annualExpense.currency) });
    minor = (minor * factor) / scale;
  }

  return steps;
}
