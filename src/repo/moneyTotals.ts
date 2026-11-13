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
import { toMoneyTotals, toYearlyIncomeTotals } from './ledgerMapping.ts';
import type { MoneyTotals, Uuid, YearlyIncomeTotals } from './types.ts';

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
