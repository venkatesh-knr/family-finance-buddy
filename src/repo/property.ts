/**
 * Property: what the household owns in land and buildings, what it cost, and what it is thought to be worth.
 *
 * The only place the property screen reads or writes the database (docs/decisions.md, Property; the schema is
 * `supabase/migrations/20261026120000_property.sql`). Nothing here works out a figure: the cost basis, the share,
 * the equity and the staleness are `src/domain/property.ts`, and what is stored is only what somebody said.
 *
 * Row-level security decides what comes back, as everywhere: the household's shared properties and the caller's own,
 * a contributor's own alone, and nothing for a viewer.
 */

import type { IsoDate } from '../lib/dates.ts';
import { optionalString, requireRecord, requireString, toBigIntExact } from '../lib/guards.ts';
import { money, type Money } from '../lib/money.ts';
import { supabase } from './client.ts';
import { currentAccountId } from './account.ts';
import { toHousehold, toMember, toProperty, toPropertyImprovement, toPropertyValuation, toRole } from './mapping.ts';
import {
  NoHouseholdError,
  type Member,
  type NewProperty,
  type NewPropertyImprovement,
  type NewPropertyValuation,
  type PropertyKind,
  type PropertyListing,
  type PropertyLoan,
  type Uuid,
} from './types.ts';

const PROPERTY_COLUMNS =
  'id, member_id, kind, label, currency, purchase_date, purchase_cost_minor::text, stamp_duty_minor::text, registration_minor::text, co_owner_share_pct::text, is_self_occupied, linked_liability_id, visibility, status, note';
const IMPROVEMENT_COLUMNS = 'id, property_id, currency, work_date, description, amount_minor::text, is_capital, voided_at';
const VALUATION_COLUMNS = 'id, property_id, currency, as_of_date, value_minor::text, basis, note';
const LOAN_COLUMNS = 'id, name, status, currency, outstanding_minor::text, outstanding_as_of';

/** The household's stale-after setting when its row does not carry one: the default the migration gives it. */
const DEFAULT_STALE_MONTHS = 12;

/**
 * The household's properties with their work and their valuations, and the loans one can be linked to.
 *
 * `includeArchived` is for a screen that draws the past; the property screen leaves it off.
 */
export async function listProperties(
  options: { householdId?: Uuid; includeArchived?: boolean } = {},
): Promise<PropertyListing> {
  const client = supabase();

  // Narrows the view to one household and cannot widen access: see the note in expenses.ts.
  const accountId = await currentAccountId();
  let membershipQuery = client
    .from('membership')
    .select('id, role, member_id, user_account_id, household:household_id (*)')
    .eq('user_account_id', accountId)
    .is('revoked_at', null)
    .order('created_at', { ascending: true });
  if (options.householdId !== undefined) membershipQuery = membershipQuery.eq('household_id', options.householdId);

  const membershipResult = await membershipQuery.limit(1);
  if (membershipResult.error !== null) throw asRepositoryError(membershipResult.error);

  const membership = membershipResult.data[0];
  if (membership === undefined) throw new NoHouseholdError();

  const household = toHousehold(membership.household);
  const role = toRole(membership.role);
  const staleRaw = requireRecord(membership.household, 'household')['property_valuation_stale_months'];
  const staleMonths = typeof staleRaw === 'number' && staleRaw >= 1 ? staleRaw : DEFAULT_STALE_MONTHS;

  const membersResult = await client
    .from('member')
    .select('id, display_name, colour, status')
    .eq('household_id', household.id)
    .order('display_name', { ascending: true });
  if (membersResult.error !== null) throw asRepositoryError(membersResult.error);

  const members: Member[] = membersResult.data.map(toMember);
  const membersById = new Map(members.map((member) => [member.id, member]));

  let propertiesQuery = client.from('property').select(PROPERTY_COLUMNS).eq('household_id', household.id);
  if (options.includeArchived !== true) propertiesQuery = propertiesQuery.eq('status', 'active');

  const [propertiesResult, improvementsResult, valuationsResult, loansResult] = await Promise.all([
    propertiesQuery.order('created_at', { ascending: true }),
    client
      .from('property_improvement')
      .select(IMPROVEMENT_COLUMNS)
      .eq('household_id', household.id)
      .order('work_date', { ascending: true }),
    client
      .from('property_valuation')
      .select(VALUATION_COLUMNS)
      .eq('household_id', household.id)
      .order('as_of_date', { ascending: false }),
    client.from('liability').select(LOAN_COLUMNS).eq('household_id', household.id).order('name', { ascending: true }),
  ]);
  for (const result of [propertiesResult, improvementsResult, valuationsResult, loansResult]) {
    if (result.error !== null) throw asRepositoryError(result.error);
  }

  const loans: PropertyLoan[] = (loansResult.data ?? []).map((raw: unknown) => {
    const row = requireRecord(raw, 'liability');
    const currency = requireString(row['currency'], 'liability.currency');
    const outstanding = row['outstanding_minor'];
    return {
      id: requireString(row['id'], 'liability.id'),
      name: requireString(row['name'], 'liability.name'),
      isClosed: row['status'] === 'closed',
      // Null is "nobody has said", which is not nothing owed.
      outstanding:
        outstanding === null || outstanding === undefined
          ? null
          : money(toBigIntExact(outstanding, 'liability.outstanding_minor'), currency),
      outstandingAsOf: optionalString(row['outstanding_as_of'], 'liability.outstanding_as_of') as IsoDate | null,
    };
  });

  return {
    household,
    staleMonths,
    viewer: {
      accountId: String(membership.user_account_id),
      memberId: String(membership.member_id),
      role,
      canRecord: ['owner', 'partner', 'contributor'].includes(role),
      canFileForOthers: role === 'owner' || role === 'partner',
    },
    members,
    properties: (propertiesResult.data ?? []).map((row: unknown) => toProperty(row, membersById)),
    improvements: (improvementsResult.data ?? []).map(toPropertyImprovement),
    valuations: (valuationsResult.data ?? []).map(toPropertyValuation),
    loans,
  };
}

/** The share is a percentage with up to two decimal places, in (0, 100]. The table says so too; this says it first. */
const SHARE = /^\d{1,3}(\.\d{1,2})?$/;

function checkProperty(input: {
  label?: string;
  sharePct?: string;
  amounts: readonly Money[];
}): void {
  if (input.label !== undefined && input.label.trim() === '') throw new Error('A property needs a name.');
  if (input.sharePct !== undefined) {
    const share = Number(input.sharePct);
    if (!SHARE.test(input.sharePct) || share <= 0 || share > 100) {
      throw new Error('The household’s share is a percentage above 0 and up to 100, with at most two decimal places.');
    }
  }
  if (input.amounts.some((amount) => amount.minor < 0n)) throw new Error('An amount cannot be negative.');
}

/** File a property. The cost basis is worked out when it is read, and never stored. */
export async function addProperty(input: NewProperty): Promise<{ readonly propertyId: string }> {
  checkProperty({
    label: input.label,
    sharePct: input.sharePct,
    amounts: [input.purchaseCost, input.stampDuty, input.registration],
  });
  for (const amount of [input.stampDuty, input.registration]) {
    if (amount.currency !== input.purchaseCost.currency) {
      throw new Error('The stamp duty and registration are in the same currency as the price.');
    }
  }

  const { data, error } = await supabase()
    .from('property')
    .insert({
      household_id: input.householdId,
      member_id: input.memberId,
      kind: input.kind,
      label: input.label.trim(),
      currency: input.purchaseCost.currency,
      purchase_date: input.purchaseDate,
      purchase_cost_minor: input.purchaseCost.minor.toString(),
      stamp_duty_minor: input.stampDuty.minor.toString(),
      registration_minor: input.registration.minor.toString(),
      co_owner_share_pct: input.sharePct,
      is_self_occupied: input.isSelfOccupied,
      linked_liability_id: input.linkedLiabilityId ?? null,
      note: input.note === undefined || input.note === null || input.note.trim() === '' ? null : input.note.trim(),
    })
    .select('id')
    .single();

  if (error !== null) throw asRepositoryError(error);
  return { propertyId: String(data.id) };
}

export interface PropertyPatch {
  readonly label?: string;
  readonly kind?: PropertyKind;
  readonly purchaseDate?: IsoDate;
  readonly purchaseCost?: Money;
  readonly stampDuty?: Money;
  readonly registration?: Money;
  readonly sharePct?: string;
  readonly isSelfOccupied?: boolean;
  readonly linkedLiabilityId?: Uuid | null;
  readonly note?: string | null;
}

/**
 * Correct a property in place. The currency is not here: the work and the valuations are in it, and a property
 * entered in the wrong currency is archived and entered again. Whoever the screen offers it to, the policy decides.
 */
export async function updateProperty(id: Uuid, patch: PropertyPatch): Promise<void> {
  checkProperty({
    ...(patch.label === undefined ? {} : { label: patch.label }),
    ...(patch.sharePct === undefined ? {} : { sharePct: patch.sharePct }),
    amounts: [patch.purchaseCost, patch.stampDuty, patch.registration].filter((a): a is Money => a !== undefined),
  });

  const fields: Record<string, unknown> = {};
  if (patch.label !== undefined) fields['label'] = patch.label.trim();
  if (patch.kind !== undefined) fields['kind'] = patch.kind;
  if (patch.purchaseDate !== undefined) fields['purchase_date'] = patch.purchaseDate;
  if (patch.purchaseCost !== undefined) fields['purchase_cost_minor'] = patch.purchaseCost.minor.toString();
  if (patch.stampDuty !== undefined) fields['stamp_duty_minor'] = patch.stampDuty.minor.toString();
  if (patch.registration !== undefined) fields['registration_minor'] = patch.registration.minor.toString();
  if (patch.sharePct !== undefined) fields['co_owner_share_pct'] = patch.sharePct;
  if (patch.isSelfOccupied !== undefined) fields['is_self_occupied'] = patch.isSelfOccupied;
  if (patch.linkedLiabilityId !== undefined) fields['linked_liability_id'] = patch.linkedLiabilityId;
  if (patch.note !== undefined) fields['note'] = patch.note === null || patch.note.trim() === '' ? null : patch.note.trim();
  if (Object.keys(fields).length === 0) return;

  const { data, error } = await supabase().from('property').update(fields).eq('id', id).select('id');
  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) {
    throw new Error('That property could not be changed. It may belong to another member.');
  }
}

/** Archived, never deleted: its history is the household's arithmetic. */
export async function archiveProperty(id: Uuid): Promise<void> {
  const { data, error } = await supabase()
    .from('property')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');

  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) {
    throw new Error('That property could not be archived. It may belong to another member.');
  }
}

/** Record work on a property. Capital work adds to the cost basis; a repair is recorded and does not. */
export async function addPropertyImprovement(input: NewPropertyImprovement): Promise<void> {
  if (input.description.trim() === '') throw new Error('Say what the work was.');
  if (input.amount.minor <= 0n) throw new Error('Work has a cost above nothing.');

  const { error } = await supabase().from('property_improvement').insert({
    household_id: input.householdId,
    property_id: input.propertyId,
    currency: input.amount.currency,
    work_date: input.date,
    description: input.description.trim(),
    amount_minor: input.amount.minor.toString(),
    is_capital: input.isCapital,
  });
  if (error !== null) throw asRepositoryError(error);
}

/** Void a piece of work recorded by mistake. Never deleted, so it stays in the log and out of the cost. */
export async function voidPropertyImprovement(id: Uuid): Promise<void> {
  const { data, error } = await supabase()
    .from('property_improvement')
    .update({ voided_at: new Date().toISOString() })
    .eq('id', id)
    .is('voided_at', null)
    .select('id');

  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) throw new Error('That entry could not be voided. It may already have been.');
}

/**
 * Record what a property is thought to be worth on a day, and how that was arrived at.
 *
 * An upsert on (property, day), because correcting a misread figure should replace it and not leave two estimates
 * for one day. An earlier day's figure is never touched by a later one, which is what keeps yesterday's net worth.
 */
export async function recordPropertyValuation(input: NewPropertyValuation): Promise<void> {
  if (input.value.minor < 0n) throw new Error('A valuation cannot be negative.');

  const { error } = await supabase().from('property_valuation').upsert(
    {
      household_id: input.householdId,
      property_id: input.propertyId,
      currency: input.value.currency,
      as_of_date: input.asOf,
      value_minor: input.value.minor.toString(),
      basis: input.basis,
      note: input.note === undefined || input.note === null || input.note.trim() === '' ? null : input.note.trim(),
    },
    { onConflict: 'property_id,as_of_date' },
  );
  if (error !== null) throw asRepositoryError(error);
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
  if (error.code === '23503') {
    return new Error('That does not fit this property: check its currency and the loan it is linked to.');
  }
  return new Error(error.message);
}
