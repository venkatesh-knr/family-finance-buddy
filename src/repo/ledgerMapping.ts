/**
 * The mapping from the ledger's rows to the app's vocabulary (docs/design/ledger-income.md section 12).
 *
 * Pure functions that take `unknown` and return our types, as `mapping.ts` does: the point where a provider's response shape stops.
 * Money is selected `::text`, so a figure too large for JSON survives intact, and `toBigIntExact` refuses one that did not. A row with no
 * visibility, a category we do not know or a source we do not know is refused, and never guessed at: a credit read as the household's
 * when it was private is a leak, and one read as a category it is not is a wrong income figure.
 */

import { CREDIT_CATEGORIES } from '../domain/credit.ts';
import { MalformedRowError, optionalString, requireBoolean, requireOneOf, requireRecord, requireString, toBigIntExact } from '../lib/guards.ts';
import { money } from '../lib/money.ts';
import { requireIsoDate, requireNumber } from './mapping.ts';
import {
  ACCOUNT_TYPES,
  BALANCE_SOURCES,
  CREDIT_SOURCES,
  RECURRING_CADENCES,
  RULE_STATUSES,
  VISIBILITIES,
  type Account,
  type AccountBalance,
  type Credit,
  type IncomeRule,
  type MoneyTotals,
  type TaxInputRecord,
  type Transfer,
  type YearlyIncomeTotals,
} from './types.ts';

const TAX_HEADS = ['salary', 'business', 'other_sources'] as const;
const TAX_SOURCES = ['payslip', 'form16', 'typed'] as const;
const TRANSFER_SOURCES = ['typed', 'import'] as const;

function optionalIsoDate(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : requireIsoDate(value, field);
}

export function toAccount(raw: unknown): Account {
  const row = requireRecord(raw, 'account');
  return {
    id: requireString(row['id'], 'account.id'),
    householdId: requireString(row['household_id'], 'account.household_id'),
    memberId: requireString(row['member_id'], 'account.member_id'),
    name: requireString(row['name'], 'account.name'),
    institution: optionalString(row['institution'], 'account.institution'),
    type: requireOneOf(row['type'], ACCOUNT_TYPES, 'account.type'),
    currency: requireString(row['currency'], 'account.currency'),
    last4: optionalString(row['account_last4'], 'account.account_last4'),
    isForeign: requireBoolean(row['is_foreign'], 'account.is_foreign'),
    openedOn: optionalIsoDate(row['opened_on'], 'account.opened_on'),
    visibility: requireOneOf(row['visibility'], VISIBILITIES, 'account.visibility'),
    isArchived: requireOneOf(row['status'], ['active', 'archived'] as const, 'account.status') === 'archived',
  };
}

export function toAccountBalance(raw: unknown): AccountBalance {
  const row = requireRecord(raw, 'account_balance');
  const currency = requireString(row['currency'], 'account_balance.currency');
  return {
    id: requireString(row['id'], 'account_balance.id'),
    householdId: requireString(row['household_id'], 'account_balance.household_id'),
    accountId: requireString(row['account_id'], 'account_balance.account_id'),
    asAt: requireIsoDate(row['as_at'], 'account_balance.as_at'),
    balance: money(toBigIntExact(row['balance_minor'], 'account_balance.balance_minor'), currency),
    source: requireOneOf(row['source'], BALANCE_SOURCES, 'account_balance.source'),
    note: optionalString(row['note'], 'account_balance.note'),
  };
}

export function toCredit(raw: unknown): Credit {
  const row = requireRecord(raw, 'credit_entry');
  const currency = requireString(row['currency'], 'credit_entry.currency');
  return {
    id: requireString(row['id'], 'credit_entry.id'),
    householdId: requireString(row['household_id'], 'credit_entry.household_id'),
    memberId: requireString(row['member_id'], 'credit_entry.member_id'),
    accountId: optionalString(row['account_id'], 'credit_entry.account_id'),
    category: requireOneOf(row['category'], CREDIT_CATEGORIES, 'credit_entry.category'),
    amount: money(toBigIntExact(row['amount_minor'], 'credit_entry.amount_minor'), currency),
    date: requireIsoDate(row['credit_date'], 'credit_entry.credit_date'),
    visibility: requireOneOf(row['visibility'], VISIBILITIES, 'credit_entry.visibility'),
    source: requireOneOf(row['source'], CREDIT_SOURCES, 'credit_entry.source'),
    ruleId: optionalString(row['recurring_rule_id'], 'credit_entry.recurring_rule_id'),
    dueDate: optionalIsoDate(row['due_date'], 'credit_entry.due_date'),
    payer: optionalString(row['payer'], 'credit_entry.payer'),
    note: optionalString(row['note'], 'credit_entry.note'),
    isVoided: row['voided_at'] !== null && row['voided_at'] !== undefined,
  };
}

export function toTransfer(raw: unknown): Transfer {
  const row = requireRecord(raw, 'account_transfer');
  const currency = requireString(row['currency'], 'account_transfer.currency');
  return {
    id: requireString(row['id'], 'account_transfer.id'),
    householdId: requireString(row['household_id'], 'account_transfer.household_id'),
    fromAccountId: requireString(row['from_account_id'], 'account_transfer.from_account_id'),
    toAccountId: requireString(row['to_account_id'], 'account_transfer.to_account_id'),
    amount: money(toBigIntExact(row['amount_minor'], 'account_transfer.amount_minor'), currency),
    date: requireIsoDate(row['transfer_date'], 'account_transfer.transfer_date'),
    source: requireOneOf(row['source'], TRANSFER_SOURCES, 'account_transfer.source'),
    note: optionalString(row['note'], 'account_transfer.note'),
    isVoided: row['voided_at'] !== null && row['voided_at'] !== undefined,
  };
}

/** A credit rule. A debit rule is an expense rule and is read by `toRecurringRule`, so it is refused here rather than read as income. */
export function toIncomeRule(raw: unknown): IncomeRule {
  const row = requireRecord(raw, 'recurring_rule');
  if (row['direction'] !== 'credit') throw new MalformedRowError('recurring_rule.direction', 'is not a credit: this is an expense rule');
  const currency = requireString(row['currency'], 'recurring_rule.currency');
  return {
    id: requireString(row['id'], 'recurring_rule.id'),
    householdId: requireString(row['household_id'], 'recurring_rule.household_id'),
    name: requireString(row['name'], 'recurring_rule.name'),
    memberId: requireString(row['member_id'], 'recurring_rule.member_id'),
    accountId: requireString(row['account_id'], 'recurring_rule.account_id'),
    category: requireOneOf(row['credit_category'], CREDIT_CATEGORIES, 'recurring_rule.credit_category'),
    amount: money(toBigIntExact(row['amount_minor'], 'recurring_rule.amount_minor'), currency),
    cadence: requireOneOf(row['cadence'], RECURRING_CADENCES, 'recurring_rule.cadence'),
    dueDay: requireNumber(row['due_day'], 'recurring_rule.due_day'),
    nextDue: requireIsoDate(row['next_due'], 'recurring_rule.next_due'),
    visibility: requireOneOf(row['visibility'], VISIBILITIES, 'recurring_rule.visibility'),
    reminderDays: requireNumber(row['reminder_days'], 'recurring_rule.reminder_days'),
    status: requireOneOf(row['status'], RULE_STATUSES, 'recurring_rule.status'),
  };
}

export function toTaxInput(raw: unknown): TaxInputRecord {
  const row = requireRecord(raw, 'income_entry');
  const currency = requireString(row['currency'], 'income_entry.currency');
  const tds = row['tds_minor'];
  return {
    id: requireString(row['id'], 'income_entry.id'),
    householdId: requireString(row['household_id'], 'income_entry.household_id'),
    memberId: requireString(row['member_id'], 'income_entry.member_id'),
    taxYear: requireString(row['tax_year'], 'income_entry.tax_year'),
    head: requireOneOf(row['head'], TAX_HEADS, 'income_entry.head'),
    amount: money(toBigIntExact(row['amount_minor'], 'income_entry.amount_minor'), currency),
    tds: tds === null || tds === undefined ? null : money(toBigIntExact(tds, 'income_entry.tds_minor'), currency),
    source: requireOneOf(row['source'], TAX_SOURCES, 'income_entry.source'),
    typedBy: requireString(row['created_by'], 'income_entry.created_by'),
  };
}

/** A line of `household_money_totals`. No member in it: the household's total is reachable only as a total (LI-I13). */
export function toMoneyTotals(raw: unknown): MoneyTotals {
  const row = requireRecord(raw, 'household_money_totals');
  const currency = requireString(row['currency'], 'household_money_totals.currency');
  return {
    cameIn: money(toBigIntExact(row['came_in_minor'], 'household_money_totals.came_in_minor'), currency),
    refunds: money(toBigIntExact(row['refunds_minor'], 'household_money_totals.refunds_minor'), currency),
  };
}

/** A line of `household_yearly_income`. */
export function toYearlyIncomeTotals(raw: unknown): YearlyIncomeTotals {
  const row = requireRecord(raw, 'household_yearly_income');
  const currency = requireString(row['currency'], 'household_yearly_income.currency');
  return {
    yearlySalary: money(toBigIntExact(row['yearly_salary_minor'], 'household_yearly_income.yearly_salary_minor'), currency),
    yearlyBusiness: money(toBigIntExact(row['yearly_business_minor'], 'household_yearly_income.yearly_business_minor'), currency),
  };
}
