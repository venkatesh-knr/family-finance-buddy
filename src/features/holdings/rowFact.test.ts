import { describe, expect, it } from 'vitest';
import type { FixedIncomePosition, FixedIncomeView } from '../../domain/fixed-income.ts';
import { money } from '../../lib/money.ts';
import { barTerm, currentTerm, rowFact } from './rowFact.ts';

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

  it('says one unit and not "1 units"', () => {
    expect(rowFact({ kind: 'other', symbol: null, unitsText: '1', position: null, view: null, institution: null })).toBe('1 unit');
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

describe('currentTerm — what a deposit is partway through, and what it was lent', () => {
  const renewal = (start: string, maturity: string, principal: number) => ({
    start,
    maturity,
    principal: inr(principal),
    ratePct: '7.000',
    compounding: 'quarterly' as const,
  });

  it('is the first term for a deposit that has not been renewed', () => {
    const term = currentTerm(deposit(), '2026-10-12');
    expect(term).toEqual({ start: '2026-02-01', end: '2027-07-31', principal: inr(100000) });
  });

  it('is the latest renewal that has begun, with its own principal, for a renewed deposit', () => {
    const position = deposit({
      start: '2024-01-01',
      maturity: '2025-01-01',
      renewals: [renewal('2025-01-01', '2026-01-01', 107500), renewal('2026-01-01', '2027-01-01', 115000)],
    });
    expect(currentTerm(position, '2026-10-12')).toEqual({ start: '2026-01-01', end: '2027-01-01', principal: inr(115000) });
  });

  it('does not look at a renewal that has not begun yet', () => {
    const position = deposit({ start: '2024-01-01', maturity: '2025-01-01', renewals: [renewal('2027-01-01', '2028-01-01', 1)] });
    expect(currentTerm(position, '2024-06-01').start).toBe('2024-01-01');
  });

  it('is the whole life of a bond, at its face value', () => {
    const bond = deposit({ kind: 'bond', principal: inr(100000), start: '2024-01-01', maturity: '2028-11-30' });
    expect(currentTerm(bond, '2026-10-12')).toEqual({ start: '2024-01-01', end: '2028-11-30', principal: inr(100000) });
  });
});

describe('barTerm — the term the progress bar is drawn over', () => {
  it('is the recorded term, from its start to its maturity', () => {
    const term = barTerm(deposit(), depositView('2027-07-31'), '2026-10-24');
    expect(term).toEqual({ start: '2026-02-01', end: '2027-07-31' });
  });

  it('is the projected term when the recorded one has run out, so the bar, the days to go and the maturity are one term', () => {
    // A one-year FD begun 1 Jan 2025 that renews itself, with no renewal recorded: the recorded term ended on
    // 1 Jan 2026 and the term it is in is the projected one, to 1 Jan 2027.
    const position = deposit({ start: '2025-01-01', maturity: '2026-01-01', autoRenew: true });
    const view = { ...depositView('2027-01-01'), projected: true, term: 2, daysToMaturity: 69 } as FixedIncomeView;
    expect(barTerm(position, view, '2026-10-24')).toEqual({ start: '2026-01-01', end: '2027-01-01' });
  });

  it('is the recorded renewal that has begun, as before', () => {
    const position = deposit({
      renewals: [{ start: '2026-08-01', maturity: '2027-08-01', ratePct: '7.000', principal: inr(105000), compounding: 'quarterly' }] as never,
    });
    expect(barTerm(position, depositView('2027-08-01'), '2026-10-24')).toEqual({ start: '2026-08-01', end: '2027-08-01' });
  });
});
