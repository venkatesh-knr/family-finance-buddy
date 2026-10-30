/**
 * One cell of the workbook, to and from the text a database holds.
 *
 * A row reaches the export as text (an amount as its integer of minor units, a number as the decimal the database prints) and
 * leaves the reader as the same kind of text, so nothing between them is ever a float that was computed with. A number is
 * written to a cell only when it can be read back to exactly the same digits, and where it cannot the export stops and says
 * so: a figure that is quietly rounded in a backup is worse than no backup.
 *
 * What a person types into a cell in Excel is read as people type it (a rupee sign, lakh grouping, a minus that is not an
 * ASCII hyphen, a date Excel made, a serial number), and anything that is not an amount, a date or a number is refused with a
 * sentence that says what is wrong. Pure; no I/O.
 */

import { minorUnitExponent } from '../../lib/money.ts';

/** What a spreadsheet cell holds once the library has read it. */
export type Cell = string | number | boolean | Date | null;

/** A value in a cell is wrong; the message is for a person reading a preview. */
export class CellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CellError';
  }
}

const isBlank = (cell: Cell): boolean => cell === null || (typeof cell === 'string' && cell.trim() === '');

// ───────────────────────────────────────────────────────────── decimals

/** "7.100" is "7.1", "100.00000000" is "100", "-0.0" is "0": the same number written one way. Null if it is not a decimal. */
export function canonicalDecimal(text: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text.trim());
  if (match === null) return null;
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const body = fraction === '' ? whole : `${whole}.${fraction}`;
  return match[1] === '-' && body !== '0' ? `-${body}` : body;
}

/** The digits a double prints for itself: the shortest text that reads back to it, never an exponent. */
function numberToDecimalText(value: number): string {
  if (!Number.isFinite(value)) throw new CellError('That is not a number.');
  const text = value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
  const canonical = canonicalDecimal(text);
  if (canonical === null) throw new CellError('That is not a number.');
  return canonical;
}

/** A decimal as the number a cell holds, and an error where a cell cannot hold it exactly. */
export function decimalToCell(text: string): number {
  const canonical = canonicalDecimal(text);
  if (canonical === null) throw new CellError(`${JSON.stringify(text)} is not a number.`);
  const value = Number(canonical);
  if (numberToDecimalText(value) !== canonical) {
    throw new CellError(
      `${canonical} has more significant digits than a spreadsheet cell can hold exactly, so it is not written rather than rounded.`,
    );
  }
  return value;
}

/** What a cell says as the decimal it means, or null for an empty cell. Grouping commas and a trailing percent sign go. */
export function cellToDecimalText(cell: Cell): string | null {
  if (isBlank(cell)) return null;
  if (typeof cell === 'number') return numberToDecimalText(cell);
  if (typeof cell !== 'string') throw new CellError('That is not a number.');
  const cleaned = cell.replace(/[\s,  ]/g, '').replace(/%$/, '').replace(/−/g, '-');
  const canonical = canonicalDecimal(cleaned);
  if (canonical === null) throw new CellError(`${JSON.stringify(cell)} is not a number.`);
  return canonical;
}

// ──────────────────────────────────────────────────────────────── money

/** 123456789 minor units at two places is "1234567.89"; trailing zeros of the fraction are dropped. */
export function minorToMajorText(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent).replace(/0+$/, '');
  const body = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/**
 * What a person wrote as an amount, in minor units. Signed (a withdrawal is negative), strict about precision (a currency's own
 * places and no more, never rounded) and taken apart digit by digit: it never becomes a Number.
 */
export function majorTextToMinor(input: string, exponent: number): bigint {
  const stripped = input.replace(/[\s,  ]/g, '').replace(/−/g, '-');
  if (stripped === '') throw new CellError('Enter an amount.');
  const hyphens = stripped.split('-').length - 1;
  if (hyphens > 1) throw new CellError(`${JSON.stringify(input)} is not an amount.`);
  const negative = hyphens === 1;
  const cleaned = stripped.replace(/-/g, '').replace(/^[^\d.]+/, '').replace(/[^\d.]+$/, '');
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null || !/\d/.test(cleaned)) throw new CellError(`${JSON.stringify(input)} is not an amount.`);
  const whole = match[1] === '' ? '0' : (match[1] ?? '0');
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) {
    throw new CellError(
      exponent === 0
        ? `${JSON.stringify(input)} has a fraction, and this currency takes a whole number.`
        : `${JSON.stringify(input)} has ${String(fraction.length)} decimal places, and this currency carries ${String(exponent)}.`,
    );
  }
  const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  return negative ? -minor : minor;
}

/** An amount in minor units (as the database's text) as the number of major units a cell holds. */
export function moneyToCell(minorText: string, currency: string): number {
  const exponent = minorUnitExponent(currency);
  return decimalToCell(minorToMajorText(BigInt(minorText), exponent));
}

/** What a cell says as an amount in minor units, as the database's text; null for an empty cell. */
export function cellToMinorText(cell: Cell, currency: string): string | null {
  if (isBlank(cell)) return null;
  const exponent = minorUnitExponent(currency);
  if (typeof cell === 'number') return majorTextToMinor(numberToDecimalText(cell), exponent).toString();
  if (typeof cell !== 'string') throw new CellError('That is not an amount.');
  return majorTextToMinor(cell, exponent).toString();
}

// ───────────────────────────────────────────────────── dates and the rest

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

function isoDate(year: number, month: number, day: number): string {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new CellError(`${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} is not a real date.`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A day as YYYY-MM-DD: from text in that form, from a date Excel made (its UTC day), or from Excel's serial number. */
export function cellToDate(cell: Cell): string | null {
  if (isBlank(cell)) return null;
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) throw new CellError('That is not a date.');
    return isoDate(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
  }
  if (typeof cell === 'number') {
    const day = new Date(EXCEL_EPOCH + Math.floor(cell) * 86_400_000);
    return isoDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
  }
  if (typeof cell !== 'string') throw new CellError('That is not a date.');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell.trim());
  if (match === null) throw new CellError(`${JSON.stringify(cell)} is not a date: write it as YYYY-MM-DD.`);
  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** An instant, as UTC to the millisecond. */
export function cellToTimestamp(cell: Cell): string | null {
  if (isBlank(cell)) return null;
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) throw new CellError('That is not a timestamp.');
    return cell.toISOString();
  }
  if (typeof cell !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(cell.trim())) {
    throw new CellError(`${JSON.stringify(cell)} is not a timestamp: write it as YYYY-MM-DDTHH:MM:SSZ.`);
  }
  const parsed = new Date(cell.trim().replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) throw new CellError(`${JSON.stringify(cell)} is not a timestamp.`);
  return parsed.toISOString();
}

export function cellToInteger(cell: Cell): string | null {
  if (isBlank(cell)) return null;
  const text = typeof cell === 'number' ? numberToDecimalText(cell) : typeof cell === 'string' ? cell.replace(/[\s,]/g, '') : '';
  if (!/^-?\d+$/.test(text)) throw new CellError(`${JSON.stringify(cell)} is not a whole number.`);
  return canonicalDecimal(text);
}

export function cellToBoolean(cell: Cell): 'true' | 'false' | null {
  if (isBlank(cell)) return null;
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (typeof cell === 'number' && (cell === 0 || cell === 1)) return cell === 1 ? 'true' : 'false';
  if (typeof cell === 'string') {
    const word = cell.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(word)) return 'true';
    if (['false', 'no', 'n', '0'].includes(word)) return 'false';
  }
  throw new CellError(`${JSON.stringify(cell)} is not yes or no (true or false).`);
}
