/**
 * What an NPS holding is worth: the units held times the NAV, which the pension regulator publishes to four decimal
 * places (docs/blueprint.md section 10: "units from your statement of transactions; NAV from the CRA's daily publication",
 * typed for now, docs/decisions.md, Retirement).
 *
 * Pure: strings in, money out. Both are taken apart digit by digit and never become a Number: the units are a scaled
 * integer of eight places, as every quantity here is, the NAV one of four, and the product is divided once and rounded
 * once, half a minor unit upward.
 */

import { minorUnitExponent, money, type Money } from '../lib/money.ts';
import { QUANTITY_SCALE, parseQuantity } from '../lib/quantity.ts';

const NAV = /^\d+(\.\d{1,4})?$/;
const NAV_SCALE = 4;

export type NpsValue =
  | { readonly ok: true; readonly value: Money }
  | { readonly ok: false; readonly reason: 'invalid-units' | 'invalid-nav' };

export function npsValue(units: string, nav: string, currency: string): NpsValue {
  let scaledUnits: bigint;
  try {
    scaledUnits = parseQuantity(units);
  } catch {
    return { ok: false, reason: 'invalid-units' };
  }

  const cleaned = nav.trim();
  if (!NAV.test(cleaned)) return { ok: false, reason: 'invalid-nav' };
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const scaledNav = BigInt(whole + fraction.padEnd(NAV_SCALE, '0'));
  if (scaledNav === 0n) return { ok: false, reason: 'invalid-nav' };

  // units x NAV is in units of 1e-8 x 1e-4 of a currency's major unit; a minor unit is 10^-exponent of one.
  const numerator = scaledUnits * scaledNav * 10n ** BigInt(minorUnitExponent(currency));
  const denominator = 10n ** BigInt(QUANTITY_SCALE + NAV_SCALE);
  return { ok: true, value: money((2n * numerator + denominator) / (2n * denominator), currency) };
}
