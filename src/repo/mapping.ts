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
  requireOneOf,
  requireRecord,
  requireString,
  toBigIntExact,
} from '../lib/guards.ts';
import { money } from '../lib/money.ts';
import {
  HOUSEHOLD_ROLES,
  MEMBER_COLOURS,
  PAYMENT_METHODS,
  type Expense,
  type Household,
  type HouseholdRole,
  type Member,
  type PaymentMethod,
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
    date: requireIsoDate(row['txn_date'], 'expense_txn.txn_date'),
    amount: money(toBigIntExact(row['amount_minor'], 'expense_txn.amount_minor'), currency),
    payee: optionalString(row['payee'], 'expense_txn.payee'),
    method: methodRaw === null ? null : requireOneOf<PaymentMethod>(methodRaw, PAYMENT_METHODS, 'expense_txn.method'),
    note: optionalString(row['note'], 'expense_txn.note'),
    isVoided: optionalString(row['voided_at'], 'expense_txn.voided_at') !== null,
  };
}
