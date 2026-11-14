import { describe, expect, it } from 'vitest';
import type { Account } from '../../repo/types.ts';
import { accountChoices, creditAmount, creditDateProblem, creditMember, creditVisibility, sharedAccountNote } from './creditForm.ts';

/**
 * What the Add money in form works out for itself (docs/design/ledger-income.md section 2; the AddCredit and AddCredit2 boards): the amount
 * as typed, the date, the accounts it offers, whose income it starts as, who can see it and the line about a shared account.
 */

const account = (patch: Partial<Account>): Account => ({
  id: 'a-1',
  householdId: 'h-1',
  memberId: 'm-1',
  name: 'HDFC Savings',
  institution: null,
  type: 'savings',
  currency: 'INR',
  last4: '4021',
  isForeign: false,
  openedOn: null,
  visibility: 'household',
  isArchived: false,
  ...patch,
});

describe('creditAmount — what was typed, in minor units', () => {
  it('reads ₹1,42,000, as the board shows it, with Indian grouping', () => {
    expect(creditAmount('1,42,000', 'INR')).toEqual({ ok: true, minor: 14_200_000n });
  });

  it('reads paise, and a rupee sign', () => {
    expect(creditAmount('₹1,299.50', 'INR')).toEqual({ ok: true, minor: 129_950n });
  });

  it('says nothing is wrong with a blank amount until it is needed, and names it then', () => {
    expect(creditAmount('', 'INR')).toEqual({ ok: false, problem: 'Enter what came in, such as 1,42,000.', blank: true });
  });

  it('refuses nothing, a minus and a third decimal place, each in words', () => {
    expect(creditAmount('0', 'INR')).toMatchObject({ ok: false, problem: 'The amount is above nothing, such as 1,42,000.' });
    expect(creditAmount('-5', 'INR')).toMatchObject({ ok: false });
    const long = creditAmount('1.234', 'INR');
    expect(long.ok).toBe(false);
    expect(long.ok ? '' : long.problem).toMatch(/decimal places/);
  });

  it('refuses words with one plain sentence', () => {
    expect(creditAmount('a lot', 'INR')).toEqual({ ok: false, problem: 'The amount is a number, such as 1,42,000.', blank: false });
  });
});

describe('creditDateProblem — the date it was credited', () => {
  it('accepts a calendar date', () => {
    expect(creditDateProblem('2026-11-01')).toBeNull();
  });

  it('refuses a blank, a date that is not one and a year nobody means', () => {
    expect(creditDateProblem('')).not.toBeNull();
    expect(creditDateProblem('2026-02-31')).not.toBeNull();
    expect(creditDateProblem('0206-11-01')).not.toBeNull();
  });
});

describe('accountChoices — the accounts the picker offers', () => {
  it('leaves out an archived account, which cannot be chosen for a new entry, and keeps the order it was given', () => {
    const choices = accountChoices([account({ id: 'a' }), account({ id: 'b', isArchived: true }), account({ id: 'c', name: 'SBI', last4: null })]);
    expect(choices.map((c) => [c.id, c.label])).toEqual([
      ['a', 'HDFC Savings ••4021'],
      ['c', 'SBI'],
    ]);
  });
});

describe('creditMember — whose income it starts as', () => {
  const viewer = { memberId: 'm-1', canFileForOthers: true };
  const chooseable = ['m-1', 'm-2'];

  it('is the account’s member when one is chosen, as the design says', () => {
    expect(creditMember(account({ memberId: 'm-2' }), viewer, chooseable)).toBe('m-2');
  });

  it('is the viewer when no account is chosen', () => {
    expect(creditMember(null, viewer, chooseable)).toBe('m-1');
  });

  it('is the viewer when they can file only under their own name, whatever the account says', () => {
    expect(creditMember(account({ memberId: 'm-2' }), { memberId: 'm-1', canFileForOthers: false }, ['m-1'])).toBe('m-1');
  });

  it('is the viewer when the account’s member is archived and so cannot be chosen: a default nobody was shown is not one', () => {
    expect(creditMember(account({ memberId: 'm-9' }), viewer, chooseable)).toBe('m-1');
  });
});

describe('creditVisibility — who can see the row', () => {
  it('starts as the category says: income private, a refund the household’s', () => {
    expect(creditVisibility({ category: 'salary', chosen: null, mine: true })).toBe('personal');
    expect(creditVisibility({ category: 'refund', chosen: null, mine: true })).toBe('household');
  });

  it('keeps what the person chose', () => {
    expect(creditVisibility({ category: 'salary', chosen: 'household', mine: true })).toBe('household');
    expect(creditVisibility({ category: 'refund', chosen: 'personal', mine: true })).toBe('personal');
  });

  it('is the household’s on somebody else’s income whatever was chosen: nobody could read it back otherwise', () => {
    expect(creditVisibility({ category: 'salary', chosen: 'personal', mine: false })).toBe('household');
    expect(creditVisibility({ category: 'salary', chosen: null, mine: false })).toBe('household');
  });
});

describe('sharedAccountNote — a private credit on an account the household sees (AddCredit2, state 1)', () => {
  it('warns that the row is private in the list only, naming the account', () => {
    expect(sharedAccountNote(account({ name: 'SBI Savings', last4: '7710' }), 'personal')).toBe(
      'SBI Savings ••7710 is shared with the household. Its balance is seen by the household, so a private credit there is private in this list only.',
    );
  });

  it('says nothing when the credit is the household’s, the account is private, or there is no account', () => {
    expect(sharedAccountNote(account({}), 'household')).toBeNull();
    expect(sharedAccountNote(account({ visibility: 'personal' }), 'personal')).toBeNull();
    expect(sharedAccountNote(null, 'personal')).toBeNull();
  });
});
