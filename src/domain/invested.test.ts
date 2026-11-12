import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { investedInMonth, type InvestedInput } from './invested.ts';

/**
 * What went into holdings and what came out of them in one month (docs/design/spending-capture.md section 10, SC-I11,
 * SC-I13). Every figure below is worked by hand from the entries; none of it is market movement.
 */

const ORDER = ['mutual_fund', 'equity', 'bond', 'etf', 'deposit', 'retirement', 'gold', 'other'] as const;

const base: InvestedInput = {
  month: '2026-10',
  classOrder: ORDER,
  holdings: [
    { id: 'mf', kind: 'mutual_fund' },
    { id: 'eq', kind: 'equity' },
    { id: 'fd', kind: 'deposit' },
    { id: 'ppf', kind: 'retirement' },
    { id: 'gold', kind: 'gold' },
    { id: 'us', kind: 'etf' },
  ],
  lots: [],
  disposals: [],
  terms: [],
  payouts: [],
  ppfEntries: [],
};

const lot = (holdingId: string, acquiredOn: string, rupees: number, kind = 'purchase', currency = 'INR') => ({
  holdingId,
  acquiredOn,
  cost: money(BigInt(rupees) * 100n, currency),
  kind,
});

const sale = (holdingId: string, disposedOn: string, rupees: number, kind = 'sale', currency = 'INR') => ({
  holdingId,
  disposedOn,
  proceeds: money(BigInt(rupees) * 100n, currency),
  kind,
});

const only = (result: ReturnType<typeof investedInMonth>, currency = 'INR') => {
  const found = result.currencies.find((c) => c.currency === currency);
  if (found === undefined) throw new Error(`no ${currency} in the result`);
  return found;
};

describe('investedInMonth', () => {
  it('is nothing for a month with no entries, and says so by having no currencies', () => {
    expect(investedInMonth(base).currencies).toEqual([]);
  });

  it('SC-I11 — adds the purchases of the month by class, by their own dates, and counts nothing from the days either side', () => {
    const result = investedInMonth({
      ...base,
      lots: [
        lot('mf', '2026-10-05', 15_000),
        lot('mf', '2026-10-20', 15_000),
        lot('gold', '2026-10-10', 5_000),
        lot('mf', '2026-09-30', 99_999), // the day before
        lot('mf', '2026-11-01', 99_999), // the day after
      ],
    });
    const inr = only(result);
    expect(inr.putIn).toBe(3_500_000n);
    expect(inr.takenOut).toBe(0n);
    expect(inr.net).toBe(3_500_000n);
    expect(inr.classes.map((c) => [c.kind, c.putIn])).toEqual([
      ['mutual_fund', 3_000_000n],
      ['gold', 500_000n],
    ]);
  });

  it('lists the class with the most movement first, and ties in the order given', () => {
    const result = investedInMonth({
      ...base,
      lots: [lot('gold', '2026-10-02', 5_000), lot('eq', '2026-10-02', 1_000), lot('mf', '2026-10-02', 30_000), lot('us', '2026-10-02', 1_000)],
    });
    expect(only(result).classes.map((c) => c.kind)).toEqual(['mutual_fund', 'gold', 'equity', 'etf']);
  });

  it('takes sales, redemptions and maturities out, and nets them against what was put in', () => {
    const result = investedInMonth({
      ...base,
      lots: [lot('mf', '2026-10-05', 30_000)],
      disposals: [sale('mf', '2026-10-12', 10_000), sale('fd', '2026-10-15', 50_000, 'maturity'), sale('eq', '2026-10-16', 2_000, 'redemption')],
    });
    const inr = only(result);
    expect(inr.putIn).toBe(3_000_000n);
    expect(inr.takenOut).toBe(6_200_000n);
    expect(inr.net).toBe(-3_200_000n);
    expect(inr.classes.find((c) => c.kind === 'mutual_fund')).toMatchObject({ putIn: 3_000_000n, takenOut: 1_000_000n, net: 2_000_000n });
  });

  it('SC-I11 — does not count bonus units, splits, transfers, gifts or ESOP vests as money put in, and says how many it left out', () => {
    const result = investedInMonth({
      ...base,
      lots: [
        lot('eq', '2026-10-03', 0, 'bonus'),
        lot('eq', '2026-10-03', 0, 'split'),
        lot('eq', '2026-10-04', 40_000, 'transfer'),
        lot('eq', '2026-10-05', 0, 'gift'),
        lot('eq', '2026-10-06', 25_000, 'esop'),
        lot('eq', '2026-10-07', 1_000),
      ],
      disposals: [sale('eq', '2026-10-08', 40_000, 'transfer'), sale('eq', '2026-10-09', 3_000, 'gift')],
    });
    const inr = only(result);
    expect(inr.putIn).toBe(100_000n);
    expect(inr.takenOut).toBe(0n);
    expect(result.leftOut).toEqual({ lots: 5, disposals: 2, holdings: 0 });
  });

  it('counts a deposit once, as its principal on the day it started, and not again when it renews', () => {
    const result = investedInMonth({
      ...base,
      terms: [
        { holdingId: 'fd', start: '2026-10-08', principal: money(10_000_000n, 'INR') },
        { holdingId: 'old', start: '2025-10-08', principal: money(99_999_900n, 'INR') },
      ],
      holdings: [...base.holdings, { id: 'old', kind: 'deposit' }],
    });
    const inr = only(result);
    expect(inr.putIn).toBe(10_000_000n);
    expect(inr.classes).toEqual([{ kind: 'deposit', putIn: 10_000_000n, takenOut: 0n, net: 10_000_000n, moves: 1 }]);
  });

  it('does not count a deposit twice when its holding also has a purchase lot', () => {
    const result = investedInMonth({
      ...base,
      lots: [lot('fd', '2026-10-08', 100_000)],
      terms: [{ holdingId: 'fd', start: '2026-10-08', principal: money(10_000_000n, 'INR') }],
    });
    expect(only(result).putIn).toBe(10_000_000n);
  });

  it('takes a deposit out in the month it paid out, at what it paid, and counts it in when it started', () => {
    const input: InvestedInput = {
      ...base,
      terms: [{ holdingId: 'fd', start: '2025-10-08', principal: money(10_000_000n, 'INR') }],
      payouts: [{ holdingId: 'fd', paidOn: '2026-10-08', amount: money(10_700_000n, 'INR') }],
    };
    expect(only(investedInMonth({ ...input, month: '2025-10' })).classes).toEqual([
      { kind: 'deposit', putIn: 10_000_000n, takenOut: 0n, net: 10_000_000n, moves: 1 },
    ]);
    expect(only(investedInMonth({ ...input, month: '2026-10' })).classes).toEqual([
      { kind: 'deposit', putIn: 0n, takenOut: 10_700_000n, net: -10_700_000n, moves: 1 },
    ]);
    // Nothing in the months between.
    expect(investedInMonth({ ...input, month: '2026-03' }).currencies).toEqual([]);
  });

  it('nets a payout that is put straight into a new deposit to nothing, and does not rely on counting it twice', () => {
    const result = investedInMonth({
      ...base,
      holdings: [...base.holdings, { id: 'fd2', kind: 'deposit' }],
      terms: [
        { holdingId: 'fd', start: '2025-10-08', principal: money(10_000_000n, 'INR') },
        { holdingId: 'fd2', start: '2026-10-08', principal: money(10_700_000n, 'INR') },
      ],
      payouts: [{ holdingId: 'fd', paidOn: '2026-10-08', amount: money(10_700_000n, 'INR') }],
    });
    expect(only(result)).toMatchObject({ putIn: 10_700_000n, takenOut: 10_700_000n, net: 0n });
  });

  it('does not count a maturity disposal on a holding whose payout is already counted', () => {
    const result = investedInMonth({
      ...base,
      terms: [{ holdingId: 'fd', start: '2025-10-08', principal: money(10_000_000n, 'INR') }],
      payouts: [{ holdingId: 'fd', paidOn: '2026-10-08', amount: money(10_700_000n, 'INR') }],
      disposals: [sale('fd', '2026-10-08', 107_000, 'maturity')],
    });
    expect(only(result).takenOut).toBe(10_700_000n);
  });

  it('counts the holdings opened this month with a cost and no purchase recorded, so the screen can say they were not counted', () => {
    const result = investedInMonth({
      ...base,
      holdings: [
        { id: 'a', kind: 'mutual_fund', openedOn: '2026-10-03', costed: true },
        { id: 'b', kind: 'mutual_fund', openedOn: '2026-10-04', costed: true }, // has a lot: counted as a lot
        { id: 'c', kind: 'mutual_fund', openedOn: '2026-10-05', costed: false }, // no cost recorded
        { id: 'd', kind: 'mutual_fund', openedOn: '2026-09-05', costed: true }, // another month
        { id: 'e', kind: 'deposit', openedOn: '2026-10-06', costed: true }, // its terms are its money
      ],
      lots: [lot('b', '2026-10-04', 1_000)],
      terms: [{ holdingId: 'e', start: '2026-10-06', principal: money(100_000n, 'INR') }],
    });
    expect(result.leftOut.holdings).toBe(1);
  });

  it('counts PPF payments in and withdrawals out, and ignores a voided entry', () => {
    const result = investedInMonth({
      ...base,
      ppfEntries: [
        { holdingId: 'ppf', date: '2026-10-04', amount: money(1_250_000n, 'INR'), isVoided: false },
        { holdingId: 'ppf', date: '2026-10-20', amount: money(-300_000n, 'INR'), isVoided: false },
        { holdingId: 'ppf', date: '2026-10-21', amount: money(7_777_700n, 'INR'), isVoided: true },
        { holdingId: 'ppf', date: '2026-09-30', amount: money(5_000_000n, 'INR'), isVoided: false },
      ],
    });
    expect(only(result).classes).toEqual([{ kind: 'retirement', putIn: 1_250_000n, takenOut: 300_000n, net: 950_000n, moves: 2 }]);
  });

  it('keeps each currency apart and never converts', () => {
    const result = investedInMonth({
      ...base,
      lots: [lot('mf', '2026-10-05', 10_000), lot('us', '2026-10-06', 100, 'purchase', 'USD')],
    });
    expect(result.currencies.map((c) => [c.currency, c.putIn])).toEqual([
      ['INR', 1_000_000n],
      ['USD', 10_000n],
    ]);
  });

  it('files a holding it was not told about under other, so nothing put in goes missing', () => {
    const result = investedInMonth({ ...base, lots: [lot('ghost', '2026-10-05', 500)] });
    expect(only(result).classes.map((c) => [c.kind, c.putIn])).toEqual([['other', 50_000n]]);
  });

  it('SC-I13 — adds up: the classes sum to the currency, in and out', () => {
    const result = investedInMonth({
      ...base,
      lots: [lot('mf', '2026-10-05', 12_345), lot('eq', '2026-10-06', 6_789), lot('gold', '2026-10-07', 1_011)],
      disposals: [sale('mf', '2026-10-09', 2_222), sale('gold', '2026-10-10', 333)],
      terms: [{ holdingId: 'fd', start: '2026-10-11', principal: money(5_550_000n, 'INR') }],
      ppfEntries: [{ holdingId: 'ppf', date: '2026-10-12', amount: money(400_000n, 'INR'), isVoided: false }],
    });
    const inr = only(result);
    expect(inr.classes.reduce((sum, c) => sum + c.putIn, 0n)).toBe(inr.putIn);
    expect(inr.classes.reduce((sum, c) => sum + c.takenOut, 0n)).toBe(inr.takenOut);
    expect(inr.net).toBe(inr.putIn - inr.takenOut);
  });

  it('refuses a month that is not a month', () => {
    expect(() => investedInMonth({ ...base, month: '2026-13' })).toThrow();
    expect(() => investedInMonth({ ...base, month: 'October' })).toThrow();
  });
});
