import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account, Credit, Member, Transfer } from '../../repo/types.ts';
import { creditLine, kindsFor, mergeByDate, spendingWord, transferLine } from './ledgerLines.ts';

/**
 * The ledger's lines for money in and money moved (docs/design/ledger-income.md section 1; the MoneyLedger board): a name, a second line
 * with the category, the account and whose it is, a signed amount and one word for what it does to the month. Every example is a line of
 * that board. Direction is a sign and a word and never a colour alone (LI-I16).
 */

const members: Member[] = [
  { id: 'm-1', displayName: 'Venkat', colour: 'c1', isArchived: false } as Member,
  { id: 'm-2', displayName: 'Meera', colour: 'c2', isArchived: false } as Member,
];

const account = (patch: Partial<Account>): Account => ({
  id: 'a-1',
  householdId: 'h-1',
  memberId: 'm-1',
  name: 'HDFC',
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

const accounts = [
  account({}),
  account({ id: 'a-2', name: 'SBI Savings', last4: '7710' }),
  account({ id: 'a-3', name: 'ICICI card', last4: '1188', type: 'card' }),
];

const credit = (patch: Partial<Credit>): Credit => ({
  id: 'c-1',
  householdId: 'h-1',
  memberId: 'm-1',
  accountId: 'a-1',
  category: 'salary',
  amount: money(14_200_000n, 'INR'),
  date: '2026-11-01',
  visibility: 'personal',
  source: 'typed',
  ruleId: null,
  dueDate: null,
  payer: null,
  note: null,
  isVoided: false,
  ...patch,
});

const ctx = { accounts, members, viewerMemberId: 'm-1', privacy: false };

describe('creditLine — money in', () => {
  it('a private salary: its name, whose and where, that only you see the row, +₹1,42,000 and the word came in', () => {
    const line = creditLine(credit({}), ctx);
    expect(line.title).toBe('Salary');
    expect(line.sub).toBe('Venkat · HDFC ••4021 · only you see this row');
    expect(line.private).toBe(true);
    expect(line.amount).toBe('+₹1,42,000');
    expect(line.word).toBe('came in');
  });

  it('interest on a shared account has no lock and says the household sees it', () => {
    const line = creditLine(credit({ category: 'interest', accountId: 'a-2', amount: money(125_000n, 'INR'), visibility: 'household' }), ctx);
    expect(line.title).toBe('Interest');
    expect(line.sub).toBe('Venkat · SBI Savings ••7710');
    expect(line.private).toBe(false);
    expect(line.amount).toBe('+₹1,250');
  });

  it('a refund is named for who paid it, says what it is, and takes away from spent', () => {
    const line = creditLine(
      credit({ category: 'refund', payer: 'Amazon', accountId: 'a-3', amount: money(129_900n, 'INR'), visibility: 'household' }),
      ctx,
    );
    expect(line.title).toBe('Amazon');
    expect(line.sub).toBe('Refund or money back · Venkat · ICICI card ••1188');
    expect(line.amount).toBe('+₹1,299');
    expect(line.word).toBe('takes away from spent');
  });

  it('a credit with no account says so, in words', () => {
    const line = creditLine(credit({ accountId: null, category: 'rent', payer: 'Tenant' }), ctx);
    expect(line.sub).toBe('Rent · Venkat · no account · only you see this row');
  });

  it('names a private credit as belonging to its owner when somebody else is looking', () => {
    // The row reaches this screen only if the caller may read it, so this is the owner reading another member’s shared row.
    const line = creditLine(credit({ memberId: 'm-2', visibility: 'household' }), ctx);
    expect(line.sub).toBe('Meera · HDFC ••4021');
  });

  it('LI-I16 — a voided credit is said to be, and says it does nothing to the month rather than that it came in', () => {
    const line = creditLine(credit({ isVoided: true }), ctx);
    expect(line.voided).toBe(true);
    expect(line.word).toBe('voided · not counted');
  });

  it('LI-I16 — direction is a sign and a word: money in is +, a refund is + and takes away from spent', () => {
    expect(creditLine(credit({}), ctx).amount.startsWith('+')).toBe(true);
    expect(creditLine(credit({ category: 'refund' }), ctx).word).toBe('takes away from spent');
  });

  it('LI-I16 — a line’s accessible name carries its direction, its figure and its word', () => {
    expect(creditLine(credit({}), ctx).name).toBe('Salary, Venkat · HDFC ••4021 · only you see this row, +₹1,42,000, came in');
  });

  it('keeps the figure out of the line under privacy, and still shows its sign', () => {
    const line = creditLine(credit({}), { ...ctx, privacy: true });
    expect(line.amount).not.toMatch(/\d/);
    expect(line.amount.startsWith('+')).toBe(true);
  });

  it('leaves the member out when the household has one', () => {
    const line = creditLine(credit({}), { ...ctx, members: [members[0] as Member] });
    expect(line.sub).toBe('HDFC ••4021 · only you see this row');
  });
});

describe('transferLine — a move between the household’s own accounts', () => {
  const move = (patch: Partial<Transfer>): Transfer => ({
    id: 't-1',
    householdId: 'h-1',
    fromAccountId: 'a-1',
    toAccountId: 'a-3',
    amount: money(1_824_000n, 'INR'),
    date: '2026-11-12',
    source: 'typed',
    note: null,
    isVoided: false,
    ...patch,
  });

  it('LI-I16 — a card payment: named for the card, from one account to the other, no sign, moved · not spent', () => {
    const line = transferLine(move({}), ctx);
    expect(line.title).toBe('ICICI card payment');
    expect(line.sub).toBe('HDFC ••4021 → ICICI card ••1188');
    expect(line.amount).toBe('₹18,240');
    expect(line.word).toBe('moved · not spent');
    expect(line.name).toBe('ICICI card payment, HDFC ••4021 → ICICI card ••1188, ₹18,240, moved · not spent');
  });

  it('a move between two bank accounts is named a move', () => {
    const line = transferLine(move({ toAccountId: 'a-2' }), ctx);
    expect(line.title).toBe('Moved between accounts');
    expect(line.sub).toBe('HDFC ••4021 → SBI Savings ••7710');
  });

  it('says an account it cannot name is another account, and still shows the move', () => {
    const line = transferLine(move({ fromAccountId: 'a-9' }), ctx);
    expect(line.sub).toBe('another account → ICICI card ••1188');
  });
});

describe('spendingWord — what a line of spending does to the month', () => {
  it('LI-I16 — spending is − and spent, and a voided line does nothing to the month', () => {
    expect(spendingWord(false)).toEqual({ sign: '−', word: 'spent' });
    expect(spendingWord(true)).toEqual({ sign: '−', word: 'voided · not counted' });
  });
});

describe('kindsFor — what each filter shows', () => {
  it('All shows everything; In shows money in; Out shows spending; Moved shows moves', () => {
    expect(kindsFor('all')).toEqual(['spending', 'credit', 'move']);
    expect(kindsFor('in')).toEqual(['credit']);
    expect(kindsFor('out')).toEqual(['spending']);
    expect(kindsFor('moved')).toEqual(['move']);
  });
});

describe('mergeByDate — one list, newest first', () => {
  it('orders by date, newest first, and keeps the order given among entries of one day', () => {
    const merged = mergeByDate([
      { date: '2026-11-10', key: 'a' },
      { date: '2026-11-13', key: 'b' },
      { date: '2026-11-10', key: 'c' },
      { date: '2026-11-12', key: 'd' },
    ]);
    expect(merged.map((e) => e.key)).toEqual(['b', 'd', 'a', 'c']);
  });
});
