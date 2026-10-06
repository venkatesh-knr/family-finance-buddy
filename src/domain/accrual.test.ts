/**
 * Fixed deposits and bonds: what they are worth, and what has accrued.
 *
 * Every figure here was worked by hand before the implementation, in the
 * convention the module states: interest is credited at the end of each
 * compounding period and rounded to the paisa then; the part of a period that
 * has not ended accrues simply, on the balance, at actual/365. Money is bigint
 * minor units throughout, and the rate is the text a column holds.
 *
 * Written first, as anything numeric is.
 */

import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { addMonths, bondAccrual, depositMaturity, depositValueOn } from './accrual.ts';

const inr = (rupees: number, paise = 0) => money(BigInt(rupees) * 100n + BigInt(paise), 'INR');

describe('addMonths', () => {
  it('moves by calendar months', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('clamps to the end of a shorter month, and does not remember the clamp', () => {
    // Counted from the start each time, so March 31 comes back after February 28.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});

describe('depositMaturity', () => {
  it('compounds yearly: 1,00,000 at 7% for three years is 1,22,504.30', () => {
    // 100000.00 -> 107000.00 -> 114490.00 -> 122504.30  (114490 x 7% = 8014.30)
    const result = depositMaturity({
      principal: inr(100000),
      ratePct: '7',
      start: '2026-01-01',
      maturity: '2029-01-01',
      compounding: 'yearly',
    });
    expect(result.maturityValue).toEqual(inr(122504, 30));
    expect(result.interest).toEqual(inr(22504, 30));
  });

  it('compounds quarterly, rounding each credit to the paisa', () => {
    // 8% for a year in four quarters of 2%:
    //   100000.00 -> 102000.00 -> 104040.00 -> 106120.80
    //   106120.80 x 2% = 2122.416, credited as 2122.42 -> 108243.22
    const result = depositMaturity({
      principal: inr(100000),
      ratePct: '8',
      start: '2026-01-01',
      maturity: '2027-01-01',
      compounding: 'quarterly',
    });
    expect(result.maturityValue).toEqual(inr(108243, 22));
  });

  it('pays simple interest, actual over 365, when nothing compounds', () => {
    // 100000 x 7.5% over 365 days.
    expect(
      depositMaturity({
        principal: inr(100000),
        ratePct: '7.5',
        start: '2026-01-01',
        maturity: '2027-01-01',
        compounding: 'simple',
      }).interest,
    ).toEqual(inr(7500));

    // 2028 is a leap year: 366 days is 7500 x 366 / 365 = 7520.5479 -> 7520.55.
    expect(
      depositMaturity({
        principal: inr(100000),
        ratePct: '7.5',
        start: '2028-01-01',
        maturity: '2029-01-01',
        compounding: 'simple',
      }).interest,
    ).toEqual(inr(7520, 55));
  });

  it('adds simple interest on the balance for a part-period at the end', () => {
    // 7% yearly from 1 Jan 2026 to 1 Jul 2027: one year credited, 107000.00,
    // then 181 days (Jan 31 + Feb 28 + Mar 31 + Apr 30 + May 31 + Jun 30):
    //   107000 x 7% x 181 / 365 = 3714.219 -> 3714.22
    const result = depositMaturity({
      principal: inr(100000),
      ratePct: '7',
      start: '2026-01-01',
      maturity: '2027-07-01',
      compounding: 'yearly',
    });
    expect(result.maturityValue).toEqual(inr(110714, 22));
  });

  it('is the principal for a deposit that earns nothing', () => {
    const result = depositMaturity({
      principal: inr(5000),
      ratePct: '0',
      start: '2026-01-01',
      maturity: '2027-01-01',
      compounding: 'yearly',
    });
    expect(result.maturityValue).toEqual(inr(5000));
    expect(result.interest).toEqual(inr(0));
  });

  it('refuses a maturity that is not after the start, and a rate that is not a rate', () => {
    const base = { principal: inr(1000), ratePct: '7', compounding: 'yearly' as const };
    expect(() => depositMaturity({ ...base, start: '2026-01-01', maturity: '2026-01-01' })).toThrow();
    expect(() => depositMaturity({ ...base, start: '2026-02-01', maturity: '2026-01-01' })).toThrow();
    expect(() => depositMaturity({ ...base, ratePct: '-1', start: '2026-01-01', maturity: '2027-01-01' })).toThrow();
    expect(() => depositMaturity({ ...base, ratePct: 'seven', start: '2026-01-01', maturity: '2027-01-01' })).toThrow();
  });
});

describe('depositValueOn', () => {
  const deposit = {
    principal: inr(100000),
    ratePct: '7',
    start: '2026-01-01',
    maturity: '2029-01-01',
    compounding: 'yearly' as const,
  };

  it('is the principal on the day it starts', () => {
    expect(depositValueOn(deposit, '2026-01-01')).toEqual(inr(100000));
  });

  it('accrues simply inside the first period: 181 days is 3471.23 on 100000 at 7%', () => {
    // 100000 x 7% x 181 / 365 = 3471.2329 -> 3471.23
    expect(depositValueOn(deposit, '2026-07-01')).toEqual(inr(103471, 23));
  });

  it('is the credited balance exactly on a credit date', () => {
    expect(depositValueOn(deposit, '2027-01-01')).toEqual(inr(107000));
    expect(depositValueOn(deposit, '2028-01-01')).toEqual(inr(114490));
  });

  it('accrues on the compounded balance in the second period', () => {
    // After one year, 107000.00; 181 days later: 107000 x 7% x 181 / 365 = 3714.22
    expect(depositValueOn(deposit, '2027-07-01')).toEqual(inr(110714, 22));
  });

  it('is the maturity value on and after maturity, and never more', () => {
    expect(depositValueOn(deposit, '2029-01-01')).toEqual(inr(122504, 30));
    expect(depositValueOn(deposit, '2031-06-01')).toEqual(inr(122504, 30));
  });

  it('has no value before it began, rather than a guess', () => {
    expect(depositValueOn(deposit, '2025-12-31')).toBeNull();
  });
});

describe('bondAccrual', () => {
  it('accrues a yearly coupon from the start: 10,00,000 at 10.75% for 183 days', () => {
    // 1000000 x 10.75% x 183 / 365 = 53897.26 (Apr 30 + May 31 + Jun 30 + Jul 31 + Aug 31 + Sep 30)
    const result = bondAccrual({
      face: inr(1000000),
      couponPct: '10.75',
      frequency: 'yearly',
      start: '2025-04-01',
      maturity: '2028-04-01',
      on: '2025-10-01',
    });
    expect(result).not.toBeNull();
    expect(result?.accrued).toEqual(inr(53897, 26));
    expect(result?.lastCoupon).toBe('2025-04-01');
    expect(result?.nextCoupon).toBe('2026-04-01');
    expect(result?.couponAmount).toEqual(inr(107500));
  });

  it('accrues from the last monthly payout, not from the start', () => {
    // 5,00,000 at 11.5% monthly from 15 Jan; on 20 Mar the last coupon was 15 Mar, 5 days ago.
    //   500000 x 11.5% x 5 / 365 = 787.67; a monthly coupon is 57500 / 12 = 4791.67
    const result = bondAccrual({
      face: inr(500000),
      couponPct: '11.5',
      frequency: 'monthly',
      start: '2026-01-15',
      maturity: '2027-01-15',
      on: '2026-03-20',
    });
    expect(result?.lastCoupon).toBe('2026-03-15');
    expect(result?.nextCoupon).toBe('2026-04-15');
    expect(result?.accrued).toEqual(inr(787, 67));
    expect(result?.couponAmount).toEqual(inr(4791, 67));
  });

  it('has nothing accrued on a coupon date, since it has just been paid', () => {
    const result = bondAccrual({
      face: inr(1000000),
      couponPct: '10.75',
      frequency: 'yearly',
      start: '2025-04-01',
      maturity: '2028-04-01',
      on: '2026-04-01',
    });
    expect(result?.accrued).toEqual(inr(0));
    expect(result?.lastCoupon).toBe('2026-04-01');
  });

  it('has nothing accrued once it has matured, and no next coupon', () => {
    const result = bondAccrual({
      face: inr(1000000),
      couponPct: '10.75',
      frequency: 'yearly',
      start: '2025-04-01',
      maturity: '2028-04-01',
      on: '2029-01-01',
    });
    expect(result?.accrued).toEqual(inr(0));
    expect(result?.nextCoupon).toBeNull();
    expect(result?.lastCoupon).toBe('2028-04-01');
  });

  it('counts a maturity that falls between coupons as the last, and the part-period is short', () => {
    // Half-yearly from 1 Jan, maturing 1 Apr 2026: coupons 1 Jul 2025, 1 Jan 2026, and the
    // last on 1 Apr 2026 rather than 1 Jul 2026.
    const result = bondAccrual({
      face: inr(100000),
      couponPct: '10',
      frequency: 'half_yearly',
      start: '2025-01-01',
      maturity: '2026-04-01',
      on: '2026-02-01',
    });
    expect(result?.lastCoupon).toBe('2026-01-01');
    expect(result?.nextCoupon).toBe('2026-04-01');
  });

  it('is null before it started, rather than a guess', () => {
    expect(
      bondAccrual({
        face: inr(1000),
        couponPct: '10',
        frequency: 'yearly',
        start: '2026-01-01',
        maturity: '2027-01-01',
        on: '2025-12-31',
      }),
    ).toBeNull();
  });
});
