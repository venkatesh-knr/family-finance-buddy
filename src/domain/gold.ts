/**
 * A jeweller's gold savings scheme, worked out (docs/design/gold.md; GD-I2, GD-I3).
 *
 * A fixed instalment is paid to a jeweller each month for a fixed number of months, and at the end the total, with a bonus, is
 * redeemed as jewellery and not as cash. Two kinds are valued differently:
 *
 *   an amount scheme   each instalment adds rupees, and the scheme is worth the instalments paid. The bonus is not in the value
 *                      until it is credited at maturity (GD-I2), as a PPF's interest is not in its value until it is credited.
 *   a weight scheme    each instalment buys grams at the day's rate, and the scheme is worth those grams at the latest rate for its
 *                      purity (GD-I3). Never a typed value, and never the rupees paid: with no rate it is not valued, and says why.
 *
 * Pure: no I/O and no clock. The day is passed in, and every figure is integer minor units; grams are a scaled integer
 * (`src/lib/quantity.ts`), so a fractional gram never meets a float. The rupees of a weight scheme's value are rounded once, half
 * up, at the end.
 */

import { parseQuantity, QUANTITY_SCALE } from '../lib/quantity.ts';

export type Purity = '24k' | '22k' | '18k';

export interface GoldTerms {
  readonly variant: 'amount' | 'weight';
  readonly instalmentMinor: bigint;
  readonly currency: string;
  readonly instalments: number;
  /** The day the first instalment falls due. */
  readonly startDate: string;
  /** The day of the month, 1 to 28. */
  readonly dueDay: number;
  /** What the bonus is worth in money, where it is stated as money; null where it is not (a discount on making charges). */
  readonly bonusMinor: bigint | null;
  readonly bonusText: string | null;
  readonly purity: Purity | null;
}

/** One instalment paid. `grams` is on a weight scheme's receipt and is a decimal string, never a number. */
export interface Instalment {
  readonly date: string;
  readonly amountMinor: bigint;
  readonly grams: string | null;
}

/** The price of a gram of a purity on a day, in minor units of its currency. */
export interface GoldRate {
  readonly purity: Purity;
  readonly asOf: string;
  readonly perGramMinor: bigint;
  readonly currency: string;
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** A day in a month counted from another: the same day of the month, `months` later. */
function plusMonths(isoDate: string, months: number, day: number): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7)) - 1 + months;
  return `${pad(year + Math.floor(month / 12), 4)}-${pad(((month % 12) + 12) % 12 + 1, 2)}-${pad(day, 2)}`;
}

/** The days the instalments fall due: one a month on the due day, from the month the scheme starts. */
export function dueDates(terms: GoldTerms): string[] {
  return Array.from({ length: terms.instalments }, (_, index) => plusMonths(terms.startDate, index, terms.dueDay));
}

export interface SchemeState {
  readonly paidCount: number;
  readonly paidMinor: bigint;
  readonly left: number;
  /** More instalments are recorded than the scheme has. */
  readonly overpaid: boolean;
  /** The earliest due day not yet covered by an instalment, or null when all are paid. It may be in the past: then it is also missed. */
  readonly nextDue: string | null;
  /** When the scheme is redeemed: the month after its last instalment, on the due day. */
  readonly matures: string;
  /** What is redeemable if every instalment is paid, for an amount scheme; null for a weight scheme, which depends on a rate not yet set. */
  readonly atMaturity: { readonly minor: bigint; readonly currency: string; readonly includesBonus: boolean } | null;
  /** The days an instalment fell due, before today, that no instalment covers. */
  readonly missed: readonly string[];
  /** Grams bought so far, scaled by 1e8, for a weight scheme. */
  readonly gramsPaid: bigint | null;
}

/**
 * Where a scheme stands on a day. Instalments are taken to cover the earliest due days first, as a person pays them, so what is
 * missed is the due days beyond the number paid that have gone by. A due day is missed once the day has passed, not on it.
 */
export function schemeState(terms: GoldTerms, paid: readonly Instalment[], on: string): SchemeState {
  const dates = dueDates(terms);
  const paidCount = paid.length;
  const paidMinor = paid.reduce((sum, instalment) => sum + instalment.amountMinor, 0n);
  const wentBy = dates.filter((date) => date < on).length;
  const last = dates[dates.length - 1] ?? terms.startDate;
  const bonus = terms.bonusMinor;

  return {
    paidCount,
    paidMinor,
    left: Math.max(0, terms.instalments - paidCount),
    overpaid: paidCount > terms.instalments,
    nextDue: paidCount < terms.instalments ? (dates[paidCount] ?? null) : null,
    matures: plusMonths(last, 1, terms.dueDay),
    atMaturity:
      terms.variant === 'amount'
        ? { minor: terms.instalmentMinor * BigInt(terms.instalments) + (bonus ?? 0n), currency: terms.currency, includesBonus: bonus !== null }
        : null,
    missed: dates.slice(paidCount, Math.max(paidCount, wentBy)),
    gramsPaid: terms.variant === 'weight' ? paid.reduce((sum, instalment) => sum + (instalment.grams === null ? 0n : parseQuantity(instalment.grams)), 0n) : null,
  };
}

export type GoldValue =
  | { readonly ok: true; readonly value: { readonly minor: bigint; readonly currency: string } }
  | { readonly ok: false; readonly reason: 'no-rate' | 'no-grams' | 'no-purity' | 'mixed-currency' };

/**
 * What a scheme is worth on a day. An amount scheme is the instalments paid and needs no rate. A weight scheme is its grams at the
 * latest rate for its purity on or before the day, and is refused, not guessed, where there is none: the reason says why.
 */
export function goldValue(terms: GoldTerms, paid: readonly Instalment[], rates: readonly GoldRate[], on: string): GoldValue {
  if (terms.variant === 'amount') {
    return { ok: true, value: { minor: paid.reduce((sum, instalment) => sum + instalment.amountMinor, 0n), currency: terms.currency } };
  }
  if (paid.length === 0) return { ok: true, value: { minor: 0n, currency: terms.currency } };
  if (terms.purity === null) return { ok: false, reason: 'no-purity' };
  if (paid.some((instalment) => instalment.grams === null)) return { ok: false, reason: 'no-grams' };

  let rate: GoldRate | undefined;
  for (const candidate of rates) {
    if (candidate.purity !== terms.purity || candidate.asOf > on) continue;
    if (rate === undefined || candidate.asOf > rate.asOf) rate = candidate;
  }
  if (rate === undefined) return { ok: false, reason: 'no-rate' };
  if (rate.currency !== terms.currency) return { ok: false, reason: 'mixed-currency' };

  const grams = paid.reduce((sum, instalment) => sum + parseQuantity(instalment.grams ?? '0'), 0n);
  const scale = 10n ** BigInt(QUANTITY_SCALE);
  return { ok: true, value: { minor: (grams * rate.perGramMinor + scale / 2n) / scale, currency: terms.currency } };
}
