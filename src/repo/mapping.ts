/**
 * The mapping from database rows to domain objects.
 *
 * Pure functions, taking `unknown` and returning our types, so the boundary can
 * be tested without a database in front of it. This is the exact point where a
 * provider's response shape stops and the app's vocabulary starts.
 */

import { isIsoDate, type IsoDate } from '../lib/dates.ts';
import {
  MalformedRowError,
  optionalString,
  requireBoolean,
  requireOneOf,
  requireRecord,
  requireString,
  toBigIntExact,
} from '../lib/guards.ts';
import { money } from '../lib/money.ts';
import {
  CATEGORY_NATURES,
  HOUSEHOLD_KINDS,
  HOUSEHOLD_ROLES,
  INSTRUMENT_KINDS,
  MEMBER_COLOURS,
  PAYMENT_METHODS,
  VALUATION_SOURCES,
  type Expense,
  type Holding,
  type Household,
  type HouseholdRole,
  type Instrument,
  type Member,
  type PaymentMethod,
  type ExpenseCategory,
  type Quantity,
  type Valuation,
} from './types.ts';

function requireIsoDate(value: unknown, field: string): IsoDate {
  const text = requireString(value, field);
  if (!isIsoDate(text)) {
    throw new MalformedRowError(field, `is ${JSON.stringify(text)}, not a calendar date`);
  }
  return text;
}

/**
 * An embedded to-one relation comes back as an object, but a single-element
 * array is also a shape PostgREST produces depending on how it infers the
 * relationship. Accepting both here costs one line and removes a failure that
 * would otherwise only ever show up against a live database.
 */
function unwrapEmbedded(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function toHousehold(raw: unknown): Household {
  const row = requireRecord(unwrapEmbedded(raw), 'household');
  const fyStartMonth = row['fy_start_month'];
  if (typeof fyStartMonth !== 'number' || !Number.isInteger(fyStartMonth)) {
    throw new MalformedRowError('household.fy_start_month', 'is not a whole month number');
  }
  return {
    id: requireString(row['id'], 'household.id'),
    name: requireString(row['name'], 'household.name'),
    kind: requireOneOf(row['kind'], HOUSEHOLD_KINDS, 'household.kind'),
    baseCurrency: requireString(row['base_currency'], 'household.base_currency'),
    displayCurrency: requireString(row['display_currency'], 'household.display_currency'),
    fyStartMonth,
  };
}

export function toMember(raw: unknown): Member {
  const row = requireRecord(raw, 'member');
  return {
    id: requireString(row['id'], 'member.id'),
    displayName: requireString(row['display_name'], 'member.display_name'),
    colour: requireOneOf(row['colour'], MEMBER_COLOURS, 'member.colour'),
    isArchived: requireOneOf(row['status'], ['active', 'archived'] as const, 'member.status') === 'archived',
  };
}

export function toRole(raw: unknown): HouseholdRole {
  return requireOneOf(raw, HOUSEHOLD_ROLES, 'membership.role');
}

/**
 * An expense row, with its member resolved from the members already loaded for
 * the household. Passing them in rather than embedding a join keeps this
 * function pure and the row shape flat.
 */
export function toExpense(raw: unknown, membersById: ReadonlyMap<string, Member>): Expense {
  const row = requireRecord(raw, 'expense_txn');

  const memberId = requireString(row['member_id'], 'expense_txn.member_id');
  const member = membersById.get(memberId);
  if (member === undefined) {
    throw new MalformedRowError(
      'expense_txn.member_id',
      `points at a member (${memberId}) that is not in this household`,
    );
  }

  const currency = requireString(row['currency'], 'expense_txn.currency');
  const methodRaw = optionalString(row['method'], 'expense_txn.method');

  return {
    id: requireString(row['id'], 'expense_txn.id'),
    householdId: requireString(row['household_id'], 'expense_txn.household_id'),
    member,
    categoryId: optionalString(row['category_id'], 'expense_txn.category_id'),
    date: requireIsoDate(row['txn_date'], 'expense_txn.txn_date'),
    amount: money(toBigIntExact(row['amount_minor'], 'expense_txn.amount_minor'), currency),
    payee: optionalString(row['payee'], 'expense_txn.payee'),
    method: methodRaw === null ? null : requireOneOf<PaymentMethod>(methodRaw, PAYMENT_METHODS, 'expense_txn.method'),
    note: optionalString(row['note'], 'expense_txn.note'),
    isVoided: optionalString(row['voided_at'], 'expense_txn.voided_at') !== null,
  };
}

/**
 * A quantity, kept as a decimal string.
 *
 * PostgREST renders numeric as a string precisely so precision survives the
 * trip, and turning it into a Number here would throw that away for the sake
 * of a type that cannot hold 12.3456789 exactly. It stays a string.
 */
function requireQuantity(value: unknown, field: string): Quantity {
  if (typeof value === 'number') {
    // A driver configured to hand back numerics as numbers has already rounded.
    // Refuse rather than accept a figure that may have lost digits in transit.
    throw new MalformedRowError(
      field,
      'arrived as a number, which cannot hold a fractional share exactly — expected a decimal string',
    );
  }
  const text = requireString(value, field);
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new MalformedRowError(field, `is ${JSON.stringify(text)}, not a decimal number`);
  }
  return text;
}

export function toInstrument(raw: unknown): Instrument {
  const row = requireRecord(unwrapEmbedded(raw), 'instrument');
  return {
    id: requireString(row['id'], 'instrument.id'),
    name: requireString(row['name'], 'instrument.name'),
    kind: requireOneOf(row['kind'], INSTRUMENT_KINDS, 'instrument.kind'),
    symbol: optionalString(row['symbol'], 'instrument.symbol'),
    currency: requireString(row['currency'], 'instrument.currency'),
    exposureCurrency: requireString(row['exposure_currency'], 'instrument.exposure_currency'),
    isForeignAsset: requireBoolean(row['is_foreign_asset'], 'instrument.is_foreign_asset'),
    isArchived:
      requireOneOf(row['status'], ['active', 'archived'] as const, 'instrument.status') === 'archived',
  };
}

/**
 * A holding, with its member and instrument resolved from what the household
 * has already loaded.
 *
 * Neither is embedded in the query. Both foreign keys are composite —
 * (household_id, member_id) and (household_id, instrument_id) — which is what
 * makes it impossible for a holding to reference an instrument from another
 * household. The cost is that PostgREST cannot infer a to-one embed from the
 * single column, so the rows are fetched separately and joined here. That is
 * the trade, and it is the right way round: the guarantee lives in the
 * database, and the inconvenience lives in one function.
 */
export function toHolding(
  raw: unknown,
  membersById: ReadonlyMap<string, Member>,
  instrumentsById: ReadonlyMap<string, Instrument>,
): Holding {
  const row = requireRecord(raw, 'holding');

  const memberId = requireString(row['member_id'], 'holding.member_id');
  const member = membersById.get(memberId);
  if (member === undefined) {
    throw new MalformedRowError(
      'holding.member_id',
      `points at a member (${memberId}) that is not in this household`,
    );
  }

  const instrumentId = requireString(row['instrument_id'], 'holding.instrument_id');
  const instrument = instrumentsById.get(instrumentId);
  if (instrument === undefined) {
    throw new MalformedRowError(
      'holding.instrument_id',
      `points at an instrument (${instrumentId}) that is not in this household`,
    );
  }

  const costMinor = row['cost_minor'];

  return {
    id: requireString(row['id'], 'holding.id'),
    householdId: requireString(row['household_id'], 'holding.household_id'),
    member,
    instrument,
    quantity: requireQuantity(row['quantity'], 'holding.quantity'),
    cost:
      costMinor === null || costMinor === undefined
        ? null
        : money(toBigIntExact(costMinor, 'holding.cost_minor'), instrument.currency),
    openedOn: row['opened_on'] === null || row['opened_on'] === undefined
      ? null
      : requireIsoDate(row['opened_on'], 'holding.opened_on'),
    isArchived:
      requireOneOf(row['status'], ['active', 'archived'] as const, 'holding.status') === 'archived',
  };
}

export function toValuation(raw: unknown): Valuation {
  const row = requireRecord(raw, 'valuation_snapshot');
  const currency = requireString(row['currency'], 'valuation_snapshot.currency');

  return {
    id: requireString(row['id'], 'valuation_snapshot.id'),
    holdingId: requireString(row['holding_id'], 'valuation_snapshot.holding_id'),
    date: requireIsoDate(row['as_of_date'], 'valuation_snapshot.as_of_date'),
    quantity: requireQuantity(row['quantity'], 'valuation_snapshot.quantity'),
    amount: money(toBigIntExact(row['value_minor'], 'valuation_snapshot.value_minor'), currency),
    source: requireOneOf(row['source'], VALUATION_SOURCES, 'valuation_snapshot.source'),
    note: optionalString(row['note'], 'valuation_snapshot.note'),
  };
}

/**
 * A category row.
 *
 * Shared by the expenses repository and the planning one: the same rows answer
 * "what may I file this under" and "what did we mean to spend", and two
 * mappers would eventually disagree about one of them.
 */
export function toExpenseCategory(raw: unknown): ExpenseCategory {
  const row = requireRecord(raw, 'expense_category');
  const sortOrder = row['sort_order'];
  if (typeof sortOrder !== 'number') {
    throw new MalformedRowError('expense_category.sort_order', 'is not a number');
  }
  return {
    id: requireString(row['id'], 'expense_category.id'),
    name: requireString(row['name'], 'expense_category.name'),
    nature: requireOneOf(row['nature'], CATEGORY_NATURES, 'expense_category.nature'),
    parentId: optionalString(row['parent_id'], 'expense_category.parent_id'),
    isEssential: requireBoolean(row['is_essential'], 'expense_category.is_essential'),
    sortOrder,
    isArchived:
      requireOneOf(row['status'], ['active', 'archived'] as const, 'expense_category.status') ===
      'archived',
  };
}
