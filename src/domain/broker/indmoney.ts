import type { ReadSheet } from '../export/workbook.ts';
import { costMinor, dateOf, decimalOf, pick, priceTolerance, rowsUnder, tablesIn, text, toMinor, within, type BrokerHolding, type BrokerTrade, type Parsed } from './common.ts';

/**
 * INDmoney's workbooks for US stocks: the holdings report and the trades report. Pure: sheets in, rows and problems out. Every figure is in US dollars, in cents.
 *
 * **Holdings.** `Holdings Report` says the day it is as of beside an `As Of Date` label, and lists each holding's quantity (fractional shares are ordinary here), its cost price and
 * what that came to (`Invested Value`). The two check each other: invested value is quantity times cost price, to within what rounding the price to its printed places allows (`priceTolerance`).
 *
 * **Trades.** `Trades Report` lists each trade with its side, quantity, price, amount and commission. A trade the broker says was cancelled, rejected or failed did not happen and is left
 * out, with a line saying so. Each trade checks itself: its amount is quantity times price.
 */

export function parseIndmoneyHoldings(sheets: readonly ReadSheet[]): Parsed<BrokerHolding> {
  const sheet = sheets.find((candidate) => candidate.name.trim().toLowerCase() === 'holdings report');
  if (sheet === undefined) return { rows: [], problems: ['This is not an INDmoney holdings report: it has no Holdings Report sheet.'] };
  const table = tablesIn(sheet.rows, ['symbol', 'quantity', '$ cost price', '$ invested value'])[0];
  if (table === undefined) return { rows: [], problems: ['Holdings Report: no table with Symbol, Quantity, Cost Price and Invested Value columns was found.'] };

  const problems: string[] = [];
  const asOf = asOfDate(sheet.rows);
  if (asOf === null) problems.push('Holdings Report: the report does not say what day it is as of, so its holdings cannot be dated.');

  const rows: BrokerHolding[] = [];
  for (const { number, cells } of rowsUnder(sheet.rows, table)) {
    const symbol = text(pick(table, cells, 'symbol'));
    if (symbol === '') continue;
    const quantity = decimalOf(pick(table, cells, 'quantity'));
    const price = decimalOf(pick(table, cells, '$ cost price'));
    const invested = decimalOf(pick(table, cells, '$ invested value'));
    if (quantity === null || price === null || invested === null || quantity.startsWith('-')) {
      problems.push(`row ${String(number)}: ${symbol} has a quantity or a value I cannot read.`);
      continue;
    }
    if (quantity === '0') continue;
    if (!within(toMinor(invested), costMinor(quantity, price), priceTolerance(quantity, price))) {
      problems.push(`row ${String(number)}: ${symbol}'s invested value is not its quantity times its cost price, so a column may be misread.`);
      continue;
    }
    rows.push({
      source: 'indmoney',
      symbol,
      name: text(pick(table, cells, 'name')) || null,
      isin: null,
      instrument: 'us_stock',
      currency: 'USD',
      quantity,
      averagePrice: price,
      costMinor: toMinor(invested),
      asOf,
    });
  }
  return { rows, problems };
}

/** The date beside an `As Of Date` label, on the same row. */
function asOfDate(rows: ReadSheet['rows']) {
  for (const row of rows.slice(0, 40)) {
    const at = row.findIndex((cell) => /^as of date$/i.test(text(cell)));
    if (at < 0) continue;
    for (const cell of row.slice(at + 1)) {
      const date = dateOf(cell);
      if (date !== null) return date;
    }
  }
  return null;
}

const NOT_DONE = /(cancel|reject|fail|expire|pending)/i;

export function parseIndmoneyTrades(sheets: readonly ReadSheet[]): Parsed<BrokerTrade> {
  const sheet = sheets.find((candidate) => candidate.name.trim().toLowerCase() === 'trades report');
  if (sheet === undefined) return { rows: [], problems: ['This is not an INDmoney trades report: it has no Trades Report sheet.'] };
  const table = tablesIn(sheet.rows, ['trade date', 'ticker', 'side', 'quantity', '$ price', '$ amount'])[0];
  if (table === undefined) return { rows: [], problems: ['Trades Report: no table with Trade Date, Ticker, Side, Quantity, Price and Amount columns was found.'] };

  const rows: BrokerTrade[] = [];
  const problems: string[] = [];
  for (const { number, cells } of rowsUnder(sheet.rows, table)) {
    const symbol = text(pick(table, cells, 'ticker'));
    if (symbol === '') continue;
    const where = `row ${String(number)}`;
    const date = dateOf(pick(table, cells, 'trade date'));
    if (date === null) {
      problems.push(`${where}: the ${symbol} trade has a date I cannot read.`);
      continue;
    }
    const status = text(pick(table, cells, 'status'));
    if (NOT_DONE.test(status)) {
      problems.push(`${where}: the ${symbol} trade on ${date} is ${status}, so it is left out.`);
      continue;
    }
    const sideWord = text(pick(table, cells, 'side')).toLowerCase();
    if (sideWord !== 'buy' && sideWord !== 'sell') {
      problems.push(`${where}: the ${symbol} trade on ${date} has a side that is neither buy nor sell.`);
      continue;
    }
    const quantity = decimalOf(pick(table, cells, 'quantity'));
    const price = decimalOf(pick(table, cells, '$ price'));
    const amount = decimalOf(pick(table, cells, '$ amount'));
    const commission = decimalOf(pick(table, cells, '$ commission')) ?? '0';
    if (quantity === null || price === null || amount === null || quantity.startsWith('-')) {
      problems.push(`${where}: the ${symbol} trade on ${date} has a quantity or a value I cannot read.`);
      continue;
    }
    if (!within(toMinor(amount), costMinor(quantity, price), priceTolerance(quantity, price))) {
      problems.push(`${where}: the ${symbol} trade on ${date} has an amount that is not its quantity times its price, so a column may be misread.`);
      continue;
    }
    rows.push({ source: 'indmoney', date, symbol, side: sideWord, currency: 'USD', quantity, price, amountMinor: toMinor(amount), commissionMinor: toMinor(commission) });
  }
  return { rows, problems };
}
