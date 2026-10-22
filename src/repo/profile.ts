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
      entityId: String(record['entity_id'] ?? ''),
      action: action as AuditAction,
      at: requireString(record['at'], 'audit_log.at'),
      actor: typeof actor === 'string' ? actor : null,
      isMine: typeof actor === 'string' && actor === me,
    };
  });
}

/** Where a name lives for the tables a person would recognise an entry by. */
const NAME_OF: Readonly<Record<string, { readonly table: string; readonly column: string }>> = {
  expense_txn: { table: 'expense_txn', column: 'payee' },
  instrument: { table: 'instrument', column: 'name' },
  insurance_policy: { table: 'insurance_policy', column: 'name' },
  expense_category: { table: 'expense_category', column: 'name' },
  liability: { table: 'liability', column: 'name' },
  member: { table: 'member', column: 'display_name' },
  invite: { table: 'invite', column: 'display_name' },
  import_batch: { table: 'import_batch', column: 'label' },
};

/** Tables whose rows hang off a holding, and the column that says which: the holding's instrument is the name. */
const HOLDING_KEY: Readonly<Record<string, string>> = {
  holding: 'id',
  valuation_snapshot: 'holding_id',
  lot: 'holding_id',
  disposal: 'holding_id',
  fixed_income_terms: 'holding_id',
};

/**
 * What each entry was about, by name: the payee, the fund, the policy.
 *
 * The audit log records a table and a row id and nothing else, so "Recorded a value" had nothing to follow it. The
 * names are read here, from the tables themselves, for the entries on the screen only, and under the same policies
 * as any other read: a row the caller may not see has no name here, as it has no row in the ledger. A name that
 * cannot be found, or a read that fails, leaves the entry without one and never takes the list down with it.
 */
export async function activityNames(entries: readonly ActivityEntry[]): Promise<ReadonlyMap<string, string>> {
  const client = supabase();
  const names = new Map<string, string>();
  const byEntity = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.entityId === '') continue;
    const ids = byEntity.get(entry.entity) ?? new Set<string>();
    ids.add(entry.entityId);
    byEntity.set(entry.entity, ids);
  }

  // entity -> row id -> name, filled as the reads come back.
  const direct = new Map<string, Map<string, string>>();
  // entity -> row id -> the holding it belongs to.
  const holdingOf = new Map<string, Map<string, string>>();

  await Promise.all(
    [...byEntity.entries()].map(async ([entity, idSet]) => {
      const ids = [...idSet];
      try {
        const named = NAME_OF[entity];
        if (named !== undefined) {
          const { data } = await client.from(named.table).select(`id, ${named.column}`).in('id', ids);
          const found = new Map<string, string>();
          for (const row of data ?? []) {
            const record = requireRecord(row, named.table);
            const value = record[named.column];
            if (typeof value === 'string' && value.trim() !== '') found.set(String(record['id']), value);
          }
          direct.set(entity, found);
          return;
        }
        const key = HOLDING_KEY[entity];
        if (key !== undefined) {
          if (key === 'id') {
            holdingOf.set(entity, new Map(ids.map((id) => [id, id])));
          } else {
            // fixed_income_terms is keyed by its holding; the others have a row id of their own.
            const idColumn = entity === 'fixed_income_terms' ? 'holding_id' : 'id';
            const { data } = await client.from(entity).select(`${idColumn}, holding_id`).in(idColumn, ids);
            const found = new Map<string, string>();
            for (const row of data ?? []) {
              const record = requireRecord(row, entity);
              found.set(String(record[idColumn]), String(record['holding_id']));
            }
            holdingOf.set(entity, found);
          }
        }
      } catch {
        // Names are a courtesy. The entry stands without one.
      }
    }),
  );

  // Holdings are named by their instrument.
  const holdingIds = new Set<string>();
  for (const map of holdingOf.values()) for (const id of map.values()) holdingIds.add(id);
  const instrumentOfHolding = new Map<string, string>();
  const instrumentName = new Map<string, string>();
  if (holdingIds.size > 0) {
    try {
      const { data } = await client.from('holding').select('id, instrument_id').in('id', [...holdingIds]);
      for (const row of data ?? []) {
        const record = requireRecord(row, 'holding');
        instrumentOfHolding.set(String(record['id']), String(record['instrument_id']));
      }
      const instrumentIds = [...new Set(instrumentOfHolding.values())];
      if (instrumentIds.length > 0) {
        const { data: instruments } = await client.from('instrument').select('id, name').in('id', instrumentIds);
        for (const row of instruments ?? []) {
          const record = requireRecord(row, 'instrument');
          if (typeof record['name'] === 'string') instrumentName.set(String(record['id']), record['name']);
        }
      }
    } catch {
      // As above.
    }
  }

  for (const entry of entries) {
    const own = direct.get(entry.entity)?.get(entry.entityId);
    if (own !== undefined) {
      names.set(entry.id, own);
      continue;
    }
    const holding = holdingOf.get(entry.entity)?.get(entry.entityId);
    const instrument = holding === undefined ? undefined : instrumentOfHolding.get(holding);
    const label = instrument === undefined ? undefined : instrumentName.get(instrument);
    if (label !== undefined) names.set(entry.id, label);
  }
  return names;
}

export interface PrivateEntries {
  readonly expenses: readonly { readonly id: string; readonly date: IsoDate; readonly payee: string | null; readonly amount: Money }[];
  readonly holdings: readonly { readonly id: string; readonly name: string }[];
}

/**
 * The caller's own private entries, so the count on the screen can be checked against the rows it counts.
 *
 * "A privacy control nobody can observe working is indistinguishable from one that does nothing" (section 20):
 * the number says how many, and this is the list. It asks for the caller's member id as well as relying on the
 * policy, so the query says what it means; the policy is what makes it safe.
 */
export async function listMyPrivateEntries(householdId: Uuid, memberId: Uuid): Promise<PrivateEntries> {
  const client = supabase();

  const [expenseResult, holdingResult] = await Promise.all([
    client
      .from('expense_txn')
      // amount_minor::text: a bigint over 2^53 would otherwise arrive as a lossy double.
      .select('id, txn_date, amount_minor::text, currency, payee')
      .eq('household_id', householdId)
      .eq('member_id', memberId)
      .eq('visibility', 'personal')
      .is('voided_at', null)
      .order('txn_date', { ascending: false })
      .limit(100),
    client
      .from('holding')
      .select('id, instrument_id')
      .eq('household_id', householdId)
      .eq('member_id', memberId)
      .eq('visibility', 'personal')
      .eq('status', 'active')
      .limit(100),
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
    return { id: String(record['id']), name: instrumentNames.get(String(record['instrument_id'])) ?? 'A holding' };
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
