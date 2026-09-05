import { describe, expect, it } from 'vitest';
import { toExpense, toHousehold, toMember } from './mapping.ts';
import type { Member } from './types.ts';

const ravi: Member = { id: 'm-1', displayName: 'Ravi', colour: 'c1', isArchived: false };
const membersById = new Map<string, Member>([[ravi.id, ravi]]);

const row = {
  id: 'e-1',
  household_id: 'h-1',
  member_id: 'm-1',
  txn_date: '2026-04-05',
  amount_minor: 248000,
  currency: 'INR',
  payee: 'Big Basket',
  method: 'upi',
  note: null,
  voided_at: null,
};

describe('toExpense', () => {
  it('maps a row into a domain object with money as minor units', () => {
    const expense = toExpense(row, membersById);
    expect(expense.amount.minor).toBe(248000n);
    expect(expense.amount.currency).toBe('INR');
    expect(expense.date).toBe('2026-04-05');
    expect(expense.member.displayName).toBe('Ravi');
    expect(expense.payee).toBe('Big Basket');
    expect(expense.method).toBe('upi');
    expect(expense.note).toBeNull();
    expect(expense.isVoided).toBe(false);
  });

  it('keeps a foreign amount in its own currency', () => {
    const expense = toExpense({ ...row, amount_minor: 1299, currency: 'USD' }, membersById);
    expect(expense.amount).toEqual({ minor: 1299n, currency: 'USD' });
  });

  it('reads a voided row as voided', () => {
    const expense = toExpense({ ...row, voided_at: '2026-04-06T09:00:00Z' }, membersById);
    expect(expense.isVoided).toBe(true);
  });

  it('refuses an amount that could not have survived JSON intact', () => {
    expect(() => toExpense({ ...row, amount_minor: 2 ** 53 }, membersById)).toThrow(/too large/);
  });

  it('refuses a fractional amount: minor units are whole', () => {
    expect(() => toExpense({ ...row, amount_minor: 2480.5 }, membersById)).toThrow(/whole number/);
  });

  it('refuses a timestamp where a calendar date belongs', () => {
    expect(() => toExpense({ ...row, txn_date: '2026-04-05T00:00:00Z' }, membersById)).toThrow(
      /calendar date/,
    );
  });

  it('refuses a payment method we do not know', () => {
    expect(() => toExpense({ ...row, method: 'crypto' }, membersById)).toThrow(/not one of/);
  });

  it('refuses a row whose member is not in the household', () => {
    expect(() => toExpense({ ...row, member_id: 'someone-else' }, membersById)).toThrow(
      /not in this household/,
    );
  });

  it('refuses a missing field rather than producing a half-built object', () => {
    const { currency, ...withoutCurrency } = row;
    void currency;
    expect(() => toExpense(withoutCurrency, membersById)).toThrow(/currency/);
  });
});

describe('toMember', () => {
  it('maps status to a boolean the UI can read', () => {
    expect(toMember({ id: 'm-1', display_name: 'Meera', colour: 'c2', status: 'archived' })).toEqual(
      { id: 'm-1', displayName: 'Meera', colour: 'c2', isArchived: true },
    );
  });

  it('refuses a colour that is not a token name', () => {
    expect(() => toMember({ id: 'm-1', display_name: 'Meera', colour: '#0D7466', status: 'active' })).toThrow(
      /not one of/,
    );
  });
});

describe('toHousehold', () => {
  it('maps the fields the screen needs', () => {
    expect(
      toHousehold({
        id: 'h-1',
        name: 'Demo household',
        base_currency: 'INR',
        display_currency: 'INR',
        fy_start_month: 4,
      }),
    ).toEqual({
      id: 'h-1',
      name: 'Demo household',
      baseCurrency: 'INR',
      displayCurrency: 'INR',
      fyStartMonth: 4,
    });
  });
});

describe('embedded relations', () => {
  const household = {
    id: 'h-1',
    name: 'Demo household',
    base_currency: 'INR',
    display_currency: 'INR',
    fy_start_month: 4,
  };

  it('accepts an embedded household as an object', () => {
    expect(toHousehold(household).id).toBe('h-1');
  });

  it('accepts it as a single-element array too', () => {
    expect(toHousehold([household]).id).toBe('h-1');
  });
});
