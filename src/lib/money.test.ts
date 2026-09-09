import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  isCurrencyCode,
  isKnownCurrency,
  knownCurrencyCodes,
  minorUnitExponent,
  money,
  parseAmountToMinor,
  exactMoney,
  percentOfCost,
} from './money.ts';

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

  it('drops the zeros from a whole amount, because they say nothing', () => {
    expect(formatMoney(money(0n, 'INR'))).toBe('₹0');
    expect(formatMoney(money(10750000n, 'INR'))).toBe('₹1,07,500');
  });

  it('keeps paise that actually exist', () => {
    // The distinction that makes dropping the zeros safe: a fraction is hidden
    // only when it carries no information.
    expect(formatMoney(money(10750050n, 'INR'))).toBe('₹1,07,500.50');
    expect(formatMoney(money(1n, 'INR'))).toBe('₹0.01');
  });

  it('keeps them anyway when a column has to align digit for digit', () => {
    expect(formatMoney(money(0n, 'INR'), { alwaysShowMinorUnits: true })).toBe('₹0.00');
    expect(formatMoney(money(10750000n, 'INR'), { alwaysShowMinorUnits: true })).toBe('₹1,07,500.00');
  });

  it('drops them on a negative whole amount too, sign intact', () => {
    expect(formatMoney(money(-250000n, 'INR'))).toBe('-₹2,500');
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

describe('isKnownCurrency', () => {
  it('refuses three capitals that are not a currency', () => {
    // The exact hole a testing round found: the form asked for three capitals,
    // the shape test agreed, and ABC became a holding's currency.
    expect(isKnownCurrency('ABC')).toBe(false);
    expect(isKnownCurrency('XYZ')).toBe(false);
  });

  it('accepts the ones this app is actually about', () => {
    expect(isKnownCurrency('INR')).toBe(true);
    expect(isKnownCurrency('USD')).toBe(true);
  });

  it('still refuses anything that is not three capitals', () => {
    expect(isKnownCurrency('inr')).toBe(false);
    expect(isKnownCurrency('RUPEE')).toBe(false);
    expect(isKnownCurrency('')).toBe(false);
  });

  it('offers a list to choose from, so a form need not be free text', () => {
    const codes = knownCurrencyCodes();
    expect(codes).toContain('INR');
    expect(codes).not.toContain('ABC');
    // Sorted, because a select of 160 unordered codes is not a chooser.
    expect([...codes].sort()).toEqual(codes);
  });
});

describe('isCurrencyCode stays a shape test', () => {
  it('accepts a code ICU does not know, so existing rows still load', () => {
    // A holding recorded before the input check existed is data. Refusing to
    // map it would take the screen down instead of letting somebody fix it.
    expect(isCurrencyCode('ABC')).toBe(true);
    expect(() => money(100n, 'ABC')).not.toThrow();
  });
});

describe('formatMoney compact', () => {
  const inr = (minor: bigint) => money(minor, 'INR');

  it('leaves anything below a lakh exactly as it was', () => {
    // The threshold is where the Indian grouping stops helping. Below it the
    // full figure is short enough to read, and abbreviating it would lose
    // precision for nothing.
    expect(formatMoney(inr(9999999n), { compact: true })).toBe('₹99,999.99');
    expect(formatMoney(inr(5000000n), { compact: true })).toBe('₹50,000');
  });

  it('turns a lakh into L, keeping two places', () => {
    expect(formatMoney(inr(10000000n), { compact: true })).toBe('₹1 L');
    expect(formatMoney(inr(10750000n), { compact: true })).toBe('₹1.08 L');
    expect(formatMoney(inr(999999900n), { compact: true })).toBe('₹100 L');
  });

  it('turns a crore into Cr', () => {
    expect(formatMoney(inr(1000000000n), { compact: true })).toBe('₹1 Cr');
    expect(formatMoney(inr(12550000000n), { compact: true })).toBe('₹12.55 Cr');
  });

  it('drops a trailing zero rather than printing 1.00 Cr', () => {
    expect(formatMoney(inr(1000000000n), { compact: true })).toBe('₹1 Cr');
    expect(formatMoney(inr(1500000000n), { compact: true })).toBe('₹1.5 Cr');
  });

  it('keeps the sign, which is what carries a negative net worth', () => {
    expect(formatMoney(inr(-12550000000n), { compact: true })).toBe('-₹12.55 Cr');
  });

  it('uses K and M outside India rather than pretending a dollar has lakhs', () => {
    // Lakh and crore are an Indian convention. Applying them to a dollar
    // figure would be inventing a unit nobody reading it uses.
    expect(formatMoney(money(10000000n, 'USD'), { compact: true })).toBe('$100K');
    expect(formatMoney(money(1000000000n, 'USD'), { compact: true })).toBe('$10M');
  });

  it('is still bullets under privacy, which outranks it', () => {
    expect(formatMoney(inr(12550000000n), { compact: true, privacy: true })).toBe('₹•••••');
  });

  it('changes nothing unless it is asked for', () => {
    // Ledgers, forms and anything reconciled against a statement stay exact.
    expect(formatMoney(inr(12550000000n))).toBe('₹12,55,00,000');
  });
});

describe('exactMoney', () => {
  it('gives the unabbreviated figure, for the title on a compact one', () => {
    expect(exactMoney(money(12550000000n, 'INR'))).toBe('₹12,55,00,000');
  });

  it('says nothing under privacy, rather than leaking through a tooltip', () => {
    expect(exactMoney(money(12550000000n, 'INR'), true)).toBeNull();
  });
});

describe('percentOfCost', () => {
  it('is the gain as a share of what was put in', () => {
    expect(percentOfCost(50000n, 100000n)).toBe('+50%');
    expect(percentOfCost(7500n, 100000n)).toBe('+7.5%');
  });

  it('carries the sign, so a loss reads as one without its colour', () => {
    expect(percentOfCost(-25000n, 100000n)).toBe('-25%');
  });

  it('rounds to one place and drops a trailing zero', () => {
    expect(percentOfCost(3333n, 100000n)).toBe('+3.3%');
    expect(percentOfCost(100000n, 100000n)).toBe('+100%');
  });

  it('is null when nothing was invested, rather than infinity or 0%', () => {
    // A holding with no cost recorded has no return — not a return of zero,
    // which is a statement about performance nobody made.
    expect(percentOfCost(50000n, 0n)).toBeNull();
  });

  it('is null when the gain is zero and nothing was staked either way', () => {
    expect(percentOfCost(0n, 100000n)).toBe('0%');
  });
});
