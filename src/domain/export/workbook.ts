/**
 * The workbook as a plain model: the full export going out, and the same sheets coming back.
 *
 * `buildWorkbook` turns the rows of every entity into sheets of cells, and `readWorkbook` turns sheets of cells (however a person
 * has been at them in Excel) into rows again, in the same text the database uses. The two are held to each other by a round-trip
 * test: what is written reads back to exactly the same rows. A library writes and reads the actual file (`src/repo`'s caller does
 * that); nothing here knows one, so all of it is testable without a file.
 *
 * A sheet is read by its header names and never by position, so a column that has been moved is found and a column that has been
 * lost is said, not misread. A column the template does not know (a name written beside an id, a note of the person's own) is
 * ignored. A wrong cell is a problem that names the sheet, the row and the column and says what is wrong; the rest of the sheet
 * is still read, so one preview lists every problem and not the first.
 */

import {
  CellError,
  canonicalDecimal,
  cellToBoolean,
  cellToDate,
  cellToDecimalText,
  cellToInteger,
  cellToMinorText,
  cellToTimestamp,
  decimalToCell,
  moneyToCell,
  type Cell,
} from './cells.ts';
import { minorUnitExponent } from '../../lib/money.ts';
import { ENTITIES, ENTITY_BY_KEY, SHEETED, TEMPLATE_VERSION, headerOf, sheetColumns, type Column, type Entity, type Lookup, type Row } from './entities.ts';

export interface ExportMeta {
  /** An instant, as UTC. */
  readonly exportedAt: string;
  readonly householdName: string;
  readonly baseCurrency: string;
  /** A demo household's file says on its first sheet that its figures are illustrative. */
  readonly demo: boolean;
}

export interface SheetModel {
  readonly name: string;
  /** The entity it holds, or null for the About sheet. */
  readonly entity: string | null;
  readonly headers: readonly string[];
  /** A number format for each header (an amount is shown with its places), or null. */
  readonly formats: readonly (string | null)[];
  readonly rows: readonly (readonly Cell[])[];
  /** Written for reading and for a backup; the upload does not accept rows from it. */
  readonly readOnly: boolean;
}

export interface Problem {
  readonly sheet: string;
  /** The row in the sheet, counting the header as row 1. */
  readonly row: number;
  readonly column: string;
  readonly message: string;
}

export interface BuiltWorkbook {
  readonly workbook: { readonly sheets: readonly SheetModel[] };
  readonly problems: readonly Problem[];
}

export interface ReadSheet {
  readonly name: string;
  /** The first row is the headers. */
  readonly rows: readonly (readonly Cell[])[];
}

const ABOUT = 'About';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeLookup(tables: Readonly<Record<string, readonly Row[]>>): Lookup {
  const byEntity = new Map<string, Map<string, Row>>();
  for (const [entity, rows] of Object.entries(tables)) {
    const index = new Map<string, Row>();
    for (const row of rows) {
      const key = row['id'] ?? null;
      if (key !== null) index.set(key, row);
    }
    byEntity.set(entity, index);
  }
  return (entity, id) => (id === null || id === undefined ? undefined : byEntity.get(entity)?.get(id));
}

/** The header of the name written beside a column that points at another record: member_id gets member_name. */
function nameHeaderOf(column: Column): string | null {
  if (column.ref === undefined || column.ref === 'household') return null;
  const target = ENTITY_BY_KEY.get(column.ref);
  if (target?.label === undefined) return null;
  return `${column.key.replace(/_id$/, '')}_name`;
}

function currencyOf(column: Column, row: Row, lookup: Lookup): string | null {
  const source = column.currency;
  if (source === undefined) return null;
  if ('via' in source) return lookup(source.entity, row[source.via])?.[source.column] ?? null;
  return row[source.column] ?? null;
}

/** The places an amount is shown with in Excel: the most any of the sheet's currencies carries, so no amount is shown rounded. */
function moneyFormat(column: Column, rows: readonly Row[], lookup: Lookup): string {
  let places = 0;
  let any = false;
  for (const row of rows) {
    if (row[column.key] === null || row[column.key] === undefined) continue;
    const currency = currencyOf(column, row, lookup);
    if (currency === null) continue;
    try {
      places = Math.max(places, minorUnitExponent(currency));
      any = true;
    } catch {
      // A code that is not a currency is a problem when the cell is written; the format is left at two places.
    }
  }
  const decimals = any ? places : 2;
  return decimals === 0 ? '#,##0' : `#,##0.${'0'.repeat(decimals)}`;
}

function toCell(column: Column, value: string | null, row: Row, lookup: Lookup): Cell {
  if (value === null) return null;
  switch (column.kind) {
    case 'money': {
      const currency = currencyOf(column, row, lookup);
      if (currency === null) throw new CellError('This amount has no currency to write it in.');
      return moneyToCell(value, currency);
    }
    case 'decimal':
      return decimalToCell(value);
    case 'integer': {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new CellError(`${value} is too large for a spreadsheet cell to hold exactly.`);
      return number;
    }
    case 'boolean':
      return value === 'true';
    default:
      return value;
  }
}

export function buildWorkbook(tables: Readonly<Record<string, readonly Row[]>>, meta: ExportMeta): BuiltWorkbook {
  const lookup = makeLookup(tables);
  const problems: Problem[] = [];

  const about: SheetModel = {
    name: ABOUT,
    entity: null,
    headers: ['Item', 'Value'],
    formats: [null, null],
    readOnly: true,
    rows: [
      ['Template version', TEMPLATE_VERSION],
      ['Generated by', 'Family Finance Buddy'],
      ['Exported at', meta.exportedAt],
      ['Household', meta.householdName],
      ['Base currency', meta.baseCurrency],
      ['Sample figures', meta.demo ? 'Yes — these are illustrative, not a real household’s' : 'No'],
      ['Amounts', 'Written in major units (rupees, not paise), with the currency in the column beside them.'],
      ['Read by', 'The headers on the first row of each sheet, never by position. Columns ending in _name are for reading and are ignored.'],
    ],
  };

  const sheets: SheetModel[] = [about];
  for (const entity of SHEETED) {
    const sheetName = entity.sheet ?? entity.key;
    const columns = sheetColumns(entity);
    const joinedRef = entity.joins?.entity;
    const headers: string[] = [];
    const formats: (string | null)[] = [];
    const writers: ((row: Row, rowNumber: number) => Cell)[] = [];

    // A holding's sheet also carries what its instrument is, so each row is read as the two together.
    const merged = (tables[entity.key] ?? []).map((row): Row => {
      const joined = entity.joins === undefined ? undefined : lookup(entity.joins.entity, row[entity.joins.via]);
      return joined === undefined ? row : { ...joined, ...row };
    });

    for (const column of columns) {
      const header = headerOf(column);
      headers.push(header);
      formats.push(column.kind === 'money' ? moneyFormat(column, merged, lookup) : null);
      writers.push((row, rowNumber) => {
        try {
          return toCell(column, row[column.key] ?? null, row, lookup);
        } catch (error) {
          if (!(error instanceof CellError)) throw error;
          problems.push({ sheet: sheetName, row: rowNumber, column: header, message: error.message });
          return null;
        }
      });

      // The name of the instrument is a column of the sheet already, so it is not written a second time beside its id.
      const nameHeader = column.ref === joinedRef ? null : nameHeaderOf(column);
      if (nameHeader !== null && column.ref !== undefined) {
        const target = ENTITY_BY_KEY.get(column.ref);
        headers.push(nameHeader);
        formats.push(null);
        writers.push((row) => target?.label?.(lookup(column.ref as string, row[column.key]) ?? {}, lookup) ?? null);
      }

    }

    const rows = merged.map((row, index) => writers.map((write) => write(row, index + 2)));
    sheets.push({ name: sheetName, entity: entity.key, headers, formats, rows, readOnly: entity.upload === 'none' });
  }

  return { workbook: { sheets }, problems };
}

// ───────────────────────────────────────────────────────────────── reading

function blank(cell: Cell | undefined): boolean {
  return cell === undefined || cell === null || (typeof cell === 'string' && cell.trim() === '');
}

function textOf(cell: Cell): string | null {
  if (blank(cell)) return null;
  if (cell instanceof Date) return cellToTimestamp(cell);
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (typeof cell === 'number') return cellToDecimalText(cell);
  return String(cell);
}

/** A cell as the database's text for a column of this kind, or an error saying what is wrong with it. Money is read apart. */
function fromCell(column: Column, cell: Cell): string | null {
  switch (column.kind) {
    case 'id': {
      const text = textOf(cell);
      if (text === null) return null;
      if (!UUID.test(text.trim())) throw new CellError(`${JSON.stringify(text)} is not an id. Leave it empty for a new row.`);
      return text.trim().toLowerCase();
    }
    case 'currency': {
      const text = textOf(cell);
      if (text === null) return null;
      if (!/^[A-Za-z]{3}$/.test(text.trim())) throw new CellError(`${JSON.stringify(text)} is not a three-letter currency code.`);
      return text.trim().toUpperCase();
    }
    case 'date':
      return cellToDate(cell);
    case 'timestamp':
      return cellToTimestamp(cell);
    case 'decimal':
      return cellToDecimalText(cell);
    case 'integer':
      return cellToInteger(cell);
    case 'boolean':
      return cellToBoolean(cell);
    case 'money':
      return null;
    default:
      return textOf(cell);
  }
}

interface PendingRow {
  readonly entity: Entity;
  readonly sheet: string;
  readonly rowNumber: number;
  readonly cells: readonly Cell[];
  readonly indexOf: ReadonlyMap<string, number>;
  readonly values: Record<string, string | null>;
}

export interface ReadWorkbook {
  readonly tables: Readonly<Record<string, readonly Row[]>>;
  readonly problems: readonly Problem[];
}

function sheetNamed(sheets: readonly ReadSheet[], name: string): ReadSheet | undefined {
  const wanted = name.trim().toLowerCase();
  return sheets.find((sheet) => sheet.name.trim().toLowerCase() === wanted);
}

export function readWorkbook(sheets: readonly ReadSheet[]): ReadWorkbook {
  const aboutSheet = sheetNamed(sheets, ABOUT);
  const versionRow = aboutSheet?.rows.find((row) => typeof row[0] === 'string' && row[0].trim().toLowerCase() === 'template version');
  if (versionRow === undefined) {
    return {
      tables: {},
      problems: [{ sheet: ABOUT, row: 1, column: 'Template version', message: 'This workbook says nothing of its template version, so it cannot be read safely. Download a fresh template or export.' }],
    };
  }
  const version = Number(versionRow[1]);
  if (version !== TEMPLATE_VERSION) {
    return {
      tables: {},
      problems: [
        {
          sheet: ABOUT,
          row: 1,
          column: 'Template version',
          message: `This workbook is template version ${String(versionRow[1])}; this app reads version ${String(TEMPLATE_VERSION)}. Download a fresh template or export.`,
        },
      ],
    };
  }

  const problems: Problem[] = [];
  const pending: PendingRow[] = [];
  const tables: Record<string, Row[]> = {};

  for (const entity of SHEETED) {
    const sheet = sheetNamed(sheets, entity.sheet ?? entity.key);
    if (sheet === undefined) continue;
    tables[entity.key] = [];
    if (entity.joins !== undefined) tables[entity.joins.entity] = [];

    const header = sheet.rows[0] ?? [];
    const indexOf = new Map<string, number>();
    let structural = false;
    header.forEach((cell, index) => {
      const name = typeof cell === 'string' ? cell.trim() : '';
      if (name === '') return;
      if (indexOf.has(name)) {
        problems.push({ sheet: sheet.name, row: 1, column: name, message: `The column "${name}" appears twice, so it cannot be read.` });
        structural = true;
        return;
      }
      indexOf.set(name, index);
    });
    for (const column of sheetColumns(entity)) {
      if (!indexOf.has(headerOf(column))) {
        problems.push({ sheet: sheet.name, row: 1, column: headerOf(column), message: `The sheet has no column "${headerOf(column)}". It is read by its headers, never by position.` });
        structural = true;
      }
    }
    if (structural) continue;

    sheet.rows.slice(1).forEach((cells, offset) => {
      if (cells.every(blank)) return;
      const values: Record<string, string | null> = {};
      const rowNumber = offset + 2;
      for (const column of sheetColumns(entity)) {
        const header = headerOf(column);
        if (column.kind === 'money') continue;
        try {
          values[column.key] = fromCell(column, cells[indexOf.get(header) ?? -1] ?? null);
        } catch (error) {
          if (!(error instanceof CellError)) throw error;
          problems.push({ sheet: sheet.name, row: rowNumber, column: header, message: error.message });
          values[column.key] = null;
        }
      }
      pending.push({ entity, sheet: sheet.name, rowNumber, cells, indexOf, values });
    });
  }

  // Money last, because an amount can be in the currency of the record it points at, which has been read by now.
  const lookup = makeLookup(
    Object.fromEntries(
      ENTITIES.map((entity) => [entity.key, pending.filter((row) => row.entity.key === entity.key).map((row) => row.values as Row)]),
    ),
  );
  for (const row of pending) {
    for (const column of sheetColumns(row.entity)) {
      if (column.kind !== 'money') continue;
      const header = headerOf(column);
      const cell = row.cells[row.indexOf.get(header) ?? -1] ?? null;
      try {
        if (blank(cell)) {
          row.values[column.key] = null;
          continue;
        }
        const currency = currencyOf(column, row.values, lookup);
        if (currency === null) throw new CellError('This amount has no currency to read it in: fill the currency column.');
        row.values[column.key] = cellToMinorText(cell, currency);
      } catch (error) {
        if (!(error instanceof CellError)) throw error;
        problems.push({ sheet: row.sheet, row: row.rowNumber, column: header, message: error.message });
        row.values[column.key] = null;
      }
    }
    tables[row.entity.key]?.push(pick(row.entity.columns, row.values));
    // The instrument written beside a holding is one row of its own, however many holdings name it.
    const joins = row.entity.joins;
    const joined = joins === undefined ? undefined : ENTITY_BY_KEY.get(joins.entity);
    if (joins !== undefined && joined !== undefined) {
      const instrumentId = row.values[joins.via] ?? null;
      const known = tables[joined.key] ?? [];
      if (instrumentId === null || !known.some((existing) => existing['id'] === instrumentId)) {
        known.push({ id: instrumentId, ...pick(joined.columns.filter((column) => column.key !== 'id'), row.values) });
        tables[joined.key] = known;
      }
    }
  }

  return { tables, problems };
}

function pick(columns: readonly Column[], values: Readonly<Record<string, string | null>>): Row {
  const out: Record<string, string | null> = {};
  for (const column of columns) out[column.key] = values[column.key] ?? null;
  return out;
}

/** A row in the one form it can be compared in: numbers without trailing zeros, instants in UTC, amounts as integers. */
export function canonicalRow(entity: Entity, row: Row): Row {
  const out: Record<string, string | null> = {};
  for (const column of entity.columns) {
    const value = row[column.key] ?? null;
    if (value === null) {
      out[column.key] = null;
      continue;
    }
    switch (column.kind) {
      case 'decimal':
      case 'integer':
        out[column.key] = canonicalDecimal(value);
        break;
      case 'money':
        out[column.key] = BigInt(value).toString();
        break;
      case 'timestamp':
        out[column.key] = cellToTimestamp(value);
        break;
      case 'currency':
        out[column.key] = value.toUpperCase();
        break;
      default:
        out[column.key] = value;
    }
  }
  return out;
}
