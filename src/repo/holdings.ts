/**
 * The holdings repository: what is owned, and what it was worth.
 *
 *   listHoldings()      — everything the screen needs in one load
 *   addHolding()        — an instrument and a position in it
 *   recordValuation()   — one dated reading
 *
 * Lots and sales are read here too, though they are written in lots.ts: a
 * parcel is a purchase and a sale together, so a screen that loaded one
 * without the other could not show a gain at all.
 *
 * Same seam as expenses: no Supabase type crosses back out, and no method takes
 * a householdId it could use to look somewhere it does not belong. Row-level
 * security decides the scope; these functions only ask.
 */

import { supabase } from './client.ts';
import { MalformedRowError, requireRecord, requireString, toBigIntExact } from '../lib/guards.ts';
import type { IsoDate } from '../lib/dates.ts';
import { toDisposal, toHolding, toInstrument, toLot, toMember, toValuation } from './mapping.ts';
import { money } from '../lib/money.ts';
import {
  NoHouseholdError,
  type Disposal,
  type Holding,
  type HoldingListing,
  type Lot,
  type Member,
  type NewHolding,
  type PersonalHoldingTotal,
  type NewValuation,
  type Uuid,
  type Valuation,
} from './types.ts';
import { toHousehold, toRole } from './mapping.ts';

const CAN_WRITE: readonly string[] = ['owner', 'partner', 'contributor'];

// Two things are going on in these column lists.
//
// No embed: both foreign keys on holding are composite, so PostgREST cannot
// infer a to-one relationship from instrument_id alone — the same reason
// listExpenses resolves members from a separate query rather than a join.
//
// And ::text on every exact number. PostgREST renders numeric and bigint as
// JSON numbers, which are doubles: 12.34567891 survives, a long enough
// quantity does not, and neither does an amount above 2^53. Casting in the
// query makes the database hand over the decimal string it already holds, so
// precision is never a matter of luck about magnitude.
const HOLDING_COLUMNS =
  'id, household_id, member_id, instrument_id, quantity::text, cost_minor::text, opened_on, status';

const INSTRUMENT_COLUMNS =
  'id, name, kind, symbol, currency, exposure_currency, is_foreign_asset, status';

const VALUATION_COLUMNS =
  'id, holding_id, as_of_date, quantity::text, value_minor::text, currency, source, note';

const LOT_COLUMNS =
  'id, holding_id, acquired_on, quantity::text, cost_minor::text, currency, kind, note';

const DISPOSAL_COLUMNS =
  'id, holding_id, disposed_on, quantity::text, proceeds_minor::text, currency, kind, note';

export async function listHoldings(options: { householdId?: Uuid } = {}): Promise<HoldingListing> {
  const client = supabase();

  // See the note in expenses.ts: this narrows the view, and cannot widen access.
  let membershipQuery = client
    .from('membership')
    .select('id, role, member_id, user_account_id, household:household_id (*)')
    .is('revoked_at', null)
    .order('created_at', { ascending: true });

  if (options.householdId !== undefined) {
    membershipQuery = membershipQuery.eq('household_id', options.householdId);
  }

  const membershipResult = await membershipQuery.limit(1);

  if (membershipResult.error !== null) throw asRepositoryError(membershipResult.error);

  const membership = membershipResult.data[0];
  if (membership === undefined) throw new NoHouseholdError();

  const household = toHousehold(membership.household);
  const role = toRole(membership.role);

  const membersResult = await client
    .from('member')
    .select('id, display_name, colour, status')
    .eq('household_id', household.id)
    .order('display_name', { ascending: true });

  if (membersResult.error !== null) throw asRepositoryError(membersResult.error);

  const members: Member[] = membersResult.data.map(toMember);
  const membersById = new Map(members.map((member) => [member.id, member]));

  const instrumentsResult = await client
    .from('instrument')
    .select(INSTRUMENT_COLUMNS)
    .eq('household_id', household.id);

  if (instrumentsResult.error !== null) throw asRepositoryError(instrumentsResult.error);

  const instrumentsById = new Map(
    instrumentsResult.data.map((row) => {
      const instrument = toInstrument(row);
      return [instrument.id, instrument] as const;
    }),
  );

  // Scoped to the household in view. See the note in expenses.ts: policies keep
  // other households out, not your own other household.
  const holdingsResult = await client
    .from('holding')
    .select(HOLDING_COLUMNS)
    .eq('household_id', household.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (holdingsResult.error !== null) throw asRepositoryError(holdingsResult.error);

  const holdings: Holding[] = holdingsResult.data.map((row) =>
    toHolding(row, membersById, instrumentsById),
  );

  // Every reading, not just this year's. The peak is a calendar-year question
  // and the tax year is a different one, so the screen is given the readings
  // and the domain decides which belong to which period.
  const valuationsResult = await client
    .from('valuation_snapshot')
    .select(VALUATION_COLUMNS)
    .eq('household_id', household.id)
    .order('as_of_date', { ascending: false });

  if (valuationsResult.error !== null) throw asRepositoryError(valuationsResult.error);

  const valuations: Valuation[] = valuationsResult.data.map(toValuation);

  // Oldest first, both of them: that is the order FIFO consumes lots in, and
  // sorting here rather than in the matcher means the rows arrive in the shape
  // the arithmetic wants instead of being re-sorted on every render.
  const lotsResult = await client
    .from('lot')
    .select(LOT_COLUMNS)
    .eq('household_id', household.id)
    .order('acquired_on', { ascending: true })
    .order('id', { ascending: true });

  if (lotsResult.error !== null) throw asRepositoryError(lotsResult.error);

  const disposalsResult = await client
    .from('disposal')
    .select(DISPOSAL_COLUMNS)
    .eq('household_id', household.id)
    .order('disposed_on', { ascending: true })
    .order('id', { ascending: true });

  if (disposalsResult.error !== null) throw asRepositoryError(disposalsResult.error);

  const lots: Lot[] = lotsResult.data.map(toLot);
  const disposals: Disposal[] = disposalsResult.data.map(toDisposal);

  return {
    household,
    viewer: {
      accountId: String(membership.user_account_id),
      memberId: String(membership.member_id),
      role,
      canRecord: CAN_WRITE.includes(role),
      canFileForOthers: role === 'owner' || role === 'partner',
    },
    members,
    holdings,
    valuations,
    lots,
    disposals,
  };
}

/**
 * Record an instrument and a position in it.
 *
 * Two inserts, and deliberately not wrapped in a transaction: PostgREST has no
 * multi-statement transaction, so a database function would be needed to make
 * this atomic. The failure it guards against is a stranded instrument with no
 * holding — untidy, visible, and harmless, since an instrument on its own
 * values nothing and can be reused by the next attempt. Worth revisiting if
 * instrument creation ever gains side effects.
 */
export async function addHolding(input: NewHolding): Promise<void> {
  const client = supabase();

  const instrumentResult = await client
    .from('instrument')
    .insert({
      household_id: input.householdId,
      name: input.instrument.name,
      kind: input.instrument.kind,
      symbol: input.instrument.symbol ?? null,
      currency: input.instrument.currency,
      exposure_currency: input.instrument.exposureCurrency,
      is_foreign_asset: input.instrument.isForeignAsset,
    })
    .select('id')
    .single();

  if (instrumentResult.error !== null) throw asRepositoryError(instrumentResult.error);

  const holdingResult = await client.from('holding').insert({
    household_id: input.householdId,
    member_id: input.memberId,
    instrument_id: String(instrumentResult.data.id),
    // A decimal string, never a number: a fractional share must not pass
    // through a double on its way to a numeric column.
    quantity: input.quantity,
    cost_minor: input.cost === null || input.cost === undefined ? null : input.cost.minor.toString(),
    opened_on: input.openedOn ?? null,
  });

  if (holdingResult.error !== null) throw asRepositoryError(holdingResult.error);
}

/**
 * Record what a holding was worth on a date.
 *
 * An upsert on (holding_id, as_of_date), because correcting a misread figure
 * should replace it rather than leave two rows disagreeing about one day.
 */
export async function recordValuation(input: NewValuation): Promise<void> {
  const client = supabase();

  if (input.amount.minor < 0n) {
    throw new Error('A valuation cannot be negative.');
  }

  const result = await client.from('valuation_snapshot').upsert(
    {
      household_id: input.householdId,
      holding_id: input.holdingId,
      as_of_date: input.date,
      quantity: input.quantity,
      value_minor: input.amount.minor.toString(),
      currency: input.amount.currency,
      source: input.source ?? 'manual',
      note: input.note ?? null,
    },
    { onConflict: 'holding_id,as_of_date' },
  );

  if (result.error !== null) throw asRepositoryError(result.error);
}

/**
 * Carry this month's readings to the month end.
 *
 * Deliberately a button and not something the app does on load. It writes
 * rows, and a screen that quietly writes rows is harder to trust than one that
 * says what it is about to do — which matters more here than usual, because
 * the whole argument for this app is that you can check what it did.
 *
 * Returns what it carried and, more usefully, how many holdings it could not
 * read at all: those are the ones whose peak for the year is now permanently a
 * lower bound.
 */
export async function closeMonth(input: {
  householdId: Uuid;
  monthEnd: IsoDate;
}): Promise<{ carried: number; unread: number }> {
  const client = supabase();

  const { data, error } = await client.rpc('close_month', {
    target_household_id: input.householdId,
    month_end: input.monthEnd,
  });

  if (error !== null) throw asRepositoryError(error);

  // A set-returning function comes back as an array of one row.
  const row = Array.isArray(data) ? data[0] : data;
  const record = requireRecord(row, 'close_month');
  return {
    carried: Number(record['carried'] ?? 0),
    unread: Number(record['unread'] ?? 0),
  };
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('You do not have permission to do that in this household.');
  }
  if (error.code === '23505') {
    return new Error('That already exists — check whether it has been recorded once already.');
  }
  return new Error(error.message);
}

/**
 * Other members' personal holdings, one sum each.
 *
 * The half of §20 the holding policy promised and nothing delivered until
 * `20260911120000`: without this, every asset total in the app is short by
 * whatever the rest of the household holds privately, and two members looking
 * at "what we are worth" see different figures.
 *
 * Failing is not the same as empty, and must not be flattened into `[]`. A
 * household with private holdings would then show a total that is too low —
 * the exact failure the function exists to prevent, silently.
 */
export async function listPersonalHoldingTotals(
  householdId: Uuid,
): Promise<readonly PersonalHoldingTotal[]> {
  const client = supabase();

  // Named argument: PostgREST resolves a function by parameter name, and a
  // positional call would not find it at all.
  const { data, error } = await client.rpc('personal_holding_totals', {
    target_household_id: householdId,
  });

  if (error !== null) throw asRepositoryError(error);
  if (data === null) return [];
  if (!Array.isArray(data)) {
    throw new MalformedRowError('personal_holding_totals', 'did not return a set of rows');
  }

  return data.map((row: unknown) => {
    const record = requireRecord(row, 'personal_holding_totals');
    const unvalued = record['unvalued'];
    return {
      memberId: requireString(record['member_id'], 'personal_holding_totals.member_id'),
      // Refuses a figure too large to have survived JSON rather than rounding
      // it: a sum that cannot be trusted throws instead of understating a
      // household total by a few paise.
      total: money(
        toBigIntExact(record['total_minor'], 'personal_holding_totals.total_minor'),
        requireString(record['currency'], 'personal_holding_totals.currency'),
      ),
      unvalued: typeof unvalued === 'number' ? unvalued : 0,
    };
  });
}
