/**
 * Reading what matching needs, and writing a statement import (docs/design/spending-capture.md sections 4 and 7; the schema is
 * `supabase/migrations/20261119120000_statement_import.sql`). The parsers and the matcher are pure (`src/domain/statement/`); this is the only part that touches the database.
 *
 * ── what it reads ──────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The entries the caller can read around the statement's dates, with the kinds of statement that have already witnessed each, and which of the statement's line hashes are
 * already recorded. Row-level security decides what comes back, so a member never matches against, or learns of, another member's private entry.
 *
 * ── what it writes, and why it is not a transaction ────────────────────────────────────────────────────────────────
 *
 * PostgREST has no multi-statement transaction, so a failure part way leaves some rows written, as it does for the eCAS import and for the same reason. Running the import again
 * completes it: a line whose witness is written is recognised by its hash and skipped, an entry written without its witness is found again by its line hash (`source_hash` is
 * unique) and given the witness, and a witness already there is not a failure. The failure mode is "run it again", which is the one worth having.
 *
 * It writes, in order: the accounts the statement names that the household lacks; the batch (with its row count, since `import_batch` has no update grant); then each entry and its
 * witness, or for a line merged into an entry, what that entry had empty and a witness. A field an entry already has is never overwritten: each fill is an update that applies
 * only where the field is still empty.
 */

import type { AccountToAdd, ExistingEntry, KnownAccount, NewEntry } from '../domain/statement/match.ts';
import type { PlannedWrite } from '../domain/statement/plan.ts';
import type { StatementKind } from '../domain/statement/common.ts';
import { addDays, isIsoDate, type IsoDate } from '../lib/dates.ts';
import { addAccount, listAccounts } from './accounts.ts';
import { supabase } from './client.ts';
import { toExistingEntry } from './statementImportMapping.ts';
import type { Uuid } from './types.ts';

/** How far either side of a statement's dates an existing entry may be and still be a near match (`NEAR_DAYS` in the matcher). */
const WINDOW_DAYS = 2;
const IN_BATCHES = 100;

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function failure(error: ProviderError): Error {
  if (error.code === '42501') return new Error('Your role here does not allow importing a statement, or one of its entries is not yours to change.');
  return new Error(error.message);
}

export interface MatchingContext {
  readonly existing: readonly ExistingEntry[];
  /** The member each existing entry is under: a witness added to it carries the same. */
  readonly memberOf: ReadonlyMap<string, Uuid>;
  readonly accounts: readonly KnownAccount[];
  readonly knownLineHashes: ReadonlySet<string>;
}

/** What the matcher needs to decide about a statement's lines: the household's entries around its dates, its accounts, and which of the line hashes are already recorded. */
export async function readMatchingContext(input: {
  readonly householdId: Uuid;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly lineHashes: readonly string[];
}): Promise<MatchingContext> {
  const client = supabase();
  const { householdId } = input;

  const [accounts, entries] = await Promise.all([
    listAccounts(householdId),
    client
      .from('expense_txn')
      .select('id, member_id, txn_date, amount_minor::text, currency, payee, account_id, upi_ref_hash')
      .eq('household_id', householdId)
      .is('voided_at', null)
      .gte('txn_date', addDays(input.from, -WINDOW_DAYS))
      .lte('txn_date', addDays(input.to, WINDOW_DAYS)),
  ]);
  if (entries.error !== null) throw failure(entries.error);
  const rows = entries.data ?? [];

  // The kinds of statement that have witnessed each of those entries. The batch is cited by a composite key, which cannot be embedded, so its kind is read apart.
  const batchesOf = new Map<string, string[]>();
  const ids = rows.map((row) => String((row as { id: string }).id));
  for (let at = 0; at < ids.length; at += IN_BATCHES) {
    const { data, error } = await client.from('expense_witness').select('expense_id, batch_id').in('expense_id', ids.slice(at, at + IN_BATCHES));
    if (error !== null) throw failure(error);
    for (const witness of data ?? []) {
      const found = witness as { expense_id: string; batch_id: string };
      batchesOf.set(found.expense_id, [...(batchesOf.get(found.expense_id) ?? []), found.batch_id]);
    }
  }
  const kindOfBatch = new Map<string, string>();
  const batchIds = [...new Set([...batchesOf.values()].flat())];
  for (let at = 0; at < batchIds.length; at += IN_BATCHES) {
    const { data, error } = await client.from('import_batch').select('id, kind').in('id', batchIds.slice(at, at + IN_BATCHES));
    if (error !== null) throw failure(error);
    for (const batch of data ?? []) kindOfBatch.set(String((batch as { id: string }).id), String((batch as { kind: string }).kind));
  }
  const kindsOf = new Map<string, string[]>();
  for (const [expenseId, batches] of batchesOf) kindsOf.set(expenseId, batches.flatMap((id) => kindOfBatch.get(id) ?? []));

  const existing: ExistingEntry[] = [];
  const memberOf = new Map<string, Uuid>();
  for (const row of rows) {
    const mapped = toExistingEntry(row, kindsOf.get(String((row as { id: string }).id)) ?? []);
    existing.push(mapped.entry);
    memberOf.set(mapped.entry.id, mapped.memberId);
  }

  const known = new Set<string>();
  for (let at = 0; at < input.lineHashes.length; at += IN_BATCHES) {
    const { data, error } = await client
      .from('expense_witness')
      .select('line_hash')
      .eq('household_id', householdId)
      .in('line_hash', input.lineHashes.slice(at, at + IN_BATCHES));
    if (error !== null) throw failure(error);
    for (const row of data ?? []) known.add(String((row as { line_hash: string }).line_hash));
  }

  return {
    existing,
    memberOf,
    accounts: accounts.map((account) => ({ id: account.id, last4: account.last4, type: account.type })),
    knownLineHashes: known,
  };
}

export interface ImportRequest {
  readonly householdId: Uuid;
  /** Who the entries are under, and who the accounts added are. */
  readonly memberId: Uuid;
  readonly visibility: 'household' | 'personal';
  readonly kind: StatementKind;
  /** A name the person gives the import, and never the file's own. */
  readonly label: string | null;
  readonly period: { readonly from: IsoDate; readonly to: IsoDate } | null;
  /** The account the statement is of, by its last four, when it is of one: the batch names it. */
  readonly statementLast4: string | null;
  readonly accountsToAdd: readonly AccountToAdd[];
  readonly writes: readonly PlannedWrite[];
  readonly memberOf: ReadonlyMap<string, Uuid>;
}

export interface ImportOutcome {
  readonly batchId: Uuid;
  readonly accountsAdded: number;
  readonly entriesCreated: number;
  /** Lines merged into an entry the household already had. */
  readonly witnessesAdded: number;
  /** Lines the database recognised as already there, whatever the check before it said: nothing was doubled. */
  readonly alreadyThere: number;
  /** Lines left out because the payment is already an entry that this person cannot see (a reference another member's private entry holds). */
  readonly conflicts: number;
}

const clean = (text: string | null): string | null => {
  const trimmed = text === null ? '' : text.trim();
  return trimmed === '' ? null : trimmed.slice(0, 120);
};

export async function commitImport(request: ImportRequest): Promise<ImportOutcome> {
  const client = supabase();
  const { householdId } = request;

  // 1. The accounts the statement names that the household lacks.
  const accountByLast4 = new Map<string, Uuid>();
  let accountsAdded = 0;
  for (const account of request.accountsToAdd) {
    const made = await addAccount({
      householdId,
      memberId: request.memberId,
      name: `${account.institution ?? 'Account'} ••${account.last4}`,
      institution: account.institution,
      type: account.type,
      currency: 'INR',
      last4: account.last4,
    });
    accountByLast4.set(account.last4, made.id);
    accountsAdded += 1;
  }
  const known = (await listAccounts(householdId)).filter((account) => account.last4 !== null);
  for (const account of known) if (account.last4 !== null && !accountByLast4.has(account.last4)) accountByLast4.set(account.last4, account.id);

  // 2. The batch: its count goes in at insert, because a batch says what happened and is never revised.
  const batch = await client
    .from('import_batch')
    .insert({
      household_id: householdId,
      kind: request.kind,
      period_start: request.period?.from ?? null,
      period_end: request.period?.to ?? null,
      label: request.label,
      row_count: request.writes.length,
      account_id: request.statementLast4 === null ? null : (accountByLast4.get(request.statementLast4) ?? null),
    })
    .select('id')
    .single();
  if (batch.error !== null) throw failure(batch.error);
  const batchId = String((batch.data as { id: string }).id);

  let entriesCreated = 0;
  let witnessesAdded = 0;
  let alreadyThere = 0;
  let conflicts = 0;

  const addWitness = async (expenseId: string, memberId: Uuid, lineHash: string): Promise<boolean> => {
    const { error } = await client.from('expense_witness').insert({ household_id: householdId, expense_id: expenseId, member_id: memberId, batch_id: batchId, line_hash: lineHash });
    if (error === null) return true;
    if (error.code === '23505') return false;
    throw failure(error);
  };

  for (const write of request.writes) {
    if (write.kind === 'create') {
      const entry: NewEntry = write.entry;
      const accountId = entry.accountId ?? (entry.accountLast4 === null ? null : (accountByLast4.get(entry.accountLast4) ?? null));
      const inserted = await client
        .from('expense_txn')
        .insert({
          household_id: householdId,
          member_id: request.memberId,
          txn_date: entry.date,
          amount_minor: entry.amountMinor.toString(),
          currency: entry.currency,
          payee: clean(entry.payee),
          method: entry.method,
          visibility: request.visibility,
          captured_via: 'import',
          source_batch_id: batchId,
          source_hash: entry.sourceHash,
          account_id: accountId,
          upi_ref_last4: entry.upiRefLast4,
          upi_ref_hash: entry.upiRefHash,
        })
        .select('id')
        .single();

      let expenseId: string | null = null;
      if (inserted.error === null) {
        expenseId = String((inserted.data as { id: string }).id);
        entriesCreated += 1;
      } else if (inserted.error.code === '23505') {
        // The line made its entry on an earlier run that stopped before its witness, or a payment with this reference is an entry this person cannot see.
        const again = await client.from('expense_txn').select('id').eq('household_id', householdId).eq('source_hash', entry.sourceHash).maybeSingle();
        if (again.error !== null) throw failure(again.error);
        if (again.data === null) {
          conflicts += 1;
          continue;
        }
        expenseId = String((again.data as { id: string }).id);
        alreadyThere += 1;
      } else {
        throw failure(inserted.error);
      }
      if (!(await addWitness(expenseId, request.memberId, write.lineHash)) && inserted.error === null) alreadyThere += 1;
    } else {
      const memberId = request.memberOf.get(write.entryId);
      if (memberId === undefined) throw new Error('An entry this import was to add to could not be found.');
      // What the entry has empty, and only that: each update applies only where the field is still empty.
      if (write.fill.payee !== undefined) {
        const { error } = await client.from('expense_txn').update({ payee: clean(write.fill.payee) }).eq('id', write.entryId).is('payee', null);
        if (error !== null) throw failure(error);
      }
      if (write.fill.accountId !== undefined) {
        const { error } = await client.from('expense_txn').update({ account_id: write.fill.accountId }).eq('id', write.entryId).is('account_id', null);
        if (error !== null) throw failure(error);
      }
      if (write.fill.upiRefHash !== undefined && write.fill.upiRefLast4 !== undefined) {
        const { error } = await client
          .from('expense_txn')
          .update({ upi_ref_hash: write.fill.upiRefHash, upi_ref_last4: write.fill.upiRefLast4 })
          .eq('id', write.entryId)
          .is('upi_ref_hash', null);
        if (error !== null && error.code !== '23505') throw failure(error);
      }
      if (await addWitness(write.entryId, memberId, write.lineHash)) witnessesAdded += 1;
      else alreadyThere += 1;
    }
  }

  return { batchId, accountsAdded, entriesCreated, witnessesAdded, alreadyThere, conflicts };
}

/** The first and last dates of a set of lines, or null for none. */
export function periodOf(dates: readonly IsoDate[]): { readonly from: IsoDate; readonly to: IsoDate } | null {
  const valid = dates.filter((date) => isIsoDate(date)).sort();
  const first = valid[0];
  const last = valid[valid.length - 1];
  return first === undefined || last === undefined ? null : { from: first, to: last };
}
