/**
 * Fixed deposits and bonds: what they are worth, and what has accrued.
 *
 * The blueprint's rule is that these are *computed, not typed* ("the app asks
 * for the terms, not the current value"): a deposit is entered once, with its
 * principal, rate, dates and compounding, and its value on any day follows.
 * Typing a value for each every month is why the workbook went stale.
 *
 * ── the convention, stated so it can be checked against a bank's advice ──────
 *
 *   Compounding. Interest is credited at the end of each compounding period,
 *   counted in whole calendar months from the start (12 for yearly, 6, 3 or 1),
 *   as the rate over the periods in a year, and rounded half up to the paisa
 *   *when it is credited*. Each credit is added to the balance the next one is
 *   earned on.
 *
 *   A part-period. Whatever of the last period has not ended, at maturity or on
 *   the day a value is asked for, accrues simply on the balance: actual days
 *   over 365. This is the common convention and not the only one; a bank's own
 *   maturity figure is the one that counts and may differ by a few rupees.
 *
 *   Simple. A deposit that does not compound earns balance x rate x days / 365.
 *
 *   A bond coupon accrues as the blueprint says: face x coupon x days / 365,
 *   from the last coupon date (or the start, before the first).
 *
 * The blueprint's worked example compounds quarterly, "the Indian bank default".
 * This household's deposits compound yearly, so compounding is a property of
 * each deposit and never a default here.
 *
 * Money is bigint minor units, and a rate is the text a `numeric` column holds.
 * Pure: the date is passed in. Where a figure cannot be given (before a deposit
 * began), the answer is null and not a guess.
 */

import { daysBetween, type IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';
import { thousandths } from './rate.ts';

export type Compounding = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'simple';
export type CouponFrequency = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

const MONTHS_PER_PERIOD: Record<CouponFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

const RATE = /^\d+(\.\d+)?$/;

function rateOf(ratePct: string): bigint {
  if (!RATE.test(ratePct)) throw new Error(`"${ratePct}" is not a rate: a non-negative percentage such as 7.5.`);
  return thousandths(ratePct);
}

/** `numerator / denominator`, half a unit rounding up. Non-negative only. */
function roundedDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Simple interest on a balance for some days: balance x rate x days / 365. */
function simpleInterest(balance: bigint, rateThousandths: bigint, days: number): bigint {
  if (days <= 0) return 0n;
  // rate% = thousandths / 1000 / 100; days over 365.
  return roundedDiv(balance * rateThousandths * BigInt(days), 100_000n * 365n);
}

/**
 * A date moved by calendar months, counted from the original each time.
 *
 * The day is clamped to the end of a shorter month and the clamp is not
 * remembered: 31 Jan plus one month is 28 Feb, plus two is 31 Mar. A coupon on
 * the 31st stays on the last day of every month, not the 28th for ever after.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const index = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${String(nextYear)}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export interface Deposit {
  readonly principal: Money;
  readonly ratePct: string;
  readonly start: IsoDate;
  readonly maturity: IsoDate;
  readonly compounding: Compounding;
}

function checked(deposit: Deposit): { rate: bigint } {
  if (deposit.maturity <= deposit.start) {
    throw new Error('A deposit has to mature after it starts.');
  }
  return { rate: rateOf(deposit.ratePct) };
}

/**
 * The balance on a date: the principal, every credit made on or before it, and
 * simple interest on that for the part-period since the last credit.
 */
function balanceOn(deposit: Deposit, rate: bigint, on: IsoDate): bigint {
  let balance = deposit.principal.minor;

  if (deposit.compounding === 'simple') {
    return balance + simpleInterest(balance, rate, daysBetween(deposit.start, on));
  }

  const step = MONTHS_PER_PERIOD[deposit.compounding];
  const perYear = BigInt(12 / step);
  let last = deposit.start;
  for (let k = 1; ; k += 1) {
    const credit = addMonths(deposit.start, k * step);
    if (credit > on) break;
    balance += roundedDiv(balance * rate, 100_000n * perYear);
    last = credit;
  }
  return balance + simpleInterest(balance, rate, daysBetween(last, on));
}

/** What the deposit pays at maturity, and the interest in it. */
export function depositMaturity(deposit: Deposit): { maturityValue: Money; interest: Money } {
  const { rate } = checked(deposit);
  const value = balanceOn(deposit, rate, deposit.maturity);
  const currency = deposit.principal.currency;
  return {
    maturityValue: money(value, currency),
    interest: money(value - deposit.principal.minor, currency),
  };
}

/**
 * What the deposit is worth on a date, or null before it began.
 *
 * Never more than the maturity value: a deposit does not go on earning after it
 * has paid out. A day on a credit date is the balance after that credit.
 */
export function depositValueOn(deposit: Deposit, on: IsoDate): Money | null {
  const { rate } = checked(deposit);
  if (on < deposit.start) return null;
  const when = on > deposit.maturity ? deposit.maturity : on;
  return money(balanceOn(deposit, rate, when), deposit.principal.currency);
}

export interface Bond {
  readonly face: Money;
  readonly couponPct: string;
  readonly frequency: CouponFrequency;
  readonly start: IsoDate;
  readonly maturity: IsoDate;
}

export interface BondAccrual {
  /** Interest earned since the last coupon and not yet paid. */
  readonly accrued: Money;
  /** The last coupon date on or before the day asked about; the start before the first. */
  readonly lastCoupon: IsoDate;
  /** The next coupon date, the maturity if that comes first, or null once matured. */
  readonly nextCoupon: IsoDate | null;
  /** What a full coupon pays: face x coupon over the coupons in a year. */
  readonly couponAmount: Money;
}

/**
 * The coupon position of a bond on a date, or null before it started.
 *
 * Coupon dates are counted in calendar months from the start. A maturity that
 * falls between two is the last coupon date, and what is paid on it is a short
 * period's; `couponAmount` is the full coupon and says so.
 */
export function bondAccrual(options: Bond & { readonly on: IsoDate }): BondAccrual | null {
  const { face, frequency, start, maturity, on } = options;
  if (maturity <= start) throw new Error('A bond has to mature after it starts.');
  const rate = rateOf(options.couponPct);
  if (on < start) return null;

  const step = MONTHS_PER_PERIOD[frequency];
  const couponAmount = money(
    roundedDiv(face.minor * rate, 100_000n * BigInt(12 / step)),
    face.currency,
  );

  if (on >= maturity) {
    return { accrued: money(0n, face.currency), lastCoupon: maturity, nextCoupon: null, couponAmount };
  }

  let last = start;
  let next = maturity;
  for (let k = 1; ; k += 1) {
    const date = addMonths(start, k * step);
    if (date >= maturity) break;
    if (date > on) {
      next = date;
      break;
    }
    last = date;
  }

  return {
    accrued: money(simpleInterest(face.minor, rate, daysBetween(last, on)), face.currency),
    lastCoupon: last,
    nextCoupon: next,
    couponAmount,
  };
}

// ─────────────────────────────────────────────── a deposit that renews itself

/**
 * A deposit as a chain of terms.
 *
 * With auto-renewal the interest is paid into the principal at maturity and the
 * whole is redeposited for the same term, at the rate the bank is then offering,
 * which can differ from the last. So a deposit's value on a day depends on which
 * term the day falls in, and every term after the first starts from the last one's
 * maturity value.
 *
 * A renewal the bank has *made* is a recorded term, carrying the principal, rate
 * and compounding its advice states: the bank's figure is the authority and the new
 * rate is a fact only the advice knows. One that has not been recorded yet is
 * *projected* here, on the same term, from the previous maturity value, at
 * `renewalRatePct` if one is assumed and otherwise the previous rate, and the
 * answer says it was projected. A projection is an estimate and is never stored.
 */
export interface DepositChain {
  readonly first: Deposit;
  /** Recorded renewals, in any order; they are sorted by start. */
  readonly renewals: readonly Deposit[];
  readonly autoRenew: boolean;
  /** The rate to project at, or null for the last term's. */
  readonly renewalRatePct: string | null;
}

export type ChainValue =
  | {
      readonly ok: true;
      readonly value: Money;
      /** Which term the day falls in, from 1. */
      readonly term: number;
      /** True when that term is an assumption and not a renewal the bank has made. */
      readonly projected: boolean;
      /** True when the deposit has matured and does not renew: its value is the maturity value. */
      readonly matured: boolean;
    }
  | { readonly ok: false; readonly reason: 'before-start' | 'broken-chain' | 'cannot-project' };

/** A whole number of calendar months from `start` to `maturity`, or null if it is not one. */
function wholeMonths(start: IsoDate, maturity: IsoDate): number | null {
  for (let months = 1; months <= 600; months += 1) {
    const reached = addMonths(start, months);
    if (reached === maturity) return months;
    if (reached > maturity) return null;
  }
  return null;
}

/** The deposit's value on a day, through its recorded renewals and then its projected ones. */
export function depositChainValueOn(chain: DepositChain, on: IsoDate): ChainValue {
  const terms = [chain.first, ...[...chain.renewals].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))];

  // Each renewal begins on the day the last term ended. Anything else is a gap or
  // an overlap, which is a mistake in what was recorded and is said, not smoothed over.
  for (let i = 1; i < terms.length; i += 1) {
    if (terms[i]?.start !== terms[i - 1]?.maturity) return { ok: false, reason: 'broken-chain' };
  }
  if (on < chain.first.start) return { ok: false, reason: 'before-start' };

  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i];
    if (term !== undefined && on < term.maturity) {
      const value = depositValueOn(term, on);
      return value === null
        ? { ok: false, reason: 'before-start' }
        : { ok: true, value, term: i + 1, projected: false, matured: false };
    }
  }

  const last = terms[terms.length - 1] ?? chain.first;
  if (!chain.autoRenew) {
    return {
      ok: true,
      value: depositMaturity(last).maturityValue,
      term: terms.length,
      projected: false,
      matured: true,
    };
  }

  const length = wholeMonths(last.start, last.maturity);
  if (length === null) return { ok: false, reason: 'cannot-project' };

  let previous: Deposit = last;
  for (let k = 1; k <= 200; k += 1) {
    const start = previous.maturity;
    const next: Deposit = {
      principal: depositMaturity(previous).maturityValue,
      ratePct: chain.renewalRatePct ?? previous.ratePct,
      start,
      maturity: addMonths(start, length),
      compounding: previous.compounding,
    };
    if (on < next.maturity) {
      const value = depositValueOn(next, on);
      return value === null
        ? { ok: false, reason: 'before-start' }
        : { ok: true, value, term: terms.length + k, projected: true, matured: false };
    }
    previous = next;
  }
  // Two hundred terms past: not a deposit, a mistake in a date.
  return { ok: false, reason: 'cannot-project' };
}
