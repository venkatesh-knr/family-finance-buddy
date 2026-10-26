/**
 * What a property cost, for the day it is sold.
 *
 * docs/blueprint.md, Property: "Purchase price, stamp duty and registration all form part of what you actually paid —
 * which is what a future capital-gains figure is measured against, and what nobody can reconstruct fifteen years
 * later. Capital improvements are dated entries that add to the basis; repairs are recorded but don't."
 *
 * A pure function: the parts in, the cost out, nothing read from anywhere and no clock (CLAUDE.md, Calculation). It
 * is the unindexed cost. The 20% with indexation election for a property bought before 23 July 2024 multiplies each
 * part by an index for the year it was paid, so the dated parts are what it will need and they are what this keeps
 * apart; the index is a `tax_rule` row and belongs to the tax engine, not here.
 *
 * Integer minor units throughout. A share is taken in integer arithmetic to two decimal places of a percentage and
 * rounded once, half a paisa upward, on the share and not on its parts, so the parts cannot drift from the whole.
 */

import { money, type Money } from '../lib/money.ts';
import type { IsoDate } from '../lib/dates.ts';

export interface PropertyImprovement {
  readonly date: IsoDate;
  readonly amount: Money;
  /** Capital work (a new kitchen, a room added) adds to the cost. A repair does not. */
  readonly isCapital: boolean;
}

export interface PropertyCostInput {
  readonly purchaseCost: Money;
  readonly stampDuty: Money;
  readonly registration: Money;
  readonly improvements: readonly PropertyImprovement[];
  /**
   * The household's share of the property, as a percentage with up to two decimal places: "50", "33.33". Absent is
   * the whole of it. A person's share of a jointly owned property is the whole cost times their share.
   */
  readonly sharePct?: string;
  /**
   * Count the work done on or before this day, the day itself included, which is the day it is sold. Absent counts
   * all of it. Work done after a sale is not part of what the property cost the seller.
   */
  readonly asOf?: IsoDate;
}

export type PropertyCostRefusal = 'mixed-currency' | 'negative-amount' | 'invalid-share';

export type PropertyCostBasis =
  | {
      readonly ok: true;
      readonly purchaseCost: Money;
      readonly stampDuty: Money;
      readonly registration: Money;
      /** The capital improvements counted. */
      readonly capitalImprovements: Money;
      /** The repairs recorded and left out, so a screen can say what was not counted and why. */
      readonly repairsExcluded: Money;
      /** The cost of the whole property. */
      readonly whole: Money;
      /** The household's share of it: what a gain is measured against. */
      readonly share: Money;
      readonly sharePct: string;
    }
  | { readonly ok: false; readonly reason: PropertyCostRefusal };

/** A share is a percentage in (0, 100] with at most two decimal places; scaled by 100 it is an integer. */
const SHARE = /^\d{1,3}(\.\d{1,2})?$/;

function scaledShare(sharePct: string): bigint | null {
  if (!SHARE.test(sharePct)) return null;
  const [whole = '0', fraction = ''] = sharePct.split('.');
  const scaled = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return scaled >= 1n && scaled <= 10_000n ? scaled : null;
}

export function propertyCostBasis(input: PropertyCostInput): PropertyCostBasis {
  const sharePct = input.sharePct ?? '100';
  const scaled = scaledShare(sharePct);
  if (scaled === null) return { ok: false, reason: 'invalid-share' };

  const currency = input.purchaseCost.currency;
  const amounts = [
    input.purchaseCost,
    input.stampDuty,
    input.registration,
    ...input.improvements.map((work) => work.amount),
  ];
  if (amounts.some((amount) => amount.currency !== currency)) return { ok: false, reason: 'mixed-currency' };
  if (amounts.some((amount) => amount.minor < 0n)) return { ok: false, reason: 'negative-amount' };

  let capital = 0n;
  let repairs = 0n;
  for (const work of input.improvements) {
    if (input.asOf !== undefined && work.date > input.asOf) continue;
    if (work.isCapital) capital += work.amount.minor;
    else repairs += work.amount.minor;
  }

  const whole = input.purchaseCost.minor + input.stampDuty.minor + input.registration.minor + capital;
  // Half a paisa rounds up. Every amount here is non-negative, so adding half the divisor before dividing is that.
  const share = (whole * scaled + 5_000n) / 10_000n;

  return {
    ok: true,
    purchaseCost: input.purchaseCost,
    stampDuty: input.stampDuty,
    registration: input.registration,
    capitalImprovements: money(capital, currency),
    repairsExcluded: money(repairs, currency),
    whole: money(whole, currency),
    share: money(share, currency),
    sharePct,
  };
}

// ─── the rest of what a property screen works out ─────────────────────────────────────────────────────────────────

/**
 * The household's share of an amount: a value, or a loan. The same integer arithmetic and the same rounding as the
 * cost, so a share of the cost and a share of the value cannot disagree about what a share is.
 */
export function shareOfMoney(
  value: Money,
  sharePct: string,
): { readonly ok: true; readonly amount: Money } | { readonly ok: false; readonly reason: 'invalid-share' | 'negative-amount' } {
  const scaled = scaledShare(sharePct);
  if (scaled === null) return { ok: false, reason: 'invalid-share' };
  if (value.minor < 0n) return { ok: false, reason: 'negative-amount' };
  return { ok: true, amount: money((value.minor * scaled + 5_000n) / 10_000n, value.currency) };
}

/** A dated estimate of the whole property. */
export interface PropertyValuationPoint {
  readonly asOf: IsoDate;
  readonly value: Money;
}

/**
 * The newest valuation at or before a day, from valuations in any order; null when there is none yet. A later
 * valuation never changes the answer for an earlier day, which is what keeps yesterday's net worth where it was.
 */
export function latestValuationOn<T extends { readonly asOf: IsoDate }>(
  valuations: readonly T[],
  on: IsoDate,
): T | null {
  let best: T | null = null;
  for (const valuation of valuations) {
    if (valuation.asOf > on) continue;
    if (best === null || valuation.asOf > best.asOf) best = valuation;
  }
  return best;
}

const dateParts = (iso: IsoDate): [number, number, number] => [
  Number(iso.slice(0, 4)),
  Number(iso.slice(5, 7)),
  Number(iso.slice(8, 10)),
];

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** A date some months on, ending the month on its last day when the day does not exist in it. */
function addMonths(iso: IsoDate, months: number): IsoDate {
  const [year, month, day] = dateParts(iso);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(Math.min(day, last), 2)}`;
}

/** Whole months from one day to a later one; none when the later day is not later. */
function wholeMonths(from: IsoDate, to: IsoDate): number {
  if (to <= from) return 0;
  const [fy, fm] = dateParts(from);
  const [ty, tm] = dateParts(to);
  let months = (ty - fy) * 12 + (tm - fm);
  if (addMonths(from, months) > to) months -= 1;
  return Math.max(months, 0);
}

/**
 * How old a valuation is, in whole months, and whether it is stale: more than `staleMonths` months old, so a
 * valuation is not stale on the day its setting is reached and is the day after. Stale is computed from the date
 * and never stored (docs/decisions.md, Property). A valuation dated after today is not old.
 */
export function valuationAge(
  asOf: IsoDate,
  today: IsoDate,
  staleMonths: number,
): { readonly months: number; readonly stale: boolean } {
  return { months: wholeMonths(asOf, today), stale: today > addMonths(asOf, staleMonths) };
}

/**
 * Equity: the household's share of the value less what is outstanding on the loan, or the value when there is no
 * loan. It can be negative, and is: a loan larger than the property is said and not floored at nothing. A loan in
 * another currency is refused rather than subtracted across.
 */
export function propertyEquity(
  valueShare: Money,
  outstanding: Money | null,
): { readonly ok: true; readonly equity: Money } | { readonly ok: false; readonly reason: 'mixed-currency' } {
  if (outstanding === null) return { ok: true, equity: valueShare };
  if (outstanding.currency !== valueShare.currency) return { ok: false, reason: 'mixed-currency' };
  return { ok: true, equity: money(valueShare.minor - outstanding.minor, valueShare.currency) };
}
