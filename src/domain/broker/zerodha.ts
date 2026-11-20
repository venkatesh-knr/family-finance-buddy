import type { Cell } from '../export/cells.ts';
import type { ReadSheet } from '../export/workbook.ts';
import { costMinor, dateAfter, dateOf, decimalOf, pick, rowsUnder, tablesIn, text, toMinor, within, type BrokerExit, type BrokerHolding, type Parsed, type Table } from './common.ts';

/**
 * Zerodha's workbooks (the holdings statement, and the tax P&L's tradewise exits). Pure: sheets in, rows and problems out.
 *
 * **Holdings.** The `Equity` and `Mutual Funds` sheets each hold a table under a line saying what day it is as on; `Combined` repeats both and is not read. What is held is what is
 * available, plus what is pledged for margin or for a loan, plus what is discrepant: all of it is the household's, and a position that is nil is left out. `Quantity Long Term` is a
 * part of what is available and is not added. The average price is Zerodha's; a cost is quantity times it, to the paisa. A holding statement has no purchase dates, so it says how much
 * is held and not when it was bought: it is a count to be stated, never a purchase (build-plan step 2).
 *
 * **Tradewise exits.** Each term's table (short, long, and so on) lists a sale against the purchase it closed, with both dates, and what each cost and fetched. They are the broker's own
 * pairing of sales to purchases. Each row checks itself: its profit is what it fetched less what it cost.
 */

const HOLDING_SHEETS: readonly { readonly name: string; readonly instrument: BrokerHolding['instrument'] }[] = [
  { name: 'equity', instrument: 'equity' },
  { name: 'mutual funds', instrument: 'mutual_fund' },
];

export function parseZerodhaHoldings(sheets: readonly ReadSheet[]): Parsed<BrokerHolding> {
  const rows: BrokerHolding[] = [];
  const problems: string[] = [];
  let seen = 0;

  for (const wanted of HOLDING_SHEETS) {
    const sheet = sheets.find((candidate) => candidate.name.trim().toLowerCase() === wanted.name);
    if (sheet === undefined) continue;
    seen += 1;
    const table = tablesIn(sheet.rows, ['symbol', 'isin', 'average price'])[0];
    if (table === undefined) {
      problems.push(`${sheet.name}: no table with Symbol, ISIN and Average Price columns was found.`);
      continue;
    }
    const asOf = dateAfter(sheet.rows, /holdings statement as on/);
    if (asOf === null) problems.push(`${sheet.name}: the statement does not say what day it is as on, so its holdings cannot be dated.`);

    for (const { number, cells } of rowsUnder(sheet.rows, table)) {
      const symbol = text(pick(table, cells, 'symbol'));
      if (symbol === '' || /^total/i.test(symbol)) continue;
      const parts = ['quantity available', 'quantity discrepant', 'quantity pledged margin', 'quantity pledged loan'].map((label) => {
        const cell = pick(table, cells, label);
        return cell === undefined || text(cell) === '' ? '0' : decimalOf(cell);
      });
      if (parts.some((part) => part === null || part.startsWith('-'))) {
        problems.push(`${sheet.name} row ${String(number)}: ${symbol} has no quantity I can read.`);
        continue;
      }
      const quantity = sum(parts as string[]);
      if (quantity === '0') continue;
      const price = decimalOf(pick(table, cells, 'average price'));
      rows.push({
        source: 'zerodha',
        symbol,
        name: wanted.instrument === 'mutual_fund' ? symbol : null,
        isin: text(pick(table, cells, 'isin')) || null,
        instrument: wanted.instrument,
        currency: 'INR',
        quantity,
        averagePrice: price,
        costMinor: price === null ? null : costMinor(quantity, price),
        asOf,
      });
    }
  }

  if (seen === 0) problems.push('This is not a Zerodha holdings statement: it has no Equity or Mutual Funds sheet.');
  return { rows, problems: dedupe(problems) };
}

/** Decimal strings added exactly. */
function sum(values: readonly string[]): string {
  const places = Math.max(...values.map((value) => (value.split('.')[1] ?? '').length));
  const scaled = values.reduce((total, value) => {
    const [whole = '0', fraction = ''] = value.split('.');
    return total + BigInt(`${whole}${fraction.padEnd(places, '0')}`);
  }, 0n);
  if (places === 0) return scaled.toString();
  const padded = scaled.toString().padStart(places + 1, '0');
  const body = `${padded.slice(0, -places)}.${padded.slice(-places)}`.replace(/0+$/, '').replace(/\.$/, '');
  return body;
}

const dedupe = (problems: readonly string[]): string[] => [...new Set(problems)];

const EXIT_LABELS = ['symbol', 'isin', 'entry date', 'exit date', 'quantity', 'buy value', 'sell value', 'profit'];

export function parseZerodhaExits(sheets: readonly ReadSheet[]): Parsed<BrokerExit> {
  const sheet = sheets.find((candidate) => /^tradewise exits/i.test(candidate.name.trim()));
  if (sheet === undefined) return { rows: [], problems: ['This is not a Zerodha tax P&L: it has no Tradewise Exits sheet.'] };

  const rows: BrokerExit[] = [];
  const problems: string[] = [];
  for (const table of tablesIn(sheet.rows, EXIT_LABELS)) {
    for (const { number, cells } of rowsUnder(sheet.rows, table)) {
      const made = exitFrom(table, cells, number);
      if (typeof made === 'string') problems.push(made);
      else if (made !== null) rows.push(made);
    }
  }
  return { rows, problems };
}

function exitFrom(table: Table, cells: readonly Cell[], number: number): BrokerExit | string | null {
  const symbol = text(pick(table, cells, 'symbol'));
  if (symbol === '') return null;
  const where = `row ${String(number)}: ${symbol}`;
  const entryDate = dateOf(pick(table, cells, 'entry date'));
  const exitDate = dateOf(pick(table, cells, 'exit date'));
  if (entryDate === null || exitDate === null) return `${where} has a date I cannot read.`;
  if (exitDate < entryDate) return `${where} was sold before it was bought (${entryDate}, ${exitDate}).`;
  const quantity = decimalOf(pick(table, cells, 'quantity'));
  const buy = decimalOf(pick(table, cells, 'buy value'));
  const sell = decimalOf(pick(table, cells, 'sell value'));
  const profit = decimalOf(pick(table, cells, 'profit'));
  if (quantity === null || buy === null || sell === null || profit === null || quantity.startsWith('-')) return `${where} has a quantity or a value I cannot read.`;
  const buyValueMinor = toMinor(buy);
  const sellValueMinor = toMinor(sell);
  if (!within(sellValueMinor - buyValueMinor, toMinor(profit), 2n)) return `${where}: the profit is not what it sold for less what it cost, so a column may be misread.`;
  return { source: 'zerodha', symbol, isin: text(pick(table, cells, 'isin')) || null, entryDate, exitDate, quantity, buyValueMinor, sellValueMinor, currency: 'INR' };
}
