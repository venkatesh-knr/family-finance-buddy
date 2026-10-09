import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { fixedIncomeView, trimRate, type FixedIncomePosition } from './fixed-income.ts';

const inr = (minor: number) => money(BigInt(minor), 'INR');

const deposit = (over: Partial<FixedIncomePosition> = {}): FixedIncomePosition => ({
  holdingId: 'h1',
  kind: 'deposit',
  principal: inr(10_000_000),
  ratePct: '7.5',
  start: '2025-10-01',
  maturity: '2026-10-01',
  compounding: 'yearly',
  couponFrequency: null,
  autoRenew: false,
  renewalRatePct: null,
  renewals: [],
  ...over,
});

const bond = (over: Partial<FixedIncomePosition> = {}): FixedIncomePosition => ({
  holdingId: 'b1',
  kind: 'bond',
  principal: inr(10_000_000),
  ratePct: '10.75',
  start: '2025-10-01',
  maturity: '2027-10-01',
  compounding: null,
  couponFrequency: 'yearly',
  autoRenew: false,
  renewalRatePct: null,
  renewals: [],
  ...over,
});

describe('fixedIncomeView, a deposit', () => {
  it('is worth its principal on the day it starts', () => {
    const view = fixedIncomeView(deposit(), '2025-10-01');
    expect(view.ok && view.value).toEqual(inr(10_000_000));
  });

  it('is worth its maturity value on the day it matures, and says what that is', () => {
    const view = fixedIncomeView(deposit(), '2026-10-01');
    expect(view.ok && view.value).toEqual(inr(10_750_000));
    expect(view.ok && view.kind === 'deposit' && view.maturityValue).toEqual(inr(10_750_000));
  });

  it('accrues simple interest for the part-period, to the paisa', () => {
    // 182 days: 10,000,000 x 7.5% x 182 / 365 = 373,972.6 -> 373,973.
    const view = fixedIncomeView(deposit(), '2026-04-01');
    expect(view.ok && view.value).toEqual(inr(10_373_973));
    expect(view.ok && view.kind === 'deposit' && view.interestToDate).toEqual(inr(373_973));
  });

  it('counts the days left to the maturity', () => {
    const view = fixedIncomeView(deposit(), '2026-04-01');
    expect(view.ok && view.kind === 'deposit' && view.daysToMaturity).toBe(183);
  });

  it('keeps its maturity value after it has paid out, and says it has matured', () => {
    const view = fixedIncomeView(deposit(), '2027-03-01');
    expect(view.ok && view.value).toEqual(inr(10_750_000));
    expect(view.ok && view.matured).toBe(true);
    expect(view.ok && view.kind === 'deposit' && view.daysToMaturity).toBeNull();
  });

  it('is not yet anything before it starts', () => {
    expect(fixedIncomeView(deposit(), '2025-09-30')).toEqual({ ok: false, reason: 'before-start' });
  });

  it('projects an auto-renewal from the previous maturity value, and says it is a projection', () => {
    const view = fixedIncomeView(
      deposit({ start: '2024-10-01', maturity: '2025-10-01', autoRenew: true }),
      '2026-04-01',
    );
    // Term 2 starts from 10,750,000; 182 days at 7.5% is 402,021.
    expect(view.ok && view.value).toEqual(inr(11_152_021));
    expect(view.ok && view.kind === 'deposit' && view.term).toBe(2);
    expect(view.ok && view.kind === 'deposit' && view.projected).toBe(true);
  });

  it('takes a recorded renewal as the bank stated it, not as a projection', () => {
    const view = fixedIncomeView(
      deposit({
        start: '2024-10-01',
        maturity: '2025-10-01',
        autoRenew: true,
        renewals: [
          {
            start: '2025-10-01',
            maturity: '2026-10-01',
            principal: inr(10_750_000),
            ratePct: '7',
            compounding: 'yearly',
          },
        ],
      }),
      '2026-09-30',
    );
    // 10,750,000 at 7% for 364 days of the recorded term: 750,438 of interest.
    expect(view.ok && view.value).toEqual(inr(11_500_438));
    expect(view.ok && view.kind === 'deposit' && view.term).toBe(2);
    expect(view.ok && view.kind === 'deposit' && view.projected).toBe(false);
  });

  it('refuses a chain with a gap in it, rather than smooth it over', () => {
    const view = fixedIncomeView(
      deposit({
        start: '2024-10-01',
        maturity: '2025-10-01',
        autoRenew: true,
        renewals: [
          {
            start: '2025-11-01',
            maturity: '2026-11-01',
            principal: inr(10_750_000),
            ratePct: '7',
            compounding: 'yearly',
          },
        ],
      }),
      '2026-04-01',
    );
    expect(view).toEqual({ ok: false, reason: 'broken-chain' });
  });

  it('refuses terms that mature before they start instead of throwing', () => {
    expect(fixedIncomeView(deposit({ start: '2026-10-01', maturity: '2025-10-01' }), '2026-04-01')).toEqual({
      ok: false,
      reason: 'invalid-terms',
    });
  });

  it('refuses a deposit with no compounding recorded', () => {
    expect(fixedIncomeView(deposit({ compounding: null }), '2026-04-01')).toEqual({
      ok: false,
      reason: 'invalid-terms',
    });
  });
});

describe('fixedIncomeView, a bond', () => {
  it('is its face value plus what has accrued since the last coupon, at par', () => {
    // 182 days of 10.75% on 10,000,000 = 536,027.4 -> 536,027.
    const view = fixedIncomeView(bond(), '2026-04-01');
    expect(view.ok && view.kind === 'bond' && view.accrued).toEqual(inr(536_027));
    expect(view.ok && view.value).toEqual(inr(10_536_027));
  });

  it('names the next coupon, its amount, and the days to maturity', () => {
    const view = fixedIncomeView(bond(), '2026-04-01');
    expect(view.ok && view.kind === 'bond' && view.nextCoupon).toBe('2026-10-01');
    expect(view.ok && view.kind === 'bond' && view.couponAmount).toEqual(inr(1_075_000));
    expect(view.ok && view.kind === 'bond' && view.daysToMaturity).toBe(548);
  });

  it('is worth its face value once it has matured, and says so', () => {
    const view = fixedIncomeView(bond(), '2027-12-01');
    expect(view.ok && view.value).toEqual(inr(10_000_000));
    expect(view.ok && view.matured).toBe(true);
    expect(view.ok && view.kind === 'bond' && view.nextCoupon).toBeNull();
  });

  it('is not yet anything before it starts', () => {
    expect(fixedIncomeView(bond(), '2025-09-01')).toEqual({ ok: false, reason: 'before-start' });
  });

  it('refuses a bond with no coupon frequency recorded', () => {
    expect(fixedIncomeView(bond({ couponFrequency: null }), '2026-04-01')).toEqual({
      ok: false,
      reason: 'invalid-terms',
    });
  });

  it('never reads the clock: the same day gives the same answer', () => {
    expect(fixedIncomeView(bond(), '2026-04-01')).toEqual(fixedIncomeView(bond(), '2026-04-01'));
  });
});

describe('trimRate', () => {
  it('drops the zeros the database pads a rate with', () => {
    expect(trimRate('7.500')).toBe('7.5');
    expect(trimRate('10.750')).toBe('10.75');
    expect(trimRate('7.000')).toBe('7');
    expect(trimRate('8')).toBe('8');
    expect(trimRate('0.125')).toBe('0.125');
  });

  it('leaves what is not a plain rate alone', () => {
    expect(trimRate('seven')).toBe('seven');
  });
});
