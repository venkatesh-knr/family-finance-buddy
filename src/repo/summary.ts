/**
 * The household summary: sums for a role that cannot read the rows.
 *
 * A contributor reads their own records and a viewer reads none
 * (`20260925120000_narrow_reads.sql`). What both are given of the household is
 * these two definer functions, which return sums by category and by kind and
 * never a payee, a date, a holding or a member. Provider types stop here.
 *
 * Named arguments, because PostgREST resolves a function by parameter name and a
 * positional call would not find it.
 */

import type { IsoDate } from '../lib/dates.ts';
import { MalformedRowError, requireRecord, requireString, toBigIntExact } from '../lib/guards.ts';
import { money } from '../lib/money.ts';
import type { AssetRow, SpendingRow } from '../domain/summary.ts';
import { supabase } from './client.ts';
import type { Uuid } from './types.ts';

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('You do not have permission to read that in this household.');
  }
  return new Error(error.message);
}

function rowsOf(name: string, data: unknown): readonly unknown[] {
  if (data === null) return [];
  if (!Array.isArray(data)) throw new MalformedRowError(name, 'did not return a set of rows');
  return data as unknown[];
}

/** The household's shared spending in a period, by category and currency. */
export async function householdSpending(options: {
  readonly householdId: Uuid;
  readonly from: IsoDate;
  readonly to: IsoDate;
}): Promise<readonly SpendingRow[]> {
  const { data, error } = await supabase().rpc('household_expense_totals', {
    target_household_id: options.householdId,
    from_date: options.from,
    to_date: options.to,
  });
  if (error !== null) throw asRepositoryError(error);

  return rowsOf('household_expense_totals', data).map((row) => {
    const record = requireRecord(row, 'household_expense_totals');
    const id = record['category_id'];
    const name = record['category_name'];
    return {
      categoryId: typeof id === 'string' ? id : null,
      categoryName: typeof name === 'string' ? name : null,
      // Refuses a figure too large to have survived JSON rather than rounding
      // it, so a sum that cannot be trusted throws.
      total: money(
        toBigIntExact(record['total_minor'], 'household_expense_totals.total_minor'),
        requireString(record['currency'], 'household_expense_totals.currency'),
      ),
    };
  });
}

/** What the household holds, by kind and currency, at each holding's latest reading. */
export async function householdAssets(householdId: Uuid): Promise<readonly AssetRow[]> {
  const { data, error } = await supabase().rpc('household_asset_totals', {
    target_household_id: householdId,
  });
  if (error !== null) throw asRepositoryError(error);

  return rowsOf('household_asset_totals', data).map((row) => {
    const record = requireRecord(row, 'household_asset_totals');
    const valued = record['valued'];
    const unvalued = record['unvalued'];
    const currency = requireString(record['currency'], 'household_asset_totals.currency');
    return {
      kind: requireString(record['kind'], 'household_asset_totals.kind'),
      currency,
      total: money(toBigIntExact(record['total_minor'], 'household_asset_totals.total_minor'), currency),
      valued: typeof valued === 'number' ? valued : 0,
      unvalued: typeof unvalued === 'number' ? unvalued : 0,
    };
  });
}
