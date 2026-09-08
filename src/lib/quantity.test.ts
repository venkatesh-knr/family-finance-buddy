/**
 * Quantity is not money, and this file exists to keep the two apart.
 *
 * Money is minor units of a currency with a fixed exponent. A quantity is a
 * count of units of an instrument, fractional on any broker that sells part of
 * a share, and `numeric(28, 8)` in the schema. Sharing the money parser would
 * have meant a share count rounded to two places, which is a position quietly
 * wrong by whatever the broker fragmented it into.
 *
 * Written before the implementation, as the numeric convention requires.
 */

import { describe, expect, it } from 'vitest';
import {
  QUANTITY_SCALE,
  formatQuantity,
  parseQuantity,
  quantityToNumeric,
} from './quantity.ts';

describe('parseQuantity', () => {
  it('scales a whole number by the eight places the column carries', () => {
    expect(parseQuantity('1')).toBe(100000000n);
    expect(QUANTITY_SCALE).toBe(8);
  });

  it('keeps the smallest fragment the column can hold', () => {
    expect(parseQuantity('0.00000001')).toBe(1n);
  });

  it('keeps every one of the eight places', () => {
    expect(parseQuantity('1.23456789')).toBe(123456789n);
  });

  it('pads a short fraction rather than misreading its scale', () => {
    expect(parseQuantity('10.5')).toBe(1050000000n);
  });

  it('takes zero, which is a closed position rather than an error', () => {
    expect(parseQuantity('0')).toBe(0n);
  });

  it('refuses more precision than the column keeps, instead of rounding it away', () => {
    expect(() => parseQuantity('1.234567891')).toThrow(/eight decimal places/i);
  });

  it('refuses a negative quantity: a short position is not a thing this app models', () => {
    expect(() => parseQuantity('-1')).toThrow(/positive|negative/i);
  });

  it('refuses an empty entry and a non-number', () => {
    expect(() => parseQuantity('')).toThrow();
    expect(() => parseQuantity('ten')).toThrow();
  });

  it('allows the grouping and spacing a person types, as the money parser does', () => {
    expect(parseQuantity(' 1,000.5 ')).toBe(100050000000n);
  });
});

describe('formatQuantity', () => {
  it('shows a whole count as a whole number', () => {
    expect(formatQuantity(100000000n)).toBe('1');
  });

  it('trims the padding but never the significant places', () => {
    expect(formatQuantity(1050000000n)).toBe('10.5');
    expect(formatQuantity(123456789n)).toBe('1.23456789');
  });

  it('shows the smallest fragment without turning it into scientific notation', () => {
    expect(formatQuantity(1n)).toBe('0.00000001');
  });

  it('round-trips everything the parser accepts', () => {
    for (const text of ['0', '1', '10.5', '1.23456789', '0.00000001', '999999.125']) {
      expect(formatQuantity(parseQuantity(text))).toBe(text);
    }
  });
});

describe('quantityToNumeric', () => {
  it('always writes all eight places, so Postgres stores the scale it declared', () => {
    expect(quantityToNumeric(100000000n)).toBe('1.00000000');
    expect(quantityToNumeric(1n)).toBe('0.00000001');
    expect(quantityToNumeric(0n)).toBe('0.00000000');
  });
});
