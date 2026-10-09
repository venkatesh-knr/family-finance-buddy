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

import type { IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';

/**
 * Where a ladder starts: the calendar year of the given IST date.
 *
 * The workbook's ladder is anchored at a year that was typed once and has not
 * moved since, so its projection quietly refers to a base two years in the
 * past. Deriving the anchor from today removes that failure — but the date is
 * still an argument, because a projection that read the clock would answer
 * differently in January than in December of one financial year, and nobody
 * would notice until the two answers were compared.
 *
 * Calendar years rather than tax years: the ladder is labelled by year and
 * compounds annually, and mixing in an April boundary would put two different
 * meanings of "2026" on one screen.
 */
export function fireBaseYear(today: IsoDate): number {
  return Number(today.slice(0, 4));
}

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

export interface ProjectionOptions {
  /** What is held today, in the ladder's currency. */
  readonly corpus: Money;
  /** What is put in each month, to begin with. */
  readonly monthlyContribution: Money;
  /** Per cent a year the corpus grows. An assumption the household sets, never a constant. */
  readonly returnPct: number;
  /** Per cent a year the contribution is raised by. Zero is a flat SIP. */
  readonly stepUpPct: number;
  /** The inflated target by year, from `fireLadder`; its first step is today and sets the horizon. */
  readonly ladder: readonly LadderStep[];
}

export interface ProjectionStep {
  readonly year: number;
  readonly corpus: Money;
  readonly target: Money;
}

export interface Projection {
  readonly steps: readonly ProjectionStep[];
  /** The first year the corpus meets that year's target; null if no year of the ladder does. */
  readonly reachedYear: number | null;
}

/**
 * The corpus year by year against the inflated target (blueprint §06):
 *
 *   c(n+1)   = c(n) x (1 + r) + sip(n)
 *   sip(n+1) = sip(n) x (1 + step_up),   sip(0) = twelve months of the monthly contribution
 *
 * The crossing point is the FIRE date. Integer minor units throughout, each year's growth truncated
 * to the paisa the way the ladder's is, so the same inputs give the same answer on every device and
 * a test can say exactly which paisa. The rates are arguments: 10% is whatever the household said, and
 * a projection that assumed one would be advice dressed as arithmetic.
 *
 * A projection is only as good as its inputs and says nothing about them: it does not know whether
 * the corpus is complete (property, deposits and the rest of the balance sheet arrive in later
 * stages), so whoever shows it has to say what it assumes.
 *
 * A target of nothing is never "reached": it means nothing is planned, and every corpus meets it.
 */
export function fireProjection(options: ProjectionOptions): Projection {
  const { corpus, monthlyContribution, returnPct, stepUpPct, ladder } = options;

  const first = ladder[0];
  if (first === undefined) throw new Error('A projection needs a ladder to measure against, and this one is empty.');
  const currency = first.target.currency;
  if (corpus.currency !== currency || monthlyContribution.currency !== currency) {
    throw new Error(
      `The corpus, the contribution and the target must share a currency, not ${corpus.currency}, ${monthlyContribution.currency} and ${currency}.`,
    );
  }
  if (!Number.isFinite(returnPct) || returnPct < 0) {
    throw new Error(`The expected return must be zero or more, not ${String(returnPct)}.`);
  }
  if (!Number.isFinite(stepUpPct) || stepUpPct < 0) {
    throw new Error(`The step-up must be zero or more, not ${String(stepUpPct)}.`);
  }

  const scale = 1_000_000n;
  const growth = scale + BigInt(Math.round((returnPct / 100) * Number(scale)));
  const raise = scale + BigInt(Math.round((stepUpPct / 100) * Number(scale)));

  const steps: ProjectionStep[] = [];
  let held = corpus.minor;
  let sip = monthlyContribution.minor * 12n;
  let reachedYear: number | null = null;

  for (const step of ladder) {
    steps.push({ year: step.year, corpus: money(held, currency), target: step.target });
    if (reachedYear === null && step.target.minor > 0n && held >= step.target.minor) {
      reachedYear = step.year;
    }
    held = (held * growth) / scale + sip;
    sip = (sip * raise) / scale;
  }

  return { steps, reachedYear };
}

export interface Progress {
  /** Whole per cent of today's target the corpus is. Not clamped: 116 means the target is passed. */
  readonly percent: number;
  /** Target less corpus, or nothing once the corpus has passed it. */
  readonly shortfall: Money;
}

/** How far along: the corpus against today's target. Null with no target to be a share of. */
export function fireProgress(corpus: Money, target: Money): Progress | null {
  if (target.minor <= 0n) return null;
  const left = target.minor - corpus.minor;
  return {
    percent: Number((corpus.minor * 100n) / target.minor),
    shortfall: money(left > 0n ? left : 0n, target.currency),
  };
}
