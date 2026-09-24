/**
 * A percentage of an amount of money, without a float.
 *
 * Rates arrive from `tax_rule` as text — `12.500`, `4.000`, from `numeric(6,3)` —
 * and an amount of money is a bigint of minor units. Multiplying one by the other
 * is exactly where a double is quietly wrong: 12.5% of ₹100.04 is ₹12.505, and
 * whether that is 1250 or 1251 paise is a question of rounding rule, not of
 * luck. So it is done in integers, with the rule stated.
 */

/** A rate in `numeric(6,3)` text — `12.5`, `12.500` — as thousandths of a percent. */
export function thousandths(ratePct: string): bigint {
  const [whole = '0', fraction = ''] = ratePct.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0').slice(0, 3));
}

/**
 * `minor × rate%`, half a paisa rounding up, entirely in bigint.
 *
 * Half up rather than truncating: a tax that always rounds down is a small
 * standing error in one direction, and several bands or terms would carry it.
 * Non-negative only — a taxable figure never is anything else.
 */
export function percentOf(minor: bigint, ratePct: string): bigint {
  return (minor * thousandths(ratePct) + 50_000n) / 100_000n;
}
