/**
 * Stated spends (docs/design/spending-capture.md section 11; the schema is `supabase/migrations/20261117130000_spend_statement.sql`).
 *
 * An owner or a partner reads and writes them: the policies return nothing to anybody else, and a write by anybody else is refused. A statement is about a
 * month that has ended; the table refuses any other. It is changed by voiding it and stating again, never edited in place (SC-I14), so `stateSpend` voids the
 * month's live statement, if there is one, and writes the new one. Nothing here works out a month's spent: which source a month's spent comes from is
 * `src/domain/spend-source.ts`.
 */

import { currentAccountId } from './account.ts';
import { supabase } from './client.ts';
import { toSpendStatement } from './spendStatementMapping.ts';
import type { Money } from '../lib/money.ts';
import type { SpendStatement, Uuid } from './types.ts';

const COLUMNS = 'id, household_id, month, currency, amount_minor::text, note';

/** What a failed write means to a person, from the table's own refusals. */
function asSpendError(error: { readonly code?: string; readonly message: string }): Error {
  switch (error.code) {
    case '42501':
      return new Error('Your role here does not allow that. Only an owner or a partner states a month’s spend.');
    case '23505':
      return new Error('That month is already stated in that currency. Change it from the month’s card.');
    case '23514':
      return new Error(error.message.includes('has ended') ? 'A spend can be stated only for a month that has ended.' : 'That does not fit: check the amount and the note.');
    default:
      return new Error(error.message);
  }
}

/** The live statements for the months given (`YYYY-MM`), or for every month when none is. A voided one is not returned: it is not a figure. */
export async function listSpendStatements(householdId: Uuid, months?: readonly string[]): Promise<readonly SpendStatement[]> {
  let query = supabase().from('spend_statement').select(COLUMNS).eq('household_id', householdId).is('voided_at', null);
  if (months !== undefined) query = query.in('month', months.map((month) => `${month}-01`));
  const { data, error } = await query.order('month', { ascending: false });
  if (error !== null) throw asSpendError(error);
  return (data ?? []).map(toSpendStatement);
}

/**
 * State a month's spend: the total, in one currency, with an optional note. A live statement for the same month and currency is voided first, so this is both
 * *state* and *change* (SC-I14). If the new one is then refused, the old one stays voided and the month is not stated; the error says so, and stating again
 * is the way back.
 */
export async function stateSpend(input: { readonly householdId: Uuid; readonly month: string; readonly amount: Money; readonly note: string | null }): Promise<void> {
  const first = `${input.month}-01`;
  const { data: live, error: readError } = await supabase()
    .from('spend_statement')
    .select('id')
    .eq('household_id', input.householdId)
    .eq('month', first)
    .eq('currency', input.amount.currency)
    .is('voided_at', null);
  if (readError !== null) throw asSpendError(readError);
  for (const row of live ?? []) await voidSpendStatement((row as { id: string }).id);

  const { error } = await supabase().from('spend_statement').insert({
    household_id: input.householdId,
    month: first,
    currency: input.amount.currency,
    amount_minor: input.amount.minor.toString(),
    note: input.note,
  });
  if (error !== null) {
    const said = asSpendError(error).message;
    throw new Error((live ?? []).length > 0 ? `${said} The earlier figure was set aside, so the month is not stated now. State it again.` : said);
  }
}

/** Void a statement. It stops counting and stays, where the audit log shows it. */
export async function voidSpendStatement(id: Uuid): Promise<void> {
  const account = await currentAccountId();
  const { data, error } = await supabase().from('spend_statement').update({ voided_at: new Date().toISOString(), voided_by: account }).eq('id', id).is('voided_at', null).select('id');
  if (error !== null) throw asSpendError(error);
  if ((data ?? []).length === 0) throw new Error('That statement is not yours to void, or it was voided already.');
}
