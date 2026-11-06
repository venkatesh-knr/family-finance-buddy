/**
 * Physical gold, worked out (docs/design/gold.md; GD-I3, GD-I8, GD-I12).
 *
 * Physical gold is worth its grams at the household's typed rate for its purity on or before the day, and never a typed value. With no
 * rate it is not valued, and says so: it is not counted as zero, and it is not counted at what was paid (GD-I3). A rate is a dated row
 * per purity, appended and never changed, so the value of an earlier day does not move because a rate was typed today (GD-I12).
 *
 * The cost of a purchase is one figure, whether the price paid or the rate per gram that day was typed (GD-I8): one is worked out from
 * the other here, on the device, and the cost of the lot is what is stored.
 *
 * Pure: no I/O and no clock. The day is passed in, and every figure is integer minor units; grams are a scaled integer
 * (`src/lib/quantity.ts`), so a fractional gram never meets a float. Money is rounded once, half up, at the end.
 */

import { daysBetween } from '../lib/dates.ts';
import { QUANTITY_SCALE } from '../lib/quantity.ts';

export type Purity = '24k' | '22k' | '18k';

/** A rate older than this still values the gold, and is shown as old, because the person can put it right (gold.md section 3). */
export const STALE_RATE_DAYS = 30;

/** The price of a gram of a purity on a day, in minor units of its currency. */
export interface GoldRate {
  readonly purity: Purity;
  /** The day the rate is for. */
  readonly asOf: string;
  readonly perGramMinor: bigint;
  readonly currency: string;
  /** When it was typed: of two rates for one day, the later wins. */
  readonly typedAt: string;
}

const SCALE = 10n ** BigInt(QUANTITY_SCALE);

/** Divide, rounding half up. Both are positive here. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/**
 * The rate in force for a purity on a day: the latest dated on or before it. Two rates for one day are possible, and the one typed
 * later wins, so a correction is a later row and not an edit.
 */
export function latestRate(rates: readonly GoldRate[], purity: Purity, on: string): GoldRate | null {
  let best: GoldRate | null = null;
  for (const candidate of rates) {
    if (candidate.purity !== purity || candidate.asOf > on) continue;
    if (best === null || candidate.asOf > best.asOf || (candidate.asOf === best.asOf && candidate.typedAt > best.typedAt)) best = candidate;
  }
  return best;
}

export type PhysicalGoldValue =
  | { readonly ok: true; readonly value: { readonly minor: bigint; readonly currency: string }; readonly rate: GoldRate }
  | { readonly ok: false; readonly reason: 'no-rate' | 'mixed-currency' };

/**
 * What physical gold is worth on a day: its grams at the latest rate for its purity on or before it. Refused, not guessed, where there
 * is no rate: the reason says why. A rate in another currency than the gold's is refused too, and not converted at a guess.
 */
export function physicalGoldValue(
  held: { readonly grams: bigint; readonly purity: Purity; readonly currency: string },
  rates: readonly GoldRate[],
  on: string,
): PhysicalGoldValue {
  const rate = latestRate(rates, held.purity, on);
  if (rate === null) return { ok: false, reason: 'no-rate' };
  if (rate.currency !== held.currency) return { ok: false, reason: 'mixed-currency' };
  return { ok: true, value: { minor: divideHalfUp(held.grams * rate.perGramMinor, SCALE), currency: held.currency }, rate };
}

/** The cost of a purchase from a rate per gram: the rate times the grams (GD-I8). */
export function costFromRate(perGramMinor: bigint, grams: bigint): bigint {
  return divideHalfUp(grams * perGramMinor, SCALE);
}

/** The rate per gram a price paid comes to, to show beside it. Null for no grams: there is no rate for nothing. */
export function ratePerGram(costMinor: bigint, grams: bigint): bigint | null {
  if (grams <= 0n) return null;
  return divideHalfUp(costMinor * SCALE, grams);
}

/** Grams held: what was bought less what was sold. */
export function gramsHeld(purchases: readonly bigint[], sales: readonly bigint[]): bigint {
  return purchases.reduce((sum, grams) => sum + grams, 0n) - sales.reduce((sum, grams) => sum + grams, 0n);
}

/** Whether a rate is older than thirty days on a day. */
export function rateIsStale(asAt: string, today: string): boolean {
  return daysBetween(asAt, today) > STALE_RATE_DAYS;
}

/** Grams as a bill shows them: three decimals, 20.000. Rounded half up if more were ever stored. */
export function formatGrams(grams: bigint): string {
  const thousandths = divideHalfUp(grams, 10n ** BigInt(QUANTITY_SCALE - 3));
  const whole = thousandths / 1000n;
  return `${whole.toString()}.${(thousandths % 1000n).toString().padStart(3, '0')}`;
}
