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
