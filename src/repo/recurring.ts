/**
 * Recurring rules: what recurs, and the poster that enters it (docs/design/spending-capture.md section 3; the schema is
 * `supabase/migrations/20261102130000_recurring_rules.sql`).
 *
 * A rule is a category, a member, an amount, a cadence and a due day. `postDueRecurring` asks the database to enter every due day up to
 * today, once per due date (SC-I10), as the caller: row-level security decides whether they may. Nothing here works out a date; the
 * device's own reckoning is `src/domain/recurring.ts`.
 */

import { toRecurringRule } from './mapping.ts';
import { supabase } from './client.ts';
import type { NewRecurringRule, RecurringRule, RecurringRulePatch, Uuid } from './types.ts';

const COLUMNS =
  'id, household_id, name, category_id, member_id, amount_minor::text, currency, cadence, due_day, next_due, payee, method, visibility, auto_post, reminder_days, status';

interface ProviderError {
  readonly code?: string;
  readonly message: string;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') return new Error('Only an owner or a partner may change the household’s recurring entries.');
  if (error.code === '23505') return new Error('That already exists — check whether it has been recorded once already.');
  if (error.code === '23514') return new Error('That does not fit: check the amount, the day and the date.');
  return new Error(error.message);
}

/** The household's rules the caller may read, the ones in use first and a paused or archived one after, by name. */
export async function listRules(householdId: Uuid): Promise<readonly RecurringRule[]> {
  const { data, error } = await supabase().from('recurring_rule').select(COLUMNS).eq('household_id', householdId).order('name', { ascending: true });
  // Before the migration is applied there is no table, and so no rule: an empty list, not a failure. The provider's codes stay here.
  if (error !== null && (error.code === '42P01' || error.code === 'PGRST205')) return [];
  if (error !== null) throw asRepositoryError(error);
  const order = { active: 0, paused: 1, archived: 2 } as const;
  return (data ?? []).map(toRecurringRule).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

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

export async function addRule(input: NewRecurringRule): Promise<{ readonly id: Uuid }> {
  const dueDay = Number(input.firstDue.slice(8, 10));
  check({ name: input.name, dueDay, amountMinor: input.amount.minor, reminderDays: input.reminderDays ?? 0 });
  const text = (value: string | null | undefined): string | null => (value === undefined || value === null || value.trim() === '' ? null : value.trim());

  const { data, error } = await supabase()
    .from('recurring_rule')
    .insert({
      household_id: input.householdId,
      name: input.name.trim(),
      category_id: input.categoryId,
      member_id: input.memberId,
      amount_minor: input.amount.minor.toString(),
      currency: input.amount.currency,
      cadence: input.cadence,
      due_day: dueDay,
      next_due: input.firstDue,
      payee: text(input.payee),
      method: input.method ?? null,
      visibility: input.visibility ?? 'household',
      auto_post: input.autoPost ?? true,
      reminder_days: input.reminderDays ?? 0,
    })
    .select('id')
    .single();
  if (error !== null) throw asRepositoryError(error);
  return { id: (data as { id: string }).id };
}

/**
 * Change a rule. A rule is paused or archived and never deleted, so what it posted keeps its history. A new next-due day moves the due
 * day with it (the table holds the two together).
 */
export async function updateRule(id: Uuid, patch: RecurringRulePatch): Promise<void> {
  const dueDay = patch.nextDue === undefined ? undefined : Number(patch.nextDue.slice(8, 10));
  check({
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(dueDay === undefined ? {} : { dueDay }),
    ...(patch.amount === undefined ? {} : { amountMinor: patch.amount.minor }),
    ...(patch.reminderDays === undefined ? {} : { reminderDays: patch.reminderDays }),
  });

  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row['name'] = patch.name.trim();
  if (patch.categoryId !== undefined) row['category_id'] = patch.categoryId;
  if (patch.memberId !== undefined) row['member_id'] = patch.memberId;
  if (patch.amount !== undefined) {
    row['amount_minor'] = patch.amount.minor.toString();
    row['currency'] = patch.amount.currency;
  }
  if (patch.cadence !== undefined) row['cadence'] = patch.cadence;
  if (patch.nextDue !== undefined) {
    row['next_due'] = patch.nextDue;
    row['due_day'] = dueDay;
  }
  if (patch.payee !== undefined) row['payee'] = patch.payee === null || patch.payee.trim() === '' ? null : patch.payee.trim();
  if (patch.method !== undefined) row['method'] = patch.method;
  if (patch.autoPost !== undefined) row['auto_post'] = patch.autoPost;
  if (patch.reminderDays !== undefined) row['reminder_days'] = patch.reminderDays;
  if (patch.status !== undefined) {
    row['status'] = patch.status;
    row['archived_at'] = patch.status === 'archived' ? new Date().toISOString() : null;
  }
  if (Object.keys(row).length === 0) return;

  const { error } = await supabase().from('recurring_rule').update(row).eq('id', id);
  if (error !== null) throw asRepositoryError(error);
}

/**
 * Enter every due day up to today, in India, of the household's active, self-posting rules, once per due date. Returns how many entries
 * it made. Running it twice, or on two devices, makes none the second time (SC-I10). Only an owner or a partner may; for anyone else, and
 * before the migration is applied, it is a quiet nothing.
 */
export async function postDueRecurring(householdId: Uuid): Promise<number> {
  const { data, error } = await supabase().rpc('post_due_recurring', { p_household: householdId });
  if (error !== null) {
    if (error.code === '42883' || error.code === 'PGRST202' || error.code === '42501') return 0;
    throw asRepositoryError(error);
  }
  return typeof data === 'number' ? data : 0;
}
