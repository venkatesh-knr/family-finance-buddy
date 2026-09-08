/**
 * Exchange rates, as dated rows.
 *
 * The whole table is fetched rather than the latest per pair, because
 * conversion happens at each figure's own date and the screen does not know in
 * advance which dates it will need. A household's rate history is a handful of
 * rows; fetching the right ones would be a round trip per holding.
 *
 * The rate crosses this seam as a string and stays one. It is `numeric(20,10)`
 * precisely so its precision survives, and turning it into a Number here would
 * discard exactly what the column was chosen to keep.
 */

import { supabase } from './client.ts';
import { MalformedRowError, requireRecord, requireString } from '../lib/guards.ts';
import type { IsoDate } from '../lib/dates.ts';
import type { Rate } from '../domain/fx.ts';
import type { Uuid } from './types.ts';

export interface FxRate extends Rate {
  readonly id: Uuid;
  readonly source: 'manual' | 'driver';
}

export async function listRates(householdId: Uuid): Promise<readonly FxRate[]> {
  const client = supabase();

  const { data, error } = await client
    .from('fx_rate')
    // ::text on a numeric, for the same reason bigint amounts are cast: left
    // alone it arrives as a JSON double and the ten decimal places are gone.
    .select('id, base_currency, quote_currency, rate::text, as_of_date, source')
    .eq('household_id', householdId)
    .order('as_of_date', { ascending: false });

  if (error !== null) throw asRepositoryError(error);

  return (data ?? []).map((row: unknown) => {
    const record = requireRecord(row, 'fx_rate');
    const source = requireString(record['source'], 'fx_rate.source');
    if (source !== 'manual' && source !== 'driver') {
      throw new MalformedRowError('fx_rate.source', `is ${source}, not manual or driver`);
    }
    return {
      id: requireString(record['id'], 'fx_rate.id'),
      base: requireString(record['base_currency'], 'fx_rate.base_currency'),
      quote: requireString(record['quote_currency'], 'fx_rate.quote_currency'),
      asOf: requireString(record['as_of_date'], 'fx_rate.as_of_date') as IsoDate,
      rate: requireString(record['rate'], 'fx_rate.rate'),
      source,
    };
  });
}

/**
 * Record what one currency was worth in another, on a date.
 *
 * An upsert on the pair and date, because a second rate for the same day is a
 * correction rather than a rival — two rows disagreeing about one day would
 * make every figure converted from it ambiguous.
 */
export async function addRate(input: {
  householdId: Uuid;
  base: string;
  quote: string;
  /** A decimal string. Never a Number: that is the precision this exists to keep. */
  rate: string;
  asOf: IsoDate;
}): Promise<void> {
  const client = supabase();

  if (!/^\d+(\.\d+)?$/.test(input.rate.trim()) || Number(input.rate) <= 0) {
    throw new Error('A rate is a positive number, like 88.45.');
  }
  if (input.base === input.quote) {
    throw new Error('A currency has no rate against itself.');
  }

  const { data: user, error: userError } = await client.auth.getUser();
  if (userError !== null) throw asRepositoryError(userError);

  const { data: account, error: accountError } = await client
    .from('user_account')
    .select('id')
    .eq('auth_user_id', user.user?.id ?? '')
    .single();
  if (accountError !== null) throw asRepositoryError(accountError);

  const { error } = await client.from('fx_rate').upsert(
    {
      household_id: input.householdId,
      base_currency: input.base.toUpperCase(),
      quote_currency: input.quote.toUpperCase(),
      rate: input.rate.trim(),
      as_of_date: input.asOf,
      created_by: (account as { id: string }).id,
    },
    { onConflict: 'household_id,base_currency,quote_currency,as_of_date' },
  );

  if (error !== null) throw asRepositoryError(error);
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('Only an owner or partner can set a rate.');
  }
  if (error.code === '23514') {
    return new Error('That rate is not a positive number, or the currencies are the same.');
  }
  return new Error(error.message);
}
