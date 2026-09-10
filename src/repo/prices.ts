/**
 * Prices, as the app reads them.
 *
 * Read-only, and there is no write function because there is no write grant:
 * the driver writes prices and the driver is not a client. A household able to
 * write its own NAV could move its own net worth.
 *
 * Not scoped to a household, because a published price is not. Every member of
 * every household reads the same rows.
 */

import { supabase } from './client.ts';
import { MalformedRowError, requireRecord, requireString } from '../lib/guards.ts';
import type { Price } from '../domain/pricing.ts';
import type { IsoDate } from '../lib/dates.ts';

const COLUMNS = 'source, external_id, as_of_date, value::text, currency, fetched_at';

/**
 * Every price for the instruments a household actually holds.
 *
 * Asked for by identifier rather than fetched wholesale: the table carries
 * every scheme anybody in the system holds, and a household wants the handful
 * that are its own. An empty list short-circuits rather than asking for
 * everything — `in.()` with no values is a query that means something
 * different from what it looks like.
 */
export async function listPrices(externalIds: readonly string[]): Promise<readonly Price[]> {
  if (externalIds.length === 0) return [];

  const client = supabase();

  const { data, error } = await client
    .from('price')
    .select(COLUMNS)
    .in('external_id', [...new Set(externalIds)])
    .order('as_of_date', { ascending: false });

  if (error !== null) throw new Error(error.message);

  return (data ?? []).map((row: unknown) => {
    const record = requireRecord(row, 'price');
    const value = record['value'];
    if (typeof value !== 'string') {
      // ::text in the query is what keeps a NAV's decimals; a number arriving
      // here means the cast was dropped and the precision is already gone.
      throw new MalformedRowError('price.value', 'is not a string — the ::text cast is missing');
    }
    return {
      source: requireString(record['source'], 'price.source'),
      externalId: requireString(record['external_id'], 'price.external_id'),
      asOf: requireString(record['as_of_date'], 'price.as_of_date') as IsoDate,
      value,
      currency: requireString(record['currency'], 'price.currency'),
      fetchedAt: requireString(record['fetched_at'], 'price.fetched_at'),
    };
  });
}

/**
 * Ask the driver to fetch. Never calls a vendor itself.
 *
 * "Clients never call a data vendor directly." This posts to the edge function
 * and reports what it did; the function is the only thing that has ever heard
 * of AMFI.
 *
 * ── saying what actually went wrong ─────────────────────────────────────
 *
 * The first version of this caught every failure and reported "Could not
 * reach the price driver". That was a guess dressed as a diagnosis. The
 * driver was deployed and reachable the whole time; the message sent somebody
 * looking at deployment and secrets for a problem that was neither, which is
 * worse than saying nothing.
 *
 * `functions.invoke` reports a non-2xx as an error and hands back the response
 * on `context`, so the function's own sentence is available and simply was not
 * being read. It is read now. Only a genuine transport failure — no response
 * at all — is described as not reaching anything.
 */
export async function refreshPrices(): Promise<{ written: number; note?: string }> {
  const client = supabase();

  const { data, error } = await client.functions.invoke('fetch-prices', { body: {} });

  if (error !== null) {
    const said = await driverSaid(error);
    if (said !== null) throw new Error(said);
    throw new Error(
      'The price driver did not respond. Prices are unchanged — nothing was written.',
    );
  }

  const result = (data ?? {}) as { written?: unknown; note?: unknown };
  return {
    written: typeof result.written === 'number' ? result.written : 0,
    ...(typeof result.note === 'string' ? { note: result.note } : {}),
  };
}

/**
 * The sentence the function sent back, if it sent one.
 *
 * Deliberately forgiving about the shape: a function that failed before it
 * could compose JSON still has a status worth reporting, and "502" tells
 * somebody more than a sentence asserting the wrong cause does.
 */
async function driverSaid(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return null;

  try {
    const body: unknown = await context.clone().json();
    const message = (body as { error?: unknown }).error;
    if (typeof message === 'string' && message.trim() !== '') {
      return `${message} (${String(context.status)})`;
    }
  } catch {
    // Not JSON. The status is still worth having.
  }

  try {
    const text = (await context.clone().text()).trim();
    if (text !== '') return `The price driver returned ${String(context.status)}: ${text.slice(0, 200)}`;
  } catch {
    // Nothing readable.
  }

  return `The price driver returned ${String(context.status)} and said nothing.`;
}
