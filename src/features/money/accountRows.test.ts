import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account, AccountBalance, Member } from '../../repo/types.ts';
import { accountRow, latestBalances, splitAccounts, titleOf } from './accountRows.ts';

/**
 * The Accounts tab's rows, as the MoneyAccounts board draws them (docs/design/ledger-income.md section 1a): a name, with the last four
 * digits when there are some; the type, whose it is and who sees it, in words; and the balance at the last close, or the words that say
 * there is none. Every example below is a row of that board.
 */

const VENKAT: Member = { id: 'm-1', displayName: 'Venkat', colour: 'c1', isArchived: false } as Member;
const MEERA: Member = { id: 'm-2', displayName: 'Meera', colour: 'c2', isArchived: false } as Member;
const members = [VENKAT, MEERA];

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

const balance = (accountId: string, asAt: string, minor: bigint, currency = 'INR'): AccountBalance => ({
  id: `b-${accountId}-${asAt}`,
  householdId: 'h-1',
  accountId,
  asAt,
  balance: money(minor, currency),
  source: 'typed',
  note: null,
});

describe('titleOf — the name, and the last four digits when there are some (LI-I24)', () => {
  it('puts the last four after the name, as the board does', () => {
    expect(titleOf(account({ name: 'HDFC Savings', last4: '4021' }))).toBe('HDFC Savings ••4021');
  });

  it('is the name alone when there are no last four: a nickname is enough', () => {
    expect(titleOf(account({ name: 'Salary account', last4: null }))).toBe('Salary account');
  });
});

describe('accountRow — what the second line says', () => {
  it('says the type, whose it is, and that only its owner sees a private account', () => {
    const row = accountRow(account({ visibility: 'personal' }), { members, viewerMemberId: 'm-1', balance: null });
    expect(row.sub).toBe('Savings · Venkat · only you see it');
    expect(row.private).toBe(true);
  });

  it('says the household sees a shared account, and names whose it is', () => {
    const row = accountRow(account({ memberId: 'm-2', last4: null, name: 'Salary account' }), { members, viewerMemberId: 'm-1', balance: null });
    expect(row.sub).toBe('Savings · Meera · the household sees it · no last four');
    expect(row.private).toBe(false);
  });

  it('names a card a card, and a current account current', () => {
    expect(accountRow(account({ type: 'card', name: 'ICICI card', last4: '1188' }), { members, viewerMemberId: 'm-1', balance: null }).sub).toBe(
      'Card · Venkat · the household sees it',
    );
    expect(accountRow(account({ type: 'current' }), { members, viewerMemberId: 'm-1', balance: null }).sub).toMatch(/^Current · /);
  });

  it('says an account held abroad is, since the currency alone does not say where it is held', () => {
    const row = accountRow(account({ isForeign: true, currency: 'USD', last4: '9001' }), { members, viewerMemberId: 'm-1', balance: null });
    expect(row.sub).toBe('Savings · Venkat · the household sees it · held outside India');
  });

  it('does not stop at a member it cannot find: the row still says something', () => {
    const row = accountRow(account({ memberId: 'm-9' }), { members, viewerMemberId: 'm-1', balance: null });
    expect(row.sub).toMatch(/^Savings · a member · /);
  });
});

describe('accountRow — the balance at the last close', () => {
  it('shows the balance and the day it is as at', () => {
    const row = accountRow(account({}), { members, viewerMemberId: 'm-1', balance: balance('a-1', '2026-10-31', 21_430_000n) });
    expect(row.value).toBe('₹2,14,300');
    expect(row.note).toBe('31 Oct');
    expect(row.hasBalance).toBe(true);
  });

  it('shows what a card owes as a minus and the word owed, never as a credit', () => {
    const row = accountRow(account({ type: 'card', last4: '1188' }), { members, viewerMemberId: 'm-1', balance: balance('a-1', '2026-10-31', 2_240_000n) });
    expect(row.value).toBe('−₹22,400');
    expect(row.note).toBe('owed, 31 Oct');
  });

  it('shows a card that has been overpaid as money held, in credit, and never as owed: its amount due is below nothing', () => {
    const row = accountRow(account({ type: 'card', last4: '1188' }), { members, viewerMemberId: 'm-1', balance: balance('a-1', '2026-10-31', -50_000n) });
    expect(row.value).toBe('₹500');
    expect(row.note).toBe('in credit, 31 Oct');
    expect(row.value).not.toMatch(/−/);
  });

  it('says there is no balance yet, and not in a close yet, for an account with none (state 3)', () => {
    const row = accountRow(account({}), { members, viewerMemberId: 'm-1', balance: null });
    expect(row.value).toBe('no balance yet');
    expect(row.note).toBe('not in a close yet');
    expect(row.hasBalance).toBe(false);
  });

  it('keeps a figure out of the row under privacy, and says there is one', () => {
    const row = accountRow(account({}), { members, viewerMemberId: 'm-1', balance: balance('a-1', '2026-10-31', 21_430_000n), privacy: true });
    expect(row.value).not.toMatch(/\d/);
    expect(row.note).toBe('31 Oct');
  });
});

describe('latestBalances — the newest balance of each account', () => {
  it('takes the latest day for each account, and prefers a statement to a typed figure for the same day', () => {
    const typed = balance('a-1', '2026-10-31', 100n);
    const statement: AccountBalance = { ...balance('a-1', '2026-10-31', 200n), source: 'statement' };
    const older = balance('a-1', '2026-09-30', 50n);
    const other = balance('a-2', '2026-08-31', 7n);
    const latest = latestBalances([older, typed, statement, other]);
    expect(latest.get('a-1')?.balance.minor).toBe(200n);
    expect(latest.get('a-2')?.balance.minor).toBe(7n);
    expect(latest.size).toBe(2);
  });

  it('has nothing for an account with no balance', () => {
    expect(latestBalances([]).size).toBe(0);
  });
});

describe('splitAccounts — in use, and archived and folded away', () => {
  it('keeps the order it is given within each group', () => {
    const a = account({ id: 'a', name: 'Axis' });
    const b = account({ id: 'b', name: 'HDFC' });
    const c = account({ id: 'c', name: 'Old', isArchived: true });
    const { active, archived } = splitAccounts([a, b, c]);
    expect(active.map((x) => x.id)).toEqual(['a', 'b']);
    expect(archived.map((x) => x.id)).toEqual(['c']);
  });
});
