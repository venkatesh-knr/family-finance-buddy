/**
 * Money in: the credits of the ledger (docs/design/ledger-income.md sections 1, 2 and 5; the schema is
 * `supabase/migrations/20261114120000_ledger_income.sql`).
 *
 * A credit has exactly one category and is voided and never deleted, as an expense is. Row-level security decides what comes back: the
 * owner and a partner read the shared credits and their own private ones, a contributor their own, a viewer none. A household total of
 * other members' private income comes only from `householdMoneyTotals`, never as rows. Nothing here adds anything up: what came in and
 * what is spent is `src/domain/credit.ts` and `src/domain/money-month.ts`.
 *
 * Confirming an expected credit from a rule writes the credit first and then moves the rule on. The credit is unique per rule and due
 * date, so a retry after a failure in between writes nothing twice and only moves the rule.
 */

import { defaultVisibility } from '../domain/credit.ts';
import { nextDueAfter } from '../domain/credit-rule.ts';
import { currentAccountId } from './account.ts';
import { supabase } from './client.ts';
import { checkCredit, checkCreditPatch } from './ledgerChecks.ts';
import { AlreadyRecordedError, asLedgerError } from './ledgerErrors.ts';
import { toCredit } from './ledgerMapping.ts';
import type { Credit, CreditPatch, IncomeRule, NewCredit, Uuid } from './types.ts';

const COLUMNS =
  'id, household_id, member_id, account_id, category, amount_minor::text, currency, credit_date, visibility, source, recurring_rule_id, due_date, payer, note, voided_at';

const text = (value: string | null | undefined): string | null => (value === undefined || value === null || value.trim() === '' ? null : value.trim());

/** The credits the caller may read, newest first. A voided one is returned, marked, as an expense is. */
export async function listCredits(householdId: Uuid, options: { from?: string; to?: string } = {}): Promise<readonly Credit[]> {
  let query = supabase().from('credit_entry').select(COLUMNS).eq('household_id', householdId);
  if (options.from !== undefined) query = query.gte('credit_date', options.from);
  if (options.to !== undefined) query = query.lte('credit_date', options.to);
  const { data, error } = await query.order('credit_date', { ascending: false }).order('created_at', { ascending: false });
  if (error !== null) throw asLedgerError(error);
  return (data ?? []).map(toCredit);
}

export async function addCredit(input: NewCredit): Promise<{ readonly id: Uuid }> {
  checkCredit({ category: input.category, amount: input.amount, date: input.date, payer: input.payer ?? null, note: input.note ?? null });
  const { data, error } = await supabase()
    .from('credit_entry')
    .insert({
      household_id: input.householdId,
      member_id: input.memberId,
      account_id: input.accountId ?? null,
      category: input.category,
      amount_minor: input.amount.minor.toString(),
      currency: input.amount.currency,
      credit_date: input.date,
      visibility: input.visibility ?? defaultVisibility(input.category),
      source: input.rule === undefined ? 'typed' : 'rule',
      recurring_rule_id: input.rule?.ruleId ?? null,
      due_date: input.rule?.dueDate ?? null,
      payer: text(input.payer),
      note: text(input.note),
    })
    .select('id')
    .single();
  if (error !== null) throw asLedgerError(error);
  return { id: (data as { id: string }).id };
}

/** Correct a credit, until a figure has been relied on; after that it is voided and entered again. */
export async function updateCredit(id: Uuid, patch: CreditPatch): Promise<void> {
  checkCreditPatch(patch);
  const row: Record<string, unknown> = {};
  if (patch.accountId !== undefined) row['account_id'] = patch.accountId;
  if (patch.category !== undefined) row['category'] = patch.category;
  if (patch.amount !== undefined) {
    row['amount_minor'] = patch.amount.minor.toString();
    row['currency'] = patch.amount.currency;
  }
  if (patch.date !== undefined) row['credit_date'] = patch.date;
  if (patch.visibility !== undefined) row['visibility'] = patch.visibility;
  if (patch.payer !== undefined) row['payer'] = text(patch.payer);
  if (patch.note !== undefined) row['note'] = text(patch.note);
  if (Object.keys(row).length === 0) return;
  const { data, error } = await supabase().from('credit_entry').update(row).eq('id', id).select('id');
  if (error !== null) throw asLedgerError(error);
  if ((data ?? []).length === 0) throw new Error('That credit is not yours to change.');
}

/** Void a credit. It stops counting and stays on the ledger, marked, where anybody who can read it can see it was voided. */
export async function voidCredit(id: Uuid): Promise<void> {
  const account = await currentAccountId();
  const { data, error } = await supabase().from('credit_entry').update({ voided_at: new Date().toISOString(), voided_by: account }).eq('id', id).select('id');
  if (error !== null) throw asLedgerError(error);
  if ((data ?? []).length === 0) throw new Error('That credit is not yours to void.');
}

/** Move a rule on by one period, past a due date that was confirmed or passed over. Only if that date is the rule's next due. */
async function moveRuleOn(rule: IncomeRule, dueDate: string): Promise<void> {
  if (rule.nextDue !== dueDate) return;
  const next = nextDueAfter(dueDate, rule.dueDay, rule.cadence);
  const { error } = await supabase().from('recurring_rule').update({ next_due: next }).eq('id', rule.id).eq('next_due', dueDate);
  if (error !== null) throw asLedgerError(error);
}

/**
 * Confirm an expected credit from a rule: write one credit for the due date, at the rule's amount or at the one given, and move the rule
 * on. A due date confirmed twice writes one credit.
 */
export async function confirmExpectedCredit(input: { readonly rule: IncomeRule; readonly dueDate: string; readonly amount?: IncomeRule['amount'] }): Promise<void> {
  const { rule } = input;
  try {
    await addCredit({
      householdId: rule.householdId,
      memberId: rule.memberId,
      accountId: rule.accountId,
      category: rule.category,
      amount: input.amount ?? rule.amount,
      date: input.dueDate,
      visibility: rule.visibility,
      payer: rule.name,
      rule: { ruleId: rule.id, dueDate: input.dueDate },
    });
  } catch (error) {
    // Already confirmed: the credit is there, so all that is left is moving the rule on.
    if (!(error instanceof AlreadyRecordedError)) throw error;
  }
  await moveRuleOn(rule, input.dueDate);
}

/** "Not this month": move the rule past a due date and write nothing. */
export async function passOverDue(rule: IncomeRule, dueDate: string): Promise<void> {
  await moveRuleOn(rule, dueDate);
}
