/**
 * Loan payments: one row for each payment on a loan, all of what left, principal and interest (docs/design/ledger-income.md section 4c; the schema is
 * `supabase/migrations/20261116120000_loan_payment.sql`).
 *
 * Owner and partner record and void them, as they alone record a loan. A payment is voided and never deleted. It changes nothing the loan says: what is
 * owed stays the figure a person states. The month close counts the ones that name an account (`src/domain/money-month.ts`); nothing here adds anything up.
 */

import { currentAccountId } from './account.ts';
import { supabase } from './client.ts';
import { checkLoanPayment } from './ledgerChecks.ts';
import { asLedgerError } from './ledgerErrors.ts';
import { toLoanPayment } from './ledgerMapping.ts';
import type { LoanPayment, NewLoanPayment, Uuid } from './types.ts';

const COLUMNS = 'id, household_id, liability_id, amount_minor::text, currency, paid_on, account_id, note, voided_at';

/** The payments the caller may read, newest first. A voided one is returned, marked, as a credit is. */
export async function listLoanPayments(householdId: Uuid, options: { from?: string; to?: string } = {}): Promise<readonly LoanPayment[]> {
  let query = supabase().from('loan_payment').select(COLUMNS).eq('household_id', householdId);
  if (options.from !== undefined) query = query.gte('paid_on', options.from);
  if (options.to !== undefined) query = query.lte('paid_on', options.to);
  const { data, error } = await query.order('paid_on', { ascending: false }).order('created_at', { ascending: false });
  if (error !== null) throw asLedgerError(error);
  return (data ?? []).map(toLoanPayment);
}

export async function addLoanPayment(input: NewLoanPayment): Promise<{ readonly id: Uuid }> {
  checkLoanPayment({ amount: input.amount, date: input.date, note: input.note ?? null });
  const note = input.note === undefined || input.note === null || input.note.trim() === '' ? null : input.note.trim();
  const { data, error } = await supabase()
    .from('loan_payment')
    .insert({
      household_id: input.householdId,
      liability_id: input.liabilityId,
      amount_minor: input.amount.minor.toString(),
      currency: input.amount.currency,
      paid_on: input.date,
      account_id: input.accountId ?? null,
      note,
    })
    .select('id')
    .single();
  if (error !== null) throw asLedgerError(error);
  return { id: (data as { id: string }).id };
}

/** Void a payment. It stops counting and stays on the loan, marked. */
export async function voidLoanPayment(id: Uuid): Promise<void> {
  const account = await currentAccountId();
  const { data, error } = await supabase().from('loan_payment').update({ voided_at: new Date().toISOString(), voided_by: account }).eq('id', id).is('voided_at', null).select('id');
  if (error !== null) throw asLedgerError(error);
  if ((data ?? []).length === 0) throw new Error('That payment is not yours to void, or it was voided already.');
}
