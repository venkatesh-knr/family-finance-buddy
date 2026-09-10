/**
 * What a holding is worth, from a price the driver recorded.
 *
 * Two steps, and each has a wrong answer that looks right.
 *
 * ── which price applies ─────────────────────────────────────────────────
 *
 * The latest one dated on or before the day in question, and never a later
 * one. Same rule as an exchange rate and for the same reason: valuing the 7th
 * at the 8th's NAV moves a figure somebody may already have relied on, and a
 * Schedule FA peak computed that way would be wrong in a way nothing on the
 * screen would reveal.
 *
 * Where a date has two prices — a vendor revising a published NAV, which
 * happens — the most recently fetched wins. The superseded row stays in the
 * table, so a total that once looked different can still be explained.
 *
 * ── multiplying it out ──────────────────────────────────────────────────
 *
 * Entirely in bigint, on the full price, rounded once at the end. Rounding the
 * NAV to paise first and then multiplying by ten thousand units loses ₹67 on
 * an ordinary holding — which is exactly why `price.value` is numeric and not
 * minor units, and the arithmetic here is the other half of that decision.
 */

import { money, minorUnitExponent, type CurrencyCode, type Money } from '../lib/money.ts';
import { QUANTITY_SCALE } from '../lib/quantity.ts';
import type { IsoDate } from '../lib/dates.ts';

export interface Price {
  readonly source: string;
  readonly externalId: string;
  readonly asOf: IsoDate;
  /**
   * A decimal string, never a number.
   *
   * `numeric(20,6)` so a NAV quoted to four places survives, and parsing it
   * into a double here would discard what the column was chosen to keep.
   */
  readonly value: string;
  readonly currency: CurrencyCode;
  /** When the driver got it. Distinguishes a revision from the original. */
  readonly fetchedAt: string;
}

/** The price that applied on a date: latest date on or before it, latest fetch. */
export function priceOn(
  prices: readonly Price[],
  source: string,
  externalId: string,
  on: IsoDate,
): Price | null {
  let best: Price | null = null;

  for (const price of prices) {
    if (price.source !== source || price.externalId !== externalId) continue;
    if (price.asOf > on) continue;

    if (best === null || price.asOf > best.asOf) {
      best = price;
      continue;
    }
    // Same date: the later fetch is the corrected figure.
    if (price.asOf === best.asOf && price.fetchedAt > best.fetchedAt) {
      best = price;
    }
  }

  return best;
}

/**
 * Units × price, as money.
 *
 * `quantity` is scaled by `QUANTITY_SCALE`; `price` is a decimal string. The
 * whole calculation stays in bigint and rounds half away from zero exactly
 * once, on the final figure — so a half-paise never rounds toward the house,
 * and no intermediate value passes through a double.
 */
export function valueOf(
  quantity: bigint,
  price: string,
  currency: CurrencyCode,
): Money {
  const exponent = minorUnitExponent(currency);

  const negative = price.trimStart().startsWith('-');
  const [whole = '0', fraction = ''] = price.replace('-', '').trim().split('.');
  const digits = BigInt(whole + fraction) * (negative ? -1n : 1n);

  //            quantity        price          to minor units
  // value  =  ───────────  ×  ──────────  ×  10^exponent
  //            10^SCALE        10^scale
  const numerator = quantity * digits * 10n ** BigInt(exponent);
  const denominator = 10n ** BigInt(QUANTITY_SCALE + fraction.length);

  const doubled = numerator * 2n;
  const quotient = doubled / denominator;
  const rounded = quotient >= 0n ? (quotient + 1n) / 2n : (quotient - 1n) / 2n;

  return money(rounded, currency);
}
