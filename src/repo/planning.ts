/**
 * The plan: what the household intends to spend, and what it is committed to.
 *
 * Distinct from the ledger, deliberately. The workbook keeps a planning sheet
 * and this is its replacement — the estimate that produces an approximate
 * annual expense and, through it, the FIRE target. What was actually spent
 * lives in expense_txn and is a different question, answered on a different
 * screen and compared with this one rather than replacing it.
 */

import { supabase } from './client.ts';
import { currentAccountId } from './account.ts';
import type { IsoDate } from '../lib/dates.ts';
import {
  MalformedRowError,
  optionalString,
  requireOneOf,
  requireRecord,
  requireString,
  toBigIntExact,
} from '../lib/guards.ts';
import { money, type Money } from '../lib/money.ts';
import { toExpenseCategory, toHousehold, toMember, toRole } from './mapping.ts';
import {
  BUDGET_CADENCES,
  COMMITMENT_CADENCES,
  LIABILITY_KINDS,
  NoHouseholdError,
  POLICY_KINDS,
  type Budget,
  type BudgetCadence,
  type CategoryNature,
  type CommitmentCadence,
  type InsurancePolicy,
  type Liability,
  type LiabilityKind,
  type Member,
  type PlanListing,
  type PolicyKind,
  type Uuid,
} from './types.ts';

const CAN_PLAN: readonly string[] = ['owner', 'partner'];

const CATEGORY_COLUMNS = 'id, name, nature, parent_id, is_essential, sort_order, status';
const BUDGET_COLUMNS = 'id, category_id, fy, cadence, period, planned_minor::text, currency, member_id';
const LIABILITY_COLUMNS =
  'id, name, kind, instalment_minor::text, currency, cadence, member_id, status, outstanding_minor::text, outstanding_as_of';
const POLICY_COLUMNS =
  'id, name, kind, premium_minor::text, currency, cadence, member_id, status, insurer, policy_last4, cover_minor::text, started_on, renewal_on, linked_holding_id';

/**
 * What is still owed, or null.
 *
 * Null and zero are different facts here and the screen shows them
 * differently: nobody has said, versus it is paid off.
 */
function outstandingOf(row: Record<string, unknown>, currency: string): Money | null {
  const raw = row['outstanding_minor'];
  if (raw === null || raw === undefined) return null;
  return money(toBigIntExact(raw, 'liability.outstanding_minor'), currency);
}

function toBudget(raw: unknown): Budget {
  const row = requireRecord(raw, 'budget');
  const fy = row['fy'];
  const period = row['period'];
  if (typeof fy !== 'number') throw new MalformedRowError('budget.fy', 'is not a number');
  if (period !== null && typeof period !== 'number') {
    throw new MalformedRowError('budget.period', 'is neither null nor a month number');
  }
  return {
    id: requireString(row['id'], 'budget.id'),
    categoryId: requireString(row['category_id'], 'budget.category_id'),
    fy,
    cadence: requireOneOf<BudgetCadence>(row['cadence'], BUDGET_CADENCES, 'budget.cadence'),
    period,
    planned: money(
      toBigIntExact(row['planned_minor'], 'budget.planned_minor'),
      requireString(row['currency'], 'budget.currency'),
    ),
    memberId: optionalString(row['member_id'], 'budget.member_id'),
  };
}

/** A liability and a policy differ only in what the amount is called. */
function toCommitment<K extends string>(
  raw: unknown,
  table: string,
  amountColumn: string,
  kinds: readonly K[],
  closedStatus: string,
): {
  id: string;
  name: string;
  kind: K;
  amount: Money | null;
  cadence: CommitmentCadence;
  memberId: string | null;
  closed: boolean;
} {
  const row = requireRecord(raw, table);
  const amount = row[amountColumn];
  const currency = requireString(row['currency'], `${table}.currency`);

  return {
    id: requireString(row['id'], `${table}.id`),
    name: requireString(row['name'], `${table}.name`),
    kind: requireOneOf<K>(row['kind'], kinds, `${table}.kind`),
    amount:
      amount === null || amount === undefined
        ? null
        : money(toBigIntExact(amount, `${table}.${amountColumn}`), currency),
    cadence: requireOneOf<CommitmentCadence>(
      row['cadence'],
      COMMITMENT_CADENCES,
      `${table}.cadence`,
    ),
    memberId: optionalString(row['member_id'], `${table}.member_id`),
    closed:
      requireOneOf(row['status'], ['active', closedStatus] as const, `${table}.status`) ===
      closedStatus,
  };
}

export async function listPlan(options: {
  householdId?: Uuid;
  fy: number;
}): Promise<PlanListing> {
  const client = supabase();

  // The caller's own membership. Not every membership in the household: see account.ts.
  const accountId = await currentAccountId();
  let membershipQuery = client
    .from('membership')
    .select('id, role, member_id, user_account_id, household:household_id (*)')
    .eq('user_account_id', accountId)
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

  const [membersResult, categoriesResult, budgetsResult, liabilitiesResult, policiesResult] =
    await Promise.all([
      client
        .from('member')
        .select('id, display_name, colour, status')
        .eq('household_id', household.id)
        .order('display_name', { ascending: true }),
      client
        .from('expense_category')
        .select(CATEGORY_COLUMNS)
        .eq('household_id', household.id)
        .order('sort_order', { ascending: true }),
      client
        .from('budget')
        .select(BUDGET_COLUMNS)
        .eq('household_id', household.id)
        .eq('fy', options.fy),
      client
        .from('liability')
        .select(LIABILITY_COLUMNS)
        .eq('household_id', household.id)
        .order('name', { ascending: true }),
      client
        .from('insurance_policy')
        .select(POLICY_COLUMNS)
        .eq('household_id', household.id)
        .order('name', { ascending: true }),
    ]);

  for (const result of [
    membersResult,
    categoriesResult,
    budgetsResult,
    liabilitiesResult,
    policiesResult,
  ]) {
    if (result.error !== null) throw asRepositoryError(result.error);
  }

  const members: Member[] = membersResult.data?.map(toMember) ?? [];

  const liabilities: Liability[] = (liabilitiesResult.data ?? []).map((row) => {
    const c = toCommitment<LiabilityKind>(
      row,
      'liability',
      'instalment_minor',
      LIABILITY_KINDS,
      'closed',
    );
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      instalment: c.amount,
      cadence: c.cadence,
      memberId: c.memberId,
      isClosed: c.closed,
      outstanding: outstandingOf(row, c.amount?.currency ?? 'INR'),
      outstandingAsOf: optionalString(row['outstanding_as_of'], 'liability.outstanding_as_of') as IsoDate | null,
    };
  });

  const policies: InsurancePolicy[] = (policiesResult.data ?? []).map((row) => {
    const c = toCommitment<PolicyKind>(
      row,
      'insurance_policy',
      'premium_minor',
      POLICY_KINDS,
      'lapsed',
    );
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      premium: c.amount,
      cadence: c.cadence,
      memberId: c.memberId,
      isLapsed: c.closed,
      insurer: optionalString(row['insurer'], 'insurance_policy.insurer'),
      policyLast4: optionalString(row['policy_last4'], 'insurance_policy.policy_last4'),
      cover:
        row['cover_minor'] === null || row['cover_minor'] === undefined
          ? null
          : money(
              toBigIntExact(row['cover_minor'], 'insurance_policy.cover_minor'),
              requireString(row['currency'], 'insurance_policy.currency'),
            ),
      startedOn: optionalString(row['started_on'], 'insurance_policy.started_on') as IsoDate | null,
      renewalOn: optionalString(row['renewal_on'], 'insurance_policy.renewal_on') as IsoDate | null,
      linkedHoldingId: optionalString(row['linked_holding_id'], 'insurance_policy.linked_holding_id'),
    };
  });

  return {
    household,
    viewer: {
      accountId: String(membership.user_account_id),
      memberId: String(membership.member_id),
      role,
      canRecord: ['owner', 'partner', 'contributor'].includes(role),
      canFileForOthers: role === 'owner' || role === 'partner',
    },
    members,
    categories: (categoriesResult.data ?? []).map(toExpenseCategory),
    budgets: (budgetsResult.data ?? []).map(toBudget),
    liabilities,
    policies,
    fy: options.fy,
  };
}

export interface BudgetInput {
  readonly householdId: Uuid;
  readonly categoryId: Uuid;
  readonly fy: number;
  readonly cadence: BudgetCadence;
  readonly planned: Money;
}

/**
 * Set what a category is planned at.
 *
 * An upsert on the one-per-period key, so editing a figure replaces it. A
 * second row at the same cadence would be read as a second envelope, and the
 * annual total would silently double.
 */
export async function setBudget(input: BudgetInput): Promise<void> {
  const client = supabase();
  const result = await client.from('budget').upsert(
    {
      household_id: input.householdId,
      category_id: input.categoryId,
      fy: input.fy,
      cadence: input.cadence,
      period: null,
      planned_minor: input.planned.minor.toString(),
      currency: input.planned.currency,
      member_id: null,
    },
    { onConflict: 'household_id,category_id,fy,cadence,period,member_id' },
  );
  if (result.error !== null) throw asRepositoryError(result.error);
}

export async function addCategory(input: {
  householdId: Uuid;
  name: string;
  nature: CategoryNature;
  sortOrder: number;
}): Promise<void> {
  const client = supabase();
  const result = await client.from('expense_category').insert({
    household_id: input.householdId,
    name: input.name.trim(),
    nature: input.nature,
    sort_order: input.sortOrder,
  });
  if (result.error !== null) throw asRepositoryError(result.error);
}

/**
 * Several categories at once, as chosen from the suggestion list.
 *
 * One insert rather than a loop of them: a partial set is worse than none.
 * Somebody who ticks eleven boxes and gets seven categories has to work out
 * which four are missing, and the four that failed are indistinguishable from
 * four they never ticked.
 */
export async function addCategories(input: {
  householdId: Uuid;
  items: readonly { name: string; nature: CategoryNature }[];
  /** Where to start numbering, so a second batch lands after the first. */
  fromSortOrder: number;
}): Promise<number> {
  if (input.items.length === 0) return 0;

  const client = supabase();
  const rows = input.items.map((item, index) => ({
    household_id: input.householdId,
    name: item.name.trim(),
    nature: item.nature,
    sort_order: input.fromSortOrder + index * 10,
  }));

  const result = await client.from('expense_category').insert(rows);
  if (result.error !== null) throw asRepositoryError(result.error);
  return rows.length;
}

/**
 * Archive a category rather than remove it.
 *
 * "A category that has ever been used is archived rather than deleted,
 * disappearing from the picker while remaining on every historical row it
 * appears in" (§269). There is no delete here to offer, and that is the point.
 */
export async function archiveCategory(id: Uuid, archived: boolean): Promise<void> {
  const client = supabase();
  const result = await client
    .from('expense_category')
    .update(
      archived
        ? { status: 'archived', archived_at: new Date().toISOString() }
        : { status: 'active', archived_at: null },
    )
    .eq('id', id);
  if (result.error !== null) throw asRepositoryError(result.error);
}

export async function renameCategory(id: Uuid, name: string): Promise<void> {
  const client = supabase();
  const result = await client
    .from('expense_category')
    .update({ name: name.trim() })
    .eq('id', id);
  if (result.error !== null) throw asRepositoryError(result.error);
}

/**
 * Restate what is owed on a liability, as at a date.
 *
 * The date is not optional. A balance without one silently ages into a wrong
 * figure, and the column constraint refuses the pair anyway — better to be
 * refused here, with a sentence, than by an error code.
 */
export async function setLiabilityBalance(input: {
  id: Uuid;
  outstanding: Money;
  asOf: IsoDate;
}): Promise<void> {
  const client = supabase();
  const result = await client
    .from('liability')
    .update({
      outstanding_minor: input.outstanding.minor.toString(),
      outstanding_as_of: input.asOf,
    })
    .eq('id', input.id);
  if (result.error !== null) throw asRepositoryError(result.error);
}

/**
 * Set the household's FIRE assumptions.
 *
 * One row, one answer. These were per-device state, which meant a couple
 * planning together saw two different targets; writing them to the household
 * is what makes the number common to both.
 *
 * Owner and partner only, enforced by the policy rather than here — this
 * translates the refusal into a sentence rather than deciding it.
 */
export async function setFireSettings(input: {
  householdId: Uuid;
  multiplier?: number;
  inflationPct?: number;
  yearsAhead?: number;
  returnPct?: number;
  stepUpPct?: number;
  monthlyContributionMinor?: bigint;
}): Promise<void> {
  const client = supabase();

  const patch: Record<string, unknown> = {};
  if (input.multiplier !== undefined) patch['fire_multiplier'] = input.multiplier;
  if (input.inflationPct !== undefined) patch['fire_inflation_pct'] = input.inflationPct;
  if (input.yearsAhead !== undefined) patch['fire_years_ahead'] = input.yearsAhead;
  if (input.returnPct !== undefined) patch['fire_return_pct'] = input.returnPct;
  if (input.stepUpPct !== undefined) patch['fire_step_up_pct'] = input.stepUpPct;
  // A bigint does not survive JSON.stringify; the column is a bigint, and a string of digits is what
  // PostgREST reads into one exactly.
  if (input.monthlyContributionMinor !== undefined) {
    patch['fire_monthly_contribution_minor'] = input.monthlyContributionMinor.toString();
  }
  if (Object.keys(patch).length === 0) return;

  const result = await client
    .from('household')
    .update(patch)
    .eq('id', input.householdId)
    .select('id');
  if (result.error !== null) throw asRepositoryError(result.error);
  if ((result.data ?? []).length === 0) {
    throw new Error('Only an owner or partner can change the household target.');
  }
}

export async function addLiability(input: {
  householdId: Uuid;
  name: string;
  kind: LiabilityKind;
  instalment: Money;
  cadence: CommitmentCadence;
}): Promise<void> {
  const client = supabase();
  const result = await client.from('liability').insert({
    household_id: input.householdId,
    name: input.name.trim(),
    kind: input.kind,
    instalment_minor: input.instalment.minor.toString(),
    currency: input.instalment.currency,
    cadence: input.cadence,
  });
  if (result.error !== null) throw asRepositoryError(result.error);
}

/** What a policy form can say beyond its name, kind and premium: every column the table has. */
export interface PolicyDetail {
  readonly insurer?: string | null;
  /** The last four characters of the policy number. Refused at five, here with a sentence. */
  readonly policyLast4?: string | null;
  readonly cover?: Money | null;
  readonly startedOn?: IsoDate | null;
  readonly renewalOn?: IsoDate | null;
  readonly linkedHoldingId?: Uuid | null;
  readonly memberId?: Uuid | null;
}

function policyFields(detail: PolicyDetail): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (detail.insurer !== undefined) {
    fields['insurer'] = detail.insurer === null || detail.insurer.trim() === '' ? null : detail.insurer.trim();
  }
  if (detail.policyLast4 !== undefined) {
    const last4 = detail.policyLast4 === null ? '' : detail.policyLast4.trim();
    if (last4 !== '' && !/^[0-9A-Za-z]{4}$/.test(last4)) {
      throw new Error(
        'Only the last four characters of a policy number are kept, so this is four letters or digits and no more.',
      );
    }
    fields['policy_last4'] = last4 === '' ? null : last4;
  }
  if (detail.cover !== undefined) {
    fields['cover_minor'] = detail.cover === null ? null : detail.cover.minor.toString();
  }
  if (detail.startedOn !== undefined) fields['started_on'] = detail.startedOn;
  if (detail.renewalOn !== undefined) fields['renewal_on'] = detail.renewalOn;
  if (detail.linkedHoldingId !== undefined) fields['linked_holding_id'] = detail.linkedHoldingId;
  if (detail.memberId !== undefined) fields['member_id'] = detail.memberId;
  return fields;
}

export async function addPolicy(
  input: {
    householdId: Uuid;
    name: string;
    kind: PolicyKind;
    premium: Money;
    cadence: CommitmentCadence;
  } & PolicyDetail,
): Promise<void> {
  const client = supabase();
  const result = await client.from('insurance_policy').insert({
    household_id: input.householdId,
    name: input.name.trim(),
    kind: input.kind,
    premium_minor: input.premium.minor.toString(),
    currency: input.premium.currency,
    cadence: input.cadence,
    ...policyFields(input),
  });
  if (result.error !== null) throw asRepositoryError(result.error);
}

/**
 * Correct a policy. Rows returned are checked and not only the error: a policy-refused update comes back
 * with neither, and would read as a save the database did not make.
 *
 * A policy is lapsed, not deleted: its history is the household's arithmetic, and the table has no
 * delete grant at all.
 */
export async function updatePolicy(
  id: Uuid,
  patch: PolicyDetail & {
    readonly name?: string;
    readonly kind?: PolicyKind;
    readonly premium?: Money;
    readonly cadence?: CommitmentCadence;
    readonly lapsed?: boolean;
  },
): Promise<void> {
  const client = supabase();
  const fields = policyFields(patch);
  if (patch.name !== undefined) {
    if (patch.name.trim() === '') throw new Error('A policy needs a name.');
    fields['name'] = patch.name.trim();
  }
  if (patch.kind !== undefined) fields['kind'] = patch.kind;
  if (patch.premium !== undefined) {
    fields['premium_minor'] = patch.premium.minor.toString();
    fields['currency'] = patch.premium.currency;
  }
  if (patch.cadence !== undefined) fields['cadence'] = patch.cadence;
  if (patch.lapsed !== undefined) {
    fields['status'] = patch.lapsed ? 'lapsed' : 'active';
    fields['lapsed_at'] = patch.lapsed ? new Date().toISOString() : null;
  }
  if (Object.keys(fields).length === 0) return;

  const result = await client.from('insurance_policy').update(fields).eq('id', id).select('id');
  if (result.error !== null) throw asRepositoryError(result.error);
  if ((result.data ?? []).length === 0) {
    throw new Error('That policy could not be changed. Only an owner or partner can change one.');
  }
}

/** The one household setting the cover gap has. Whole years, 0 to 50, which the database also checks. */
export async function setCoverDependencyYears(householdId: Uuid, years: number): Promise<void> {
  if (!Number.isInteger(years) || years < 0 || years > 50) {
    throw new Error('Years of dependency is a whole number from 0 to 50.');
  }
  const result = await supabase()
    .from('household')
    .update({ cover_dependency_years: years })
    .eq('id', householdId)
    .select('id');
  if (result.error !== null) throw asRepositoryError(result.error);
  if ((result.data ?? []).length === 0) {
    throw new Error('Only an owner or partner can change the years of dependency.');
  }
}

/** Roles that may set a plan. Recording a spend and planning one differ. */
export function canPlan(role: string): boolean {
  return CAN_PLAN.includes(role);
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('Only an owner or partner can change the plan.');
  }
  if (error.code === '23505') {
    return new Error('That already exists.');
  }
  return new Error(error.message);
}
