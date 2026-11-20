import { describe, expect, it } from 'vitest';
import type { Cell } from '../export/cells.ts';
import type { ReadSheet } from '../export/workbook.ts';
import { costMinor, dateOf, decimalOf, tablesIn, toMinor } from './common.ts';
import { detectBroker } from './detect.ts';
import { parseIndmoneyHoldings, parseIndmoneyTrades } from './indmoney.ts';
import { parseZerodhaExits, parseZerodhaHoldings } from './zerodha.ts';

/**
 * What a broker's workbook says (docs/blueprint.md section 13, broker exports; docs/build-plan.md step 2 on what a statement of part of the history can and cannot tell). The sheets
 * are built here with the layout the brokers use, and every name, number and figure is invented.
 */
const blank = (n: number): Cell[][] => Array.from({ length: n }, () => []);

describe('figures', () => {
  it('reads a number a cell holds as the shortest decimal that reads back to it, and text with its sign, grouping and currency mark taken off', () => {
    expect(decimalOf(1234.5)).toBe('1234.5');
    expect(decimalOf(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(decimalOf(1e-7)).toBe('0.0000001');
    expect(decimalOf('₹ 1,23,456.70')).toBe('123456.7');
    expect(decimalOf('($1,000.00)')).toBe('-1000');
    expect(decimalOf('n/a')).toBeNull();
    expect(decimalOf(null)).toBeNull();
    expect(decimalOf(true)).toBeNull();
  });

  it('rounds half up at the minor unit, away from zero, and never through a float', () => {
    expect(toMinor('12.345')).toBe(1235n);
    expect(toMinor('12.344')).toBe(1234n);
    expect(toMinor('-12.345')).toBe(-1235n);
    expect(toMinor('7')).toBe(700n);
    expect(toMinor('1234567890123.45')).toBe(123456789012345n);
  });

  it('works a cost out of a quantity and a price exactly', () => {
    expect(costMinor('12.5', '99.99')).toBe(124988n);
    expect(costMinor('10', '2.505')).toBe(2505n);
    expect(costMinor('0.001', '1000')).toBe(100n);
    expect(costMinor('3', '0.333')).toBe(100n);
  });

  it('reads a date Excel made, an ISO date with or without a time, and a day-month-year date', () => {
    expect(dateOf(new Date('2026-11-19T00:00:00Z'))).toBe('2026-11-19');
    expect(dateOf('2026-11-19')).toBe('2026-11-19');
    expect(dateOf('2026-11-19T10:30:00')).toBe('2026-11-19');
    expect(dateOf('19-11-2026')).toBe('2026-11-19');
    expect(dateOf('9/1/2026')).toBe('2026-01-09');
    expect(dateOf('31-02-2026')).toBeNull();
    expect(dateOf('soon')).toBeNull();
  });

  it('finds a table by the words of its header and not by its place, and each repeat of it', () => {
    const rows: Cell[][] = [['x'], ['Symbol', 'Quantity Available', 'Quantity'], ['A', 1, 2], [], ['Symbol', 'Quantity Available', 'Quantity'], ['B', 3, 4]];
    expect(tablesIn(rows, ['symbol', 'quantity']).map((table) => table.at)).toEqual([1, 4]);
    expect(tablesIn(rows, ['symbol', 'average price'])).toEqual([]);
  });
});

// ── Zerodha ─────────────────────────────────────────────────────────────────────────────────────────────────────

const EQUITY_HEAD = ['Symbol', 'ISIN', 'Sector', 'Quantity Available', 'Quantity Discrepant', 'Quantity Long Term', 'Quantity Pledged (Margin)', 'Quantity Pledged (Loan)', 'Average Price', 'Previous Closing Price', 'Unrealized P&L', 'Unrealized P&L Pct.'];
const FUND_HEAD = ['Symbol', 'ISIN', 'Instrument Type', 'Quantity Available', 'Quantity Discrepant', 'Quantity Pledged (Margin)', 'Quantity Pledged (Loan)', 'Average Price', 'Previous Closing Price', 'Unrealized P&L', 'Unrealized P&L Pct.'];

const zerodhaHoldings = (equity: Cell[][], funds: Cell[][]): ReadSheet[] => [
  { name: 'Equity', rows: [...blank(10), ['Equity Holdings Statement as on 2026-11-19'], ...blank(11), EQUITY_HEAD, ...equity] },
  { name: 'Mutual Funds', rows: [...blank(10), ['Mutual Funds Holdings Statement as on 2026-11-19'], ...blank(11), FUND_HEAD, ...funds] },
  { name: 'Combined', rows: [...blank(22), ['Symbol', 'ISIN'], ['SAMPLE1', 'INE000A01010']] },
];

describe('Zerodha holdings', () => {
  const sheets = zerodhaHoldings(
    [
      ['SAMPLE1', 'INE000A01010', 'Sector', 10, 0, 10, 0, 0, 100.5, 120, 195, 19.4],
      ['SAMPLE2', 'INE000A01028', 'Sector', 4, 1, 0, 2, 3, 1234.5678, 1300, 0, 0],
      ['SOLDOUT', 'INE000A01036', 'Sector', 0, 0, 0, 0, 0, 50, 55, 0, 0],
      [],
      ['Disclaimer text below the table'],
    ],
    [['SAMPLE LARGE CAP FUND - DIRECT PLAN - GROWTH', 'INF000A01011', 'MF', 1234.567, 0, 0, 0, 25.4321, 30, 5, 18]],
  );
  const out = parseZerodhaHoldings(sheets);

  it('reads the equity and the mutual fund sheets, as at the day the statement says, and not the combined sheet that repeats them', () => {
    expect(out.problems).toEqual([]);
    expect(out.rows.map((row) => [row.symbol, row.instrument, row.asOf])).toEqual([
      ['SAMPLE1', 'equity', '2026-11-19'],
      ['SAMPLE2', 'equity', '2026-11-19'],
      ['SAMPLE LARGE CAP FUND - DIRECT PLAN - GROWTH', 'mutual_fund', '2026-11-19'],
    ]);
  });

  it('counts what is held as what is available, what is pledged and what is discrepant, and leaves out a position that is nil', () => {
    expect(out.rows.map((row) => row.quantity)).toEqual(['10', '10', '1234.567']);
    expect(out.rows.some((row) => row.symbol === 'SOLDOUT')).toBe(false);
  });

  it('gives the average price as the broker prints it, and a cost that is quantity times it, to the paisa', () => {
    expect(out.rows[0]).toMatchObject({ averagePrice: '100.5', costMinor: 100_500n, currency: 'INR', isin: 'INE000A01010', source: 'zerodha' });
    expect(out.rows[1]).toMatchObject({ averagePrice: '1234.5678', costMinor: 1_234_568n });
    expect(out.rows[2]?.costMinor).toBe(costMinor('1234.567', '25.4321'));
  });

  it('says so when a sheet has no table, or a row has no quantity', () => {
    expect(parseZerodhaHoldings([{ name: 'Equity', rows: [['nothing here']] }]).problems[0]).toMatch(/no table/i);
    const bad = parseZerodhaHoldings(zerodhaHoldings([['SAMPLE1', 'INE000A01010', 'Sector', 'ten', 0, 0, 0, 0, 100, 100, 0, 0]], []));
    expect(bad.rows).toEqual([]);
    expect(bad.problems[0]).toMatch(/SAMPLE1.*quantity/i);
  });
});

const EXIT_HEAD = ['Symbol', 'ISIN', 'Entry Date', 'Exit Date', 'Quantity', 'Buy Value', 'Sell Value', 'Profit', 'Period of Holding', 'Fair Market Value', 'Taxable Profit', 'Turnover', 'Brokerage'];
const exits = (...blocks: Cell[][][]): ReadSheet[] => [
  {
    name: 'Tradewise Exits from 2026-04-01',
    rows: [
      ...blank(10),
      ['Tradewise Exits from 2026-04-01 to 2026-11-19'],
      ...blank(7),
      ['Intraday'],
      ...blocks.flatMap((block, at) => [[at === 0 ? 'Short Term trades' : 'Long Term trades'], EXIT_HEAD, ...block, []]),
    ],
  },
  { name: 'Equity and Non Equity', rows: [['Symbol', 'Quantity', 'Buy Value', 'Sell Value', 'Realized P&L'], ['SAMPLE1', 5, 1, 2, 1]] },
];

describe('Zerodha tradewise exits', () => {
  const out = parseZerodhaExits(
    exits(
      [['SAMPLE1', 'INE000A01010', '2026-05-04', '2026-08-10', 5, 500, 650.5, 150.5, 98, 0, 150.5, 650.5, 3]],
      [['SAMPLE2', 'INE000A01028', new Date('2025-01-06T00:00:00Z'), '2026-09-01', 2.5, 2000, 1800, -200, 603, 0, -200, 1800, 2]],
    ),
  );

  it('reads each term’s table, with the dates a purchase and a sale were made, and what each cost and fetched', () => {
    expect(out.problems).toEqual([]);
    expect(out.rows).toEqual([
      { source: 'zerodha', symbol: 'SAMPLE1', isin: 'INE000A01010', entryDate: '2026-05-04', exitDate: '2026-08-10', quantity: '5', buyValueMinor: 50_000n, sellValueMinor: 65_050n, currency: 'INR' },
      { source: 'zerodha', symbol: 'SAMPLE2', isin: 'INE000A01028', entryDate: '2025-01-06', exitDate: '2026-09-01', quantity: '2.5', buyValueMinor: 200_000n, sellValueMinor: 180_000n, currency: 'INR' },
    ]);
  });

  it('refuses a row whose profit is not what it sold for less what it cost, which is how a column read the wrong way shows', () => {
    const bad = parseZerodhaExits(exits([['SAMPLE1', 'INE000A01010', '2026-05-04', '2026-08-10', 5, 500, 650.5, 99, 98, 0, 99, 650.5, 3]]));
    expect(bad.rows).toEqual([]);
    expect(bad.problems[0]).toMatch(/SAMPLE1.*profit/i);
  });

  it('refuses a row that was sold before it was bought, or has a date it cannot read', () => {
    const backwards = parseZerodhaExits(exits([['SAMPLE1', 'INE000A01010', '2026-09-04', '2026-08-10', 5, 500, 650.5, 150.5, 98, 0, 150.5, 650.5, 3]]));
    expect(backwards.problems[0]).toMatch(/before/i);
    const unreadable = parseZerodhaExits(exits([['SAMPLE1', 'INE000A01010', 'long ago', '2026-08-10', 5, 500, 650.5, 150.5, 98, 0, 150.5, 650.5, 3]]));
    expect(unreadable.problems[0]).toMatch(/date/i);
  });
});

// ── INDmoney ────────────────────────────────────────────────────────────────────────────────────────────────────

const indHoldings = (rows: Cell[][]): ReadSheet[] => [
  {
    name: 'Holdings Report',
    rows: [['Holdings Report'], ['As Of Date', '2026-11-19'], [], [], [], ['Symbol', 'Name', 'Quantity', '($) Cost Price', '($) Invested Value', '($) Market Price', '($) Market Value', '($) Unrealized Returns', 'Broker'], ...rows],
  },
];

describe('INDmoney holdings', () => {
  const out = parseIndmoneyHoldings(
    indHoldings([
      ['AAAA', 'Sample Corp Class A', 2.5, 100, 250, 120, 300, 50, 'Broker'],
      ['BBBB', 'Another Sample Inc', 0.12345678, 812.3456, 100.28, 900, 111.11, 10.83, 'Broker'],
    ]),
  );

  it('reads the day it is as of, each holding’s fractional quantity and what it cost in dollars, in cents', () => {
    expect(out.problems).toEqual([]);
    expect(out.rows[0]).toEqual({ source: 'indmoney', symbol: 'AAAA', name: 'Sample Corp Class A', isin: null, instrument: 'us_stock', currency: 'USD', quantity: '2.5', averagePrice: '100', costMinor: 25_000n, asOf: '2026-11-19' });
    expect(out.rows[1]).toMatchObject({ quantity: '0.12345678', averagePrice: '812.3456', costMinor: 10_028n });
  });

  it('refuses a holding whose invested value is not its quantity times its cost price, to within what rounding allows', () => {
    const bad = parseIndmoneyHoldings(indHoldings([['AAAA', 'Sample Corp Class A', 2.5, 100, 999, 120, 300, 50, 'Broker']]));
    expect(bad.rows).toEqual([]);
    expect(bad.problems[0]).toMatch(/AAAA.*invested/i);
  });

  it('says so when the file does not say what day it is as of', () => {
    const rows = indHoldings([['AAAA', 'Sample Corp Class A', 2.5, 100, 250, 120, 300, 50, 'Broker']]);
    const noDate = parseIndmoneyHoldings([{ name: 'Holdings Report', rows: (rows[0]?.rows ?? []).filter((row) => row[0] !== 'As Of Date') }]);
    expect(noDate.rows[0]?.asOf).toBeNull();
    expect(noDate.problems[0]).toMatch(/as of/i);
  });
});

const indTrades = (rows: Cell[][]): ReadSheet[] => [
  { name: 'Trades Report', rows: [['Trades Report'], [], [], [], [], [], ['Trade Date', 'Ticker', 'Side', 'Quantity', '($) Price', '($) Amount', '($) Commission', 'Status', 'Broker'], ...rows] },
];

describe('INDmoney trades', () => {
  const out = parseIndmoneyTrades(
    indTrades([
      ['2026-11-03', 'AAAA', 'BUY', 1.5, 100, 150, 0.05, 'FILLED', 'Broker'],
      ['2026-11-10', 'AAAA', 'SELL', 0.5, 110.123, 55.06, 0, 'FILLED', 'Broker'],
      ['2026-11-11', 'BBBB', 'BUY', 1, 50, 50, 0, 'CANCELLED', 'Broker'],
    ]),
  );

  it('reads each trade with its side, its dollars in cents and its fractional quantity, and leaves out what was cancelled, saying so', () => {
    expect(out.rows).toEqual([
      { source: 'indmoney', date: '2026-11-03', symbol: 'AAAA', side: 'buy', currency: 'USD', quantity: '1.5', price: '100', amountMinor: 15_000n, commissionMinor: 5n },
      { source: 'indmoney', date: '2026-11-10', symbol: 'AAAA', side: 'sell', currency: 'USD', quantity: '0.5', price: '110.123', amountMinor: 5_506n, commissionMinor: 0n },
    ]);
    expect(out.problems).toEqual(['row 10: the BBBB trade on 2026-11-11 is CANCELLED, so it is left out.']);
  });

  it('refuses a trade whose amount is not its quantity times its price, to within what rounding allows', () => {
    const bad = parseIndmoneyTrades(indTrades([['2026-11-03', 'AAAA', 'BUY', 1.5, 100, 175, 0, 'FILLED', 'Broker']]));
    expect(bad.rows).toEqual([]);
    expect(bad.problems[0]).toMatch(/amount/i);
  });

  it('allows for a price printed to two places on a fractional share, whose amount is worked from the unrounded one', () => {
    // The report prints the price to two places and the amount from the unrounded one: 0.71234567 shares at 140.13 is 99.8186, printed as 99.82 and off by a hair.
    const out = parseIndmoneyTrades(indTrades([['2026-11-03', 'AAAA', 'BUY', 0.71234567, 140.13, 99.82, 0, 'FILLED', 'Broker']]));
    expect(out.problems).toEqual([]);
    expect(out.rows).toHaveLength(1);
    // But not by a margin a rounded price cannot explain.
    expect(parseIndmoneyTrades(indTrades([['2026-11-03', 'AAAA', 'BUY', 0.71234567, 140.13, 105, 0, 'FILLED', 'Broker']])).problems[0]).toMatch(/amount/i);
  });

  it('refuses a side that is neither buy nor sell', () => {
    expect(parseIndmoneyTrades(indTrades([['2026-11-03', 'AAAA', 'SWAP', 1, 100, 100, 0, 'FILLED', 'Broker']])).problems[0]).toMatch(/side/i);
  });
});

describe('telling which file it is', () => {
  it('recognises each by its sheets and headers, and says nothing for any other workbook', () => {
    expect(detectBroker(zerodhaHoldings([], []))).toBe('zerodha_holdings');
    expect(detectBroker(exits([]))).toBe('zerodha_exits');
    expect(detectBroker(indHoldings([]))).toBe('indmoney_holdings');
    expect(detectBroker(indTrades([]))).toBe('indmoney_trades');
    expect(detectBroker([{ name: 'Sheet1', rows: [['a', 'b']] }])).toBeNull();
  });
});
