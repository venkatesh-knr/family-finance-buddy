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
import {
  MalformedRowError,
  optionalString,
  requireBoolean,
  requireOneOf,
  requireRecord,
  requireString,
  toBigIntExact,
} from '../lib/guards.ts';
import { money, type Money } from '../lib/money.ts';
import { toHousehold, toMember, toRole } from './mapping.ts';
import {
  BUDGET_CADENCES,
  CATEGORY_NATURES,
  COMMITMENT_CADENCES,
  LIABILITY_KINDS,
  NoHouseholdError,
  POLICY_KINDS,
  type Budget,
  type BudgetCadence,
  type CategoryNature,
  type CommitmentCadence,
  type ExpenseCategory,
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
const LIABILITY_COLUMNS = 'id, name, kind, instalment_minor::text, currency, cadence, member_id, status';
const POLICY_COLUMNS = 'id, name, kind, premium_minor::text, currency, cadence, member_id, status';

function toCategory(raw: unknown): ExpenseCategory {
  const row = requireRecord(raw, 'expense_category');
  const sortOrder = row['sort_order'];
  if (typeof sortOrder !== 'number') {
    throw new MalformedRowError('expense_category.sort_order', 'is not a number');
  }
  return {
    id: requireString(row['id'], 'expense_category.id'),
    name: requireString(row['name'], 'expense_category.name'),
    nature: requireOneOf<CategoryNature>(row['nature'], CATEGORY_NATURES, 'expense_category.nature'),
    parentId: optionalString(row['parent_id'], 'expense_category.parent_id'),
    isEssential: requireBoolean(row['is_essential'], 'expense_category.is_essential'),
    sortOrder,
    isArchived:
      requireOneOf(row['status'], ['active', 'archived'] as const, 'expense_category.status') ===
      'archived',
  };
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
    categories: (categoriesResult.data ?? []).map(toCategory),
    budgets: (budgetsResult.data ?? []).map(toBudget),
    liabilities,
    policies,
    fy: options.fy,
  };
}

/** True when this household has nothing to plan with yet. */
export function needsStarterCategories(plan: PlanListing): boolean {
  return plan.categories.length === 0;
}

export async function seedStarterCategories(householdId: Uuid): Promise<number> {
  const client = supabase();
  const result = await client.rpc('seed_starter_categories', {
    target_household_id: householdId,
  });
  if (result.error !== null) throw asRepositoryError(result.error);
  return typeof result.data === 'number' ? result.data : 0;
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

export async function addPolicy(input: {
  householdId: Uuid;
  name: string;
  kind: PolicyKind;
  premium: Money;
  cadence: CommitmentCadence;
}): Promise<void> {
  const client = supabase();
  const result = await client.from('insurance_policy').insert({
    household_id: input.householdId,
    name: input.name.trim(),
    kind: input.kind,
    premium_minor: input.premium.minor.toString(),
    currency: input.premium.currency,
    cadence: input.cadence,
  });
  if (result.error !== null) throw asRepositoryError(result.error);
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
