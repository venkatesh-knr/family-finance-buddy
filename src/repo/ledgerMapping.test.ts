import { describe, expect, it } from 'vitest';
import { MalformedRowError } from '../lib/guards.ts';
import { toAccount, toAccountBalance, toCredit, toIncomeRule, toMoneyTotals, toTaxInput, toTransfer, toYearlyIncomeTotals } from './ledgerMapping.ts';

/**
 * The mapping from the ledger's rows to the app's vocabulary (docs/design/ledger-income.md section 12). Rows are as PostgREST returns them:
 * money arrives as text because the columns are selected `::text`, so a figure too large for JSON survives intact.
 */

const account = {
  id: 'a-1',
  household_id: 'h-1',
  member_id: 'm-1',
  name: 'HDFC savings',
  institution: 'HDFC Bank',
  type: 'savings',
  currency: 'INR',
  account_last4: '4821',
  is_foreign: false,
  opened_on: '2019-04-01',
  visibility: 'household',
  status: 'active',
};

const credit = {
  id: 'c-1',
  household_id: 'h-1',
  member_id: 'm-1',
  account_id: 'a-1',
  category: 'salary',
  amount_minor: '14200000',
  currency: 'INR',
  credit_date: '2026-10-01',
  visibility: 'personal',
  source: 'typed',
  recurring_rule_id: null,
  due_date: null,
  payer: 'Acme Ltd',
  note: null,
  voided_at: null,
};

describe('toAccount', () => {
  it('maps a row, keeping the last four characters and no more', () => {
    expect(toAccount(account)).toEqual({
      id: 'a-1',
      householdId: 'h-1',
      memberId: 'm-1',
      name: 'HDFC savings',
      institution: 'HDFC Bank',
      type: 'savings',
      currency: 'INR',
      last4: '4821',
      isForeign: false,
      openedOn: '2019-04-01',
      visibility: 'household',
      isArchived: false,
    });
  });

  it('reads an archived account as archived, and a card as a card', () => {
    expect(toAccount({ ...account, status: 'archived', type: 'card' })).toMatchObject({ isArchived: true, type: 'card' });
  });

  it('refuses a type we do not know: cash is not an account', () => {
    expect(() => toAccount({ ...account, type: 'cash' })).toThrow(MalformedRowError);
  });

  it('refuses a row with no visibility rather than assuming it is shared', () => {
    expect(() => toAccount({ ...account, visibility: undefined })).toThrow(MalformedRowError);
  });
});

describe('toAccountBalance', () => {
  const row = { id: 'b-1', household_id: 'h-1', account_id: 'a-1', as_at: '2026-10-31', balance_minor: '22038000', currency: 'INR', source: 'typed', note: null };

  it('maps a balance as money in the account’s currency', () => {
    expect(toAccountBalance(row)).toMatchObject({ accountId: 'a-1', asAt: '2026-10-31', source: 'typed' });
    expect(toAccountBalance(row).balance).toEqual({ minor: 22_038_000n, currency: 'INR' });
  });

  it('keeps an overdrawn balance negative', () => {
    expect(toAccountBalance({ ...row, balance_minor: '-150000' }).balance.minor).toBe(-150_000n);
  });

  it('refuses a source we do not know, and a timestamp where a date belongs', () => {
    expect(() => toAccountBalance({ ...row, source: 'guess' })).toThrow(MalformedRowError);
    expect(() => toAccountBalance({ ...row, as_at: '2026-10-31T00:00:00Z' })).toThrow(MalformedRowError);
  });
});

describe('toCredit', () => {
  it('maps a credit with its category, its date and money as minor units', () => {
    const mapped = toCredit(credit);
    expect(mapped).toMatchObject({ id: 'c-1', category: 'salary', accountId: 'a-1', date: '2026-10-01', visibility: 'personal', source: 'typed', payer: 'Acme Ltd', isVoided: false });
    expect(mapped.amount).toEqual({ minor: 14_200_000n, currency: 'INR' });
  });

  it('reads a credit confirmed from a rule as one, with the rule and the due date it answers', () => {
    const mapped = toCredit({ ...credit, source: 'rule', recurring_rule_id: 'r-1', due_date: '2026-10-01' });
    expect(mapped).toMatchObject({ source: 'rule', ruleId: 'r-1', dueDate: '2026-10-01' });
  });

  it('reads a credit with no account as null: accounts are optional and it still counts as came in (LI-I4)', () => {
    expect(toCredit({ ...credit, account_id: null }).accountId).toBeNull();
  });

  it('reads a voided credit as voided', () => {
    expect(toCredit({ ...credit, voided_at: '2026-10-02T04:00:00Z' }).isVoided).toBe(true);
  });

  it('LI-I1 — refuses a category outside the seven, and never guesses', () => {
    expect(() => toCredit({ ...credit, category: 'bonus' })).toThrow(MalformedRowError);
  });

  it('refuses an amount that could not have survived JSON intact, and a fractional one', () => {
    expect(() => toCredit({ ...credit, amount_minor: 1e21 })).toThrow(MalformedRowError);
    expect(() => toCredit({ ...credit, amount_minor: '100.5' })).toThrow(MalformedRowError);
  });

  it('refuses a row with no visibility at all', () => {
    expect(() => toCredit({ ...credit, visibility: null })).toThrow(MalformedRowError);
  });
});

describe('toTransfer', () => {
  const row = {
    id: 't-1',
    household_id: 'h-1',
    from_account_id: 'a-1',
    to_account_id: 'a-3',
    transfer_date: '2026-10-10',
    amount_minor: '1824000',
    currency: 'INR',
    source: 'typed',
    note: 'card payment',
    voided_at: null,
  };

  it('maps a move between two accounts', () => {
    const mapped = toTransfer(row);
    expect(mapped).toMatchObject({ fromAccountId: 'a-1', toAccountId: 'a-3', date: '2026-10-10', note: 'card payment', isVoided: false });
    expect(mapped.amount).toEqual({ minor: 1_824_000n, currency: 'INR' });
  });

  it('refuses a source we do not know', () => {
    expect(() => toTransfer({ ...row, source: 'rule' })).toThrow(MalformedRowError);
  });
});

describe('toIncomeRule', () => {
  const row = {
    id: 'r-1',
    household_id: 'h-1',
    name: 'Salary',
    direction: 'credit',
    credit_category: 'salary',
    member_id: 'm-1',
    account_id: 'a-1',
    amount_minor: '14200000',
    currency: 'INR',
    cadence: 'monthly',
    due_day: 1,
    next_due: '2026-11-01',
    visibility: 'personal',
    reminder_days: 2,
    status: 'active',
  };

  it('maps a credit rule, which never posts by itself', () => {
    const mapped = toIncomeRule(row);
    expect(mapped).toMatchObject({ id: 'r-1', name: 'Salary', category: 'salary', accountId: 'a-1', cadence: 'monthly', dueDay: 1, nextDue: '2026-11-01', reminderDays: 2, status: 'active' });
    expect(mapped.amount).toEqual({ minor: 14_200_000n, currency: 'INR' });
  });

  it('LI-I8 — refuses a debit rule: an expense rule is not an income rule', () => {
    expect(() => toIncomeRule({ ...row, direction: 'debit', credit_category: null, account_id: null })).toThrow(MalformedRowError);
  });
});

describe('toTaxInput', () => {
  const row = { id: 'i-1', household_id: 'h-1', member_id: 'm-1', tax_year: '2026-27', head: 'salary', amount_minor: '22800000', currency: 'INR', tds_minor: '3100000', source: 'payslip', created_by: 'u-1' };

  it('maps a typed gross figure with its tax deducted, and who typed it', () => {
    const mapped = toTaxInput(row);
    expect(mapped).toMatchObject({ memberId: 'm-1', taxYear: '2026-27', head: 'salary', source: 'payslip', typedBy: 'u-1' });
    expect(mapped.amount).toEqual({ minor: 22_800_000n, currency: 'INR' });
    expect(mapped.tds).toEqual({ minor: 3_100_000n, currency: 'INR' });
  });

  it('reads no tax deducted as none, and not as zero', () => {
    expect(toTaxInput({ ...row, tds_minor: null }).tds).toBeNull();
  });

  it('refuses a head the design does not list, and a source we do not know', () => {
    expect(() => toTaxInput({ ...row, head: 'house_property' })).toThrow(MalformedRowError);
    expect(() => toTaxInput({ ...row, source: 'guess' })).toThrow(MalformedRowError);
  });
});

describe('the sum functions’ rows', () => {
  it('LI-I13 — reads came in and refunds per currency, and nothing about a member', () => {
    const totals = toMoneyTotals({ currency: 'INR', came_in_minor: '28325000', refunds_minor: '129900' });
    expect(totals).toEqual({ cameIn: { minor: 28_325_000n, currency: 'INR' }, refunds: { minor: 129_900n, currency: 'INR' } });
    expect(Object.keys(totals)).not.toContain('memberId');
  });

  it('reads the household’s yearly salary and business income per currency', () => {
    expect(toYearlyIncomeTotals({ currency: 'INR', yearly_salary_minor: '530400000', yearly_business_minor: '273600000' })).toEqual({
      yearlySalary: { minor: 530_400_000n, currency: 'INR' },
      yearlyBusiness: { minor: 273_600_000n, currency: 'INR' },
    });
  });

  it('refuses a figure too large to have survived JSON rather than understating a household total', () => {
    expect(() => toMoneyTotals({ currency: 'INR', came_in_minor: 1e21, refunds_minor: '0' })).toThrow(MalformedRowError);
  });
});
