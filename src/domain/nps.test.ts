import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { npsValue } from './nps.ts';

/**
 * What an NPS holding is worth: units held times the NAV the pension regulator published, which is quoted to four
 * decimal places. Worked by hand; the units carry up to eight places (as every quantity here does) and the result is
 * rounded once, half a paisa upward.
 */

describe('units times NAV', () => {
  it('multiplies exactly and rounds once: 1,234.5678 units at 45.6789 is 56,393.69907942, which is 56,393.70', () => {
    // 1,234.5678 x 45 = 55,555.551 and 1,234.5678 x 0.6789 = 838.14807942: 56,393.69907942.
    expect(npsValue('1234.5678', '45.6789', 'INR')).toEqual({ ok: true, value: money(5_639_370n, 'INR') });
  });

  it('is exact where the product is exact: 100 units at 10 is 1,000', () => {
    expect(npsValue('100', '10', 'INR')).toEqual({ ok: true, value: money(100_000n, 'INR') });
  });

  it('rounds a half paisa up: 2 units at 0.0025 is half a paisa, a paisa', () => {
    expect(npsValue('2', '0.0025', 'INR')).toEqual({ ok: true, value: money(1n, 'INR') });
  });

  it('rounds down below a half: 1 unit at 12.3449 is 12.34, and at 12.3456 is 12.35', () => {
    expect(npsValue('1', '12.3449', 'INR')).toEqual({ ok: true, value: money(1_234n, 'INR') });
    expect(npsValue('1', '12.3456', 'INR')).toEqual({ ok: true, value: money(1_235n, 'INR') });
  });

  it('keeps eight decimal places of units: 0.00000001 of a unit at 100 is nothing, and 0.5 of a unit at 100 is 50', () => {
    expect(npsValue('0.00000001', '100', 'INR')).toEqual({ ok: true, value: money(0n, 'INR') });
    expect(npsValue('0.5', '100', 'INR')).toEqual({ ok: true, value: money(5_000n, 'INR') });
  });

  it('is nothing for no units, which is a holding that has been sold out and not an error', () => {
    expect(npsValue('0', '45.6789', 'INR')).toEqual({ ok: true, value: money(0n, 'INR') });
  });

  it('takes grouping commas in the units, as every quantity here does', () => {
    expect(npsValue('1,000', '10', 'INR')).toEqual({ ok: true, value: money(1_000_000n, 'INR') });
  });
});

describe('what it refuses', () => {
  it.each(['', 'abc', '-5', '1.123456789'])('units of %j', (units) => {
    expect(npsValue(units, '10', 'INR')).toEqual({ ok: false, reason: 'invalid-units' });
  });

  it.each(['', 'abc', '-1', '0', '1.23456', '.5x'])('a NAV of %j: above nothing, to four places at most', (nav) => {
    expect(npsValue('10', nav, 'INR')).toEqual({ ok: false, reason: 'invalid-nav' });
  });
});
