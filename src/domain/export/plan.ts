/**
 * From a workbook a person has edited to a plan of what an upload would do, before anything is written.
 *
 * `readWorkbook` has already said what each cell is. This matches the rows to what the household holds (by id, by the person's own
 * reference, or by the name written where the id is empty), checks them against what the database will require, and compares each
 * with the row it would change. The result is what the preview shows (rows to create, rows to change and in which columns, rows
 * left alone, and every problem by sheet, row and column) and, when there are no problems, the payload `apply_template` takes.
 *
 * Nothing here is random or reads a clock: a new row's id comes from `newId`, which the caller supplies. A row is never deleted by
 * an upload: one missing from the sheet is simply not mentioned. Pure; no I/O.
 */

import { COLUMN_RULES } from './rules.generated.ts';
import {
  ENTITY_BY_KEY,
  UPLOAD_ORDER,
  headerOf,
  type Column,
  type Entity,
  type Lookup,
  type Row,
} from './entities.ts';
import { canonicalRow, type Problem, type ReadWorkbook, type RefMap, type SheetRow } from './workbook.ts';

export interface UploadInput {
  readonly read: ReadWorkbook;
  /** What the household holds now, by entity: the rows the export reads. */
  readonly existing: Readonly<Record<string, readonly Row[]>>;
  /** The references the household has already given rows. */
  readonly existingRefs: RefMap;
  /** A fresh id for a row that has none. Supplied, because this module is pure. */
  readonly newId: () => string;
}

export interface Change {
  readonly column: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface PlannedRow {
  readonly entity: string;
  readonly sheet: string;
  readonly sheetRow: number;
  readonly action: 'create' | 'update';
  readonly key: string;
  readonly ref: string | null;
  /** The columns to write, in the database's text. A column left out takes its default or is left as it is. */
  readonly values: Readonly<Record<string, string | null>>;
  /** For an update, what changes. */
  readonly changes: readonly Change[];
}

export interface Warning {
  readonly sheet: string;
  readonly row: number;
  readonly message: string;
}

export interface UploadPlan {
  readonly rows: readonly PlannedRow[];
  /** Rows the sheets carry that are the same as what the household holds, by entity. They are not written. */
  readonly unchanged: Readonly<Record<string, number>>;
  readonly problems: readonly Problem[];
  readonly warnings: readonly Warning[];
}

type Values = Record<string, string | null>;

interface Resolved {
  readonly id: string;
  readonly existing: boolean;
}

const blank = (value: string | null | undefined): boolean => value === null || value === undefined || value.trim() === '';

const norm = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** The sheet a message is about. */
const sheetOf = (entity: Entity): string => entity.sheet ?? entity.key;

export function planUpload(input: UploadInput): UploadPlan {
  const problems: Problem[] = [];
  const warnings: Warning[] = [];
  const planned: PlannedRow[] = [];
  const unchanged: Record<string, number> = {};

  // Every record the upload can point at: what the household holds, and what this upload is about to create.
  const records = new Map<string, Map<string, Row>>();
  const have = (entity: string): Map<string, Row> => {
    let held = records.get(entity);
    if (held === undefined) {
      held = new Map();
      records.set(entity, held);
    }
    return held;
  };
  for (const [entity, rows] of Object.entries(input.existing)) {
    for (const row of rows) {
      const id = row['id'] ?? row[ENTITY_BY_KEY.get(entity)?.rowKey[0] ?? 'id'] ?? null;
      if (id !== null) have(entity).set(id, row);
    }
  }
  const existingIds = new Map<string, Set<string>>();
  for (const [entity, held] of records) existingIds.set(entity, new Set(held.keys()));

  const lookup: Lookup = (entity, id) => (id === null || id === undefined ? undefined : records.get(entity)?.get(id));

  const labelOf = (entity: string, row: Row): string | null => ENTITY_BY_KEY.get(entity)?.label?.(row, lookup) ?? null;

  /** Who a name means: the records of that entity whose label is that, existing or about to be created. */
  const byName = (entity: string, name: string): string[] => {
    const wanted = norm(name);
    const found: string[] = [];
    for (const [id, row] of records.get(entity) ?? []) {
      const label = labelOf(entity, row);
      if (label !== null && norm(label) === wanted) found.push(id);
    }
    return found;
  };

  // The references the household already has, the other way round: which row each stands for.
  const refToKey = new Map<string, Map<string, string>>();
  const keyToRef = new Map<string, Map<string, string>>();
  for (const [entity, byKey] of Object.entries(input.existingRefs)) {
    const forward = new Map<string, string>();
    const back = new Map<string, string>();
    for (const [key, ref] of Object.entries(byKey)) {
      forward.set(ref, key);
      back.set(key, ref);
    }
    refToKey.set(entity, forward);
    keyToRef.set(entity, back);
  }

  const instrumentByNaturalKey = new Map<string, string>();
  const naturalKey = (row: Values | Row): string => `${norm(row['name'] ?? '')}|${norm(row['kind'] ?? '')}|${(row['currency'] ?? '').toUpperCase()}`;
  for (const [id, row] of records.get('instrument') ?? []) {
    const key = naturalKey(row);
    instrumentByNaturalKey.set(instrumentByNaturalKey.has(key) ? `${key}|duplicate` : key, id);
  }
  const instrumentsInThisFile = new Map<string, string>();

  for (const entityKey of UPLOAD_ORDER) {
    const entity = ENTITY_BY_KEY.get(entityKey);
    if (entity === undefined || entity.upload !== 'rows') continue;
    const rows = input.read.sheets[entityKey];
    if (rows === undefined) continue;
    const sheet = sheetOf(entity);
    const keyColumn = entity.rowKey[0] ?? 'id';
    const rules = COLUMN_RULES[entityKey] ?? {};
    const seenKeys = new Map<string, number>();
    const seenRefs = new Map<string, number>();
    const joined = entity.joins === undefined ? undefined : ENTITY_BY_KEY.get(entity.joins.entity);

    for (const row of rows) {
      const where = (column: string, message: string): void => {
        problems.push({ sheet, row: row.sheetRow, column, message });
      };
      const before = problems.length;
      const values: Values = { ...row.values };

      // ── the columns that point at other records ──────────────────────────────────────────────────────
      for (const column of entity.columns) {
        if (column.kind !== 'id' || column.ref === undefined) continue;
        if (column.ref === entity.joins?.entity) continue; // the instrument is resolved below, with its fields
        const target = ENTITY_BY_KEY.get(column.ref);
        if (target === undefined || target.key === 'household') continue;
        const given = row.values[column.key] ?? null;
        const named = row.names[column.key] ?? null;
        if (given !== null) {
          if (!(records.get(column.ref)?.has(given) ?? false)) where(headerOf(column), `There is no ${column.ref.replace(/_/g, ' ')} with this id. Clear it and write its name beside it instead.`);
          continue;
        }
        if (named === null) continue;
        const found = byName(column.ref, named);
        if (found.length === 1) values[column.key] = found[0] ?? null;
        else if (found.length === 0) {
          const hint = column.ref === entityKey ? ' A parent must be written above the rows under it.' : '';
          where(`${column.key.replace(/_id$/, '')}_name`, `No ${column.ref.replace(/_/g, ' ')} is called "${named}".${hint}`);
        }
        else where(`${column.key.replace(/_id$/, '')}_name`, `${String(found.length)} ${column.ref.replace(/_/g, ' ')} records are called "${named}": write the id, or make the names differ.`);
      }

      // ── a holding's instrument, written beside it ───────────────────────────────────────────────────
      let instrumentPlan: { id: string; create: boolean; row: Values } | null = null;
      if (joined !== undefined && entity.joins !== undefined) {
        const via = entity.joins.via;
        const givenInstrument = row.values[via] ?? null;
        const instrumentValues: Values = {};
        for (const column of joined.columns) if (column.key !== 'id') instrumentValues[column.key] = row.values[column.key] ?? null;
        if (givenInstrument !== null) {
          if (!(records.get(joined.key)?.has(givenInstrument) ?? false)) where(via, 'There is no instrument with this id. Clear it, and the name and kind beside it will find or make one.');
          else instrumentPlan = { id: givenInstrument, create: false, row: instrumentValues };
          values[via] = givenInstrument;
        } else if (blank(instrumentValues['name'])) {
          where('name', 'A holding needs a name: what it is.');
        } else {
          const key = naturalKey(instrumentValues);
          const existing = instrumentByNaturalKey.get(key);
          if (instrumentByNaturalKey.has(`${key}|duplicate`)) {
            where('name', `More than one instrument is called "${instrumentValues['name'] ?? ''}" (${instrumentValues['kind'] ?? ''}, ${instrumentValues['currency'] ?? ''}): write the instrument id.`);
          } else if (existing !== undefined) {
            values[via] = existing;
            instrumentPlan = { id: existing, create: false, row: instrumentValues };
          } else if (instrumentsInThisFile.has(key)) {
            values[via] = instrumentsInThisFile.get(key) ?? null;
            instrumentPlan = { id: instrumentsInThisFile.get(key) ?? '', create: false, row: instrumentValues };
          } else {
            const id = input.newId();
            instrumentsInThisFile.set(key, id);
            values[via] = id;
            instrumentPlan = { id, create: true, row: instrumentValues };
          }
        }
      }

      // ── which row this is ─────────────────────────────────────────────────────────────────────────────
      let resolved: Resolved | null = null;
      const given = row.values[keyColumn] ?? values[keyColumn] ?? null;
      if (keyColumn !== 'id') {
        // Keyed by the holding it belongs to: that holding has one row, and the row is there or it is not.
        const holding = values[keyColumn] ?? null;
        if (holding === null) where(keyColumn, `Say which ${keyColumn.replace(/_id$/, '')} this row is for, by its id or by its name beside it.`);
        else resolved = { id: holding, existing: have(entityKey).has(holding) };
      } else if (given !== null) {
        const known = existingIds.get(entityKey)?.has(given) ?? false;
        if (!known) where('id', 'This id is not one of this household’s records. Leave it empty for a new row.');
        else resolved = { id: given, existing: true };
      } else if (row.ref !== null && refToKey.get(entityKey)?.has(row.ref) === true) {
        const mapped = refToKey.get(entityKey)?.get(row.ref) ?? '';
        resolved = { id: mapped, existing: existingIds.get(entityKey)?.has(mapped) ?? false };
      } else {
        resolved = { id: input.newId(), existing: false };
        if (row.ref === null) warnings.push({ sheet, row: row.sheetRow, message: 'A new row with no ref cannot be recognised if this file is uploaded again: give it one to be safe.' });
      }

      // ── the same row twice, or a reference that means two things ─────────────────────────────────────
      if (resolved !== null) {
        const earlier = seenKeys.get(resolved.id);
        if (earlier !== undefined) where(keyColumn === 'id' ? 'id' : keyColumn, `This row is the same record as row ${String(earlier)}: a record is written once in an upload.`);
        else seenKeys.set(resolved.id, row.sheetRow);
      }
      if (row.ref !== null) {
        const earlier = seenRefs.get(row.ref);
        if (earlier !== undefined) where('ref', `The reference "${row.ref}" is also on row ${String(earlier)}.`);
        else seenRefs.set(row.ref, row.sheetRow);
        const owner = refToKey.get(entityKey)?.get(row.ref);
        if (owner !== undefined && resolved !== null && owner !== resolved.id) {
          where('ref', `The reference "${row.ref}" already belongs to another ${entityKey.replace(/_/g, ' ')}.`);
        }
        const own = resolved === null ? undefined : keyToRef.get(entityKey)?.get(resolved.id);
        if (own !== undefined && own !== row.ref) where('ref', `This row already has the reference "${own}"; a row has one.`);
      }

      // ── what the database will require ───────────────────────────────────────────────────────────────
      const check = (column: Column, columnRules: Readonly<Record<string, { notNull: boolean; hasDefault: boolean; values?: readonly string[] }>>): void => {
        if (column.key === 'id') return;
        const rule = columnRules[column.key];
        if (rule === undefined) return;
        const value = values[column.key] ?? null;
        if (value === null) {
          if (rule.notNull && !rule.hasDefault && column.key !== keyColumn) where(headerOf(column), 'This is required.');
          return;
        }
        if (rule.values !== undefined && !rule.values.includes(value)) {
          where(headerOf(column), `"${value}" is not one of: ${rule.values.join(', ')}.`);
        }
      };
      for (const column of entity.columns) check(column, rules);
      if (joined !== undefined && instrumentPlan !== null && instrumentPlan.create) {
        for (const column of joined.columns) {
          const rule = (COLUMN_RULES[joined.key] ?? {})[column.key];
          if (rule === undefined || column.key === 'id') continue;
          const value = instrumentPlan.row[column.key] ?? null;
          if (value === null && rule.notNull && !rule.hasDefault) where(headerOf(column), 'This is required.');
          else if (value !== null && rule.values !== undefined && !rule.values.includes(value)) where(headerOf(column), `"${value}" is not one of: ${rule.values.join(', ')}.`);
        }
      }

      if (problems.length > before || resolved === null) continue;

      // ── an instrument that is new, or changed, comes before the holding that points at it ────────────
      if (joined !== undefined && instrumentPlan !== null) {
        const instrumentRow = writable(joined, instrumentPlan.row, COLUMN_RULES[joined.key] ?? {}, instrumentPlan.id, 'id');
        const held = have(joined.key).get(instrumentPlan.id);
        if (instrumentPlan.create) {
          planned.push({ entity: joined.key, sheet, sheetRow: row.sheetRow, action: 'create', key: instrumentPlan.id, ref: null, values: instrumentRow, changes: [] });
          have(joined.key).set(instrumentPlan.id, { id: instrumentPlan.id, ...instrumentRow });
          instrumentByNaturalKey.set(naturalKey(instrumentRow), instrumentPlan.id);
        } else if (held !== undefined && givenExplicitly(row, entity)) {
          const changes = diff(joined, held, instrumentRow);
          if (changes.length > 0 && !planned.some((p) => p.entity === joined.key && p.key === instrumentPlan?.id)) {
            planned.push({ entity: joined.key, sheet, sheetRow: row.sheetRow, action: 'update', key: instrumentPlan.id, ref: null, values: instrumentRow, changes });
          }
        }
      }

      // ── the row itself ───────────────────────────────────────────────────────────────────────────────
      const body = writable(entity, values, rules, resolved.id, keyColumn);
      if (resolved.existing) {
        const held = have(entityKey).get(resolved.id);
        const changes = held === undefined ? [] : diff(entity, held, body);
        if (changes.length === 0 && (row.ref === null || keyToRef.get(entityKey)?.get(resolved.id) === row.ref)) {
          unchanged[entityKey] = (unchanged[entityKey] ?? 0) + 1;
        } else {
          planned.push({ entity: entityKey, sheet, sheetRow: row.sheetRow, action: 'update', key: resolved.id, ref: row.ref, values: body, changes });
        }
      } else {
        planned.push({ entity: entityKey, sheet, sheetRow: row.sheetRow, action: 'create', key: resolved.id, ref: row.ref, values: body, changes: [] });
        have(entityKey).set(resolved.id, { ...body } as Row);
      }
    }
  }

  return { rows: planned, unchanged, problems, warnings };
}

/** Whether the row named its instrument by id, which is what lets a sheet edit the instrument: a name alone only finds or makes one. */
function givenExplicitly(row: SheetRow, entity: Entity): boolean {
  const via = entity.joins?.via;
  return via !== undefined && (row.values[via] ?? null) !== null;
}

/**
 * The columns to write for a row. A blank where the database fills in a default is left out, so a new row takes the default and an
 * existing one keeps what it has; a blank anywhere else is a null, which is what clears it.
 */
function writable(
  entity: Entity,
  values: Readonly<Record<string, string | null>>,
  rules: Readonly<Record<string, { notNull: boolean; hasDefault: boolean }>>,
  key: string,
  keyColumn: string,
): Values {
  const out: Values = {};
  for (const column of entity.columns) {
    if (column.key === keyColumn) {
      out[column.key] = key;
      continue;
    }
    const value = values[column.key] ?? null;
    const rule = rules[column.key];
    if (value === null && rule !== undefined && rule.notNull && rule.hasDefault) continue;
    out[column.key] = value;
  }
  return out;
}

/** What would change in an existing row: the columns this upload writes whose value differs from the household's. */
function diff(entity: Entity, held: Row, body: Readonly<Record<string, string | null>>): Change[] {
  const now = canonicalRow(entity, held);
  const next = canonicalRow(entity, body as Row);
  const changes: Change[] = [];
  for (const column of entity.columns) {
    if (!(column.key in body)) continue;
    const from = now[column.key] ?? null;
    const to = next[column.key] ?? null;
    if (from !== to) changes.push({ column: headerOf(column), from, to });
  }
  return changes;
}

/** The payload `apply_template` takes: the rows to create and change, by sheet, in the order they must be written. */
export function toApplyPayload(plan: UploadPlan): Record<string, { sheet_row: number; ref: string | null; values: Readonly<Record<string, string | null>> }[]> {
  const out: Record<string, { sheet_row: number; ref: string | null; values: Readonly<Record<string, string | null>> }[]> = {};
  for (const row of plan.rows) {
    (out[row.entity] ??= []).push({ sheet_row: row.sheetRow, ref: row.ref, values: row.values });
  }
  return out;
}
