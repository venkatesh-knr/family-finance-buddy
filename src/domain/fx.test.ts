import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { convert, netWorth, rateOn, type Rate } from './fx.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

const rate = (as_of: string, value: string): Rate => ({
  base: 'USD',
  quote: 'INR',
  asOf: as_of,
  rate: value,
});

/**
 * "A transaction converts at the rate for its own date. Yesterday's net worth
 * must not change because the rupee moved today."
 */
describe('rateOn', () => {
  const rates = [rate('2026-01-31', '82.5'), rate('2026-06-30', '86.0'), rate('2026-08-31', '88.45')];

  it('takes the latest rate on or before the date asked about', () => {
    expect(rateOn(rates, 'USD', 'INR', '2026-07-15')?.rate).toBe('86.0');
  });

  it('uses a rate dated exactly that day', () => {
    expect(rateOn(rates, 'USD', 'INR', '2026-06-30')?.rate).toBe('86.0');
  });

  it('will not reach forward for a rate that did not exist yet', () => {
    // The whole point. Converting January at August's rate would move a figure
    // somebody has already filed a return on.
    expect(rateOn(rates, 'USD', 'INR', '2026-01-01')).toBeNull();
  });

  it('is null for a pair nobody has recorded', () => {
    expect(rateOn(rates, 'EUR', 'INR', '2026-08-31')).toBeNull();
  });
});

describe('convert', () => {
  it('leaves an amount already in the target currency exactly alone', () => {
    // Not "converts at 1.0" — untouched. A round trip through a rate of one is
    // still an opportunity to round.
    const result = convert(inr(1_234.56), 'INR', [], '2026-08-31');
    expect(result).toEqual({ ok: true, amount: inr(1_234.56) });
  });

  it('converts at the rate for the date given', () => {
    const result = convert(usd(100), 'INR', [rate('2026-08-31', '88.45')], '2026-08-31');
    expect(result.ok).toBe(true);
    // 100 USD = 10000 cents; x 88.45 = 884,500 paise = ₹8,845.00
    if (result.ok) expect(result.amount.minor).toBe(884_500n);
  });

  it('keeps the fractional part of a rate rather than rounding the rate first', () => {
    // 12.5 dollars at 88.4567 is ₹1,105.71 (110571.
    // Rounding the rate to 88.46 first would give ₹1,105.75 — four paise adrift
    // on one small holding, and it compounds.
    const result = convert(usd(12.5), 'INR', [rate('2026-08-31', '88.4567')], '2026-08-31');
    if (result.ok) expect(result.amount.minor).toBe(110_571n);
  });

  it('rounds the final figure to the minor unit, half away from zero', () => {
    const result = convert(usd(1), 'INR', [rate('2026-08-31', '88.455')], '2026-08-31');
    // 100 cents x 88.455 = 8845.5 paise, which is not a whole paise.
    if (result.ok) expect(result.amount.minor).toBe(8_846n);
  });

  it('refuses rather than guessing when there is no rate', () => {
    const result = convert(usd(100), 'INR', [], '2026-08-31');
    expect(result).toEqual({ ok: false, missing: { base: 'USD', quote: 'INR' } });
  });

  it('refuses when every rate is later than the date', () => {
    const result = convert(usd(100), 'INR', [rate('2026-09-30', '88.9')], '2026-08-31');
    expect(result.ok).toBe(false);
  });

  it('converts a negative amount without losing its sign', () => {
    const result = convert(usd(-50), 'INR', [rate('2026-08-31', '88.45')], '2026-08-31');
    if (result.ok) expect(result.amount.minor).toBe(-442_250n);
  });
});

/**
 * Net worth, which is only a number when every part of it can be converted.
 *
 * A total that quietly drops the holdings it could not convert is worse than
 * no total: it looks complete and is short by an amount nobody can see.
 */
describe('netWorth', () => {
  const rates = [rate('2026-08-31', '88.45')];

  it('is assets minus debt in the base currency', () => {
    const result = netWorth({
      assets: [inr(500_000), usd(1_000)],
      debts: [inr(320_000)],
      base: 'INR',
      rates,
      on: '2026-08-31',
    });

    // 5,00,000 + (1,000 x 88.45 = 88,450) − 3,20,000 = 2,68,450
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amount.minor).toBe(26_845_000n);
  });

  it('subtracts debt recorded in another currency too', () => {
    const result = netWorth({
      assets: [inr(100_000)],
      debts: [usd(100)],
      base: 'INR',
      rates,
      on: '2026-08-31',
    });
    if (result.ok) expect(result.amount.minor).toBe(9_115_500n); // 1,00,000 − 8,845
  });

  it('is negative when the debt is larger, and says so plainly', () => {
    const result = netWorth({
      assets: [inr(100_000)],
      debts: [inr(250_000)],
      base: 'INR',
      rates,
      on: '2026-08-31',
    });
    if (result.ok) expect(result.amount.minor).toBe(-15_000_000n);
  });

  it('refuses the whole total when any one part cannot be converted', () => {
    // Not "the rupee part". A number labelled net worth that silently omits
    // the dollars is the failure this returns instead of.
    const result = netWorth({
      assets: [inr(500_000), usd(1_000)],
      debts: [],
      base: 'INR',
      rates: [],
      on: '2026-08-31',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual([{ base: 'USD', quote: 'INR' }]);
  });

  it('names every currency it lacks a rate for, not just the first', () => {
    const result = netWorth({
      assets: [usd(10), money(500n, 'EUR')],
      debts: [money(100n, 'GBP')],
      base: 'INR',
      rates: [],
      on: '2026-08-31',
    });

    if (!result.ok) {
      expect(result.missing.map((m) => m.base).sort()).toEqual(['EUR', 'GBP', 'USD']);
    }
  });

  it('is zero, not an error, for a household with nothing', () => {
    const result = netWorth({ assets: [], debts: [], base: 'INR', rates: [], on: '2026-08-31' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amount.minor).toBe(0n);
  });
});
