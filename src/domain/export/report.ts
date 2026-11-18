/**
 * The report: the file a person reads and keeps (docs/design/export-redesign.md section 2).
 *
 * Built from the rows of the entities the complete backup reads, and four more the report needs (credits, accounts, their balances and loan payments),
 * under the same row-level security: a row the reader may not see is not in the rows, so it is not in the file. This turns those rows into sheets of
 * cells a person can read: friendly headers, no technical column, only live records, a word for every code, Indian-grouped amounts, dates a person reads,
 * and formulas for what a person would work out (a gain, a total cost, the Summary). A sheet with nothing in it is left out, and Read me says so.
 *
 * Pure: no I/O. The cells are a plain model (`ReportSheet`); `src/lib/reportFile.ts` is the one place a spreadsheet library is named.
 */

import { istCalendarDate } from '../../lib/dates.ts';
import { minorUnitExponent } from '../../lib/money.ts';
import { canonicalDecimal, decimalToCell, moneyToCell } from './cells.ts';
import type { Row } from './entities.ts';
import {
  ACCOUNT_WORDS,
  CADENCE_WORDS,
  COMPOUNDING_WORDS,
  CREDIT_WORDS,
  DISPOSAL_WORDS,
  EARMARK_WORDS,
  INSURANCE_WORDS,
  LOAN_WORDS,
  LOT_WORDS,
  METHOD_WORDS,
  PROPERTY_WORDS,
  READING_WORDS,
  investmentType,
  wordFor,
} from './reportWords.ts';

// ───────────────────────────────────────────────────────────── the model

/** A value in a cell: text, a number, a date, nothing, or a formula (which the file's reader works out). */
export type ReportValue = string | number | Date | null | { readonly formula: string };

export type ReportStyle = 'title' | 'subtitle' | 'header' | 'label' | 'note' | 'total';

export interface ReportCell {
  /** 1-based. */
  readonly row: number;
  readonly col: number;
  readonly value: ReportValue;
  readonly format?: string;
  readonly style?: ReportStyle;
}

/** Where a block of a sheet is, so a chart can point at it (slice 2) and a test can read it back. */
export interface ReportBlock {
  readonly key: string;
  readonly headerRow: number;
  readonly firstRow: number;
  readonly lastRow: number;
  readonly firstCol: number;
  readonly lastCol: number;
}

export interface ReportSheet {
  readonly name: string;
  /** Read me and Summary are the overview sheets; the rest are data. */
  readonly tab: 'overview' | 'data';
  readonly widths: readonly number[];
  readonly freeze: boolean;
  /** The columns of the table the filter is on, from row 1 to the last data row. Null for a sheet that is not a table. */
  readonly filter: { readonly toRow: number; readonly toCol: number } | null;
  readonly cells: readonly ReportCell[];
  readonly blocks: readonly ReportBlock[];
}

export interface ReportWorkbook {
  readonly sheets: readonly ReportSheet[];
  /** The sheets that are not in the file because nothing is recorded for them, in the order they would have been. */
  readonly leftOut: readonly string[];
}

export interface ReportMeta {
  /** An instant, as UTC. */
  readonly exportedAt: string;
  readonly householdName: string;
  readonly demo: boolean;
}

export type ReportTables = Readonly<Record<string, readonly Row[]>>;

// ───────────────────────────────────────────────────────────── formats

/** Indian grouping, kept as a number format so the cell stays a number: ₹1,42,000. The same formats as the sample workbook. */
export const INR_WHOLE = '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0';
export const INR_2DP = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
export const GAIN_INR = '[<0]"₹"##,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0';
export const DATE_FORMAT = 'DD MMM YYYY';
export const MONTH_FORMAT = 'MMM YYYY';
export const UNITS_FORMAT = '#,##0.000';
export const PERCENT_1 = '0.0%';
export const PERCENT_2 = '0.00%';
export const PERCENT_0 = '0%';

/** The number format for an amount in a currency: Indian grouping for rupees, a symbol for dollars, the code for the rest. */
export function moneyFormat(currency: string, places: 0 | 2): string {
  if (currency === 'INR') return places === 0 ? INR_WHOLE : INR_2DP;
  const decimals = places === 0 ? '#,##0' : '#,##0.00';
  return currency === 'USD' ? `"$"${decimals}` : `"${currency} "${decimals}`;
}

function gainFormat(currency: string): string {
  return currency === 'INR' ? GAIN_INR : moneyFormat(currency, 0);
}

// ───────────────────────────────────────────────────────────── small helpers

/** The sheets, in the order they are written. */
export const REPORT_SHEETS = [
  'Read me',
  'Summary',
  'Spending',
  'Money in',
  'Monthly plan',
  'Investments',
  'Purchases and sales',
  'Value history',
  'Deposits',
  'Insurance',
  'Loans',
  'Property',
  'Accounts',
] as const;

const NOT_FILED = 'Not filed';

const dateOf = (iso: string | null | undefined): Date | null => (iso === null || iso === undefined || iso === '' ? null : new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const monthOf = (iso: string): Date => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
const last4 = (value: string | null | undefined): string | null => (value === null || value === undefined || value === '' ? null : `••${value}`);

function amount(minor: string | null | undefined, currency: string | null | undefined): number | null {
  if (minor === null || minor === undefined || minor === '' || currency === null || currency === undefined) return null;
  return moneyToCell(minor, currency);
}

function decimal(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text === '') return null;
  return decimalToCell(text);
}

/** A rate or a share held as a percent in the database, as the fraction a percent cell takes: 6.5 is 0.065. */
function fraction(text: string | null | undefined): number | null {
  if (text === null || text === undefined || text === '') return null;
  const canonical = canonicalDecimal(text);
  if (canonical === null) return null;
  return Number((Number(canonical) / 100).toFixed(8));
}

const byDateDescending = (a: { readonly date: string; readonly tie: string }, b: { readonly date: string; readonly tie: string }): number =>
  a.date === b.date ? a.tie.localeCompare(b.tie) : a.date < b.date ? 1 : -1;

class Index {
  private readonly maps = new Map<string, Map<string, Row>>();

  constructor(private readonly tables: ReportTables) {}

  rows(entity: string): readonly Row[] {
    return this.tables[entity] ?? [];
  }

  get(entity: string, id: string | null | undefined): Row | undefined {
    if (id === null || id === undefined) return undefined;
    let map = this.maps.get(entity);
    if (map === undefined) {
      map = new Map(this.rows(entity).map((row) => [row['id'] ?? '', row] as const));
      this.maps.set(entity, map);
    }
    return map.get(id);
  }

  member(id: string | null | undefined): string | null {
    return this.get('member', id)?.['display_name'] ?? null;
  }
}

/** A cell of a row: a value (a missing one is nothing), or a value with a number format of its own. */
type RowCell = ReportValue | undefined | { readonly v: ReportValue; readonly f: string };

/** A table's cells: the header in row 1 and a row under it for each row, and a number format for each column unless the cell sets its own. */
function tableCells(headers: readonly string[], rows: readonly (readonly RowCell[])[], columnFormats: readonly (string | undefined)[]): ReportCell[] {
  const cells: ReportCell[] = headers.map((header, index) => ({ row: 1, col: index + 1, value: header, style: 'header' as const }));
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const isWrapped = typeof cell === 'object' && cell !== null && !(cell instanceof Date) && 'v' in cell && !('formula' in cell);
      const value = isWrapped ? (cell as { v: ReportValue }).v : (cell as ReportValue);
      const format = isWrapped ? (cell as { f: string }).f : columnFormats[colIndex];
      if (value === null || value === undefined) return;
      cells.push({ row: rowIndex + 2, col: colIndex + 1, value, ...(format === undefined ? {} : { format }) });
    });
  });
  return cells;
}

const formatted = (v: ReportValue, f: string): { v: ReportValue; f: string } => ({ v, f });

// ───────────────────────────────────────────────────────────── the sheets

interface Built {
  readonly sheet: ReportSheet;
}

/** A data sheet: a table, an optional note under it, and the freeze and filter every data sheet has. */
function dataSheet(
  name: string,
  headers: readonly string[],
  widths: readonly number[],
  rows: readonly (readonly RowCell[])[],
  columnFormats: readonly (string | undefined)[],
  note: string | null,
  extra: readonly ReportCell[] = [],
  blocks: readonly ReportBlock[] = [],
): Built {
  const cells = tableCells(headers, rows, columnFormats);
  const lastRow = rows.length + 1;
  if (note !== null) cells.push({ row: lastRow + 2, col: 1, value: note, style: 'note' });
  return {
    sheet: {
      name,
      tab: 'data',
      widths,
      freeze: true,
      filter: { toRow: lastRow, toCol: headers.length },
      cells: [...cells, ...extra],
      blocks,
    },
  };
}

function spending(index: Index): Built | null {
  const live = index.rows('expense_txn').filter((row) => row['voided_at'] === null);
  if (live.length === 0) return null;
  const ordered = [...live].sort((a, b) => byDateDescending({ date: a['txn_date'] ?? '', tie: a['id'] ?? '' }, { date: b['txn_date'] ?? '', tie: b['id'] ?? '' }));
  const rows = ordered.map((row) => {
    const currency = row['currency'] ?? 'INR';
    const category = index.get('expense_category', row['category_id'])?.['name'] ?? NOT_FILED;
    return [
      dateOf(row['txn_date']),
      row['txn_date'] === null ? null : monthOf(row['txn_date'] ?? ''),
      index.member(row['member_id']),
      category,
      row['payee'],
      wordFor(METHOD_WORDS, row['method']),
      formatted(amount(row['amount_minor'], currency), moneyFormat(currency, 2)),
      currency,
      row['note'],
      row['visibility'] === 'personal' ? 'Yes' : null,
    ];
  });

  // The categories the chart reads (slice 2): rupee spend per category, largest first, read back out of the sheet by SUMIFS.
  const perCategory = new Map<string, bigint>();
  for (const row of ordered) {
    if ((row['currency'] ?? 'INR') !== 'INR') continue;
    const name = index.get('expense_category', row['category_id'])?.['name'] ?? NOT_FILED;
    perCategory.set(name, (perCategory.get(name) ?? 0n) + BigInt(row['amount_minor'] ?? '0'));
  }
  const ranked = [...perCategory.entries()].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] < b[1] ? 1 : -1));
  const extra: ReportCell[] = [];
  const blocks: ReportBlock[] = [];
  if (ranked.length > 0) {
    extra.push({ row: 1, col: 12, value: 'By category (INR)', style: 'header' }, { row: 1, col: 13, value: 'Spent', style: 'header' });
    ranked.forEach(([name], i) => {
      extra.push(
        { row: i + 2, col: 12, value: name },
        { row: i + 2, col: 13, value: { formula: `SUMIFS($G:$G,$D:$D,L${String(i + 2)},$H:$H,"INR")` }, format: INR_WHOLE },
      );
    });
    blocks.push({ key: 'by-category', headerRow: 1, firstRow: 2, lastRow: ranked.length + 1, firstCol: 12, lastCol: 13 });
  }
  const built = dataSheet(
    'Spending',
    ['Date', 'Month', 'Who', 'Category', 'Paid to', 'How paid', 'Amount', 'Currency', 'Note', 'Private'],
    [13, 11, 18, 24, 26, 13, 14, 10, 24, 9, 3, 26, 14],
    rows,
    [DATE_FORMAT, MONTH_FORMAT, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
    'Entries you removed are not listed. Private entries are yours; other members’ private entries are not in this file.',
    extra,
    blocks,
  );
  return built;
}

function moneyIn(index: Index): Built | null {
  const live = index.rows('credit_entry').filter((row) => row['voided_at'] === null);
  if (live.length === 0) return null;
  const ordered = [...live].sort((a, b) => byDateDescending({ date: a['credit_date'] ?? '', tie: a['id'] ?? '' }, { date: b['credit_date'] ?? '', tie: b['id'] ?? '' }));
  const rows = ordered.map((row) => {
    const currency = row['currency'] ?? 'INR';
    return [
      dateOf(row['credit_date']),
      wordFor(CREDIT_WORDS, row['category']),
      index.member(row['member_id']),
      index.get('account', row['account_id'])?.['name'] ?? null,
      row['payer'],
      formatted(amount(row['amount_minor'], currency), moneyFormat(currency, 2)),
      currency,
      row['visibility'] === 'personal' ? 'Yes' : null,
    ];
  });
  return dataSheet(
    'Money in',
    ['Date', 'What it is', 'Whose', 'Into account', 'From', 'Amount', 'Currency', 'Private'],
    [13, 22, 18, 24, 24, 14, 10, 9],
    rows,
    [DATE_FORMAT, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
    'Entries you removed are not listed. Private entries are yours; other members’ private entries are not in this file.',
  );
}

function monthlyPlan(index: Index): Built | null {
  const budgets = index.rows('budget').filter((row) => row['period'] === null || row['period'] === undefined);
  if (budgets.length === 0) return null;
  const grouped = new Map<string, { name: string; fy: string; currency: string; month: string | null; year: string | null }>();
  for (const row of budgets) {
    const name = index.get('expense_category', row['category_id'])?.['name'] ?? NOT_FILED;
    const fy = row['fy'] ?? '';
    const key = `${fy}\u0000${name}\u0000${row['currency'] ?? 'INR'}`;
    const entry = grouped.get(key) ?? { name, fy, currency: row['currency'] ?? 'INR', month: null, year: null };
    if (row['cadence'] === 'monthly') entry.month = row['planned_minor'] ?? null;
    else entry.year = row['planned_minor'] ?? null;
    grouped.set(key, entry);
  }
  const ordered = [...grouped.values()].sort((a, b) => (a.fy === b.fy ? a.name.localeCompare(b.name) : a.fy < b.fy ? 1 : -1));
  const rows = ordered.map((entry) => [
    entry.name,
    formatted(amount(entry.month, entry.currency), moneyFormat(entry.currency, 0)),
    formatted(amount(entry.year, entry.currency), moneyFormat(entry.currency, 0)),
    entry.currency,
    entry.fy === '' ? null : `${entry.fy}-${String((Number(entry.fy) + 1) % 100).padStart(2, '0')}`,
  ]);
  return dataSheet('Monthly plan', ['Category', 'Per month', 'Per year', 'Currency', 'Financial year'], [28, 14, 14, 10, 14], rows, [undefined, undefined, undefined, undefined, undefined], null);
}

/** The latest recorded value of each live holding: the newest date, and on one date the later row. */
function latestReadings(index: Index): Map<string, Row> {
  const latest = new Map<string, Row>();
  for (const row of index.rows('valuation_snapshot')) {
    const holding = row['holding_id'];
    if (holding === null || holding === undefined) continue;
    const current = latest.get(holding);
    if (current === undefined || (row['as_of_date'] ?? '') > (current['as_of_date'] ?? '') || ((row['as_of_date'] ?? '') === (current['as_of_date'] ?? '') && (row['id'] ?? '') > (current['id'] ?? ''))) {
      latest.set(holding, row);
    }
  }
  return latest;
}

const liveHoldings = (index: Index): readonly Row[] => index.rows('holding').filter((row) => (row['status'] ?? 'active') === 'active' && row['archived_at'] === null);

interface InvestmentRow {
  readonly holding: Row;
  readonly instrument: Row;
  readonly type: string;
  readonly currency: string;
  readonly name: string;
}

function investmentRows(index: Index): InvestmentRow[] {
  const out: InvestmentRow[] = [];
  for (const holding of liveHoldings(index)) {
    const instrument = index.get('instrument', holding['instrument_id']);
    if (instrument === undefined) continue;
    out.push({
      holding,
      instrument,
      type: investmentType(instrument['kind'] ?? null, instrument['scheme'] ?? null, instrument['retirement_type'] ?? null) ?? 'Other',
      currency: instrument['currency'] ?? 'INR',
      name: instrument['name'] ?? '',
    });
  }
  return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type)));
}

function investments(index: Index, rowsOfInvestments: readonly InvestmentRow[]): Built | null {
  if (rowsOfInvestments.length === 0) return null;
  const readings = latestReadings(index);
  const rows = rowsOfInvestments.map((entry, i) => {
    const r = String(i + 2);
    const { holding, instrument, currency } = entry;
    const reading = readings.get(holding['id'] ?? '');
    const kind = instrument['kind'];
    const units = kind === 'deposit' || kind === 'retirement' ? null : decimal(holding['quantity']);
    return [
      entry.name,
      entry.type,
      index.member(holding['member_id']),
      units,
      formatted(amount(holding['cost_minor'], currency), moneyFormat(currency, 0)),
      formatted(reading === undefined ? null : amount(reading['value_minor'], reading['currency'] ?? currency), moneyFormat(currency, 0)),
      dateOf(reading?.['as_of_date']),
      formatted({ formula: `IF(OR(E${r}="",F${r}=""),"",F${r}-E${r})` }, gainFormat(currency)),
      formatted({ formula: `IF(OR(E${r}="",E${r}=0,F${r}=""),"",(F${r}-E${r})/E${r})` }, PERCENT_1),
      wordFor(EARMARK_WORDS, holding['earmark']),
      instrument['is_foreign_asset'] === 'true' ? 'Yes' : null,
      currency,
    ];
  });
  return dataSheet(
    'Investments',
    ['Name', 'Type', 'Whose', 'Units', 'Invested', 'Latest value', 'Value as at', 'Gain', 'Gain %', 'Kept for', 'Held abroad', 'Currency'],
    [32, 24, 14, 10, 14, 14, 13, 13, 9, 12, 11, 10],
    rows,
    [undefined, undefined, undefined, undefined, undefined, undefined, DATE_FORMAT, undefined, undefined, undefined, undefined, undefined],
    'Latest value is the last one recorded or worked out; a blank means it has not been valued yet. Gain is latest value minus invested.',
  );
}

function purchasesAndSales(index: Index, live: ReadonlyMap<string, InvestmentRow>): Built | null {
  const entries: { date: string; tie: string; row: RowCell[] }[] = [];
  for (const lot of index.rows('lot')) {
    const entry = live.get(lot['holding_id'] ?? '');
    if (entry === undefined) continue;
    const currency = lot['currency'] ?? entry.currency;
    const money = lot['kind'] === 'bonus' || lot['kind'] === 'split' ? null : amount(lot['cost_minor'], currency);
    entries.push({
      date: lot['acquired_on'] ?? '',
      tie: `${entry.name}\u0000${lot['id'] ?? ''}`,
      row: [dateOf(lot['acquired_on']), entry.name, index.member(entry.holding['member_id']), wordFor(LOT_WORDS, lot['kind']), formatted(decimal(lot['quantity']), UNITS_FORMAT), formatted(money, moneyFormat(currency, 2)), currency, lot['note']],
    });
  }
  for (const disposal of index.rows('disposal')) {
    const entry = live.get(disposal['holding_id'] ?? '');
    if (entry === undefined) continue;
    const currency = disposal['currency'] ?? entry.currency;
    entries.push({
      date: disposal['disposed_on'] ?? '',
      tie: `${entry.name}\u0000${disposal['id'] ?? ''}`,
      row: [
        dateOf(disposal['disposed_on']),
        entry.name,
        index.member(entry.holding['member_id']),
        wordFor(DISPOSAL_WORDS, disposal['kind']),
        formatted(decimal(disposal['quantity']), UNITS_FORMAT),
        formatted(amount(disposal['proceeds_minor'], currency), moneyFormat(currency, 2)),
        currency,
        disposal['note'],
      ],
    });
  }
  if (entries.length === 0) return null;
  entries.sort(byDateDescending);
  return dataSheet(
    'Purchases and sales',
    ['Date', 'Investment', 'Whose', 'What happened', 'Units', 'Amount', 'Currency', 'Note'],
    [13, 30, 14, 15, 11, 14, 10, 44],
    entries.map((entry) => entry.row),
    [DATE_FORMAT, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
    'Amount is what you paid, charges included, for a purchase, and what you received for a sale.',
  );
}

function valueHistory(index: Index, live: ReadonlyMap<string, InvestmentRow>): Built | null {
  const entries: { name: string; date: string; id: string; row: RowCell[] }[] = [];
  for (const reading of index.rows('valuation_snapshot')) {
    const entry = live.get(reading['holding_id'] ?? '');
    if (entry === undefined) continue;
    const currency = reading['currency'] ?? entry.currency;
    entries.push({
      name: entry.name,
      date: reading['as_of_date'] ?? '',
      id: reading['id'] ?? '',
      row: [
        entry.name,
        index.member(entry.holding['member_id']),
        dateOf(reading['as_of_date']),
        formatted(decimal(reading['quantity']), UNITS_FORMAT),
        formatted(amount(reading['value_minor'], currency), moneyFormat(currency, 2)),
        currency,
        wordFor(READING_WORDS, reading['source']),
        reading['note'],
      ],
    });
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => (a.name === b.name ? (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1) : a.name.localeCompare(b.name)));
  return dataSheet(
    'Value history',
    ['Investment', 'Whose', 'Date', 'Units', 'Value', 'Currency', 'How', 'Note'],
    [32, 14, 13, 11, 14, 10, 16, 48],
    entries.map((entry) => entry.row),
    [undefined, undefined, DATE_FORMAT, undefined, undefined, undefined, undefined, undefined],
    'Every value recorded for what you hold today, oldest first for each investment. Investments sheet shows the latest.',
  );
}

function deposits(index: Index, live: ReadonlyMap<string, InvestmentRow>): Built | null {
  const rows: RowCell[][] = [];
  const terms = index.rows('fixed_income_terms');
  for (const term of terms) {
    const entry = live.get(term['holding_id'] ?? '');
    if (entry === undefined) continue;
    // The latest renewal is what the deposit is now.
    const renewals = index.rows('deposit_renewal').filter((renewal) => renewal['holding_id'] === term['holding_id']);
    const renewal = [...renewals].sort((a, b) => ((a['start_date'] ?? '') < (b['start_date'] ?? '') ? 1 : -1))[0];
    const currency = term['currency'] ?? entry.currency;
    const principal = renewal?.['principal_minor'] ?? term['principal_minor'];
    rows.push([
      entry.name,
      term['institution'],
      formatted(amount(principal, currency), moneyFormat(currency, 0)),
      formatted(fraction(renewal?.['rate_pct'] ?? term['rate_pct']), PERCENT_2),
      dateOf(renewal?.['start_date'] ?? term['start_date']),
      dateOf(renewal?.['maturity_date'] ?? term['maturity_date']),
      wordFor(COMPOUNDING_WORDS, renewal?.['compounding'] ?? term['compounding']),
      last4(term['account_last4']),
      currency,
    ]);
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return dataSheet(
    'Deposits',
    ['Deposit', 'Bank', 'Principal', 'Interest rate', 'Started', 'Matures', 'Interest added', 'Account', 'Currency'],
    [30, 16, 14, 12, 13, 13, 15, 10, 10],
    rows,
    [undefined, undefined, undefined, undefined, DATE_FORMAT, DATE_FORMAT, undefined, undefined, undefined],
    null,
  );
}

const isActive = (row: Row): boolean => (row['status'] ?? 'active') === 'active';

function insurance(index: Index): Built | null {
  const policies = index.rows('insurance_policy').filter(isActive);
  if (policies.length === 0) return null;
  const showEnd = policies.some((policy) => policy['premiums_end_on'] !== null && policy['premiums_end_on'] !== undefined);
  const ordered = [...policies].sort((a, b) => (a['renewal_on'] ?? '9999') .localeCompare(b['renewal_on'] ?? '9999') || (a['name'] ?? '').localeCompare(b['name'] ?? ''));
  const rows = ordered.map((policy) => {
    const currency = policy['currency'] ?? 'INR';
    const row: RowCell[] = [
      policy['name'],
      wordFor(INSURANCE_WORDS, policy['kind']),
      policy['insurer'],
      last4(policy['policy_last4']),
      index.member(policy['member_id']) ?? 'Family',
      formatted(amount(policy['cover_minor'], currency), moneyFormat(currency, 0)),
      formatted(amount(policy['premium_minor'], currency), moneyFormat(currency, 0)),
      wordFor(CADENCE_WORDS, policy['cadence']),
      dateOf(policy['renewal_on']),
    ];
    if (showEnd) row.push(dateOf(policy['premiums_end_on']));
    row.push(currency);
    return row;
  });
  const headers = ['Policy', 'Type', 'Insurer', 'Policy no.', 'Covers', 'Cover', 'Premium', 'Paid', 'Next renewal', ...(showEnd ? ['Premiums end'] : []), 'Currency'];
  const widths = [24, 13, 22, 11, 13, 14, 12, 11, 14, ...(showEnd ? [14] : []), 10];
  const formats = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, DATE_FORMAT, ...(showEnd ? [DATE_FORMAT] : []), undefined];
  return dataSheet('Insurance', headers, widths, rows, formats, null);
}

function loans(index: Index): Built | null {
  const live = index.rows('liability').filter(isActive);
  if (live.length === 0) return null;
  const paid = new Map<string, bigint>();
  for (const payment of index.rows('loan_payment')) {
    if (payment['voided_at'] !== null && payment['voided_at'] !== undefined) continue;
    const id = payment['liability_id'] ?? '';
    paid.set(id, (paid.get(id) ?? 0n) + BigInt(payment['amount_minor'] ?? '0'));
  }
  const rows = [...live]
    .sort((a, b) => (a['name'] ?? '').localeCompare(b['name'] ?? ''))
    .map((loan) => {
      const currency = loan['currency'] ?? 'INR';
      const sum = paid.get(loan['id'] ?? '');
      return [
        loan['name'],
        wordFor(LOAN_WORDS, loan['kind']),
        index.member(loan['member_id']),
        formatted(amount(loan['instalment_minor'], currency), moneyFormat(currency, 0)),
        wordFor(CADENCE_WORDS, loan['cadence']),
        formatted(amount(loan['outstanding_minor'], currency), moneyFormat(currency, 0)),
        dateOf(loan['outstanding_as_of']),
        formatted(sum === undefined ? null : amount(sum.toString(), currency), moneyFormat(currency, 0)),
      ];
    });
  return dataSheet(
    'Loans',
    ['Loan', 'Type', 'Whose', 'EMI', 'Paid', 'Outstanding', 'As on', 'Paid so far'],
    [26, 16, 14, 13, 11, 14, 13, 14],
    rows,
    [undefined, undefined, undefined, undefined, undefined, undefined, DATE_FORMAT, undefined],
    'Outstanding is what you last stated, as on its date. Paid so far is the payments recorded on the loan.',
  );
}

function property(index: Index): Built | null {
  const live = index.rows('property').filter(isActive);
  if (live.length === 0) return null;
  const rows = [...live]
    .sort((a, b) => (a['label'] ?? '').localeCompare(b['label'] ?? ''))
    .map((entry, i) => {
      const currency = entry['currency'] ?? 'INR';
      const r = String(i + 2);
      return [
        entry['label'],
        wordFor(PROPERTY_WORDS, entry['kind']),
        index.member(entry['member_id']),
        dateOf(entry['purchase_date']),
        formatted(amount(entry['purchase_cost_minor'], currency), moneyFormat(currency, 0)),
        formatted(amount(entry['stamp_duty_minor'], currency), moneyFormat(currency, 0)),
        formatted(amount(entry['registration_minor'], currency), moneyFormat(currency, 0)),
        formatted({ formula: `SUM(E${r}:G${r})` }, moneyFormat(currency, 0)),
        formatted(fraction(entry['co_owner_share_pct'] ?? '100'), PERCENT_0),
        entry['is_self_occupied'] === 'true' ? 'Yes' : 'No',
        currency,
      ];
    });
  return dataSheet(
    'Property',
    ['Property', 'Type', 'Whose', 'Bought on', 'Price paid', 'Stamp duty', 'Registration', 'Total cost', 'Your share', 'You live in it', 'Currency'],
    [18, 12, 14, 13, 14, 12, 13, 14, 10, 13, 10],
    rows,
    [undefined, undefined, undefined, DATE_FORMAT, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
    null,
  );
}

function accounts(index: Index): Built | null {
  const live = index.rows('account').filter(isActive);
  if (live.length === 0) return null;
  // The last closing balance of each: the newest day, and on one day a statement's beats a typed one.
  const latest = new Map<string, Row>();
  for (const balance of index.rows('account_balance')) {
    const account = balance['account_id'] ?? '';
    const current = latest.get(account);
    const better =
      current === undefined ||
      (balance['as_at'] ?? '') > (current['as_at'] ?? '') ||
      ((balance['as_at'] ?? '') === (current['as_at'] ?? '') && balance['source'] === 'statement' && current['source'] !== 'statement');
    if (better) latest.set(account, balance);
  }
  const rows = [...live]
    .sort((a, b) => (a['name'] ?? '').localeCompare(b['name'] ?? ''))
    .map((account) => {
      const currency = account['currency'] ?? 'INR';
      const balance = latest.get(account['id'] ?? '');
      // A card's balance is the amount due; it is shown as a minus, as the Accounts screen shows it, and never as money held.
      const minor = balance === undefined ? null : account['type'] === 'card' ? (-BigInt(balance['balance_minor'] ?? '0')).toString() : balance['balance_minor'];
      const tail = last4(account['account_last4']);
      return [
        tail === null ? account['name'] : `${account['name'] ?? ''} ${tail}`,
        wordFor(ACCOUNT_WORDS, account['type']),
        index.member(account['member_id']),
        formatted(amount(minor, currency), moneyFormat(currency, 0)),
        dateOf(balance?.['as_at']),
      ];
    });
  return dataSheet(
    'Accounts',
    ['Account', 'Type', 'Whose', 'Balance', 'As on'],
    [30, 12, 14, 14, 13],
    rows,
    [undefined, undefined, undefined, undefined, DATE_FORMAT],
    'A card’s balance is what is owed, shown as a minus. Balances are the ones typed at a month close.',
  );
}

// ───────────────────────────────────────────────────────────── Summary and Read me

function summary(
  meta: ReportMeta,
  today: string,
  inrTypes: readonly string[],
  hasOtherCurrencyHoldings: boolean,
  spendingMonths: readonly Date[],
  hasPlan: boolean,
  hasInsurance: boolean,
): Built {
  const cells: ReportCell[] = [];
  const blocks: ReportBlock[] = [];
  cells.push({ row: 1, col: 1, value: `${meta.householdName} · summary`, style: 'title' });
  const stamp = formatDay(today);
  cells.push({ row: 2, col: 1, value: `From Family Finance Buddy on ${stamp}.${meta.demo ? ' Sample figures, not a real household’s.' : ''}`, style: 'note' });
  let row = 4;

  if (inrTypes.length > 0) {
    cells.push(
      { row, col: 1, value: 'Investments by type (INR)', style: 'header' },
      { row, col: 2, value: 'Invested', style: 'header' },
      { row, col: 3, value: 'Latest value', style: 'header' },
    );
    const header = row;
    inrTypes.forEach((type, i) => {
      const r = String(header + 1 + i);
      cells.push(
        { row: header + 1 + i, col: 1, value: type },
        { row: header + 1 + i, col: 2, value: { formula: `SUMIFS(Investments!$E:$E,Investments!$B:$B,$A${r},Investments!$L:$L,"INR")` }, format: INR_WHOLE },
        { row: header + 1 + i, col: 3, value: { formula: `SUMIFS(Investments!$F:$F,Investments!$B:$B,$A${r},Investments!$L:$L,"INR")` }, format: INR_WHOLE },
      );
    });
    const first = header + 1;
    const last = header + inrTypes.length;
    blocks.push({ key: 'investments-by-type', headerRow: header, firstRow: first, lastRow: last, firstCol: 1, lastCol: 3 });
    cells.push(
      { row: last + 1, col: 1, value: 'Total', style: 'total' },
      { row: last + 1, col: 2, value: { formula: `SUM(B${String(first)}:B${String(last)})` }, format: INR_WHOLE, style: 'total' },
      { row: last + 1, col: 3, value: { formula: `SUM(C${String(first)}:C${String(last)})` }, format: INR_WHOLE, style: 'total' },
    );
    row = last + 2;
    if (hasOtherCurrencyHoldings) {
      cells.push({ row, col: 1, value: 'Holdings in other currencies are on the Investments sheet and are not added here.', style: 'note' });
      row += 1;
    }
    row += 1;
  }

  if (spendingMonths.length > 0) {
    const header = row;
    cells.push({ row: header, col: 1, value: 'Spending by month (INR)', style: 'header' }, { row: header, col: 2, value: 'Spent', style: 'header' });
    if (hasPlan) cells.push({ row: header, col: 3, value: 'Planned', style: 'header' });
    spendingMonths.forEach((month, i) => {
      const r = header + 1 + i;
      cells.push(
        { row: r, col: 1, value: month, format: MONTH_FORMAT },
        { row: r, col: 2, value: { formula: `SUMIFS(Spending!$G:$G,Spending!$B:$B,$A${String(r)},Spending!$H:$H,"INR")` }, format: INR_WHOLE },
      );
      if (hasPlan) cells.push({ row: r, col: 3, value: { formula: `SUMIFS('Monthly plan'!$B:$B,'Monthly plan'!$D:$D,"INR")` }, format: INR_WHOLE });
    });
    const last = header + spendingMonths.length;
    blocks.push({ key: 'spending-by-month', headerRow: header, firstRow: header + 1, lastRow: last, firstCol: 1, lastCol: hasPlan ? 3 : 2 });
    cells.push({ row: last + 1, col: 1, value: 'Itemised entries only. A month you closed from balances or stated in the app shows its own figure there.', style: 'note' });
    row = last + 3;
  }

  if (hasInsurance) {
    cells.push(
      { row, col: 1, value: 'Protection', style: 'header' },
      { row, col: 2, value: 'Cover', style: 'header' },
      { row, col: 3, value: 'Premium a year', style: 'header' },
      { row: row + 1, col: 1, value: 'All policies' },
      { row: row + 1, col: 2, value: { formula: 'SUM(Insurance!F:F)' }, format: INR_WHOLE },
      {
        row: row + 1,
        col: 3,
        value: {
          formula:
            'SUMIFS(Insurance!G:G,Insurance!H:H,"Yearly")+SUMIFS(Insurance!G:G,Insurance!H:H,"Monthly")*12+SUMIFS(Insurance!G:G,Insurance!H:H,"Quarterly")*4+SUMIFS(Insurance!G:G,Insurance!H:H,"Half-yearly")*2',
        },
        format: INR_WHOLE,
      },
    );
    blocks.push({ key: 'protection', headerRow: row, firstRow: row + 1, lastRow: row + 1, firstCol: 1, lastCol: 3 });
  }

  return { sheet: { name: 'Summary', tab: 'overview', widths: [40, 16, 16], freeze: false, filter: null, cells, blocks } };
}

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  Summary: 'Investments by type, spending by month against the plan, and insurance cover.',
  Spending: 'Every expense you can see, newest first. Removed entries are left out.',
  'Money in': 'Every credit you can see, newest first: salary, interest, rent and refunds. Removed entries are left out.',
  'Monthly plan': 'What you planned per category.',
  Investments: 'Everything you hold today: what you put in, its latest value, and the gain.',
  'Purchases and sales': 'Each purchase, sale, bonus or redemption, newest first.',
  'Value history': 'Every value recorded for what you hold, over time.',
  Deposits: 'Fixed and recurring deposits: rate, start and maturity.',
  Insurance: 'Policies in force, cover, premium and renewal.',
  Loans: 'Loans you are paying: instalment, what is outstanding and what has been paid so far.',
  Property: 'What you own and what it cost.',
  Accounts: 'Your accounts and their last closing balance.',
};

/** "Loans, money in and accounts": the left-out sheets as a person would say them. */
function listOf(names: readonly string[]): string {
  const lower = names.map((name) => name.toLowerCase());
  if (lower.length <= 1) return lower.join('');
  return `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1] ?? ''}`;
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(day)} ${names[month - 1] ?? ''} ${String(year)}`;
}

function formatLongDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${String(day)} ${names[month - 1] ?? ''} ${String(year)}`;
}

function readMe(meta: ReportMeta, today: string, present: readonly string[], leftOut: readonly string[]): Built {
  const cells: ReportCell[] = [];
  let row = 1;
  const put = (label: string, text: string): void => {
    cells.push({ row, col: 1, value: label, style: 'label' }, { row, col: 2, value: text });
    row += 1;
  };
  cells.push({ row: row, col: 1, value: 'Family Finance Buddy · report', style: 'title' });
  row += 1;
  put('Household', meta.householdName);
  put('Made on', formatLongDay(today));
  if (meta.demo) put('Sample figures', 'Yes. These are illustrative, not a real household’s.');
  row += 1;
  cells.push({ row, col: 1, value: 'What is in it', style: 'label' });
  row += 1;
  for (const name of present) {
    if (name === 'Read me') continue;
    put(name, DESCRIPTIONS[name] ?? '');
  }
  row += 1;
  if (leftOut.length > 0) put('Not in this file', `${capital(listOf(leftOut))}: nothing recorded yet. A sheet appears once there is something in it.`);
  put('Privacy', 'Your own private entries are included. Other members’ private entries are not.');
  put('This is a report', 'It is for reading. To add data, download the template from the Reports screen. For a complete copy of everything, which another app or a restore can read, use “Download a complete backup”.');
  return { sheet: { name: 'Read me', tab: 'overview', widths: [20, 90], freeze: false, filter: null, cells, blocks: [] } };
}

const capital = (text: string): string => (text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

// ───────────────────────────────────────────────────────────── the report

/**
 * The report for a household, from the rows the reader may see. A sheet with nothing in it is left out and named in `leftOut`; Read me and Summary are
 * always there.
 */
export function buildReport(tables: ReportTables, meta: ReportMeta): ReportWorkbook {
  const index = new Index(tables);
  const today = istCalendarDate(new Date(meta.exportedAt));

  const investmentList = investmentRows(index);
  const liveByHolding = new Map(investmentList.map((entry) => [entry.holding['id'] ?? '', entry] as const));

  const built = new Map<string, ReportSheet>();
  const add = (candidate: Built | null): void => {
    if (candidate !== null) built.set(candidate.sheet.name, candidate.sheet);
  };
  add(spending(index));
  add(moneyIn(index));
  add(monthlyPlan(index));
  add(investments(index, investmentList));
  add(purchasesAndSales(index, liveByHolding));
  add(valueHistory(index, liveByHolding));
  add(deposits(index, liveByHolding));
  add(insurance(index));
  add(loans(index));
  add(property(index));
  add(accounts(index));

  const inrTypes = [...new Set(investmentList.filter((entry) => entry.currency === 'INR').map((entry) => entry.type))].sort((a, b) => a.localeCompare(b));
  const spendingMonths = [
    ...new Set(
      index
        .rows('expense_txn')
        .filter((row) => row['voided_at'] === null && (row['currency'] ?? 'INR') === 'INR' && row['txn_date'] !== null)
        .map((row) => (row['txn_date'] ?? '').slice(0, 7)),
    ),
  ]
    .sort()
    .map((month) => new Date(`${month}-01T00:00:00Z`));
  const summarySheet = summary(
    meta,
    today,
    inrTypes,
    investmentList.some((entry) => entry.currency !== 'INR'),
    spendingMonths,
    built.has('Monthly plan'),
    built.has('Insurance'),
  ).sheet;

  const dataSheets = REPORT_SHEETS.filter((name) => name !== 'Read me' && name !== 'Summary');
  const present = ['Read me', 'Summary', ...dataSheets.filter((name) => built.has(name))];
  const leftOut = dataSheets.filter((name) => !built.has(name));
  const readMeSheet = readMe(meta, today, present, leftOut).sheet;

  return {
    sheets: [readMeSheet, summarySheet, ...dataSheets.flatMap((name) => (built.has(name) ? [built.get(name) as ReportSheet] : []))],
    leftOut,
  };
}

/** The places an amount can have places: the most any of the sheet's currencies carries. Exported for the writer's tests. */
export const placesOf = (currency: string): number => minorUnitExponent(currency);
