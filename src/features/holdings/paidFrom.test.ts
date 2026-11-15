import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account } from '../../repo/types.ts';
import { paidViaOf, paidFromChoices, recentlyNamed } from './paidFrom.ts';

const account = (over: Partial<Account> = {}): Account =>
  ({ id: 'hdfc', name: 'HDFC savings', type: 'savings', currency: 'INR', last4: '4821', isArchived: false, ...over }) as Account;

describe('paidFromChoices — the accounts a purchase or a sale can name', () => {
  it('are the ones in use, by their names, and not an archived one', () => {
    const choices = paidFromChoices([account(), account({ id: 'old', name: 'Old', last4: null, isArchived: true }), account({ id: 'usd', name: 'Dollar', currency: 'USD', last4: null })]);
    expect(choices).toEqual([
      { id: 'hdfc', label: 'HDFC savings ••4821', currency: 'INR' },
      { id: 'usd', label: 'Dollar', currency: 'USD' },
    ]);
  });
});

describe('paidFromChoices — last used first', () => {
  it('puts the account named most recently first, then the rest as they were given', () => {
    const accounts = [account({ id: 'a', name: 'A', last4: null }), account({ id: 'b', name: 'B', last4: null }), account({ id: 'c', name: 'C', last4: null })];
    expect(paidFromChoices(accounts, ['c', 'b']).map((choice) => choice.id)).toEqual(['c', 'b', 'a']);
    expect(paidFromChoices(accounts).map((choice) => choice.id)).toEqual(['a', 'b', 'c']);
  });

  it('is by the day each entry was made, each account once, and none for an entry that named none', () => {
    expect(
      recentlyNamed([
        { date: '2026-09-01', accountId: 'a' },
        { date: '2026-10-05', accountId: 'b' },
        { date: '2026-10-20', accountId: null },
        { date: '2026-10-01', accountId: 'a' },
      ]),
    ).toEqual(['b', 'a']);
  });
});

describe('paidViaOf — what an entry says of the account its money moved through', () => {
  const rupees = money(5_500_000n, 'INR');

  it('is nothing when no account is chosen', () => {
    expect(paidViaOf({ accountId: '', typed: '', accounts: [account()], entry: rupees })).toEqual({ ok: true, value: null });
  });

  it("is the entry's own amount when the account is in the entry's currency: nothing more is asked", () => {
    expect(paidViaOf({ accountId: 'hdfc', typed: '', accounts: [account()], entry: rupees })).toEqual({
      ok: true,
      value: { accountId: 'hdfc', amount: rupees },
    });
  });

  it("is what was typed, in the account's currency, when the entry is in another: a dollar purchase paid from a rupee account", () => {
    expect(paidViaOf({ accountId: 'hdfc', typed: '8,500', accounts: [account()], entry: money(10_000n, 'USD') })).toEqual({
      ok: true,
      value: { accountId: 'hdfc', amount: money(850_000n, 'INR') },
    });
  });

  it('asks for the amount, and does not guess it, when the account is in another currency and none was typed', () => {
    const result = paidViaOf({ accountId: 'hdfc', typed: '  ', accounts: [account()], entry: money(10_000n, 'USD'), verb: 'left' });
    expect(result).toEqual({ ok: false, problem: 'Say what left HDFC savings ••4821, in ₹, as its statement shows it.' });
  });

  it('refuses an amount that is not a number or is nothing', () => {
    expect(paidViaOf({ accountId: 'hdfc', typed: 'lots', accounts: [account()], entry: money(10_000n, 'USD') }).ok).toBe(false);
    expect(paidViaOf({ accountId: 'hdfc', typed: '0', accounts: [account()], entry: money(10_000n, 'USD') }).ok).toBe(false);
  });

  it('refuses an account the person cannot use', () => {
    expect(paidViaOf({ accountId: 'gone', typed: '', accounts: [account()], entry: rupees }).ok).toBe(false);
  });

  it('refuses an archived account for a new entry, and accepts the one the entry being corrected already names', () => {
    const archived = account({ id: 'old', name: 'Old', last4: null, isArchived: true });
    expect(paidViaOf({ accountId: 'old', typed: '', accounts: [archived], entry: rupees }).ok).toBe(false);
    expect(paidViaOf({ accountId: 'old', typed: '', accounts: [archived], entry: rupees, keep: 'old' })).toEqual({
      ok: true,
      value: { accountId: 'old', amount: rupees },
    });
    expect(paidViaOf({ accountId: 'old', typed: '', accounts: [archived], entry: rupees, keep: 'another' }).ok).toBe(false);
  });
});

describe('paidFromChoices — the account a correction already names', () => {
  it('offers an archived account the entry names, marked archived, and no other archived one', () => {
    const accounts = [account(), account({ id: 'old', name: 'Old', last4: null, isArchived: true }), account({ id: 'older', name: 'Older', last4: null, isArchived: true })];
    expect(paidFromChoices(accounts, [], 'old').map((choice) => [choice.id, choice.label])).toEqual([
      ['hdfc', 'HDFC savings ••4821'],
      ['old', 'Old (archived)'],
    ]);
  });
});
