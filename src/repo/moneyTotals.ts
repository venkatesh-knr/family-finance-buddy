/**
 * The household's totals, which include other members' private income and so cannot be read as rows
 * (docs/design/ledger-income.md sections 7 and 12; LI-I13).
 *
 * Both come from security-definer functions that read past the policy and return only totals per currency: no row, no category beyond
 * the refund split, no date and no member. Only an owner or a partner may ask, with a second factor, and anyone else is refused.
 *
 * Failing is not the same as empty, and neither is flattened into the other: a household that failed to read its private income would
 * quietly show a total that is too low, which is the exact failure these functions exist to prevent. An error is thrown, and a household
 * with no income credit yet is an empty list.
 */

import { MalformedRowError } from '../lib/guards.ts';
import { supabase } from './client.ts';
import { asLedgerError } from './ledgerErrors.ts';
import { toCashReserve, toMoneyTotals, toPrivateClose, toYearlyIncomeTotals } from './ledgerMapping.ts';
import type { CashReserve, MoneyTotals, PrivateClose, Uuid, YearlyIncomeTotals } from './types.ts';

/** What came in and what was refunded between two days, per currency, for the whole household. */
export async function householdMoneyTotals(householdId: Uuid, from: string, to: string): Promise<readonly MoneyTotals[]> {
  // Named arguments, not positional: PostgREST resolves a function by parameter name.
  const { data, error } = await supabase().rpc('household_money_totals', { target_household_id: householdId, from_date: from, to_date: to });
  if (error !== null) throw asLedgerError(error);
  if (data === null) return [];
  if (!Array.isArray(data)) throw new MalformedRowError('household_money_totals', 'did not return a set of rows');
  return data.map(toMoneyTotals);
}

/**
 * What a month close needs of the money the caller cannot read, per currency (another member's private accounts, the private credits into
 * accounts the caller does read, the moves that touch a hidden account), as totals and two counts. An owner or a partner only; the database
 * refuses anyone else, so a screen does not ask a contributor.
 */
export async function householdPrivateClose(householdId: Uuid, month: string, lastDay: string): Promise<readonly PrivateClose[]> {
  const { data, error } = await supabase().rpc('household_private_close', { target_household_id: householdId, month_first: `${month}-01`, month_last: lastDay });
  if (error !== null) throw asLedgerError(error);
  if (data === null) return [];
  if (!Array.isArray(data)) throw new MalformedRowError('household_private_close', 'did not return a set of rows');
  return data.map(toPrivateClose);
}

/**
 * The household's cash reserve as at a day, per currency, other members' private accounts included without their rows (LI-I27): what the
 * accounts hold, a card's due taken off, with how many accounts had a balance and how many there are. A currency with no balance typed returns
 * a sum of nothing and a count of none, which a screen says in words and never shows as a reserve of nothing.
 */
export async function householdCashReserve(householdId: Uuid, asOf: string): Promise<readonly CashReserve[]> {
  const { data, error } = await supabase().rpc('household_cash_reserve', { target_household_id: householdId, as_of: asOf });
  if (error !== null) throw asLedgerError(error);
  if (data === null) return [];
  if (!Array.isArray(data)) throw new MalformedRowError('household_cash_reserve', 'did not return a set of rows');
  return data.map(toCashReserve);
}

/**
 * The household's yearly salary and business income, the sum over its earners, as at a day, per currency. The day is passed in and not
 * read from a clock, so the same question always has the same answer. An empty list says nobody has an income credit to read yet.
 */
export async function householdYearlyIncome(householdId: Uuid, asOf: string): Promise<readonly YearlyIncomeTotals[]> {
  const { data, error } = await supabase().rpc('household_yearly_income', { target_household_id: householdId, as_of: asOf });
  if (error !== null) throw asLedgerError(error);
  if (data === null) return [];
  if (!Array.isArray(data)) throw new MalformedRowError('household_yearly_income', 'did not return a set of rows');
  return data.map(toYearlyIncomeTotals);
}
