import { describe, expect, it } from 'vitest';
import { toExpense, toHolding, toHousehold, toInstrument, toMember, toValuation } from './mapping.ts';
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

describe('toInstrument', () => {
  const row = {
    id: 'i-1',
    name: 'US index ETF',
    kind: 'etf',
    symbol: 'VOO',
    currency: 'USD',
    exposure_currency: 'USD',
    is_foreign_asset: true,
    status: 'active',
  };

  it('keeps currency and exposure currency apart', () => {
    // An Indian feeder fund: bought in rupees, tracking dollars, and NOT a
    // foreign asset for tax. Collapsing these two fields would lose that.
    const feeder = toInstrument({
      ...row,
      name: 'Indian feeder fund',
      kind: 'mutual_fund',
      currency: 'INR',
      exposure_currency: 'USD',
      is_foreign_asset: false,
    });
    expect(feeder.currency).toBe('INR');
    expect(feeder.exposureCurrency).toBe('USD');
    expect(feeder.isForeignAsset).toBe(false);
  });

  it('maps a directly held foreign asset', () => {
    const direct = toInstrument(row);
    expect(direct.currency).toBe('USD');
    expect(direct.exposureCurrency).toBe('USD');
    expect(direct.isForeignAsset).toBe(true);
  });

  it('refuses a foreign-asset flag that is not a boolean', () => {
    expect(() => toInstrument({ ...row, is_foreign_asset: 'yes' })).toThrow(/is_foreign_asset/);
  });
});

describe('toValuation', () => {
  const row = {
    id: 'v-1',
    holding_id: 'h-1',
    as_of_date: '2026-08-31',
    quantity: '12.50000000',
    value_minor: 715000,
    currency: 'USD',
    source: 'manual',
    note: null,
  };

  it('keeps a fractional quantity exact, as a string', () => {
    const v = toValuation({ ...row, quantity: '12.34567891' });
    // 12.34567891 is not representable exactly as a double; the string is.
    expect(v.quantity).toBe('12.34567891');
  });

  it('refuses a quantity that arrived as a number', () => {
    // A number here means something upstream already rounded it.
    expect(() => toValuation({ ...row, quantity: 12.3456789 })).toThrow(/fractional share/);
  });

  it('maps the value as minor units in its own currency', () => {
    const v = toValuation(row);
    expect(v.amount).toEqual({ minor: 715000n, currency: 'USD' });
    expect(v.date).toBe('2026-08-31');
    expect(v.source).toBe('manual');
  });

  it('refuses a source we do not know', () => {
    expect(() => toValuation({ ...row, source: 'guessed' })).toThrow(/not one of/);
  });
});

describe('toHolding', () => {
  const ravi2: Member = { id: 'm-1', displayName: 'Ravi', colour: 'c1', isArchived: false };
  const members = new Map<string, Member>([[ravi2.id, ravi2]]);
  const instruments = new Map([
    [
      'i-1',
      toInstrument({
        id: 'i-1',
        name: 'US index ETF',
        kind: 'etf',
        symbol: 'VOO',
        currency: 'USD',
        exposure_currency: 'USD',
        is_foreign_asset: true,
        status: 'active',
      }),
    ],
  ]);

  const row = {
    id: 'h-1',
    household_id: 'hh-1',
    member_id: 'm-1',
    instrument_id: 'i-1',
    quantity: '12.50000000',
    cost_minor: 620000,
    opened_on: '2026-02-14',
    status: 'active',
  };

  it('joins member and instrument from what the household already loaded', () => {
    const holding = toHolding(row, members, instruments);
    expect(holding.member.displayName).toBe('Ravi');
    expect(holding.instrument.symbol).toBe('VOO');
    expect(holding.quantity).toBe('12.50000000');
    expect(holding.cost).toEqual({ minor: 620000n, currency: 'USD' });
    expect(holding.openedOn).toBe('2026-02-14');
  });

  it('refuses an instrument from outside the household', () => {
    // The composite foreign key makes this impossible in the database. The
    // guard is here because the mapper must not invent a holding either way.
    expect(() => toHolding({ ...row, instrument_id: 'somewhere-else' }, members, instruments)).toThrow(
      /not in this household/,
    );
  });

  it('reads cost as null when there is none', () => {
    expect(toHolding({ ...row, cost_minor: null }, members, instruments).cost).toBeNull();
  });
});
