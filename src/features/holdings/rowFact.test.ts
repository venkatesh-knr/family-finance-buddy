import { describe, expect, it } from 'vitest';
import type { FixedIncomePosition, FixedIncomeView } from '../../domain/fixed-income.ts';
import { money } from '../../lib/money.ts';
import { rowFact } from './rowFact.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');

const deposit = (over: Partial<FixedIncomePosition> = {}): FixedIncomePosition => ({
  holdingId: 'h',
  kind: 'deposit',
  principal: inr(100000),
  ratePct: '6.500',
  start: '2026-02-01',
  maturity: '2027-07-31',
  compounding: 'quarterly',
  couponFrequency: null,
  repayMode: null,
  autoRenew: false,
  renewalRatePct: null,
  renewals: [],
  ...over,
});

const depositView = (nextMaturity: string | null): FixedIncomeView => ({
  ok: true,
  kind: 'deposit',
  value: inr(104487),
  maturityValue: inr(109913),
  interestToDate: inr(4487),
  term: 1,
  projected: false,
  matured: false,
  nextMaturity,
  daysToMaturity: 293,
});

describe('rowFact — the one class-specific fact a row carries', () => {
  it('is the units, and the symbol, for a fund or a share', () => {
    expect(rowFact({ kind: 'etf', symbol: 'VTI', unitsText: '12.5', position: null, view: null, institution: null })).toBe(
      'VTI · 12.5 units',
    );
    expect(rowFact({ kind: 'mutual_fund', symbol: null, unitsText: '6,992.23', position: null, view: null, institution: null })).toBe(
      '6,992.23 units',
    );
  });

  it('is the institution, the rate and the maturity, for a deposit', () => {
    expect(
      rowFact({
        kind: 'deposit',
        symbol: null,
        unitsText: '1',
        position: deposit(),
        view: depositView('2027-07-31'),
        institution: 'HDFC',
      }),
    ).toBe('HDFC · 6.5% · matures 31 Jul 2027');
  });

  it('leaves out the institution where there is none, and says nothing about units on a deposit', () => {
    const fact = rowFact({ kind: 'deposit', symbol: null, unitsText: '1', position: deposit(), view: depositView('2027-02-28'), institution: null });
    expect(fact).toBe('6.5% · matures 28 Feb 2027');
    expect(fact).not.toMatch(/units/);
  });

  it('is the coupon and the next one for a bond that pays out', () => {
    const bond = deposit({ kind: 'bond', ratePct: '10.500', couponFrequency: 'yearly', repayMode: 'payout' });
    const view: FixedIncomeView = {
      ok: true,
      kind: 'bond',
      repay: 'payout',
      value: inr(201668),
      accrued: inr(100),
      maturityValue: inr(200000),
      couponAmount: inr(1750),
      nextCoupon: '2026-11-01',
      matured: false,
      daysToMaturity: 500,
    };
    expect(rowFact({ kind: 'bond', symbol: null, unitsText: '100', position: bond, view, institution: null })).toBe(
      '10.5% · next ₹1,750 on 1 Nov 2026',
    );
  });

  it('masks a coupon under privacy mode: the fact is a figure like any other', () => {
    const bond = deposit({ kind: 'bond', ratePct: '10.500', couponFrequency: 'yearly', repayMode: 'payout' });
    const view: FixedIncomeView = {
      ok: true,
      kind: 'bond',
      repay: 'payout',
      value: inr(201668),
      accrued: inr(100),
      maturityValue: inr(200000),
      couponAmount: inr(1750),
      nextCoupon: '2026-11-01',
      matured: false,
      daysToMaturity: 500,
    };
    const fact = rowFact({ kind: 'bond', symbol: null, unitsText: '100', position: bond, view, institution: null, privacy: true });
    expect(fact).not.toMatch(/1,750/);
    expect(fact).toMatch(/•/);
  });

  it('is the rate and the maturity for a bond that pays nothing in between', () => {
    const bond = deposit({ kind: 'bond', ratePct: '8.000', repayMode: 'cumulative', couponFrequency: 'yearly', maturity: '2028-11-30' });
    const view: FixedIncomeView = {
      ok: true,
      kind: 'bond',
      repay: 'cumulative',
      value: inr(1),
      accrued: inr(1),
      maturityValue: inr(1),
      couponAmount: null,
      nextCoupon: null,
      matured: false,
      daysToMaturity: 100,
    };
    expect(rowFact({ kind: 'bond', symbol: null, unitsText: '1', position: bond, view, institution: null })).toBe('8% · matures 30 Nov 2028');
  });

  it('falls back to the terms as recorded where the view cannot be worked out, rather than inventing a date', () => {
    const fact = rowFact({ kind: 'deposit', symbol: null, unitsText: '1', position: deposit(), view: { ok: false, reason: 'broken-chain' }, institution: null });
    expect(fact).toBe('6.5% · terms need attention');
  });

  it('says nothing but the units for a deposit or bond with no terms recorded', () => {
    expect(rowFact({ kind: 'deposit', symbol: null, unitsText: '1', position: null, view: null, institution: null })).toBe('terms not recorded');
  });
});
