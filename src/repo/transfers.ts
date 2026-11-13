/**
 * Moves between the household's own accounts, a card payment among them (docs/design/ledger-income.md sections 1 and 12).
 *
 * A move is neither income nor spent (LI-I2). It is one row and the ledger shows it as one line. Row-level security returns it only to
 * someone who can read both of its accounts, so a move into a personal account is not shown to the rest of the household. Both accounts
 * must be in the transfer's currency: a move between currencies is not modelled yet.
 */

import { currentAccountId } from './account.ts';
import { supabase } from './client.ts';
import { checkTransfer } from './ledgerChecks.ts';
import { asLedgerError } from './ledgerErrors.ts';
import { toTransfer } from './ledgerMapping.ts';
import type { NewTransfer, Transfer, Uuid } from './types.ts';

const COLUMNS = 'id, household_id, from_account_id, to_account_id, transfer_date, amount_minor::text, currency, source, note, voided_at';

export async function listTransfers(householdId: Uuid, options: { from?: string; to?: string } = {}): Promise<readonly Transfer[]> {
  let query = supabase().from('account_transfer').select(COLUMNS).eq('household_id', householdId);
  if (options.from !== undefined) query = query.gte('transfer_date', options.from);
  if (options.to !== undefined) query = query.lte('transfer_date', options.to);
  const { data, error } = await query.order('transfer_date', { ascending: false });
  if (error !== null) throw asLedgerError(error);
  return (data ?? []).map(toTransfer);
}

export async function addTransfer(input: NewTransfer): Promise<{ readonly id: Uuid }> {
  checkTransfer({ fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, amount: input.amount, date: input.date });
  const { data, error } = await supabase()
    .from('account_transfer')
    .insert({
      household_id: input.householdId,
      from_account_id: input.fromAccountId,
      to_account_id: input.toAccountId,
      transfer_date: input.date,
      amount_minor: input.amount.minor.toString(),
      currency: input.amount.currency,
      note: input.note === undefined || input.note === null || input.note.trim() === '' ? null : input.note.trim(),
    })
    .select('id')
    .single();
  if (error !== null) throw asLedgerError(error);
  return { id: (data as { id: string }).id };
}

/** Void a move: it stops counting and stays on the ledger, marked. */
export async function voidTransfer(id: Uuid): Promise<void> {
  const account = await currentAccountId();
  const { data, error } = await supabase().from('account_transfer').update({ voided_at: new Date().toISOString(), voided_by: account }).eq('id', id).select('id');
  if (error !== null) throw asLedgerError(error);
  if ((data ?? []).length === 0) throw new Error('That move is not yours to void.');
}
