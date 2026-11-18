/**
 * Reading what the report needs (docs/design/export-redesign.md section 2): everything the complete backup reads, and four more tables the report shows
 * and the backup does not (credits, accounts, their balances and loan payments).
 *
 * The same rule as the backup: columns are named and selected by name, a table is read a page at a time, an amount comes back as text so no digit is lost,
 * and row-level security decides which rows return, so another member's private entry is not here and is not in the file.
 */

import type { Row } from '../domain/export/entities.ts';
import { supabase } from './client.ts';
import { readEverything, type ExportSource } from './export.ts';
import type { Uuid } from './types.ts';

const PAGE = 1000;

/** The tables only the report reads, and the columns of each. A money column is asked for as text. */
const EXTRA: ReadonlyArray<{ readonly table: string; readonly columns: readonly string[]; readonly text: readonly string[] }> = [
  { table: 'credit_entry', columns: ['id', 'member_id', 'account_id', 'category', 'amount_minor', 'currency', 'credit_date', 'visibility', 'payer', 'voided_at'], text: ['amount_minor'] },
  { table: 'account', columns: ['id', 'member_id', 'name', 'type', 'currency', 'account_last4', 'status'], text: [] },
  { table: 'account_balance', columns: ['id', 'account_id', 'as_at', 'balance_minor', 'currency', 'source'], text: ['balance_minor'] },
  { table: 'loan_payment', columns: ['id', 'liability_id', 'paid_on', 'amount_minor', 'currency', 'voided_at'], text: ['amount_minor'] },
];

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

async function readExtra(table: (typeof EXTRA)[number], householdId: Uuid): Promise<Row[]> {
  const select = table.columns.map((column) => (table.text.includes(column) ? `${column}::text` : column)).join(',');
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase().from(table.table).select(select).eq('household_id', householdId).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error !== null) throw new Error(`Could not read ${table.table} for the report: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    for (const record of page) {
      const row: Record<string, string | null> = {};
      for (const column of table.columns) row[column] = asText(record[column]);
      rows.push(row);
    }
    if (page.length < PAGE) break;
  }
  return rows;
}

export interface ReportSource {
  readonly tables: Readonly<Record<string, readonly Row[]>>;
  readonly householdName: string;
  readonly isDemo: boolean;
}

/** What the report is built from, for a household: the backup's rows, and the four tables the report adds. */
export async function readForReport(householdId: Uuid): Promise<ReportSource> {
  const base: ExportSource = await readEverything(householdId);
  const tables: Record<string, readonly Row[]> = { ...base.tables };
  for (const table of EXTRA) tables[table.table] = await readExtra(table, householdId);
  return { tables, householdName: base.householdName, isDemo: base.isDemo };
}
