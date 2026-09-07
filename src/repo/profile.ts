/**
 * What a member can learn about their own account.
 *
 * Two reads, both about the person asking. Section 20 asks for a screen where
 * the privacy promises are checkable rather than merely stated — "if a spouse
 * can see that her salary entry was viewed, the conversation stops being
 * 'please trust me' and becomes 'check for yourself'" — and a promise nobody
 * can inspect is worth about as much as no promise.
 */

import { supabase } from './client.ts';
import { MalformedRowError, requireRecord, requireString } from '../lib/guards.ts';
import type { IsoDate } from '../lib/dates.ts';
import type { Uuid } from './types.ts';

export interface PrivateEntryCount {
  readonly expenses: number;
  readonly holdings: number;
}

/**
 * How many of the caller's own entries are private.
 *
 * "A member should see '4 of your entries are private' on their own screen. A
 * privacy control nobody can observe working is indistinguishable from one
 * that does nothing." (§20)
 *
 * Strictly about the caller: the function it calls resolves the member from
 * the session and takes no argument that could point it at somebody else.
 */
export async function myPrivateEntryCount(householdId: Uuid): Promise<PrivateEntryCount> {
  const client = supabase();

  const { data, error } = await client.rpc('my_private_entry_count', {
    target_household_id: householdId,
  });

  if (error !== null) throw asRepositoryError(error);
  if (!Array.isArray(data)) {
    throw new MalformedRowError('my_private_entry_count', 'did not return a set of rows');
  }

  const counts: Record<string, number> = {};
  for (const row of data) {
    const record = requireRecord(row, 'my_private_entry_count');
    const entity = requireString(record['entity'], 'my_private_entry_count.entity');
    const raw = record['entry_count'];
    // A count is small by nature, so Number is honest here in a way it would
    // not be for money — but it still has to be a whole one.
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(value)) {
      throw new MalformedRowError('my_private_entry_count.entry_count', `is ${String(raw)}, not a count`);
    }
    counts[entity] = value;
  }

  return { expenses: counts['expense_txn'] ?? 0, holdings: counts['holding'] ?? 0 };
}

export type AuditAction = 'insert' | 'update' | 'delete' | 'read';

export interface ActivityEntry {
  readonly id: string;
  readonly entity: string;
  readonly action: AuditAction;
  readonly at: string;
  /** Null for a scheduled job, which is a real answer: nobody did this. */
  readonly actor: Uuid | null;
  readonly isMine: boolean;
}

const ACTIONS: readonly AuditAction[] = ['insert', 'update', 'delete', 'read'];

/**
 * Recent changes in this household, as the audit log recorded them.
 *
 * No household filter is passed and none is needed: the log's policy returns
 * only rows from households the caller belongs to, and applies the same
 * visibility test as the table each row shadows — so another member's private
 * entry is missing from this list exactly as it is missing from the ledger.
 *
 * Reads are not in here yet. `audit_log` accepts a 'read' action and nothing
 * writes one, because Postgres fires no trigger on select; recording reads
 * means routing them through definer functions, which is its own slice. The
 * screen has to say so rather than let an absence read as "nobody looked".
 */
export async function listRecentActivity(
  householdId: Uuid,
  limit = 20,
): Promise<readonly ActivityEntry[]> {
  const client = supabase();

  const { data: user } = await client.auth.getUser();
  const me = user.user?.id ?? null;

  const { data, error } = await client
    .from('audit_log')
    .select('id, entity, entity_id, action, at, actor')
    .eq('household_id', householdId)
    .order('at', { ascending: false })
    .limit(limit);

  if (error !== null) throw asRepositoryError(error);

  return (data ?? []).map((row: unknown) => {
    const record = requireRecord(row, 'audit_log');
    const action = requireString(record['action'], 'audit_log.action');
    if (!ACTIONS.includes(action as AuditAction)) {
      throw new MalformedRowError('audit_log.action', `is ${action}, not one of ${ACTIONS.join(', ')}`);
    }
    const actor = record['actor'];
    return {
      // A bigint identity column, used only as a key. It never becomes money
      // and never enters arithmetic, so a string of it is the whole need.
      id: String(record['id']),
      entity: requireString(record['entity'], 'audit_log.entity'),
      action: action as AuditAction,
      at: requireString(record['at'], 'audit_log.at'),
      actor: typeof actor === 'string' ? actor : null,
      isMine: typeof actor === 'string' && actor === me,
    };
  });
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('You do not have permission to do that in this household.');
  }
  return new Error(error.message);
}

/** Re-exported for a screen that wants to show a date without importing two modules. */
export type { IsoDate };
