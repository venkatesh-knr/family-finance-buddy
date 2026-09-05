import { describe, expect, it } from 'vitest';
import { formatMoney, minorUnitExponent, money, parseAmountToMinor } from './money.ts';

/**
 * Fixtures with known answers, written before the implementation.
 *
 * The property under test throughout: money is integer minor units, and no
 * value ever passes through a float on its way in or out.
 */

describe('minorUnitExponent', () => {
  it('is 2 for the rupee and the dollar', () => {
    expect(minorUnitExponent('INR')).toBe(2);
    expect(minorUnitExponent('USD')).toBe(2);
  });

  it('is 0 for a currency with no minor unit', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
  });
});

describe('parseAmountToMinor', () => {
  it('converts a plain rupee figure to paise', () => {
    expect(parseAmountToMinor('1234.56', 'INR')).toBe(123456n);
  });

  it('accepts Indian lakh grouping', () => {
    expect(parseAmountToMinor('1,23,456.78', 'INR')).toBe(12345678n);
  });

  it('accepts western grouping too, since a pasted figure may carry either', () => {
    expect(parseAmountToMinor('123,456.78', 'INR')).toBe(12345678n);
  });

  it('treats a whole number as whole rupees', () => {
    expect(parseAmountToMinor('1234', 'INR')).toBe(123400n);
  });

  it('pads a single decimal place', () => {
    expect(parseAmountToMinor('1234.5', 'INR')).toBe(123450n);
  });

  it('keeps sub-rupee amounts exact', () => {
    expect(parseAmountToMinor('0.07', 'INR')).toBe(7n);
  });

  it('tolerates surrounding whitespace and a rupee sign', () => {
    expect(parseAmountToMinor('  ₹ 250 ', 'INR')).toBe(25000n);
  });

  it('refuses more precision than the currency has, rather than rounding it away', () => {
    expect(() => parseAmountToMinor('1234.567', 'INR')).toThrow(/two decimal/i);
  });

  it('refuses a decimal on a currency with no minor unit', () => {
    expect(() => parseAmountToMinor('12.3', 'JPY')).toThrow();
    expect(parseAmountToMinor('1234', 'JPY')).toBe(1234n);
  });

  it('refuses what is not a number', () => {
    expect(() => parseAmountToMinor('', 'INR')).toThrow();
    expect(() => parseAmountToMinor('abc', 'INR')).toThrow();
    expect(() => parseAmountToMinor('1.2.3', 'INR')).toThrow();
  });

  it('refuses a negative amount: an expense is a positive figure', () => {
    expect(() => parseAmountToMinor('-5', 'INR')).toThrow();
  });

  it('is exact where a float would not be', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In paise it is simply 30.
    const sum = parseAmountToMinor('0.10', 'INR') + parseAmountToMinor('0.20', 'INR');
    expect(sum).toBe(30n);
    expect(sum).toBe(parseAmountToMinor('0.30', 'INR'));
  });

  it('carries a figure larger than a double can hold exactly', () => {
    // ₹1,00,00,00,00,000.01 — beyond Number.MAX_SAFE_INTEGER once in paise.
    expect(parseAmountToMinor('10000000000.01', 'INR')).toBe(1000000000001n);
  });
});

describe('formatMoney', () => {
  it('formats rupees with lakh grouping', () => {
    expect(formatMoney(money(12345678n, 'INR'))).toBe('₹1,23,456.78');
  });

  it('formats a foreign amount in its own currency, never converted', () => {
    expect(formatMoney(money(1299n, 'USD'))).toBe('$12.99');
  });

  it('formats zero minor units', () => {
    expect(formatMoney(money(0n, 'INR'))).toBe('₹0.00');
  });

  it('formats a currency with no minor unit', () => {
    expect(formatMoney(money(1234n, 'JPY'))).toBe('JP¥1,234');
  });

  it('hides the figure but keeps the symbol in privacy mode', () => {
    // A formatter switch, not a blur: this has to survive a screenshot.
    expect(formatMoney(money(12345678n, 'INR'), { privacy: true })).toBe('₹•••••');
    expect(formatMoney(money(1299n, 'USD'), { privacy: true })).toBe('$•••••');
  });
});

describe('money', () => {
  it('rejects a currency that is not a three-letter code', () => {
    expect(() => money(1n, 'rupees')).toThrow();
    expect(() => money(1n, 'inr')).toThrow();
  });
});
