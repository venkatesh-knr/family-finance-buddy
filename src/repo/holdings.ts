/**
 * The holdings repository: what is owned, and what it was worth.
 *
 *   listHoldings()      — everything the screen needs in one load
 *   addHolding()        — an instrument and a position in it
 *   recordValuation()   — one dated reading
 *
 * Same seam as expenses: no Supabase type crosses back out, and no method takes
 * a householdId it could use to look somewhere it does not belong. Row-level
 * security decides the scope; these functions only ask.
 */

import { supabase } from './client.ts';
import { toHolding, toInstrument, toMember, toValuation } from './mapping.ts';
import {
  NoHouseholdError,
  type Holding,
  type HoldingListing,
  type Member,
  type NewHolding,
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
