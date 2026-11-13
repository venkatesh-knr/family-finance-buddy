import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { checkAccount, checkBalance, checkCredit, checkCreditPatch, checkTaxInput, checkTransfer } from './ledgerChecks.ts';

/**
 * What the repository refuses before it asks the database, so a person is told in words and not by a constraint's name. The database
 * refuses all of these too (the tables' checks); this is the same rule said first, kindly.
 */

const inr = (rupees: number) => money(BigInt(rupees) * 100n, 'INR');

describe('checkCredit', () => {
  const ok = { category: 'salary', amount: inr(142_000), date: '2026-10-01' } as const;

  it('accepts a credit of some money, on a calendar day, in one of the seven categories', () => {
    expect(() => checkCredit(ok)).not.toThrow();
  });

  it('refuses a credit of nothing, or less', () => {
    expect(() => checkCredit({ ...ok, amount: inr(0) })).toThrow(/some amount/);
    expect(() => checkCredit({ ...ok, amount: money(-1n, 'INR') })).toThrow(/some amount/);
  });

  it('refuses a date that is not a calendar day', () => {
    expect(() => checkCredit({ ...ok, date: '2026-13-01' })).toThrow(/date/);
    expect(() => checkCredit({ ...ok, date: '2026-10-01T10:00:00Z' })).toThrow(/date/);
  });

  it('LI-I1 — refuses a category outside the seven', () => {
    expect(() => checkCredit({ ...ok, category: 'bonus' as never })).toThrow(/category/);
  });

  it('refuses a payer or a note that is too long to keep', () => {
    expect(() => checkCredit({ ...ok, payer: 'x'.repeat(121) })).toThrow(/payer/);
    expect(() => checkCredit({ ...ok, note: 'x'.repeat(501) })).toThrow(/note/);
  });
});

describe('checkCreditPatch', () => {
  it('accepts an empty patch and any field that is right', () => {
    expect(() => checkCreditPatch({})).not.toThrow();
    expect(() => checkCreditPatch({ amount: inr(5), date: '2026-10-01', category: 'rent' })).not.toThrow();
  });

  it('refuses only what is given and wrong: nothing, a day that is not one, a category that is not one', () => {
    expect(() => checkCreditPatch({ amount: inr(0) })).toThrow(/some amount/);
    expect(() => checkCreditPatch({ date: '2026-02-30x' })).toThrow(/date/);
    expect(() => checkCreditPatch({ category: 'bonus' as never })).toThrow(/category/);
  });
});

describe('checkAccount', () => {
  const ok = { name: 'HDFC savings', type: 'savings', currency: 'INR' } as const;

  it('accepts an account with a name, a type and a currency', () => {
    expect(() => checkAccount(ok)).not.toThrow();
    expect(() => checkAccount({ ...ok, last4: '4821', institution: 'HDFC Bank' })).not.toThrow();
  });

  it('refuses a name that is empty or too long', () => {
    expect(() => checkAccount({ ...ok, name: '   ' })).toThrow(/name/);
    expect(() => checkAccount({ ...ok, name: 'x'.repeat(81) })).toThrow(/name/);
  });

  it('keeps only the last four characters of an account number, and says so', () => {
    expect(() => checkAccount({ ...ok, last4: '123456' })).toThrow(/last four/);
    expect(() => checkAccount({ ...ok, last4: '12' })).toThrow(/last four/);
    expect(() => checkAccount({ ...ok, last4: '12 4' })).toThrow(/last four/);
  });

  it('refuses a type that is not a savings or current account or a card: cash is not an account', () => {
    expect(() => checkAccount({ ...ok, type: 'cash' as never })).toThrow(/type/);
  });

  it('refuses a currency that is not a three-letter code', () => {
    expect(() => checkAccount({ ...ok, currency: 'rupee' })).toThrow(/currency/);
  });
});

describe('checkBalance', () => {
  it('accepts any balance on a calendar day, an overdrawn one included', () => {
    expect(() => checkBalance({ asAt: '2026-10-31', balance: inr(0) })).not.toThrow();
    expect(() => checkBalance({ asAt: '2026-10-31', balance: money(-5_000n, 'INR') })).not.toThrow();
  });

  it('refuses a day that is not a calendar day', () => {
    expect(() => checkBalance({ asAt: '31-10-2026', balance: inr(1) })).toThrow(/date/);
  });
});

describe('checkTransfer', () => {
  const ok = { fromAccountId: 'a-1', toAccountId: 'a-3', amount: inr(18_240), date: '2026-10-10' };

  it('accepts a move of some money between two accounts', () => {
    expect(() => checkTransfer(ok)).not.toThrow();
  });

  it('LI-I2 — refuses a move from an account to itself, and a move of nothing', () => {
    expect(() => checkTransfer({ ...ok, toAccountId: 'a-1' })).toThrow(/itself/);
    expect(() => checkTransfer({ ...ok, amount: inr(0) })).toThrow(/some amount/);
  });
});

describe('checkTaxInput', () => {
  const ok = { taxYear: '2026-27', head: 'salary', amount: inr(2_280_000), source: 'payslip' } as const;

  it('accepts a gross figure for a tax year', () => {
    expect(() => checkTaxInput(ok)).not.toThrow();
    expect(() => checkTaxInput({ ...ok, tds: inr(310_000) })).not.toThrow();
  });

  it('refuses a tax year whose second half does not follow its first, or that is not a year at all', () => {
    expect(() => checkTaxInput({ ...ok, taxYear: '2026-28' })).toThrow(/tax year/);
    expect(() => checkTaxInput({ ...ok, taxYear: 'abcd-ef' })).toThrow(/tax year/);
    expect(() => checkTaxInput({ ...ok, taxYear: '2099-00' })).not.toThrow();
  });

  it('refuses a figure that is negative, and a business loss by name', () => {
    expect(() => checkTaxInput({ ...ok, amount: money(-1n, 'INR') })).toThrow(/not negative/);
    expect(() => checkTaxInput({ ...ok, head: 'business', source: 'typed', amount: money(-1n, 'INR') })).toThrow(/loss/i);
  });

  it('refuses a currency but the rupee, and a negative tax deducted', () => {
    expect(() => checkTaxInput({ ...ok, amount: money(100n, 'USD') })).toThrow(/rupees/);
    expect(() => checkTaxInput({ ...ok, tds: money(-1n, 'INR') })).toThrow(/tax deducted/);
  });

  it('refuses a head the design does not list, and a source we do not know', () => {
    expect(() => checkTaxInput({ ...ok, head: 'house_property' as never })).toThrow(/head/);
    expect(() => checkTaxInput({ ...ok, source: 'guess' as never })).toThrow(/source/);
  });
});
