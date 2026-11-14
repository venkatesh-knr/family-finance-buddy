import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { Account, IncomeRule } from '../../repo/types.ts';
import { dueAfterCredit, expectedRows, firstDueAfter, ordinalDay, ruleFromCredit, ruleHistory, ruleListRows } from './ruleForm.ts';

/**
 * The salary rule and its expected credits (docs/design/ledger-income.md section 5; the SalaryRule board and the Expected panel of
 * MoneyLedger). A rule reminds and never posts (LI-I8): a due rule shows an expected credit that counts nowhere until it is confirmed.
 */

const account = (patch: Partial<Account>): Account => ({
  id: 'a-1',
  householdId: 'h-1',
  memberId: 'm-1',
  name: 'SBI Savings',
  institution: null,
  type: 'savings',
  currency: 'INR',
  last4: '7710',
  isForeign: false,
  openedOn: null,
  visibility: 'household',
  isArchived: false,
  ...patch,
});

const rule = (patch: Partial<IncomeRule>): IncomeRule => ({
  id: 'r-1',
  householdId: 'h-1',
  name: 'Rent · Flat 2B',
  memberId: 'm-1',
  accountId: 'a-1',
  category: 'rent',
  amount: money(2_800_000n, 'INR'),
  cadence: 'monthly',
  dueDay: 5,
  nextDue: '2026-11-05',
  visibility: 'household',
  reminderDays: 0,
  status: 'active',
  ...patch,
});

describe('ordinalDay — a payday as a person says it', () => {
  it('says 1st, 2nd, 3rd and 4th to 20th, then 21st, 22nd, 23rd and 24th to 28th', () => {
    expect(ordinalDay(1)).toBe('1st of the month');
    expect(ordinalDay(2)).toBe('2nd of the month');
    expect(ordinalDay(3)).toBe('3rd of the month');
    expect(ordinalDay(4)).toBe('4th of the month');
    expect(ordinalDay(11)).toBe('11th of the month');
    expect(ordinalDay(12)).toBe('12th of the month');
    expect(ordinalDay(13)).toBe('13th of the month');
    expect(ordinalDay(21)).toBe('21st of the month');
    expect(ordinalDay(22)).toBe('22nd of the month');
    expect(ordinalDay(23)).toBe('23rd of the month');
    expect(ordinalDay(28)).toBe('28th of the month');
  });
});

describe('firstDueAfter — the first payday a new rule falls due on, after the credit it repeats', () => {
  it('is the same month’s payday when that is after the credit’s day', () => {
    expect(firstDueAfter('2026-11-01', 28)).toBe('2026-11-28');
    expect(firstDueAfter('2026-11-14', 15)).toBe('2026-11-15');
  });

  it('is next month’s when the payday is the credit’s day or before it, across a year end', () => {
    expect(firstDueAfter('2026-11-14', 14)).toBe('2026-12-14');
    expect(firstDueAfter('2026-11-14', 5)).toBe('2026-12-05');
    expect(firstDueAfter('2026-12-14', 1)).toBe('2027-01-01');
  });

  it('a credit of an earlier month gives a payday that is already due, so it is expected at once', () => {
    expect(firstDueAfter('2026-10-01', 1)).toBe('2026-11-01');
  });
});

describe('dueAfterCredit — Repeats every month, from a credit just entered', () => {
  it('the payday is the credit’s day and the rule first falls due a month on', () => {
    expect(dueAfterCredit('2026-11-01')).toEqual({ payday: 1, firstDue: '2026-12-01' });
    expect(dueAfterCredit('2026-11-17')).toEqual({ payday: 17, firstDue: '2026-12-17' });
  });

  it('a credit on the 29th to 31st becomes the 28th, which exists in every month', () => {
    expect(dueAfterCredit('2026-01-31')).toEqual({ payday: 28, firstDue: '2026-02-28' });
    expect(dueAfterCredit('2026-12-30')).toEqual({ payday: 28, firstDue: '2027-01-28' });
  });
});

describe('ruleFromCredit — the rule a credit becomes', () => {
  it('keeps the credit’s name for it, whose, account, amount, kind and who sees it', () => {
    const made = ruleFromCredit({
      payer: 'Acme Technologies',
      category: 'salary',
      memberId: 'm-1',
      accountId: 'a-1',
      amount: money(14_200_000n, 'INR'),
      visibility: 'personal',
      date: '2026-11-01',
    });
    expect(made).toEqual({
      name: 'Acme Technologies',
      category: 'salary',
      memberId: 'm-1',
      accountId: 'a-1',
      amount: money(14_200_000n, 'INR'),
      visibility: 'personal',
      payday: '1',
      creditDate: '2026-11-01',
    });
  });

  it('is named for its kind when the credit had no payer', () => {
    expect(ruleFromCredit({ payer: null, category: 'rent', memberId: 'm-1', accountId: null, amount: money(100n, 'INR'), visibility: 'household', date: '2026-11-05' }).name).toBe(
      'Rent',
    );
  });
});

describe('expectedRows — what is waiting to be confirmed', () => {
  const ctx = { accounts: [account({})], today: '2026-11-14', privacy: false, credits: [] as { ruleId: string | null; dueDate: string | null }[] };

  it('lists a rule due today or earlier, with its account, its due date, that it counts nowhere yet, and its amount', () => {
    const [row] = expectedRows([rule({})], ctx);
    expect(row).toMatchObject({
      ruleId: 'r-1',
      dueDate: '2026-11-05',
      title: 'Rent · Flat 2B',
      sub: 'SBI Savings ••7710 · due 5 Nov · not counted yet',
      amount: '₹28,000',
      word: 'expected',
    });
  });

  it('lists a rule three months behind three times, oldest first', () => {
    const rows = expectedRows([rule({ nextDue: '2026-09-05' })], ctx);
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
  });

  it('LI-I8 — offers its actions on a rule’s oldest due date only: the rule moves on one date at a time, so a later one waits', () => {
    const rows = expectedRows([rule({ nextDue: '2026-09-05' })], ctx);
    expect(rows.map((r) => r.actionable)).toEqual([true, false, false]);
    // Each rule has its own oldest.
    const two = expectedRows([rule({ nextDue: '2026-10-05' }), rule({ id: 'r-2', name: 'Salary', nextDue: '2026-10-01' })], ctx);
    expect(two.filter((r) => r.actionable).map((r) => [r.ruleId, r.dueDate])).toEqual([
      ['r-2', '2026-10-01'],
      ['r-1', '2026-10-05'],
    ]);
  });

  it('LI-I8 — leaves out a due date that already has a credit, a voided one included, since it holds the date', () => {
    const credited = [{ ruleId: 'r-1', dueDate: '2026-10-05' }];
    const rows = expectedRows([rule({ nextDue: '2026-09-05' })], { ...ctx, credits: credited });
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-09-05', '2026-11-05']);
    // A credit of another rule, or a typed credit with no rule, takes nothing off.
    expect(expectedRows([rule({})], { ...ctx, credits: [{ ruleId: 'r-9', dueDate: '2026-11-05' }, { ruleId: null, dueDate: null }] })).toHaveLength(1);
  });

  it('lists nothing for a rule not yet due, or one that is paused or archived', () => {
    expect(expectedRows([rule({ nextDue: '2026-12-05' })], ctx)).toEqual([]);
    expect(expectedRows([rule({ status: 'paused' })], ctx)).toEqual([]);
    expect(expectedRows([rule({ status: 'archived' })], ctx)).toEqual([]);
  });

  it('says no account for a rule that names none, and keeps the figure out of the row under privacy', () => {
    const [row] = expectedRows([rule({ accountId: null })], { ...ctx, privacy: true });
    expect(row?.sub).toBe('no account · due 5 Nov · not counted yet');
    expect(row?.amount).not.toMatch(/\d/);
  });

  it('orders rows by due date, and by name within a day', () => {
    const rows = expectedRows([rule({ id: 'r-2', name: 'Salary', nextDue: '2026-11-01' }), rule({ id: 'r-1' })], ctx);
    expect(rows.map((r) => r.ruleId)).toEqual(['r-2', 'r-1']);
  });
});

describe('ruleHistory — a rule’s due dates, as the SalaryRule board lists them (Its credits)', () => {
  const salary = rule({ id: 'r-s', name: 'Salary', category: 'salary', amount: money(14_200_000n, 'INR'), dueDay: 1, nextDue: '2026-12-01', accountId: null });
  const credit = (dueDate: string, minor: number, over: { isVoided?: boolean } = {}) => ({
    ruleId: 'r-s',
    dueDate,
    amount: money(BigInt(minor) * 100n, 'INR'),
    isVoided: over.isVoided ?? false,
  });
  const ctx = { today: '2026-11-14', privacy: false, viewerMemberId: 'm-1' };

  it('lists the upcoming date, a confirmed one, and one confirmed at a different amount with what the rule says now', () => {
    const lines = ruleHistory(salary, [credit('2026-11-01', 142_000), credit('2026-10-01', 138_450)], ctx);
    // Newest first.
    expect(lines.map((l) => [l.dueDate, l.word])).toEqual([
      ['2026-12-01', 'upcoming'],
      ['2026-11-01', 'confirmed'],
      ['2026-10-01', 'confirmed at a different amount'],
    ]);
    expect(lines[1]).toMatchObject({ amount: '+₹1,42,000', note: null });
    // The rule's amount is today's: what it said on that date is not kept, so the line does not claim it did.
    expect(lines[2]).toMatchObject({ amount: '+₹1,38,450', note: 'rule now ₹1,42,000' });
  });

  it('says not this month, and that nothing was posted, for a date that was passed over', () => {
    const lines = ruleHistory(salary, [credit('2026-11-01', 142_000), credit('2026-09-01', 142_000)], ctx);
    expect(lines.find((l) => l.dueDate === '2026-10-01')).toMatchObject({ word: 'not this month', amount: '—', note: 'nothing posted' });
  });

  it('LI-I8 — a due date that is waiting is expected and not counted yet, at the rule’s amount', () => {
    const waiting = { ...salary, nextDue: '2026-11-01' };
    const lines = ruleHistory(waiting, [credit('2026-10-01', 142_000)], ctx);
    expect(lines.find((l) => l.dueDate === '2026-11-01')).toMatchObject({ word: 'expected', amount: '₹1,42,000', note: 'not counted yet' });
    expect(lines.find((l) => l.dueDate === '2026-12-01')?.word).toBe('upcoming');
  });

  it('lists every date a rule that is behind is expecting, as the Expected panel does, and then the next', () => {
    const behind = { ...salary, nextDue: '2026-09-01' };
    const lines = ruleHistory(behind, [credit('2026-08-01', 142_000)], ctx);
    expect(lines.map((l) => [l.dueDate, l.word])).toEqual([
      ['2026-12-01', 'upcoming'],
      ['2026-11-01', 'expected'],
      ['2026-10-01', 'expected'],
      ['2026-09-01', 'expected'],
      ['2026-08-01', 'confirmed'],
    ]);
  });

  it('LI-I8 — keeps a confirmed credit when the payday has been changed: it is listed by the date it answered, not matched to the new payday', () => {
    // Credits answered 1 Oct and 1 Nov; the payday was then moved to the 5th, so the rule's next due is 5 Dec.
    const moved = { ...salary, dueDay: 5, nextDue: '2026-12-05' };
    const lines = ruleHistory(moved, [credit('2026-10-01', 142_000), credit('2026-11-01', 142_000)], ctx);
    expect(lines.map((l) => [l.dueDate, l.word])).toEqual([
      ['2026-12-05', 'upcoming'],
      ['2026-11-01', 'confirmed'],
      ['2026-10-01', 'confirmed'],
    ]);
    expect(lines.some((l) => l.word === 'not this month')).toBe(false);
  });

  it('a voided credit holds its date, and says it does not count', () => {
    const lines = ruleHistory(salary, [credit('2026-11-01', 142_000, { isVoided: true })], ctx);
    expect(lines.find((l) => l.dueDate === '2026-11-01')).toMatchObject({ word: 'voided', amount: '—', note: 'not counted' });
  });

  it('on a rule that is another member’s, a month with no credit shown is not called not this month: the credit may be one the viewer cannot read', () => {
    const lines = ruleHistory(salary, [credit('2026-11-01', 142_000), credit('2026-09-01', 142_000)], { ...ctx, viewerMemberId: 'm-9' });
    expect(lines.find((l) => l.dueDate === '2026-10-01')).toMatchObject({ word: 'no credit shown to you', amount: '—', note: null });
    // On one’s own rule every credit is readable, so nothing posted is true.
    const own = ruleHistory(salary, [credit('2026-11-01', 142_000), credit('2026-09-01', 142_000)], ctx);
    expect(own.find((l) => l.dueDate === '2026-10-01')?.word).toBe('not this month');
  });

  it('a paused rule lists what was settled and no expected or upcoming date: it expects nothing', () => {
    const paused = { ...salary, status: 'paused' as const, nextDue: '2026-11-01' };
    const lines = ruleHistory(paused, [credit('2026-10-01', 142_000)], ctx);
    expect(lines.map((l) => [l.dueDate, l.word])).toEqual([['2026-10-01', 'confirmed']]);
  });

  it('keeps figures out of the lines under privacy, and takes no other rule’s credits', () => {
    const other = { ruleId: 'r-9', dueDate: '2026-11-01', amount: money(100n, 'INR'), isVoided: false };
    const lines = ruleHistory(salary, [credit('2026-11-01', 142_000), other], { ...ctx, privacy: true });
    expect(lines.find((l) => l.dueDate === '2026-11-01')?.amount).not.toMatch(/\d/);
    expect(ruleHistory(salary, [other], ctx).find((l) => l.dueDate === '2026-11-01')).toBeUndefined();
  });

  it('lists at most the latest twelve, and a rule with no credit yet lists its next date', () => {
    const credits = Array.from({ length: 30 }, (_, i) => {
      const index = 2026 * 12 + 10 - i;
      return credit(`${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}-01`, 100);
    });
    expect(ruleHistory(salary, credits, ctx)).toHaveLength(12);
    expect(ruleHistory(salary, [], ctx).map((l) => l.dueDate)).toEqual(['2026-12-01']);
  });
});

describe('ruleListRows — the rules, so that one that is not due can be reached', () => {
  const ctx = { accounts: [account({})], privacy: false };

  it('lists each rule in use or paused, by name, with its usual amount and when it is next due, or that it is paused', () => {
    const rows = ruleListRows(
      [rule({ id: 'a', name: 'Zed', nextDue: '2026-12-05' }), rule({ id: 'b', name: 'Alpha', status: 'paused' }), rule({ id: 'c', status: 'archived' })],
      ctx,
    );
    expect(rows.map((r) => [r.ruleId, r.title, r.sub])).toEqual([
      ['b', 'Alpha', '₹28,000 · paused, it expects nothing'],
      ['a', 'Zed', '₹28,000 · next due 5 Dec'],
    ]);
  });

  it('keeps the amount out of the row under privacy', () => {
    const [row] = ruleListRows([rule({})], { ...ctx, privacy: true });
    expect(row?.sub).not.toMatch(/\d{2},/);
  });
});
