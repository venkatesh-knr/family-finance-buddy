/**
 * What a broker's workbook says, as the app reads it (docs/blueprint.md section 13, "Broker CSV exports"; docs/build-plan.md step 2, on what a statement of part of the history can and
 * cannot tell). Pure: the sheets of a workbook as rows of cells in, plain shapes out. Nothing is read from a file or written to a database here.
 *
 * ── three rules ────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A figure is a **decimal string** until the last moment and money is **integer minor units** (never a float that was computed with): a cell the library gives as a number is turned
 * into the shortest decimal that reads back to the same number, and rounded half up to the currency's minor unit only where a money figure is needed.
 *
 * A column is found by **its header's words**, never by its place, because a broker adds a column (Zerodha's holdings have one more in the equity sheet than in the mutual funds').
 *
 * A file that does not **check itself** is refused with a sentence, not guessed at: a cost that is not quantity times price, a profit that is not sell less buy, a trade whose amount is
 * not quantity times price. Each one is how a column read the wrong way shows.
 */

import { isIsoDate, type IsoDate } from '../../lib/dates.ts';
import { canonicalDecimal, type Cell } from '../export/cells.ts';

export type BrokerSource = 'zerodha' | 'indmoney';

/** What is held at a broker, on a day: a count of units, with the average price paid where the broker says it. The count answers how much; it does not itemise purchases. */
export interface BrokerHolding {
  readonly source: BrokerSource;
  /** The broker's own name for it: a ticker, or for a mutual fund the scheme's name. */
  readonly symbol: string;
  readonly name: string | null;
  readonly isin: string | null;
  readonly instrument: 'equity' | 'mutual_fund' | 'us_stock';
  readonly currency: 'INR' | 'USD';
  /** A decimal string, never a number: a fractional unit must not meet a double. */
  readonly quantity: string;
  /** What the broker says was paid per unit on average, as a decimal string; null where it says nothing. */
  readonly averagePrice: string | null;
  /** What it cost, in minor units of the currency: the broker's own invested value where it gives one, otherwise quantity times the average price. Null where there is neither. */
  readonly costMinor: bigint | null;
  /** The day the broker says the holding was true; null where the file does not say. */
  readonly asOf: IsoDate | null;
}

/** A purchase or a sale at a broker, as its trade report has it. */
export interface BrokerTrade {
  readonly source: BrokerSource;
  readonly date: IsoDate;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly currency: 'USD';
  readonly quantity: string;
  readonly price: string;
  readonly amountMinor: bigint;
  readonly commissionMinor: bigint;
}

/** A sale matched to the purchase it sold, as a broker's tax report has it: the entry and exit dates, and what each cost and fetched. Reported by the broker; it is not the app's own match. */
export interface BrokerExit {
  readonly source: BrokerSource;
  readonly symbol: string;
  readonly isin: string | null;
  readonly entryDate: IsoDate;
  readonly exitDate: IsoDate;
  readonly quantity: string;
  readonly buyValueMinor: bigint;
  readonly sellValueMinor: bigint;
  readonly currency: 'INR' | 'USD';
}

export interface Parsed<T> {
  readonly rows: readonly T[];
  /** What could not be read or did not check, by row, in words. A row that could not be read is never dropped silently. */
  readonly problems: readonly string[];
}

// ── cells ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const text = (cell: Cell | undefined): string => (cell === null || cell === undefined ? '' : cell instanceof Date ? '' : String(cell).trim());

/** A number a cell holds, as the shortest decimal that reads back to it; or a decimal typed as text (a rupee sign, a dollar sign and grouping commas are taken off). Null for anything else. */
export function decimalOf(cell: Cell | undefined): string | null {
  if (cell === null || cell === undefined || cell instanceof Date || typeof cell === 'boolean') return null;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return null;
    const shortest = String(cell);
    if (!/e/i.test(shortest)) return canonicalDecimal(shortest);
    return canonicalDecimal(cell.toFixed(10));
  }
  const cleaned = cell.replace(/[\s,₹$]/g, '').replace(/^\((.*)\)$/, '-$1');
  return canonicalDecimal(cleaned);
}

/** A decimal string in minor units, rounded half up (away from zero) at the unit: 12.345 at two places is 1235. */
export function toMinor(decimal: string, exponent = 2): bigint {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(decimal);
  if (match === null) throw new Error(`Not a decimal: ${decimal}`);
  const negative = match[1] === '-';
  const fraction = match[3] ?? '';
  const kept = fraction.slice(0, exponent).padEnd(exponent, '0');
  let minor = BigInt(`${match[2] ?? '0'}${kept}`);
  if ((fraction[exponent] ?? '0') >= '5') minor += 1n;
  return negative ? -minor : minor;
}

/** Quantity times a price, in minor units, rounded half up: 12.5 units at 99.99 is 124987.5 paise, so 124988. Exact: neither is ever a float. */
export function costMinor(quantity: string, price: string, exponent = 2): bigint {
  const scale = (value: string): { readonly units: bigint; readonly places: number } => {
    const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
    return { units: BigInt(`${whole}${fraction}`), places: fraction.length };
  };
  const q = scale(quantity);
  const p = scale(price);
  const places = q.places + p.places;
  // product / 10^places is in whole currency units; in minor units it is product * 10^exponent / 10^places, rounded half up.
  const numerator = q.units * p.units * 10n ** BigInt(exponent);
  const divisor = 10n ** BigInt(places);
  return (numerator * 2n + divisor) / (divisor * 2n);
}

/** A date in a cell: a date Excel made, `2026-11-19` (with or without a time), or `19-11-2026` / `19/11/2026`. Null for anything else. */
export function dateOf(cell: Cell | undefined): IsoDate | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : (cell.toISOString().slice(0, 10) as IsoDate);
  const value = text(cell);
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/.exec(value);
  if (iso !== null && isIsoDate(iso[1] ?? '')) return iso[1] as IsoDate;
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);
  if (dmy !== null) {
    const day = `${dmy[3] ?? ''}-${(dmy[2] ?? '').padStart(2, '0')}-${(dmy[1] ?? '').padStart(2, '0')}`;
    return isIsoDate(day) ? (day as IsoDate) : null;
  }
  return null;
}

/**
 * How far a quantity times a printed price may be from the amount beside it, in minor units. A broker prints a price rounded (two decimals on a fractional share) and the amount from
 * the unrounded one, so the product is off by up to half the last printed place for every unit: two cents of rounding in the amount itself, and half a cent a share.
 */
export function priceTolerance(quantity: string, price: string, exponent = 2): bigint {
  const places = (price.split('.')[1] ?? '').length;
  const perUnit = 0.5 * 10 ** (exponent - places);
  return 2n + BigInt(Math.ceil(Number(quantity) * perUnit));
}

/** Whether two money figures in minor units agree to within a tolerance. */
export const within = (a: bigint, b: bigint, tolerance: bigint): boolean => (a > b ? a - b : b - a) <= tolerance;

// ── tables ──────────────────────────────────────────────────────────────────────────────────────────────────────

const normal = (label: string): string => label.toLowerCase().replace(/[^a-z0-9$%&]+/g, ' ').trim();

export interface Table {
  /** The row the header is on, counting from 0. */
  readonly at: number;
  /** A column's place by the words of its header, normalised. */
  readonly columns: ReadonlyMap<string, number>;
}

/**
 * Every header row in a sheet: a row that has all the labels given. A sheet that repeats its table under several headings (Zerodha's tradewise exits do, one per term) has one for each.
 * A label matches a header cell when the cell's words are the label's, so `quantity` is not found in `quantity available`.
 */
export function tablesIn(rows: readonly (readonly Cell[])[], labels: readonly string[]): Table[] {
  const wanted = labels.map(normal);
  const found: Table[] = [];
  rows.forEach((row, at) => {
    const columns = new Map<string, number>();
    row.forEach((cell, column) => {
      const label = normal(text(cell));
      if (label !== '' && !columns.has(label)) columns.set(label, column);
    });
    if (wanted.every((label) => columns.has(label))) found.push({ at, columns });
  });
  return found;
}

/** A cell of a row, by the words of its column's header. */
export function pick(table: Table, row: readonly Cell[], label: string): Cell | undefined {
  const column = table.columns.get(normal(label));
  return column === undefined ? undefined : row[column];
}

/** The rows under a header, up to the first blank row, which is where a table ends. */
export function rowsUnder(rows: readonly (readonly Cell[])[], table: Table): { readonly number: number; readonly cells: readonly Cell[] }[] {
  const out: { number: number; cells: readonly Cell[] }[] = [];
  for (let at = table.at + 1; at < rows.length; at += 1) {
    const cells = rows[at] ?? [];
    if (cells.every((cell) => text(cell) === '')) break;
    out.push({ number: at + 1, cells });
  }
  return out;
}

/** The first date in a text cell of a sheet's top rows that follows `after`: `Equity Holdings Statement as on 2026-11-19`. */
export function dateAfter(rows: readonly (readonly Cell[])[], after: RegExp): IsoDate | null {
  for (const row of rows.slice(0, 60)) {
    for (const cell of row) {
      const value = text(cell);
      const found = new RegExp(`${after.source}\\s*:?\\s*(\\d{4}-\\d{2}-\\d{2})`, 'i').exec(value);
      if (found !== null && isIsoDate(found[1] ?? '')) return found[1] as IsoDate;
    }
  }
  return null;
}

