/**
 * Recurring credits: the salary rule and any income rule (docs/design/ledger-income.md section 5; the schema is
 * `supabase/migrations/20261114120000_ledger_income.sql`).
 *
 * A credit rule is a `recurring_rule` with a direction of credit. The database refuses one that posts by itself (LI-I8), so a due rule
 * makes an expected credit that counts nowhere until a person confirms it (`credits.ts`). An expense rule is read by `recurring.ts`, and
 * this module reads only the credit ones. An owner or a partner makes and changes them.
 */

import { RECURRING_CADENCES } from './types.ts';
import { supabase } from './client.ts';
import { asLedgerError } from './ledgerErrors.ts';
import { toIncomeRule } from './ledgerMapping.ts';
import type { IncomeRule, IncomeRulePatch, NewIncomeRule, Uuid } from './types.ts';

const COLUMNS =
  'id, household_id, name, direction, credit_category, member_id, account_id, amount_minor::text, currency, cadence, due_day, next_due, visibility, reminder_days, status';

function check(input: { name?: string; dueDay?: number; amountMinor?: bigint; reminderDays?: number }): void {
  if (input.name !== undefined && (input.name.trim() === '' || input.name.trim().length > 80)) throw new Error('A rule needs a name of up to 80 characters.');
  if (input.amountMinor !== undefined && input.amountMinor <= 0n) throw new Error('A rule recurs for some amount of money.');
  if (input.dueDay !== undefined && (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28)) {
    throw new Error('A rule falls due on a day from 1 to 28, so that the day exists in every month.');
  }
  if (input.reminderDays !== undefined && (!Number.isInteger(input.reminderDays) || input.reminderDays < 0 || input.reminderDays > 30)) {
    throw new Error('A reminder is between 0 and 30 days ahead.');
  }
}

/** The household's credit rules the caller may read, the ones in use first and a paused or archived one after. */
export async function listIncomeRules(householdId: Uuid): Promise<readonly IncomeRule[]> {
  const { data, error } = await supabase()
    .from('recurring_rule')
    .select(COLUMNS)
    .eq('household_id', householdId)
    .eq('direction', 'credit')
    .order('name', { ascending: true });
  if (error !== null) throw asLedgerError(error);
  const order = { active: 0, paused: 1, archived: 2 } as const;
  return (data ?? []).map(toIncomeRule).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

export async function addIncomeRule(input: NewIncomeRule): Promise<{ readonly id: Uuid }> {
  const dueDay = Number(input.firstDue.slice(8, 10));
  check({ name: input.name, dueDay, amountMinor: input.amount.minor, reminderDays: input.reminderDays ?? 0 });
  if (!RECURRING_CADENCES.includes(input.cadence)) throw new Error('A rule recurs monthly, quarterly, half-yearly or yearly.');
  const { data, error } = await supabase()
    .from('recurring_rule')
    .insert({
      household_id: input.householdId,
      name: input.name.trim(),
      direction: 'credit',
      credit_category: input.category,
      category_id: null,
      account_id: input.accountId ?? null,
      member_id: input.memberId,
      amount_minor: input.amount.minor.toString(),
      currency: input.amount.currency,
      cadence: input.cadence,
      due_day: dueDay,
      next_due: input.firstDue,
      visibility: input.visibility ?? 'personal',
      // A credit rule never posts by itself: the table refuses it (LI-I8).
      auto_post: false,
      reminder_days: input.reminderDays ?? 0,
    })
    .select('id')
    .single();
  if (error !== null) throw asLedgerError(error);
  return { id: (data as { id: string }).id };
}

/** Change a rule. It is paused or archived and never deleted. A new next-due day moves the due day with it. */
export async function updateIncomeRule(id: Uuid, patch: IncomeRulePatch): Promise<void> {
  const dueDay = patch.nextDue === undefined ? undefined : Number(patch.nextDue.slice(8, 10));
  check({
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(dueDay === undefined ? {} : { dueDay }),
    ...(patch.amount === undefined ? {} : { amountMinor: patch.amount.minor }),
    ...(patch.reminderDays === undefined ? {} : { reminderDays: patch.reminderDays }),
  });
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row['name'] = patch.name.trim();
  if (patch.visibility !== undefined) row['visibility'] = patch.visibility;
  if (patch.accountId !== undefined) row['account_id'] = patch.accountId;
  if (patch.amount !== undefined) {
    row['amount_minor'] = patch.amount.minor.toString();
    row['currency'] = patch.amount.currency;
  }
  if (patch.cadence !== undefined) row['cadence'] = patch.cadence;
  if (patch.nextDue !== undefined) {
    row['next_due'] = patch.nextDue;
    row['due_day'] = dueDay;
  }
  if (patch.reminderDays !== undefined) row['reminder_days'] = patch.reminderDays;
  if (patch.status !== undefined) {
    row['status'] = patch.status;
    row['archived_at'] = patch.status === 'archived' ? new Date().toISOString() : null;
  }
  if (Object.keys(row).length === 0) return;
  const { data, error } = await supabase().from('recurring_rule').update(row).eq('id', id).eq('direction', 'credit').select('id');
  if (error !== null) throw asLedgerError(error);
  if ((data ?? []).length === 0) throw new Error('That rule is not yours to change.');
}
