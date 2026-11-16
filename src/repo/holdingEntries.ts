/**
 * The holdings' own entries that moved money between two days, for the month close (docs/design/ledger-income.md section 4a; LI-I30).
 *
 * Purchases, sales, redemptions and maturities, and PPF payments and withdrawals that are not voided, with the account each names. Only what the caller
 * can read comes back: a private holding is its member's, and the database adds the money it moved to the close as totals (`household_private_close`),
 * so nothing here is counted twice. A failure is thrown, and is not an empty list: a close that read no entries would show saved lower than it is.
 */

import type { IsoDate } from '../lib/dates.ts';
import { toBigIntExact } from '../lib/guards.ts';
import { money, type Money } from '../lib/money.ts';
import { supabase } from './client.ts';
import { listFixedIncome } from './fixedIncome.ts';
import { DISPOSAL_COLUMNS, LOT_COLUMNS } from './holdings.ts';
import { toDisposal, toLot, toPpfEntry } from './mapping.ts';
import { ENTRY_COLUMNS } from './retirement.ts';
import type { DepositRenewal, Disposal, FixedIncomeTerms, Lot, PpfEntryRow, Uuid } from './types.ts';

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

/** A holding opened with a cost: what the close reads of it, with whether a purchase already says what went in. */
export interface OpeningCost {
  readonly holdingId: Uuid;
  readonly openedOn: IsoDate | null;
  readonly cost: Money | null;
  /** The account the cost was paid from, in the instrument's own currency; null when none is named, or the one named is in another currency (not read). */
  readonly accountId: Uuid | null;
  /** Any purchase at all on the holding: its cost is then the lots', and not an opening cost. */
  readonly hasLot: boolean;
}

export interface FixedIncomeEntries {
  /** Every deposit and bond the caller can read, with the account each named. A payout is worked out from all of them. */
  readonly terms: readonly FixedIncomeTerms[];
  readonly renewals: readonly DepositRenewal[];
  /** Holdings opened between the two days with a cost on them. */
  readonly openings: readonly OpeningCost[];
  /** The holdings of a recurring deposit (scheme `rd`), which the close keeps out of every part of this. */
  readonly recurring: ReadonlySet<Uuid>;
}

/**
 * What a deposit, a bond and a holding opened with a cost say about money into and out of holdings in a month (ledger-income.md section 4b; LI-I32 to
 * LI-I35). Only what the caller can read comes back: the database adds the rest of the principals and opening costs as totals, and a payout it cannot
 * add. A failure is thrown, not an empty list, for the reason `listHoldingEntriesBetween` gives.
 */
export async function listFixedIncomeEntries(householdId: Uuid, from: IsoDate, to: IsoDate): Promise<FixedIncomeEntries> {
  const client = supabase();
  const [listing, holdings, instruments] = await Promise.all([
    listFixedIncome(householdId),
    client.from('holding').select('id, instrument_id, cost_minor::text, cost_account_id, cost_account_currency, opened_on').eq('household_id', householdId),
    client.from('instrument').select('id, currency, scheme').eq('household_id', householdId),
  ]);
  for (const result of [holdings, instruments]) {
    if (result.error !== null) throw new Error('The holdings could not be read just now.');
  }
  const instrumentOf = new Map<string, { currency: string; scheme: string | null }>();
  for (const row of instruments.data ?? []) {
    const record = row as Record<string, unknown>;
    instrumentOf.set(String(record['id']), { currency: String(record['currency']), scheme: typeof record['scheme'] === 'string' ? record['scheme'] : null });
  }

  const recurring = new Set<string>();
  const candidates: Record<string, unknown>[] = [];
  for (const row of holdings.data ?? []) {
    const record = row as Record<string, unknown>;
    const instrument = instrumentOf.get(String(record['instrument_id']));
    if (instrument?.scheme === 'rd') recurring.add(String(record['id']));
    const openedOn = record['opened_on'];
    if (typeof openedOn === 'string' && openedOn >= from && openedOn <= to && record['cost_minor'] !== null && record['cost_minor'] !== undefined) {
      candidates.push(record);
    }
  }

  let withLots = new Set<string>();
  if (candidates.length > 0) {
    const lots = await client.from('lot').select('holding_id').in('holding_id', candidates.map((row) => String(row['id'])));
    if (lots.error !== null) throw new Error('The holdings could not be read just now.');
    withLots = new Set((lots.data ?? []).map((row) => String((row as Record<string, unknown>)['holding_id'])));
  }

  const openings = candidates.map((record): OpeningCost => {
    const instrument = instrumentOf.get(String(record['instrument_id']));
    // A holding whose instrument was not read is not one to guess a currency for.
    if (instrument === undefined) throw new Error('The holdings could not be read just now.');
    const currency = instrument.currency;
    const named = record['cost_account_id'];
    return {
      holdingId: String(record['id']),
      openedOn: String(record['opened_on']),
      cost: money(toBigIntExact(record['cost_minor'], 'holding.cost_minor'), currency),
      accountId: typeof named === 'string' && record['cost_account_currency'] === currency ? named : null,
      hasLot: withLots.has(String(record['id'])),
    };
  });
  return { terms: listing.terms, renewals: listing.renewals, openings, recurring };
}
