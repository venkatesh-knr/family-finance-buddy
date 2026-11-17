import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account, Liability, LoanPayment } from '../../repo/types.ts';
import { accountLabelFor, loanPaymentChoices, loanPaymentOf, suggestedAmount } from './loanPayment.ts';

/**
 * Recording a payment on a loan (docs/design/ledger-income.md section 4c; LI-I36): the amount of what left, in the loan's own currency, on a day, and, when
 * the person says, the account it left, which is in the loan's currency too. Pure.
 */

const account = (id: string, name: string, currency = 'INR', isArchived = false): Account => ({
  id,
  householdId: 'h-1',
  memberId: 'm-1',
  name,
  institution: null,
  type: 'savings',
  currency,
  last4: null,
  isForeign: false,
  openedOn: null,
  isArchived,
});

const loan = (over: Partial<Liability> = {}): Liability => ({
  id: 'l-1',
  name: 'Home loan',
  kind: 'home_loan',
  currency: 'INR',
  instalment: money(3_200_000n, 'INR'),
  cadence: 'monthly',
  memberId: null,
  isClosed: false,
  outstanding: null,
  outstandingAsOf: null,
  ...over,
});

const accounts = [account('hdfc', 'HDFC'), account('usd', 'Dollar account', 'USD'), account('old', 'Old', 'INR', true)];

describe('loanPaymentChoices', () => {
  it('offers the accounts in use that are in the loan’s currency, and no other', () => {
    expect(loanPaymentChoices(accounts, 'INR', []).map((c) => c.id)).toEqual(['hdfc']);
    expect(loanPaymentChoices(accounts, 'USD', []).map((c) => c.id)).toEqual(['usd']);
  });

  it('puts the one named most recently first', () => {
    const two = [account('a', 'A'), account('b', 'B')];
    expect(loanPaymentChoices(two, 'INR', ['b']).map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('loanPaymentOf', () => {
  const ok = { loan: loan(), amount: '32,000', date: '2026-10-05', accountId: 'hdfc', accounts };

  it('LI-I36 — is the amount in the loan’s currency, the day, and the account named', () => {
    const result = loanPaymentOf(ok);
    expect(result).toEqual({ ok: true, value: { amount: money(3_200_000n, 'INR'), date: '2026-10-05', accountId: 'hdfc' } });
  });

  it('may name no account', () => {
    const result = loanPaymentOf({ ...ok, accountId: '' });
    expect(result.ok && result.value.accountId).toBeNull();
  });

  it('refuses nothing, and what is not an amount', () => {
    expect(loanPaymentOf({ ...ok, amount: '0' }).ok).toBe(false);
    expect(loanPaymentOf({ ...ok, amount: '' }).ok).toBe(false);
    expect(loanPaymentOf({ ...ok, amount: 'abc' }).ok).toBe(false);
  });

  it('refuses a day that is not one', () => {
    expect(loanPaymentOf({ ...ok, date: '' }).ok).toBe(false);
    expect(loanPaymentOf({ ...ok, date: '2026-02-30' }).ok).toBe(false);
  });

  it('refuses an account in another currency than the loan’s, an archived one, and one that is not there', () => {
    expect(loanPaymentOf({ ...ok, accountId: 'usd' })).toMatchObject({ ok: false });
    expect(loanPaymentOf({ ...ok, accountId: 'old' })).toMatchObject({ ok: false });
    expect(loanPaymentOf({ ...ok, accountId: 'nope' })).toMatchObject({ ok: false });
  });

  it('is in a dollar loan’s own currency', () => {
    const result = loanPaymentOf({ ...ok, loan: loan({ currency: 'USD', instalment: null }), amount: '1,000', accountId: 'usd' });
    expect(result).toEqual({ ok: true, value: { amount: money(100_000n, 'USD'), date: '2026-10-05', accountId: 'usd' } });
  });
});

describe('suggestedAmount', () => {
  it('starts from the instalment, when one is stated', () => {
    expect(suggestedAmount(loan())).toBe('32000');
    expect(suggestedAmount(loan({ instalment: money(3_212_550n, 'INR') }))).toBe('32125.50');
  });

  it('is empty when none is stated', () => {
    expect(suggestedAmount(loan({ instalment: null }))).toBe('');
  });
});

describe('accountLabelFor', () => {
  const payment = (accountId: string | null): Pick<LoanPayment, 'accountId'> => ({ accountId });

  it('names the account, or says none was said, or that it cannot be seen', () => {
    expect(accountLabelFor(payment('hdfc'), accounts)).toBe('HDFC');
    expect(accountLabelFor(payment(null), accounts)).toBe('no account said');
    expect(accountLabelFor(payment('elsewhere'), accounts)).toBe('an account you cannot see');
  });

  it('says so of an archived account', () => {
    expect(accountLabelFor(payment('old'), accounts)).toBe('Old (archived)');
  });
});
