import { describe, expect, it } from 'vitest';
import {
  canonicalDecimal,
  cellToBoolean,
  cellToDate,
  cellToDecimalText,
  cellToInteger,
  cellToMinorText,
  cellToTimestamp,
  decimalToCell,
  majorTextToMinor,
  minorToMajorText,
  moneyToCell,
} from './cells.ts';

describe('minor units and major units', () => {
  it('writes an integer of minor units as the decimal a person reads', () => {
    expect(minorToMajorText(123456789n, 2)).toBe('1234567.89');
    expect(minorToMajorText(5n, 2)).toBe('0.05');
    expect(minorToMajorText(100n, 2)).toBe('1');
    expect(minorToMajorText(150n, 2)).toBe('1.5');
    expect(minorToMajorText(0n, 2)).toBe('0');
    expect(minorToMajorText(-5000n, 2)).toBe('-50');
    expect(minorToMajorText(-5n, 2)).toBe('-0.05');
  });

  it('has no decimal point for a currency with no minor unit, and three places for one with three', () => {
    expect(minorToMajorText(1500n, 0)).toBe('1500');
    expect(minorToMajorText(1234n, 3)).toBe('1.234');
  });

  it('reads what people type: symbols, lakh grouping, spaces, a sign, a decimal point', () => {
    expect(majorTextToMinor('₹12,34,567.89', 2)).toBe(123456789n);
    expect(majorTextToMinor(' 1 00 000 ', 2)).toBe(10000000n);
    expect(majorTextToMinor('$1,234.5', 2)).toBe(123450n);
    expect(majorTextToMinor('-50', 2)).toBe(-5000n);
    expect(majorTextToMinor('−50.25', 2)).toBe(-5025n);
    expect(majorTextToMinor('0.05', 2)).toBe(5n);
    expect(majorTextToMinor('1500', 0)).toBe(1500n);
  });

  it('refuses more precision than the currency has, and anything that is not an amount, instead of rounding', () => {
    expect(() => majorTextToMinor('1.005', 2)).toThrow(/3 decimal places.*carries 2/i);
    expect(() => majorTextToMinor('1.5', 0)).toThrow(/whole/i);
    expect(() => majorTextToMinor('abc', 2)).toThrow(/not an amount/i);
    expect(() => majorTextToMinor('1.2.3', 2)).toThrow(/not an amount/i);
    expect(() => majorTextToMinor('', 2)).toThrow();
  });

  it('round-trips every amount through a cell without the digits moving', () => {
    for (const minor of ['0', '1', '99', '100', '123456789', '-123456789', '99999999999999', '-1', '1000000000000']) {
      const cell = moneyToCell(minor, 'INR');
      expect(typeof cell).toBe('number');
      expect(cellToMinorText(cell, 'INR')).toBe(minor);
    }
    expect(cellToMinorText(moneyToCell('150000', 'JPY'), 'JPY')).toBe('150000');
    expect(cellToMinorText(moneyToCell('1234', 'BHD'), 'BHD')).toBe('1234');
  });

  it('refuses to write an amount a spreadsheet cannot hold exactly, and says which', () => {
    expect(() => moneyToCell('1234567890123456789', 'INR')).toThrow(/cannot hold|exactly/i);
  });

  it('reads an amount typed as text in a cell as it reads a number', () => {
    expect(cellToMinorText('₹1,00,000', 'INR')).toBe('10000000');
    expect(cellToMinorText(1234.5, 'INR')).toBe('123450');
    expect(cellToMinorText(null, 'INR')).toBeNull();
    expect(cellToMinorText('  ', 'INR')).toBeNull();
    expect(() => cellToMinorText(12.345, 'INR')).toThrow(/decimal places/i);
  });
});

describe('decimals: units, NAVs, rates', () => {
  it('canonicalises the text a database gives so equal numbers compare equal', () => {
    expect(canonicalDecimal('7.100')).toBe('7.1');
    expect(canonicalDecimal('100.00000000')).toBe('100');
    expect(canonicalDecimal('0.00')).toBe('0');
    expect(canonicalDecimal('-0.0')).toBe('0');
    expect(canonicalDecimal('1000.50')).toBe('1000.5');
    expect(canonicalDecimal('-12.340')).toBe('-12.34');
    expect(canonicalDecimal('abc')).toBeNull();
  });

  it('writes a decimal as a number and reads it back to the same digits', () => {
    for (const text of ['1000.5', '45.6789', '0.00000001', '12345678.12345678', '7.1', '100', '0', '-3.25']) {
      expect(cellToDecimalText(decimalToCell(text))).toBe(text);
    }
    expect(cellToDecimalText(decimalToCell('7.100'))).toBe('7.1');
  });

  it('refuses to round: more significant digits than a cell holds is an error, never a quiet change', () => {
    expect(() => decimalToCell('1234567.12345678901')).toThrow(/significant digits|cannot hold/i);
    expect(() => decimalToCell('99999999999999.99999999')).toThrow();
  });

  it('reads a decimal typed with grouping commas, and refuses what is not a number', () => {
    expect(cellToDecimalText('1,000.5')).toBe('1000.5');
    expect(cellToDecimalText('12.5%')).toBe('12.5');
    expect(cellToDecimalText('')).toBeNull();
    expect(() => cellToDecimalText('twelve')).toThrow(/not a number/i);
  });
});

describe('dates, timestamps, integers and booleans', () => {
  it('reads a date as text, as a date Excel made, or as a serial number', () => {
    expect(cellToDate('2026-10-30')).toBe('2026-10-30');
    expect(cellToDate(new Date(Date.UTC(2026, 9, 30)))).toBe('2026-10-30');
    // 2026-10-30 is serial 46325 in Excel's 1900 system.
    expect(cellToDate(46325)).toBe('2026-10-30');
    expect(cellToDate('')).toBeNull();
    expect(() => cellToDate('30/10/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => cellToDate('2026-02-30')).toThrow(/not a real date/i);
  });

  it('reads a timestamp to the instant, as UTC, from text or from a date', () => {
    expect(cellToTimestamp('2026-10-30T06:04:08.123+00:00')).toBe('2026-10-30T06:04:08.123Z');
    expect(cellToTimestamp('2026-10-30T11:34:08+05:30')).toBe('2026-10-30T06:04:08.000Z');
    expect(cellToTimestamp(new Date('2026-10-30T06:04:08Z'))).toBe('2026-10-30T06:04:08.000Z');
    expect(cellToTimestamp(null)).toBeNull();
    expect(() => cellToTimestamp('yesterday')).toThrow(/timestamp/i);
  });

  it('reads integers and refuses a fraction', () => {
    expect(cellToInteger(12)).toBe('12');
    expect(cellToInteger('12')).toBe('12');
    expect(cellToInteger(null)).toBeNull();
    expect(() => cellToInteger(1.5)).toThrow(/whole number/i);
  });

  it('reads yes and no as people write them', () => {
    expect(cellToBoolean(true)).toBe('true');
    expect(cellToBoolean('Yes')).toBe('true');
    expect(cellToBoolean('FALSE')).toBe('false');
    expect(cellToBoolean('no')).toBe('false');
    expect(cellToBoolean(0)).toBe('false');
    expect(cellToBoolean(null)).toBeNull();
    expect(() => cellToBoolean('maybe')).toThrow(/yes or no|true or false/i);
  });
});
