/**
 * A rate applied to money, in integers. Every figure was worked by hand.
 */

import { describe, expect, it } from 'vitest';
import { percentOf, thousandths } from './rate.ts';

describe('thousandths', () => {
  it('reads numeric(6,3) text however many zeros it carries', () => {
    expect(thousandths('12.5')).toBe(12_500n);
    expect(thousandths('12.500')).toBe(12_500n);
    expect(thousandths('20')).toBe(20_000n);
    expect(thousandths('0.125')).toBe(125n);
    expect(thousandths('37.000')).toBe(37_000n);
  });
});

describe('percentOf', () => {
  it('takes a whole percentage of an amount', () => {
    // 20% of ₹70,000 is ₹14,000.
    expect(percentOf(7_000_000n, '20.000')).toBe(1_400_000n);
  });

  it('takes a fractional percentage exactly', () => {
    // 12.5% of ₹1,75,000 is ₹21,875.
    expect(percentOf(17_500_000n, '12.500')).toBe(2_187_500n);
  });

  it('rounds a half paisa up rather than down', () => {
    // 12.5% of 10,004 paise is 1,250.5 → 1,251.
    expect(percentOf(10_004n, '12.500')).toBe(1_251n);
    // And a third of a paisa rounds down, so it is rounding and not always-up.
    expect(percentOf(10_001n, '12.500')).toBe(1_250n);
  });

  it('is zero of nothing, and nothing of anything', () => {
    expect(percentOf(0n, '30.000')).toBe(0n);
    expect(percentOf(1_000_000n, '0.000')).toBe(0n);
  });

  it('takes the 4% cess of a large tax without losing a rupee to a float', () => {
    // 4% of ₹2,44,03,125 is ₹9,76,125 exactly. A double would carry this to
    // the last digit at this size, but the point is that nothing needs to.
    expect(percentOf(2_440_312_500n, '4.000')).toBe(97_612_500n);
  });
});
