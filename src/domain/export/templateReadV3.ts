/**
 * A filled template, version 3, read into the rows an upload plans from (docs/design/export-redesign.md section 3; XR-I8 to XR-I10).
 *
 * The reader maps words to codes and writes names beside ids, and `planUpload` finds the records those names mean, exactly as it does for a version 2 file; the
 * database function `apply_template` does not change. Row 1 of every sheet is the headers and column A is the hidden row key: `SP-0001` becomes the ref
 * `<template id>:SP-0001`, so uploading a corrected file again updates the rows it added and adds nothing twice. The example row (keyed EXAMPLE) and any row
 * whose visible cells are all empty are skipped.
 *
 * Pure: no I/O.
 */

import {
  CellError,
  cellToDate,
  cellToDecimalText,
  cellToMinorText,
  type Cell,
} from './cells.ts';
import type { Row } from './entities.ts';
import {
  INSURANCE_CHOICES,
  INTEREST_CHOICES,
  INVESTMENT_TYPES,
  KEPT_FOR_CHOICES,
  LOAN_CHOICES,
  METHOD_CHOICES,
  OFTEN_CHOICES,
  PROPERTY_CHOICES,
  TEMPLATE_SHEETS,
  TEMPLATE_V3_MARKER,
  TRADE_CHOICES,
  plainHeader,
  type Choice,
  type TemplateSheet,
} from './templateV3.ts';
import { isExample, type Problem, type ReadSheet, type ReadWorkbook, type SheetRow } from './workbook.ts';

export interface TemplateReadContext {
  /** The household's investments as the app shows them, `Name (Whose)`, so a name that means two can be said. */
  readonly investments: readonly string[];
}

const HOW_TO_FILL = 'How to fill';
const sheetNamed = (sheets: readonly ReadSheet[], name: string): ReadSheet | undefined => sheets.find((sheet) => sheet.name.trim().toLowerCase() === name.trim().toLowerCase());

/** The marker line of a version 3 file: its version and this download's id, found on How to fill. */
function markerOf(sheets: readonly ReadSheet[]): { version: number; id: string } | null {
  const sheet = sheetNamed(sheets, HOW_TO_FILL);
  if (sheet === undefined) return null;
  for (const row of sheet.rows) {
    const text = typeof row[0] === 'string' ? row[0].trim() : '';
    const match = TEMPLATE_V3_MARKER.exec(text);
    if (match !== null) return { version: Number(match[1]), id: match[2] ?? '' };
  }
  return null;
}

/** Whether this workbook is a version 3 template: it has a How to fill sheet that says so. A version 2 file has an About sheet instead. */
export function isTemplateV3(sheets: readonly ReadSheet[]): boolean {
  return markerOf(sheets)?.version === 3;
}

const blank = (cell: Cell): boolean => cell === null || (typeof cell === 'string' && cell.trim() === '');
const text = (cell: Cell): string | null => (blank(cell) ? null : String(cell instanceof Date ? cell.toISOString() : cell).trim());
const norm = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

function word<T>(choices: readonly Choice<T>[], given: string | null): { found: boolean; code: T | null } {
  if (given === null) return { found: true, code: null };
  const hit = choices.find((choice) => norm(choice.word) === norm(given));
  return hit === undefined ? { found: false, code: null } : { found: true, code: hit.code };
}

interface Ctx {
  readonly sheet: TemplateSheet;
  readonly sheetName: string;
  readonly rowNumber: number;
  readonly cells: ReadonlyMap<string, Cell>;
  readonly problems: Problem[];
}

/** Read a cell with a converter, saying what is wrong where it is. */
function read<T>(ctx: Ctx, header: string, convert: (cell: Cell) => T | null, needed = false): T | null {
  const cell = ctx.cells.get(header) ?? null;
  if (blank(cell)) {
    if (needed) ctx.problems.push({ sheet: ctx.sheetName, row: ctx.rowNumber, column: header, message: 'This is needed.' });
    return null;
  }
  try {
    return convert(cell);
  } catch (error) {
    if (!(error instanceof CellError)) throw error;
    ctx.problems.push({ sheet: ctx.sheetName, row: ctx.rowNumber, column: header, message: error.message });
    return null;
  }
}

const textOf = (ctx: Ctx, header: string, needed = false): string | null => read(ctx, header, (cell) => text(cell), needed);
const dateOf = (ctx: Ctx, header: string, needed = false): string | null => read(ctx, header, cellToDate, needed);
const numberOf = (ctx: Ctx, header: string, needed = false): string | null => read(ctx, header, cellToDecimalText, needed);

/** An amount in minor units, in the row's currency (INR when the currency cell is empty). */
function moneyOf(ctx: Ctx, header: string, currency: string, needed = false): string | null {
  return read(ctx, header, (cell) => cellToMinorText(cell, currency), needed);
}

function choice<T>(ctx: Ctx, header: string, choices: readonly Choice<T>[], needed = false): T | null {
  const given = textOf(ctx, header, needed);
  if (given === null) return null;
  const hit = word(choices, given);
  if (!hit.found) {
    ctx.problems.push({ sheet: ctx.sheetName, row: ctx.rowNumber, column: header, message: `"${given}" is not one of: ${choices.map((entry) => entry.word).join(', ')}.` });
    return null;
  }
  return hit.code;
}

function currencyOf(ctx: Ctx, header = 'Currency ▾'): string {
  const given = textOf(ctx, header);
  return given === null ? 'INR' : given.toUpperCase();
}

const yesNo = (ctx: Ctx, header: string): boolean => {
  const given = textOf(ctx, header);
  if (given === null) return false;
  if (norm(given) === 'yes') return true;
  if (norm(given) === 'no') return false;
  ctx.problems.push({ sheet: ctx.sheetName, row: ctx.rowNumber, column: header, message: `"${given}" is not Yes or No.` });
  return false;
};

/** 2026-27 is the financial year that began in 2026. */
function fyOf(ctx: Ctx, header: string): string | null {
  const given = textOf(ctx, header, true);
  if (given === null) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(given);
  if (match === null || (Number(match[1]) + 1) % 100 !== Number(match[2])) {
    ctx.problems.push({ sheet: ctx.sheetName, row: ctx.rowNumber, column: header, message: `"${given}" is not a financial year like 2026-27.` });
    return null;
  }
  return match[1] ?? null;
}

type Values = Record<string, string | null>;

interface Out {
  readonly entity: string;
  readonly row: SheetRow;
}

/** The sheets of a filled template as rows to plan from, with problems named by sheet, row and column. */
export function readTemplateV3(sheets: readonly ReadSheet[], context: TemplateReadContext): ReadWorkbook {
  const marker = markerOf(sheets);
  const problems: Problem[] = [];
  if (marker === null || marker.version !== 3) {
    return { tables: {}, sheets: {}, problems: [{ sheet: HOW_TO_FILL, row: 1, column: 'Template version', message: 'This workbook does not say it is a version 3 template. Download a fresh template or a backup.' }] };
  }

  const out: Out[] = [];
  const duplicates = new Set<string>();
  const seenLabels = new Map<string, number>();
  for (const label of context.investments) seenLabels.set(norm(label), (seenLabels.get(norm(label)) ?? 0) + 1);
  for (const [label, count] of seenLabels) if (count > 1) duplicates.add(label);

  // The investments this file adds, by name: so a deposit's name, which has no Whose beside it, finds its label.
  const fileInvestments: { name: string; label: string }[] = [];

  const byHeader = new Map<string, TemplateSheet>(TEMPLATE_SHEETS.map((sheet) => [sheet.name, sheet]));
  const rowsOf = (name: string): { sheet: TemplateSheet; sheetName: string; rows: { rowNumber: number; key: string; cells: Map<string, Cell> }[] } | null => {
    const spec = byHeader.get(name);
    const sheet = sheetNamed(sheets, name);
    if (spec === undefined || sheet === undefined) return null;
    const header = sheet.rows[0] ?? [];
    const indexOf = new Map<string, number>();
    header.forEach((cell, index) => {
      const given = typeof cell === 'string' ? cell.trim() : '';
      if (given !== '') indexOf.set(given, index);
    });
    // A sheet is read by its headers, never by position; a column that is gone is said once, and the rest of the sheet is still read.
    const columns = spec.columns.map((column) => ({ column, at: indexOf.get(column.header) ?? [...indexOf.entries()].find(([given]) => norm(plainHeader(given)) === norm(plainHeader(column.header)))?.[1] }));
    for (const { column, at } of columns) {
      if (at === undefined && column.needed) problems.push({ sheet: sheet.name, row: 1, column: column.header, message: `The sheet has no column "${column.header}". It is read by its headers, never by position.` });
    }
    const keyAt = indexOf.get('Row key') ?? 0;
    const rows: { rowNumber: number; key: string; cells: Map<string, Cell> }[] = [];
    sheet.rows.slice(1).forEach((cells, offset) => {
      const key = text(cells[keyAt] ?? null) ?? '';
      if (isExample(cells[keyAt] ?? null)) return;
      const mapped = new Map<string, Cell>();
      let any = false;
      for (const { column, at } of columns) {
        const cell = at === undefined ? null : (cells[at] ?? null);
        mapped.set(column.header, cell);
        if (!blank(cell)) any = true;
      }
      // A row whose visible cells are all empty is the pre-filled key and nothing else.
      if (!any) return;
      rows.push({ rowNumber: offset + 2, key, cells: mapped });
    });
    return { sheet: spec, sheetName: sheet.name, rows };
  };

  const ref = (key: string, suffix = ''): string | null => (key === '' ? null : `${marker.id}:${key}${suffix}`);
  const push = (entity: string, rowNumber: number, key: string, values: Values, names: Record<string, string | null>, suffix = ''): void => {
    out.push({ entity, row: { sheetRow: rowNumber, ref: ref(key, suffix), names, values } });
  };

  // ── Spending ────────────────────────────────────────────────────────────────────────────────────────
  const spending = rowsOf('Spending');
  for (const { rowNumber, key, cells } of spending?.rows ?? []) {
    const ctx: Ctx = { sheet: spending!.sheet, sheetName: spending!.sheetName, rowNumber, cells, problems };
    const currency = currencyOf(ctx);
    const date = dateOf(ctx, 'Date *', true);
    const amount = moneyOf(ctx, 'Amount *', currency, true);
    const category = textOf(ctx, 'Category * ▾', true);
    const who = textOf(ctx, 'Who * ▾', true);
    const method = choice(ctx, 'How paid ▾', METHOD_CHOICES);
    const isPrivate = yesNo(ctx, 'Private ▾');
    push(
      'expense_txn',
      rowNumber,
      key,
      { id: null, member_id: null, category_id: null, txn_date: date, amount_minor: amount, currency, payee: textOf(ctx, 'Paid to'), method, note: textOf(ctx, 'Note'), visibility: isPrivate ? 'personal' : 'household', voided_at: null },
      { member_id: who, category_id: category },
    );
  }

  // ── Money in: not taken by an upload yet ──────────────────────────────────────────────────────────────
  const moneyIn = rowsOf('Money in');
  for (const { rowNumber } of moneyIn?.rows ?? []) {
    problems.push({
      sheet: moneyIn!.sheetName,
      row: rowNumber,
      column: 'Date *',
      message: 'An upload does not take money in yet. Add it in the app (Money, then + Money in), and leave this sheet empty.',
    });
  }

  // ── Monthly plan ────────────────────────────────────────────────────────────────────────────────────
  const plan = rowsOf('Monthly plan');
  for (const { rowNumber, key, cells } of plan?.rows ?? []) {
    const ctx: Ctx = { sheet: plan!.sheet, sheetName: plan!.sheetName, rowNumber, cells, problems };
    const category = textOf(ctx, 'Category * ▾', true);
    const fy = fyOf(ctx, 'Financial year * ▾');
    const month = moneyOf(ctx, 'Per month', 'INR');
    const year = moneyOf(ctx, 'Per year', 'INR');
    if (month === null && year === null) problems.push({ sheet: plan!.sheetName, row: rowNumber, column: 'Per month', message: 'Fill Per month or Per year, or both.' });
    const base = { id: null, category_id: null, fy, period: null, currency: 'INR', member_id: null };
    if (month !== null) push('budget', rowNumber, key, { ...base, cadence: 'monthly', planned_minor: month }, { category_id: category }, ':month');
    if (year !== null) push('budget', rowNumber, key, { ...base, cadence: 'yearly', planned_minor: year }, { category_id: category }, ':year');
  }

  // ── Investments, and the value beside each ───────────────────────────────────────────────────────────
  const investments = rowsOf('Investments');
  for (const { rowNumber, key, cells } of investments?.rows ?? []) {
    const ctx: Ctx = { sheet: investments!.sheet, sheetName: investments!.sheetName, rowNumber, cells, problems };
    const currency = currencyOf(ctx);
    const name = textOf(ctx, 'Name *', true);
    const type = choice(ctx, 'Type * ▾', INVESTMENT_TYPES, true);
    const whose = textOf(ctx, 'Whose * ▾', true);
    const units = numberOf(ctx, 'Units');
    const keptFor = choice(ctx, 'Kept for ▾', KEPT_FOR_CHOICES);
    const abroad = yesNo(ctx, 'Held outside India ▾');
    const latest = moneyOf(ctx, 'Latest value', currency);
    const valueDate = dateOf(ctx, 'Value as on');
    const noUnits = type !== null && (type.kind === 'deposit' || type.kind === 'retirement');
    const quantity = units ?? (noUnits ? '1' : null);
    if (name !== null && whose !== null) fileInvestments.push({ name, label: `${name} (${whose})` });
    push(
      'holding',
      rowNumber,
      key,
      {
        id: null,
        member_id: null,
        instrument_id: null,
        quantity,
        cost_minor: moneyOf(ctx, 'Amount invested', currency),
        visibility: 'household',
        opened_on: dateOf(ctx, 'Bought on'),
        folio_last4: null,
        stated_quantity: null,
        stated_as_at: null,
        stated_source_batch_id: null,
        earmark: keptFor ?? 'none',
        status: null,
        archived_at: null,
        name,
        kind: type?.kind ?? null,
        symbol: null,
        isin: null,
        currency,
        exposure_currency: currency,
        is_foreign_asset: abroad ? 'true' : 'false',
        tax_asset_class: null,
        price_source: null,
        price_external_id: null,
        scheme: type?.scheme ?? null,
        retirement_type: type?.retirement ?? null,
      },
      { member_id: whose },
    );
    if (latest !== null) {
      if (valueDate === null && blank(cells.get('Value as on') ?? null)) {
        problems.push({ sheet: investments!.sheetName, row: rowNumber, column: 'Value as on', message: 'Give the date of the latest value.' });
      }
      if (name !== null && whose !== null && valueDate !== null) {
        push('valuation_snapshot', rowNumber, key, { id: null, holding_id: null, as_of_date: valueDate, quantity: quantity ?? '1', value_minor: latest, currency, source: 'manual', note: null }, { holding_id: `${name} (${whose})` }, ':value');
      }
    }
  }

  // ── Purchases and sales ───────────────────────────────────────────────────────────────────────────────
  const trades = rowsOf('Purchases and sales');
  const ambiguous = new Set<string>();
  for (const { rowNumber, key, cells } of trades?.rows ?? []) {
    const ctx: Ctx = { sheet: trades!.sheet, sheetName: trades!.sheetName, rowNumber, cells, problems };
    const currency = currencyOf(ctx);
    const date = dateOf(ctx, 'Date *', true);
    const label = textOf(ctx, 'Investment * ▾', true);
    const what = choice(ctx, 'What happened * ▾', TRADE_CHOICES, true);
    const units = numberOf(ctx, 'Units *', true);
    const amount = moneyOf(ctx, 'Amount', currency);
    const note = textOf(ctx, 'Note');
    if (label !== null && duplicates.has(norm(label)) && !ambiguous.has(norm(label))) {
      ambiguous.add(norm(label));
      problems.push({
        sheet: trades!.sheetName,
        row: rowNumber,
        column: 'Investment * ▾',
        message: `"${label}" is two of your investments, with the same name and the same owner. Rename one in the app so this file can tell them apart, then download a fresh template.`,
      });
    }
    if (what === null) continue;
    const money = amount ?? (what.kind === 'bonus' || what.kind === 'split' || what.kind === 'gift' || what.kind === 'transfer' || what.kind === 'esop' ? '0' : null);
    if (money === null) problems.push({ sheet: trades!.sheetName, row: rowNumber, column: 'Amount', message: 'This is needed for a purchase, a sale, a redemption or a maturity.' });
    if (what.table === 'lot') {
      push('lot', rowNumber, key, { id: null, holding_id: null, acquired_on: date, quantity: units, cost_minor: money, currency, kind: what.kind, note, source_batch_id: null, source_hash: null }, { holding_id: label });
    } else {
      push('disposal', rowNumber, key, { id: null, holding_id: null, disposed_on: date, quantity: units, proceeds_minor: money, currency, kind: what.kind, note, source_batch_id: null, source_hash: null }, { holding_id: label });
    }
  }

  // ── Deposits: by the name on Investments, which has no Whose beside it ────────────────────────────────
  const deposits = rowsOf('Deposits');
  for (const { rowNumber, key, cells } of deposits?.rows ?? []) {
    const ctx: Ctx = { sheet: deposits!.sheet, sheetName: deposits!.sheetName, rowNumber, cells, problems };
    const name = textOf(ctx, 'Deposit *', true);
    const principal = moneyOf(ctx, 'Principal *', 'INR', true);
    const rate = numberOf(ctx, 'Interest rate % *', true);
    const start = dateOf(ctx, 'Start date *', true);
    const maturity = dateOf(ctx, 'Maturity date *', true);
    const compounding = choice(ctx, 'Interest added ▾', INTEREST_CHOICES);
    if (name === null) continue;
    const candidates = [...new Set([...fileInvestments.map((entry) => entry.label), ...context.investments])].filter((label) => norm(label).startsWith(`${norm(name)} (`) && norm(label).endsWith(')'));
    const exact = candidates.filter((label) => norm(label).slice(norm(name).length + 2).indexOf('(') === -1);
    const pool = exact.length > 0 ? exact : candidates;
    if (pool.length === 0) {
      problems.push({ sheet: deposits!.sheetName, row: rowNumber, column: 'Deposit *', message: `No investment is called "${name}". Write the deposit's name as it is on the Investments sheet, or in the app.` });
      continue;
    }
    if (pool.length > 1) {
      problems.push({ sheet: deposits!.sheetName, row: rowNumber, column: 'Deposit *', message: `"${name}" is more than one investment: ${pool.join(' and ')}. Rename one so this file can tell them apart.` });
      continue;
    }
    push(
      'fixed_income_terms',
      rowNumber,
      key,
      {
        holding_id: null,
        kind: 'deposit',
        principal_minor: principal,
        currency: 'INR',
        rate_pct: rate,
        start_date: start,
        maturity_date: maturity,
        compounding,
        coupon_frequency: null,
        rating: null,
        auto_renew: 'false',
        renewal_rate_pct: null,
        institution: textOf(ctx, 'Bank'),
        account_last4: textOf(ctx, 'Account last 4'),
        repay_mode: null,
        note: null,
      },
      { holding_id: pool[0] ?? null },
    );
  }

  // ── Insurance ─────────────────────────────────────────────────────────────────────────────────────────
  const insurance = rowsOf('Insurance');
  for (const { rowNumber, key, cells } of insurance?.rows ?? []) {
    const ctx: Ctx = { sheet: insurance!.sheet, sheetName: insurance!.sheetName, rowNumber, cells, problems };
    push(
      'insurance_policy',
      rowNumber,
      key,
      {
        id: null,
        name: textOf(ctx, 'Policy *', true),
        kind: choice(ctx, 'Type * ▾', INSURANCE_CHOICES, true),
        insurer: textOf(ctx, 'Insurer'),
        policy_last4: textOf(ctx, 'Policy no. last 4'),
        premium_minor: moneyOf(ctx, 'Premium *', 'INR', true),
        currency: 'INR',
        cadence: choice(ctx, 'Paid * ▾', OFTEN_CHOICES, true),
        cover_minor: moneyOf(ctx, 'Cover amount', 'INR'),
        started_on: null,
        renewal_on: dateOf(ctx, 'Next renewal'),
        premiums_end_on: null,
        linked_holding_id: null,
        member_id: null,
        status: null,
        lapsed_at: null,
        note: null,
      },
      { member_id: textOf(ctx, 'Covers ▾') },
    );
  }

  // ── Loans ─────────────────────────────────────────────────────────────────────────────────────────────
  const loans = rowsOf('Loans');
  for (const { rowNumber, key, cells } of loans?.rows ?? []) {
    const ctx: Ctx = { sheet: loans!.sheet, sheetName: loans!.sheetName, rowNumber, cells, problems };
    push(
      'liability',
      rowNumber,
      key,
      {
        id: null,
        name: textOf(ctx, 'Loan *', true),
        kind: choice(ctx, 'Type * ▾', LOAN_CHOICES, true),
        instalment_minor: moneyOf(ctx, 'EMI *', 'INR', true),
        currency: 'INR',
        cadence: choice(ctx, 'Paid * ▾', OFTEN_CHOICES, true),
        member_id: null,
        outstanding_minor: moneyOf(ctx, 'Outstanding', 'INR'),
        outstanding_as_of: dateOf(ctx, 'Outstanding as on'),
        status: null,
        closed_at: null,
        note: null,
      },
      { member_id: textOf(ctx, 'Whose ▾') },
    );
  }

  // ── Property ──────────────────────────────────────────────────────────────────────────────────────────
  const property = rowsOf('Property');
  for (const { rowNumber, key, cells } of property?.rows ?? []) {
    const ctx: Ctx = { sheet: property!.sheet, sheetName: property!.sheetName, rowNumber, cells, problems };
    const share = numberOf(ctx, 'Your share %');
    push(
      'property',
      rowNumber,
      key,
      {
        id: null,
        member_id: null,
        kind: choice(ctx, 'Type * ▾', PROPERTY_CHOICES, true),
        label: textOf(ctx, 'Property *', true),
        currency: 'INR',
        purchase_date: dateOf(ctx, 'Bought on'),
        purchase_cost_minor: moneyOf(ctx, 'Price paid', 'INR'),
        stamp_duty_minor: moneyOf(ctx, 'Stamp duty', 'INR'),
        registration_minor: moneyOf(ctx, 'Registration', 'INR'),
        co_owner_share_pct: share,
        is_self_occupied: yesNo(ctx, 'You live in it ▾') ? 'true' : 'false',
        linked_liability_id: null,
        visibility: null,
        status: null,
        archived_at: null,
        note: null,
      },
      { member_id: textOf(ctx, 'Whose * ▾', true) },
    );
  }

  const bySheet: Record<string, SheetRow[]> = {};
  for (const { entity, row } of out) (bySheet[entity] ??= []).push(row);
  return { tables: {} as Readonly<Record<string, readonly Row[]>>, sheets: bySheet, problems };
}
