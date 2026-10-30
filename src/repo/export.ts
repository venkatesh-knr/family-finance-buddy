/**
 * Reading everything the caller may see, for the full export.
 *
 * Which tables and which columns is `src/domain/export/entities.ts` and nothing else: each table is asked for the columns named
 * there, by name and never `select *`, so a column added to a table later is out of the file until someone decides it belongs.
 * Row-level security decides which rows come back, as it does for every screen: a private entry of another member, or a record
 * the caller's role may not read, is not here, and the file is a copy of what this person can already see.
 *
 * Amounts, numbers and integers are asked for as text, because PostgREST sends a bigint as a JSON number and a number loses its
 * digits past 2^53. A table is read a page at a time in a stable order; PostgREST caps a response at a thousand rows.
 */

import { ENTITIES, type Entity, type Row } from '../domain/export/entities.ts';
import { supabase } from './client.ts';
import type { Uuid } from './types.ts';

const PAGE = 1000;

export interface ExportSource {
  readonly tables: Readonly<Record<string, readonly Row[]>>;
  readonly householdName: string;
  readonly baseCurrency: string;
  readonly isDemo: boolean;
}

function selectOf(entity: Entity): string {
  return entity.columns
    .map((column) => (column.kind === 'money' || column.kind === 'decimal' || column.kind === 'integer' ? `${column.key}::text` : column.key))
    .join(',');
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

async function readTable(entity: Entity, householdId: Uuid): Promise<Row[]> {
  const rows: Row[] = [];
  const order = entity.rowKey[0] ?? 'id';
  for (let from = 0; ; from += PAGE) {
    let query = supabase().from(entity.key).select(selectOf(entity));
    query = query.eq('household_id', householdId);
    const { data, error } = await query.order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error !== null) throw new Error(`Could not read ${entity.sheet} for the export: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    for (const record of page) {
      const row: Record<string, string | null> = {};
      for (const column of entity.columns) row[column.key] = asText(record[column.key]);
      rows.push(row);
    }
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Every entity's rows for a household, as the text the database holds. */
export async function readEverything(householdId: Uuid): Promise<ExportSource> {
  const tables: Record<string, Row[]> = {};

  for (const entity of ENTITIES) tables[entity.key] = await readTable(entity, householdId);

  // What the file says about itself. The household's settings are not a sheet of it.
  const { data, error } = await supabase().from('household').select('name, base_currency, kind').eq('id', householdId).maybeSingle();
  if (error !== null) throw new Error(`Could not read the household for the export: ${error.message}`);
  const household = (data ?? null) as { name?: string; base_currency?: string; kind?: string } | null;
  return {
    tables,
    householdName: household?.name ?? 'Household',
    baseCurrency: household?.base_currency ?? 'INR',
    isDemo: household?.kind === 'demo',
  };
}
