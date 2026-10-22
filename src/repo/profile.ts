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
import { money, type Money } from '../lib/money.ts';
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
  /** The row the entry is about. Not a name: see `activityNames`. */
  readonly entityId: string;
  /** The row as it was after the change, or before it for a removal: where a name is read when the row is gone. */
  readonly snapshot: Readonly<Record<string, unknown>> | null;
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
    .select('id, entity, entity_id, action, at, actor, before, after')
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
      entityId: String(record['entity_id'] ?? ''),
      snapshot: snapshotOf(record['after']) ?? snapshotOf(record['before']),
      action: action as AuditAction,
      at: requireString(record['at'], 'audit_log.at'),
      actor: typeof actor === 'string' ? actor : null,
      isMine: typeof actor === 'string' && actor === me,
    };
  });
}

/** The row a snapshot holds, or null: the audit log stores it as json and a read of it is checked, not assumed. */
function snapshotOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Where a name lives in the row, for the tables a person would recognise an entry by. */
const NAME_COLUMN: Readonly<Record<string, string>> = {
  expense_txn: 'payee',
  instrument: 'name',
  insurance_policy: 'name',
  expense_category: 'name',
  liability: 'name',
  member: 'display_name',
  invite: 'display_name',
  import_batch: 'label',
};

/** Tables whose rows are about a holding, and so are named by the holding's instrument. */
const ABOUT_A_HOLDING: ReadonlySet<string> = new Set([
  'holding',
  'valuation_snapshot',
  'lot',
  'disposal',
  'fixed_income_terms',
  'deposit_renewal',
  'bond_rating_change',
]);

/**
 * What each entry was about, by name: the payee, the fund, the policy.
 *
 * The audit log records a table and a row id and a snapshot of the row, and a snapshot of a removal is the row as it
 * was, so even something that has been removed can be named from it. A name in the snapshot is used as it is. A row
 * about a holding is named by the holding's instrument: its id is in the snapshot, and the instrument is looked up
 * beside it, for the entries on the screen only and under the same policies as any other read. An entry with
 * nothing to name it by, or whose lookup fails, has no name and the sentence stands alone; a failed read never takes
 * the list down with it.
 */
export async function activityNames(entries: readonly ActivityEntry[]): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>();
  const holdingOf = new Map<string, string>();
  const instrumentOfEntry = new Map<string, string>();

  for (const entry of entries) {
    const snap = entry.snapshot;
    const column = NAME_COLUMN[entry.entity];
    if (column !== undefined) {
      const own = snap?.[column];
      if (typeof own === 'string' && own.trim() !== '') names.set(entry.id, own);
      continue;
    }
    if (!ABOUT_A_HOLDING.has(entry.entity)) continue;
    if (entry.entity === 'holding') {
      const instrument = snap?.['instrument_id'];
      if (typeof instrument === 'string') instrumentOfEntry.set(entry.id, instrument);
      else if (entry.entityId !== '') holdingOf.set(entry.id, entry.entityId);
    } else {
      const holding = snap?.['holding_id'];
      if (typeof holding === 'string') holdingOf.set(entry.id, holding);
    }
  }

  const client = supabase();
  try {
    // Holdings that are still there say which instrument they are.
    const holdingIds = [...new Set(holdingOf.values())];
    const instrumentOfHolding = new Map<string, string>();
    if (holdingIds.length > 0) {
      const { data } = await client.from('holding').select('id, instrument_id').in('id', holdingIds);
      for (const row of data ?? []) {
        const record = requireRecord(row, 'holding');
        instrumentOfHolding.set(String(record['id']), String(record['instrument_id']));
      }
    }
    for (const [entryId, holding] of holdingOf) {
      const instrument = instrumentOfHolding.get(holding);
      if (instrument !== undefined) instrumentOfEntry.set(entryId, instrument);
    }

    const instrumentIds = [...new Set(instrumentOfEntry.values())];
    if (instrumentIds.length > 0) {
      const { data } = await client.from('instrument').select('id, name').in('id', instrumentIds);
      const called = new Map<string, string>();
      for (const row of data ?? []) {
        const record = requireRecord(row, 'instrument');
        if (typeof record['name'] === 'string') called.set(String(record['id']), record['name']);
      }
      for (const [entryId, instrument] of instrumentOfEntry) {
        const label = called.get(instrument);
        if (label !== undefined) names.set(entryId, label);
      }
    }
  } catch {
    // Names are a courtesy. Whatever was read from the snapshots stands.
  }
  return names;
}

export interface PrivateEntries {
  readonly expenses: readonly {
    readonly id: string;
    readonly date: IsoDate;
    readonly payee: string | null;
    readonly amount: Money;
    /** A voided entry is still counted as private: the count does not look at it. */
    readonly isVoided: boolean;
  }[];
  readonly holdings: readonly { readonly id: string; readonly name: string; readonly isArchived: boolean }[];
}

/**
 * The caller's own private entries, so the count on the screen can be checked against the rows it counts.
 *
 * "A privacy control nobody can observe working is indistinguishable from one that does nothing" (section 20):
 * the number says how many, and this is the list. It is the set the count counts: `my_private_entry_count` counts
 * every personal expense and holding the caller has, voided or archived or not, so this lists them all and says
 * which are which. A list that left some out would make the number impossible to check. It asks for the caller's
 * member id as well as relying on the policy, so the query says what it means; the policy is what makes it safe.
 */
export async function listMyPrivateEntries(householdId: Uuid, memberId: Uuid): Promise<PrivateEntries> {
  const client = supabase();

  const [expenseResult, holdingResult] = await Promise.all([
    client
      .from('expense_txn')
      // amount_minor::text: a bigint over 2^53 would otherwise arrive as a lossy double.
      .select('id, txn_date, amount_minor::text, currency, payee, voided_at')
      .eq('household_id', householdId)
      .eq('member_id', memberId)
      .eq('visibility', 'personal')
      .order('txn_date', { ascending: false })
      .limit(500),
    client
      .from('holding')
      .select('id, instrument_id, status')
      .eq('household_id', householdId)
      .eq('member_id', memberId)
      .eq('visibility', 'personal')
      .limit(500),
  ]);
  if (expenseResult.error !== null) throw asRepositoryError(expenseResult.error);
  if (holdingResult.error !== null) throw asRepositoryError(holdingResult.error);

  const expenses = (expenseResult.data ?? []).map((row: unknown) => {
    const record = requireRecord(row, 'expense_txn');
    const payee = record['payee'];
    return {
      id: String(record['id']),
      date: requireString(record['txn_date'], 'expense_txn.txn_date'),
      payee: typeof payee === 'string' && payee.trim() !== '' ? payee : null,
      amount: money(BigInt(requireString(record['amount_minor'], 'expense_txn.amount_minor')), requireString(record['currency'], 'expense_txn.currency')),
      isVoided: record['voided_at'] != null,
    };
  });

  const instrumentIds = [...new Set((holdingResult.data ?? []).map((row: unknown) => String(requireRecord(row, 'holding')['instrument_id'])))];
  const instrumentNames = new Map<string, string>();
  if (instrumentIds.length > 0) {
    const { data, error } = await client.from('instrument').select('id, name').in('id', instrumentIds);
    if (error !== null) throw asRepositoryError(error);
    for (const row of data ?? []) {
      const record = requireRecord(row, 'instrument');
      instrumentNames.set(String(record['id']), requireString(record['name'], 'instrument.name'));
    }
  }
  const holdings = (holdingResult.data ?? []).map((row: unknown) => {
    const record = requireRecord(row, 'holding');
    return {
      id: String(record['id']),
      name: instrumentNames.get(String(record['instrument_id'])) ?? 'A holding',
      isArchived: record['status'] !== 'active',
    };
  });

  return { expenses, holdings };
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
