/**
 * The holdings' own entries that moved money between two days, for the month close (docs/design/ledger-income.md section 4a; LI-I30).
 *
 * Purchases, sales, redemptions and maturities, and PPF payments and withdrawals that are not voided, with the account each names. Only what the caller
 * can read comes back: a private holding is its member's, and the database adds the money it moved to the close as totals (`household_private_close`),
 * so nothing here is counted twice. A failure is thrown, and is not an empty list: a close that read no entries would show saved lower than it is.
 */

import type { IsoDate } from '../lib/dates.ts';
import { supabase } from './client.ts';
import { DISPOSAL_COLUMNS, LOT_COLUMNS } from './holdings.ts';
import { toDisposal, toLot, toPpfEntry } from './mapping.ts';
import { ENTRY_COLUMNS } from './retirement.ts';
import type { Disposal, Lot, PpfEntryRow, Uuid } from './types.ts';

export interface HoldingEntriesBetween {
  readonly lots: readonly Lot[];
  readonly disposals: readonly Disposal[];
  readonly ppf: readonly PpfEntryRow[];
}

export async function listHoldingEntriesBetween(householdId: Uuid, from: IsoDate, to: IsoDate): Promise<HoldingEntriesBetween> {
  const client = supabase();
  const [lots, disposals, ppf] = await Promise.all([
    client.from('lot').select(LOT_COLUMNS).eq('household_id', householdId).eq('kind', 'purchase').gte('acquired_on', from).lte('acquired_on', to),
    client
      .from('disposal')
      .select(DISPOSAL_COLUMNS)
      .eq('household_id', householdId)
      .in('kind', ['sale', 'redemption', 'maturity'])
      .gte('disposed_on', from)
      .lte('disposed_on', to),
    client.from('ppf_entry').select(ENTRY_COLUMNS).eq('household_id', householdId).is('voided_at', null).gte('entry_date', from).lte('entry_date', to),
  ]);
  for (const result of [lots, disposals, ppf]) {
    if (result.error !== null) throw new Error('The holdings could not be read just now.');
  }
  return {
    lots: (lots.data ?? []).map(toLot),
    disposals: (disposals.data ?? []).map(toDisposal),
    ppf: (ppf.data ?? []).map(toPpfEntry),
  };
}
