/**
 * The household's accounts and their balances (docs/design/ledger-income.md section 12; the schema is
 * `supabase/migrations/20261114120000_ledger_income.sql`).
 *
 * An account is a savings or current account, or a card, and keeps only its last four characters. A balance is as at a day, typed or
 * stated by a statement, and is as private as its account. Row-level security decides what comes back: the owner and a partner read the
 * shared accounts and their own personal ones, a contributor their own, a viewer none. Nothing here works out a figure: the month
 * close that reads balances is `src/domain/money-month.ts`.
 */

import { supabase } from './client.ts';
import { checkAccount, checkBalance } from './ledgerChecks.ts';
import { asLedgerError } from './ledgerErrors.ts';
import { toAccount, toAccountBalance } from './ledgerMapping.ts';
import type { Account, AccountBalance, AccountPatch, NewAccount, NewBalance, Uuid } from './types.ts';

const ACCOUNT_COLUMNS = 'id, household_id, member_id, name, institution, type, currency, account_last4, is_foreign, opened_on, visibility, status';
const BALANCE_COLUMNS = 'id, household_id, account_id, as_at, balance_minor::text, currency, source, note';

const text = (value: string | null | undefined): string | null => (value === undefined || value === null || value.trim() === '' ? null : value.trim());

/** The accounts the caller may read, in use first and by name. An archived account is left out unless asked for: its history still counts. */
export async function listAccounts(householdId: Uuid, options: { includeArchived?: boolean } = {}): Promise<readonly Account[]> {
  let query = supabase().from('account').select(ACCOUNT_COLUMNS).eq('household_id', householdId);
  if (options.includeArchived !== true) query = query.eq('status', 'active');
  const { data, error } = await query.order('name', { ascending: true });
  if (error !== null) throw asLedgerError(error);
  return (data ?? []).map(toAccount);
}

export async function addAccount(input: NewAccount): Promise<{ readonly id: Uuid }> {
  checkAccount({ name: input.name, type: input.type, currency: input.currency, last4: input.last4 ?? null, institution: input.institution ?? null });
  const { data, error } = await supabase()
    .from('account')
    .insert({
      household_id: input.householdId,
      member_id: input.memberId,
      name: input.name.trim(),
      institution: text(input.institution),
      type: input.type,
      currency: input.currency,
      account_last4: text(input.last4),
      is_foreign: input.isForeign ?? false,
      opened_on: input.openedOn ?? null,
      visibility: input.visibility ?? 'household',
    })
    .select('id')
    .single();
  if (error !== null) throw asLedgerError(error);
  return { id: (data as { id: string }).id };
}

/** Change an account. It is archived and never deleted, so what was recorded against it keeps its history. */
export async function updateAccount(id: Uuid, patch: AccountPatch): Promise<void> {
  checkAccount({
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.type === undefined ? {} : { type: patch.type }),
    ...(patch.currency === undefined ? {} : { currency: patch.currency }),
    ...(patch.last4 === undefined ? {} : { last4: patch.last4 }),
    ...(patch.institution === undefined ? {} : { institution: patch.institution }),
  });
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row['name'] = patch.name.trim();
  if (patch.type !== undefined) row['type'] = patch.type;
  if (patch.currency !== undefined) row['currency'] = patch.currency;
  if (patch.isForeign !== undefined) row['is_foreign'] = patch.isForeign;
  if (patch.institution !== undefined) row['institution'] = text(patch.institution);
  if (patch.last4 !== undefined) row['account_last4'] = text(patch.last4);
  if (patch.visibility !== undefined) row['visibility'] = patch.visibility;
  if (patch.archived !== undefined) {
    row['status'] = patch.archived ? 'archived' : 'active';
    row['archived_at'] = patch.archived ? new Date().toISOString() : null;
  }
  if (Object.keys(row).length === 0) return;
  const { data, error } = await supabase().from('account').update(row).eq('id', id).select('id');
  if (error !== null) throw asLedgerError(error);
  if ((data ?? []).length === 0) throw new Error('That account is not yours to change.');
}

/** The balances the caller may read, newest first: those of the accounts they can read, and of no other. */
export async function listBalances(householdId: Uuid, options: { from?: string; to?: string } = {}): Promise<readonly AccountBalance[]> {
  let query = supabase().from('account_balance').select(BALANCE_COLUMNS).eq('household_id', householdId);
  if (options.from !== undefined) query = query.gte('as_at', options.from);
  if (options.to !== undefined) query = query.lte('as_at', options.to);
  const { data, error } = await query.order('as_at', { ascending: false });
  if (error !== null) throw asLedgerError(error);
  return (data ?? []).map(toAccountBalance);
}

/**
 * Type a balance. One typed balance per account and day: typing it again corrects it. A statement's balance for the same day is a
 * separate row and the month close prefers it, so a typed figure is never overwritten by an import, nor an import by a typed figure.
 */
export async function saveBalance(input: NewBalance): Promise<void> {
  checkBalance({ asAt: input.asAt, balance: input.balance });
  const { error } = await supabase()
    .from('account_balance')
    .upsert(
      {
        household_id: input.householdId,
        account_id: input.accountId,
        as_at: input.asAt,
        balance_minor: input.balance.minor.toString(),
        currency: input.balance.currency,
        source: 'typed',
        note: text(input.note),
      },
      { onConflict: 'account_id,as_at,source' },
    );
  if (error !== null) throw asLedgerError(error);
}

/**
 * Whether an account has a credit, a transfer or a balance, so that its type and currency are fixed (docs/design/ledger-income.md
 * section 1a): they decide how its past months were worked out. It reads only what the caller may read, so it can say no for an account
 * whose only entries are another member's private ones. The table itself refuses a change of type or currency once there is any history,
 * whoever can see it (LI-I26, app.refuse_account_retyping), so this only lets the form say so before it is tried.
 */
export async function accountHasHistory(accountId: Uuid): Promise<boolean> {
  const client = supabase();
  const asked = await Promise.all([
    client.from('credit_entry').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    client.from('account_transfer').select('id', { count: 'exact', head: true }).or(`from_account_id.eq.${accountId},to_account_id.eq.${accountId}`),
    client.from('account_balance').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
  ]);
  for (const result of asked) {
    if (result.error !== null) throw asLedgerError(result.error);
  }
  return asked.some((result) => (result.count ?? 0) > 0);
}
