/**
 * Writing an uploaded workbook, and taking one back.
 *
 * The preview has already compared the workbook with the household (`src/domain/export/plan.ts`) and said what is wrong; this is the
 * only part that writes. One call, `apply_template`, writes every row or none of them, as the signed-in person, so row-level security
 * decides each row: nothing here can do what that person could not do by hand. A row the database refuses stops the whole upload,
 * and the error says which sheet and row.
 *
 * `reverse_template_batch` undoes an upload as a unit, for the person who made it.
 */

import { ENTITY_BY_KEY } from '../domain/export/entities.ts';
import { currentAccountId } from './account.ts';
import { supabase } from './client.ts';
import type { Uuid } from './types.ts';

/** What the database refused, and where in the workbook, when it says. */
export class UploadError extends Error {
  readonly code: string | undefined;
  readonly entity: string | undefined;
  readonly row: number | undefined;

  constructor(message: string, code?: string, entity?: string, row?: number) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.entity = entity;
    this.row = row;
  }
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
  readonly details?: string | null | undefined;
}

/** The entity and the row the database named, from the detail it raised with: `entity=expense_txn;row=14`. */
function whereIt(details: string | null | undefined): { entity: string | undefined; row: number | undefined } {
  const entity = /entity=(\w+)/.exec(details ?? '')?.[1];
  const row = /row=(\d+)/.exec(details ?? '')?.[1];
  return { entity, row: row === undefined ? undefined : Number(row) };
}

function asUploadError(error: ProviderError): UploadError {
  const place = whereIt(error.details);
  if (error.code === '42501' && place.entity === undefined) {
    return new UploadError('You do not have permission to do that in this household. An upload is for an owner or a partner, with the authenticator code from this session.', error.code);
  }
  if (error.code === '23503') return new UploadError('A row points at a record that does not exist.', error.code, place.entity, place.row);
  if (error.code === '23505') return new UploadError(error.message.replace(/^duplicate key value violates unique constraint.*/i, 'That already exists.'), error.code, place.entity, place.row);
  if (error.code === '23514') return new UploadError('A value does not fit what the database allows for it.', error.code, place.entity, place.row);
  if (error.code === '23502') return new UploadError('A required value is missing.', error.code, place.entity, place.row);
  return new UploadError(error.message, error.code, place.entity, place.row);
}

export interface UploadRow {
  readonly sheet_row: number;
  readonly ref: string | null;
  readonly values: Readonly<Record<string, string | null>>;
}

export interface Applied {
  readonly batchId: string;
  readonly inserted: number;
  readonly updated: number;
}

/** Write the new and changed rows of a workbook, all or none. */
export async function applyTemplate(householdId: Uuid, label: string, rows: Readonly<Record<string, readonly UploadRow[]>>): Promise<Applied> {
  const { data, error } = await supabase().rpc('apply_template', { p_household: householdId, p_label: label, p_rows: rows });
  if (error !== null) throw asUploadError(error);
  const result = (data ?? {}) as { batch_id?: string; inserted?: number; updated?: number };
  return { batchId: result.batch_id ?? '', inserted: result.inserted ?? 0, updated: result.updated ?? 0 };
}

export interface Reversed {
  readonly restored: number;
  readonly removed: number;
}

/** Undo an upload as a unit. The person who made it only; nothing is undone if anything has changed since or refers to what it made. */
export async function reverseTemplate(batchId: Uuid): Promise<Reversed> {
  const { data, error } = await supabase().rpc('reverse_template_batch', { p_batch: batchId });
  if (error !== null) {
    if (error.code === '40001' || error.code === '23503' || error.code === '22023') {
      // The database names the table; the person knows the sheet.
      const place = whereIt(error.details);
      const sheet = place.entity === undefined ? undefined : ENTITY_BY_KEY.get(place.entity)?.sheet;
      const message = sheet === undefined || place.entity === undefined ? error.message : error.message.replace(new RegExp(`\\b${place.entity}\\b`), `the ${sheet} sheet`);
      throw new UploadError(message, error.code, place.entity);
    }
    throw asUploadError(error);
  }
  const result = (data ?? {}) as { restored?: number; removed?: number };
  return { restored: result.restored ?? 0, removed: result.removed ?? 0 };
}

export interface UploadBatch {
  readonly id: string;
  readonly label: string | null;
  readonly rowCount: number;
  readonly createdAt: string;
  readonly reversedAt: string | null;
  /** Made by the signed-in person, who alone can reverse it. */
  readonly mine: boolean;
}

/** The household's recent uploads from a template, newest first. */
export async function listUploads(householdId: Uuid, limit = 20): Promise<UploadBatch[]> {
  const [account, result] = await Promise.all([
    currentAccountId(),
    supabase()
      .from('import_batch')
      .select('id, label, row_count, created_at, reversed_at, created_by')
      .eq('household_id', householdId)
      .eq('kind', 'template')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);
  if (result.error !== null) throw new UploadError(result.error.message, result.error.code);
  return ((result.data ?? []) as unknown as { id: string; label: string | null; row_count: number; created_at: string; reversed_at: string | null; created_by: string }[]).map(
    (row) => ({
      id: row.id,
      label: row.label,
      rowCount: row.row_count,
      createdAt: row.created_at,
      reversedAt: row.reversed_at,
      mine: row.created_by === account,
    }),
  );
}
