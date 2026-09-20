/**
 * Converting money, and refusing to when it cannot be done honestly.
 *
 * Two rules govern everything here, and both come from CLAUDE.md rather than
 * from taste:
 *
 *   "A transaction converts at the rate for its own date. Yesterday's net
 *   worth must not change because the rupee moved today."
 *
 *   "Never overwrite the original figure with a converted one."
 *
 * The first means a rate is looked up by date and never reached forward for.
 * The second means conversion always produces a new amount and the original
 * stays untouched wherever it is stored.
 *
 * The third rule is this module's own: when a rate is missing, it returns a
 * refusal rather than a number. A total that quietly drops what it could not
 * convert is worse than no total, because it looks complete while being short
 * by an amount nobody can see. Every caller has to decide what to show, which
 * is the point — there is no default that is safe here.
 */

import { minorUnitExponent, money, type Money } from '../lib/money.ts';
import type { IsoDate } from '../lib/dates.ts';

export interface Rate {
  readonly base: string;
  readonly quote: string;
  readonly asOf: IsoDate;
  /**
   * A decimal string, not a number.
   *
   * It arrives from `numeric(20,10)` as a string precisely so its precision
   * survives, and parsing it into a double here would throw away what the
   * column was chosen to keep.
   */
  readonly rate: string;
}

export interface MissingRate {
  readonly base: string;
  readonly quote: string;
}

export type Converted =
  | { readonly ok: true; readonly amount: Money }
  | { readonly ok: false; readonly missing: MissingRate };

/**
 * The rate that applied on a date: the latest one dated on or before it.
 *
 * Never a later one. Converting January at August's rate would move a figure
 * somebody may already have filed a return on, which is the exact failure the
 * dated-rows rule exists to prevent.
 */
export function rateOn(
  rates: readonly Rate[],
  base: string,
  quote: string,
  on: IsoDate,
): Rate | null {
  let best: Rate | null = null;
  for (const rate of rates) {
    if (rate.base !== base || rate.quote !== quote) continue;
    if (rate.asOf > on) continue;
    if (best === null || rate.asOf > best.asOf) best = rate;
  }
  return best;
}

/**
 * Multiply an integer amount by a decimal string, exactly.
 *
 * The rate is split into its digits and scale so the whole calculation stays
 * in bigint: `88.4567` becomes 884567 with a scale of 4. Doing it in floating
 * point would be a rounding error per holding, all of them in the same
 * direction, which is how a portfolio total drifts.
 *
 * Rounds half away from zero at the end, once, on the final figure.
 */
function multiply(minor: bigint, decimal: string, exponentDelta: number): bigint {
  const negative = decimal.trimStart().startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace('-', '').trim().split('.');
  const scale = fraction.length;
  const factor = BigInt(whole + fraction) * (negative ? -1n : 1n);

  // The target may use a different number of minor digits from the source —
  // a currency with no subunit next to one with two.
  const scaleUp = 10n ** BigInt(Math.max(exponentDelta, 0));
  const scaleDown = 10n ** BigInt(Math.max(-exponentDelta, 0));

  const numerator = minor * factor * scaleUp;
  const denominator = 10n ** BigInt(scale) * scaleDown;

  // Half away from zero, so a half-paise never rounds toward the house.
  const doubled = numerator * 2n;
  const quotient = doubled / denominator;
  const rounded = quotient >= 0n ? (quotient + 1n) / 2n : (quotient - 1n) / 2n;
  return rounded;
}

/**
 * Divide an integer amount by a decimal string, exactly.
 *
 * The mirror of `multiply`, and it exists for one reason: a household records
 * the rate it has. One row says a dollar costs 88.45 rupees, and reading the
 * same holdings in dollars needs that fact the other way round. Asking for a
 * second row instead would mean two rows describing one exchange rate, free to
 * disagree — which is the failure the dated-rows invariant exists to prevent.
 *
 * Dividing by `factor / 10^scale` is multiplying by `10^scale / factor`, so
 * the whole calculation stays in bigint and rounds once, at the end, half away
 * from zero.
 */
function divide(minor: bigint, decimal: string, exponentDelta: number): bigint {
  const negative = decimal.trimStart().startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace('-', '').trim().split('.');
  const scale = fraction.length;
  const factor = BigInt(whole + fraction) * (negative ? -1n : 1n);

  // The column forbids it — `check (rate > 0)` — so this is a guard against a
  // caller, not against the database.
  if (factor === 0n) throw new Error('A rate of zero cannot be inverted.');

  let numerator = minor * 10n ** BigInt(scale);
  let denominator = factor;
  if (exponentDelta > 0) numerator *= 10n ** BigInt(exponentDelta);
  else if (exponentDelta < 0) denominator *= 10n ** BigInt(-exponentDelta);

  const doubled = numerator * 2n;
  const quotient = doubled / denominator;
  return quotient >= 0n ? (quotient + 1n) / 2n : (quotient - 1n) / 2n;
}

export function convert(
  amount: Money,
  target: string,
  rates: readonly Rate[],
  on: IsoDate,
): Converted {
  // Untouched, not converted at 1.0. A round trip through an identity rate is
  // still an opportunity to round something that needed no rounding.
  if (amount.currency === target) return { ok: true, amount };

  const exponentDelta = minorUnitExponent(target) - minorUnitExponent(amount.currency);

  const rate = rateOn(rates, amount.currency, target, on);
  if (rate !== null) {
    return { ok: true, amount: money(multiply(amount.minor, rate.rate, exponentDelta), target) };
  }

  /**
   * The same rate, read backwards.
   *
   * Tried only after the pair itself, so a rate somebody recorded for this
   * direction always wins. That order matters where the two disagree: a rate a
   * bank actually gave on a remittance carries a spread, and its inverse is
   * not the rate that bank would give going the other way. For a mid-market
   * rate — which is what a feed publishes and what these rows almost always
   * are — the inverse is the same fact.
   */
  const inverse = rateOn(rates, target, amount.currency, on);
  if (inverse !== null) {
    return { ok: true, amount: money(divide(amount.minor, inverse.rate, exponentDelta), target) };
  }

  return { ok: false, missing: { base: amount.currency, quote: target } };
}

export type NetWorth =
  | { readonly ok: true; readonly amount: Money }
  | { readonly ok: false; readonly missing: readonly MissingRate[] };

/**
 * Assets minus debt, in one currency, or an honest refusal.
 *
 * It refuses on the whole figure rather than converting what it can. A number
 * labelled "net worth" that silently omits the dollar holdings is exactly the
 * kind of confidently wrong answer this app exists not to give, and the
 * missing pairs come back so a screen can say which rate to go and enter.
 */
export function netWorth(options: {
  readonly assets: readonly Money[];
  readonly debts: readonly Money[];
  readonly base: string;
  readonly rates: readonly Rate[];
  readonly on: IsoDate;
}): NetWorth {
  const { assets, debts, base, rates, on } = options;

  const missing = new Map<string, MissingRate>();
  let total = 0n;

  for (const amount of assets) {
    const converted = convert(amount, base, rates, on);
    if (converted.ok) total += converted.amount.minor;
    else missing.set(`${converted.missing.base}/${converted.missing.quote}`, converted.missing);
  }

  for (const amount of debts) {
    const converted = convert(amount, base, rates, on);
    if (converted.ok) total -= converted.amount.minor;
    else missing.set(`${converted.missing.base}/${converted.missing.quote}`, converted.missing);
  }

  if (missing.size > 0) return { ok: false, missing: [...missing.values()] };
  return { ok: true, amount: money(total, base) };
}
