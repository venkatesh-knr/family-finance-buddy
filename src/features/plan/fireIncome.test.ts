import { describe, expect, it } from 'vitest';
import type { IncomeCredit } from '../../domain/income.ts';
import { money } from '../../lib/money.ts';
import { householdIncomeView, mineIncomeView, otherCurrencyIncome, sideBySide } from './fireIncome.ts';

/**
 * What FIRE says about income (docs/design/ledger-income.md section 7; the FireIncome and FireBusiness boards): the yearly income with its
 * working, where the usual amount came from, the months each marked usual or not, business income over twelve months with *nothing drawn*
 * beside an empty one, and *a year, side by side*. Never grown by inflation, never a guess, and never zero when there is nothing to read
 * (LI-I10). Every example is a state of those boards.
 */

const credit = (category: IncomeCredit['category'], date: string, rupees: number, memberId = 'm-1'): IncomeCredit => ({
  memberId,
  category,
  amountMinor: BigInt(rupees) * 100n,
  currency: 'INR',
  date,
});
const inr = (rupees: number) => money(BigInt(rupees) * 100n, 'INR');
const asOf = '2026-11-14';

describe('mineIncomeView — salary', () => {
  // Four of the last six months entered came to ₹1,42,000, and two to other amounts.
  const salary = [
    credit('salary', '2026-06-01', 142_000),
    credit('salary', '2026-07-01', 142_000),
    credit('salary', '2026-08-01', 138_450),
    credit('salary', '2026-09-01', 142_000),
    credit('salary', '2026-10-01', 142_000),
    credit('salary', '2026-11-01', 150_000),
  ];

  it('is the usual month times twelve, with its working saying so and that it is never grown by inflation', () => {
    const view = mineIncomeView(salary, 'm-1', 'INR', asOf, false);
    expect(view.kind).toBe('income');
    expect(view.total).toEqual(inr(1_704_000));
    expect(view.salary?.yearly).toEqual(inr(1_704_000));
    expect(view.salary?.working).toBe('₹1,42,000 × 12 · never grown by inflation');
  });

  it('says where the usual amount came from, in words: four of the six months entered', () => {
    const view = mineIncomeView(salary, 'm-1', 'INR', asOf, false);
    expect(view.salary?.origin).toBe('came in four of the six months entered');
  });

  it('marks each month usual or not the usual amount, with the word and not only a tick', () => {
    const months = mineIncomeView(salary, 'm-1', 'INR', asOf, false).salary?.months ?? [];
    expect(months.map((m) => [m.label, m.mark])).toEqual([
      ['Jun 2026', 'usual'],
      ['Jul 2026', 'usual'],
      ['Aug 2026', 'not the usual amount'],
      ['Sep 2026', 'usual'],
      ['Oct 2026', 'usual'],
      ['Nov 2026', 'not the usual amount'],
    ]);
    expect(months[2]?.amount).toEqual(inr(138_450));
  });

  it('LI-I20 — when nothing repeats it uses the latest month’s salary and says so (state 2)', () => {
    const view = mineIncomeView([credit('salary', '2026-10-01', 140_000), credit('salary', '2026-11-01', 150_000)], 'm-1', 'INR', asOf, false);
    expect(view.salary?.yearly).toEqual(inr(1_800_000));
    expect(view.salary?.origin).toBe('No amount repeats, so this is the latest month’s salary.');
  });

  it('keeps the figures out of the working under privacy', () => {
    const view = mineIncomeView(salary, 'm-1', 'INR', asOf, true);
    expect(view.salary?.working).not.toMatch(/\d{2},/);
    expect(view.salary?.working).toContain('× 12 · never grown by inflation');
  });
});

describe('mineIncomeView — business income', () => {
  it('LI-I18 — over twelve complete months is their total, labelled as the last 12 months, with the window it covers', () => {
    const credits = Array.from({ length: 12 }, (_, i) => {
      const index = 2025 * 12 + 10 + i; // Nov 2025 to Oct 2026
      return credit('business', `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}-10`, 50_000);
    });
    const view = mineIncomeView(credits, 'm-1', 'INR', asOf, false);
    expect(view.business).toMatchObject({ kind: 'full', yearly: inr(600_000), working: 'Business income, last 12 months · never grown by inflation' });
    expect(view.business?.months).toHaveLength(12);
    expect(view.business?.window).toBe('November 2025 to October 2026. November 2026 joins when it ends.');
  });

  it('LI-I18 — with fewer months is their average times twelve, labelled as that, and a month with nothing counts as nothing drawn', () => {
    const view = mineIncomeView([credit('business', '2026-08-10', 90_000), credit('business', '2026-10-10', 30_000)], 'm-1', 'INR', asOf, false);
    expect(view.business).toMatchObject({ kind: 'average', yearly: inr(480_000), working: 'average of 3 months × 12 · never grown by inflation' });
    expect(view.business?.months.map((m) => [m.label, m.note])).toEqual([
      ['Aug 2026', null],
      ['Sep 2026', 'nothing drawn'],
      ['Oct 2026', null],
    ]);
  });

  it('with only the current month entered says the first figure comes when that month ends (state 4)', () => {
    const view = mineIncomeView([credit('business', '2026-11-05', 70_000)], 'm-1', 'INR', asOf, false);
    expect(view.business).toMatchObject({ kind: 'waiting', yearly: null });
    expect(view.business?.working).toBe('Business income entered for November 2026 only. The first yearly figure comes when November 2026 ends.');
    // No salary, and a business figure that has not arrived: nothing to read yet.
    expect(view.kind).toBe('none');
  });

  it('adds to the salary: yearly income is the salary times twelve plus the business', () => {
    const view = mineIncomeView(
      [credit('salary', '2026-10-01', 100_000), credit('salary', '2026-09-01', 100_000), credit('business', '2026-10-10', 60_000)],
      'm-1',
      'INR',
      asOf,
      false,
    );
    // Salary 12 lakh, and one month of business income since the first, averaged: 60,000 × 12.
    expect(view.total).toEqual(inr(1_200_000 + 720_000));
  });
});

describe('mineIncomeView — nothing to read', () => {
  it('LI-I10 — is none, and never zero, when the only business income is older than the twelve months: it counts for nothing', () => {
    const view = mineIncomeView([credit('business', '2025-06-10', 80_000)], 'm-1', 'INR', asOf, false);
    expect(view.kind).toBe('none');
    expect(view.total).toBeNull();
  });

  it('LI-I10 — with no salary and no business income credit is none, and never zero (state 3)', () => {
    const view = mineIncomeView([credit('interest', '2026-10-05', 1_250)], 'm-1', 'INR', asOf, false);
    expect(view).toEqual({ kind: 'none', total: null, salary: null, business: null });
  });

  it('reads only the member it is asked for', () => {
    const view = mineIncomeView([credit('salary', '2026-10-01', 100_000, 'm-2')], 'm-1', 'INR', asOf, false);
    expect(view.kind).toBe('none');
  });
});

describe('otherCurrencyIncome — income that is not in the currency being read', () => {
  const usd = (category: IncomeCredit['category'], date: string, memberId = 'm-1'): IncomeCredit => ({ memberId, category, amountMinor: 100_000n, currency: 'USD', date });

  it('names the currencies a member has Salary or Business income in besides the one being read, so they are not dropped in silence', () => {
    expect(otherCurrencyIncome([usd('salary', '2026-10-01'), credit('salary', '2026-10-01', 100_000)], 'm-1', 'INR')).toEqual(['USD']);
  });

  it('counts only income: a dividend or a refund in dollars is not income FIRE reads', () => {
    expect(otherCurrencyIncome([usd('dividend', '2026-10-01'), usd('refund', '2026-10-02')], 'm-1', 'INR')).toEqual([]);
  });

  it('reads the member it is asked for, and none besides the currency being read', () => {
    expect(otherCurrencyIncome([usd('salary', '2026-10-01', 'm-2')], 'm-1', 'INR')).toEqual([]);
    expect(otherCurrencyIncome([credit('salary', '2026-10-01', 100_000)], 'm-1', 'INR')).toEqual([]);
  });
});

describe('householdIncomeView — from the sum function, with no member’s months', () => {
  it('is the salary and the business figures the database returned, added, and lists no months', () => {
    const view = householdIncomeView({ yearlySalary: inr(2_400_000), yearlyBusiness: inr(300_000) });
    expect(view.kind).toBe('income');
    expect(view.total).toEqual(inr(2_700_000));
    expect(view.lines).toEqual([
      { label: 'Salary', amount: inr(2_400_000) },
      { label: 'Business income', amount: inr(300_000) },
    ]);
  });

  it('LI-I10 — is none, and never zero, when nobody has an income credit to read', () => {
    expect(householdIncomeView(null)).toEqual({ kind: 'none', total: null, lines: [] });
  });

  it('leaves a line out that is nothing', () => {
    const view = householdIncomeView({ yearlySalary: inr(2_400_000), yearlyBusiness: inr(0) });
    expect(view.lines.map((l) => l.label)).toEqual(['Salary']);
  });
});

describe('sideBySide — a year, arithmetic only', () => {
  it('is what comes in, what is spent from the plan and the difference, labelled as arithmetic and not advice', () => {
    const side = sideBySide(inr(2_700_000), inr(1_800_000), 'salary');
    expect(side).toEqual({
      comesIn: inr(2_700_000),
      comesInNote: 'usual salary × 12',
      spent: inr(1_800_000),
      difference: inr(900_000),
      note: 'arithmetic only, not advice',
    });
  });

  it('says what the income is: the salary, the business income, the two added, or the household’s', () => {
    expect(sideBySide(inr(2), inr(1), 'business')?.comesInNote).toBe('business income, last 12 months');
    expect(sideBySide(inr(2), inr(1), 'both')?.comesInNote).toBe('the two added');
    expect(sideBySide(inr(2), inr(1), 'household')?.comesInNote).toBe('the household’s, added');
  });

  it('shows a difference below nothing as it is', () => {
    expect(sideBySide(inr(1_000_000), inr(1_200_000), 'salary')?.difference).toEqual(inr(-200_000));
  });

  it('is nothing when there is no income to read, no plan, or the two are in different currencies', () => {
    expect(sideBySide(null, inr(1), 'salary')).toBeNull();
    expect(sideBySide(inr(1), null, 'salary')).toBeNull();
    expect(sideBySide(inr(1), money(100n, 'USD'), 'salary')).toBeNull();
  });

  it('LI-I10 — is nothing for a plan with nothing in it: there is no spent from the plan, and the difference would be the whole income', () => {
    expect(sideBySide(inr(1_704_000), inr(0), 'salary')).toBeNull();
  });
});
