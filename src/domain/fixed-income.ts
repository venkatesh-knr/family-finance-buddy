/**
 * A deposit or a bond as the screen reads it on a day.
 *
 * `accrual.ts` does the arithmetic, one term and one coupon schedule at a time. This is
 * the seam between that and a row of terms as the database holds them: it assembles the
 * chain, asks for the value on a day, and says what the answer is made of. Nothing here
 * is stored. A value is a function of the terms and the date, and the date is passed in.
 *
 * It does not throw on a row it was handed. The database stops most bad terms, but a
 * screen that falls over on one stored row takes the others down with it; a refusal
 * names the row and leaves the rest readable.
 *
 * A bond is valued at par: its face plus the interest accrued since the last coupon.
 * There is no market price for an unlisted NBFC bond, so no figure is invented, and the
 * card says it is at par.
 */

import { type IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';
import {
  bondAccrual,
  depositChainValueOn,
  addMonths,
  depositMaturity,
  type Compounding,
  type CouponFrequency,
  type Deposit,
} from './accrual.ts';

export interface RecordedRenewal {
  readonly start: IsoDate;
  readonly maturity: IsoDate;
  readonly principal: Money;
  readonly ratePct: string;
  readonly compounding: Compounding;
}

export interface FixedIncomePosition {
  readonly holdingId: string;
  readonly kind: 'deposit' | 'bond';
  /** A deposit's first-term principal, or a bond's face value. */
  readonly principal: Money;
  /** A deposit's first-term rate, or a bond's coupon. */
  readonly ratePct: string;
  readonly start: IsoDate;
  readonly maturity: IsoDate;
  readonly compounding: Compounding | null;
  readonly couponFrequency: CouponFrequency | null;
  readonly autoRenew: boolean;
  readonly renewalRatePct: string | null;
  readonly renewals: readonly RecordedRenewal[];
}

export type FixedIncomeRefusal = 'before-start' | 'broken-chain' | 'cannot-project' | 'invalid-terms';

export type FixedIncomeView =
  | {
      readonly ok: true;
      readonly kind: 'deposit';
      /**
       * What it is worth on the day. Once `matured` this is the payout, which is money
       * the bank has paid out and not a holding's worth: a screen shows it as paid out
       * and does not add it to what is held.
       */
      readonly value: Money;
      /** What the current term pays at its end. */
      readonly maturityValue: Money;
      /** Value less the principal of the first term. */
      readonly interestToDate: Money;
      readonly term: number;
      /** True when the term is an assumed renewal, not one the bank has made. */
      readonly projected: boolean;
      readonly matured: boolean;
      /** The end of the term the day falls in; null once it has matured and does not renew. */
      readonly nextMaturity: IsoDate | null;
      readonly daysToMaturity: number | null;
    }
  | {
      readonly ok: true;
      readonly kind: 'bond';
      /** Face plus accrued interest: at par. */
      readonly value: Money;
      readonly accrued: Money;
      readonly couponAmount: Money;
      readonly nextCoupon: IsoDate | null;
      readonly matured: boolean;
      readonly daysToMaturity: number | null;
    }
  | { readonly ok: false; readonly reason: FixedIncomeRefusal };

/** How far ahead a maturity is called out: the setting the design shows for "Bond and deposit maturity". */
export const MATURITY_NOTICE_DAYS = 30;

/** "7.500" as "7.5": the database pads a rate to three places, a person does not say it so. */
export function trimRate(rate: string): string {
  if (!/^\d+(\.\d+)?$/.test(rate)) return rate;
  return rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate;
}

const dayNumber = (date: IsoDate): number =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

const asDeposit = (
  principal: Money,
  ratePct: string,
  start: IsoDate,
  maturity: IsoDate,
  compounding: Compounding,
): Deposit => ({ principal, ratePct, start, maturity, compounding });

export function fixedIncomeView(position: FixedIncomePosition, on: IsoDate): FixedIncomeView {
  if (position.maturity <= position.start) return { ok: false, reason: 'invalid-terms' };
  try {
    return position.kind === 'bond' ? bondView(position, on) : depositView(position, on);
  } catch {
    // The accrual module refuses a rate or a term it cannot read, by throwing.
    return { ok: false, reason: 'invalid-terms' };
  }
}

function depositView(position: FixedIncomePosition, on: IsoDate): FixedIncomeView {
  if (position.compounding === null) return { ok: false, reason: 'invalid-terms' };

  const first = asDeposit(position.principal, position.ratePct, position.start, position.maturity, position.compounding);
  const renewals = position.renewals.map((r) => asDeposit(r.principal, r.ratePct, r.start, r.maturity, r.compounding));
  const chain = { first, renewals, autoRenew: position.autoRenew, renewalRatePct: position.renewalRatePct };

  const result = depositChainValueOn(chain, on);
  if (!result.ok) return result;

  // Every term up to and including the one the day falls in: the recorded ones, then
  // any that are projected, built the way the chain builds them (the previous maturity
  // value, the same length, the assumed rate).
  const terms = [first, ...[...renewals].sort((a, b) => (a.start < b.start ? -1 : 1))];
  const rate = position.renewalRatePct ?? (terms[terms.length - 1] as Deposit).ratePct;
  while (terms.length < result.term) {
    const previous = terms[terms.length - 1] as Deposit;
    terms.push({
      principal: depositMaturity(previous).maturityValue,
      ratePct: rate,
      start: previous.maturity,
      maturity: addMonths(previous.maturity, monthsBetween(previous.start, previous.maturity)),
      compounding: previous.compounding,
    });
  }
  const current = terms[result.term - 1] as Deposit;

  // Interest is per term, and not the value less the first principal. A bank that pays a
  // term's interest out and renews the principal, takes tax at source, or takes a top-up
  // starts the next term from a figure that is not the last maturity value; the difference
  // is not interest and must not be counted as if it were.
  let interest = 0n;
  for (const term of terms.slice(0, result.term - 1)) {
    interest += depositMaturity(term).maturityValue.minor - term.principal.minor;
  }
  interest += result.value.minor - current.principal.minor;

  const maturityValue = depositMaturity(current).maturityValue;
  const nextMaturity = result.matured ? null : current.maturity;
  return {
    ok: true,
    kind: 'deposit',
    value: result.value,
    maturityValue,
    interestToDate: money(interest, position.principal.currency),
    term: result.term,
    projected: result.projected,
    matured: result.matured,
    nextMaturity,
    daysToMaturity: nextMaturity === null ? null : dayNumber(nextMaturity) - dayNumber(on),
  };
}

/** Whole calendar months from a start to a maturity that is a whole number of them. */
function monthsBetween(start: IsoDate, maturity: IsoDate): number {
  return (
    (Number(maturity.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    (Number(maturity.slice(5, 7)) - Number(start.slice(5, 7)))
  );
}

function bondView(position: FixedIncomePosition, on: IsoDate): FixedIncomeView {
  if (position.couponFrequency === null) return { ok: false, reason: 'invalid-terms' };

  const accrual = bondAccrual({
    face: position.principal,
    couponPct: position.ratePct,
    frequency: position.couponFrequency,
    start: position.start,
    maturity: position.maturity,
    on,
  });
  if (accrual === null) return { ok: false, reason: 'before-start' };

  const matured = on >= position.maturity;
  return {
    ok: true,
    kind: 'bond',
    value: money(position.principal.minor + accrual.accrued.minor, position.principal.currency),
    accrued: accrual.accrued,
    couponAmount: accrual.couponAmount,
    nextCoupon: accrual.nextCoupon,
    matured,
    daysToMaturity: matured ? null : dayNumber(position.maturity) - dayNumber(on),
  };
}
