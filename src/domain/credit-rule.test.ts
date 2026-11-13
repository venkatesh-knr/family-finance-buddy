import { describe, expect, it } from 'vitest';
import { dueHistory, expectedCredits, nextDueAfter, reminderText, type CreditRule } from './credit-rule.ts';

/**
 * A recurring credit, the salary rule (docs/design/ledger-income.md section 5): what is expected, what was confirmed, and what the
 * reminder says. A rule never posts by itself, so an expected credit counts nowhere until a person confirms it. Pure: the day is passed in.
 */

const rule = (over: Partial<CreditRule> = {}): CreditRule => ({
  id: 'r1',
  name: 'Salary',
  amountMinor: 14_200_000n,
  cadence: 'monthly',
  dueDay: 1,
  nextDue: '2026-11-01',
  status: 'active',
  ...over,
});

describe('nextDueAfter', () => {
  it('moves a monthly rule on by a month, on its day', () => {
    expect(nextDueAfter('2026-11-01', 1, 'monthly')).toBe('2026-12-01');
    expect(nextDueAfter('2026-12-28', 28, 'monthly')).toBe('2027-01-28');
  });

  it('moves a quarterly, half-yearly or yearly rule by that many months', () => {
    expect(nextDueAfter('2026-11-05', 5, 'quarterly')).toBe('2027-02-05');
    expect(nextDueAfter('2026-11-05', 5, 'half_yearly')).toBe('2027-05-05');
    expect(nextDueAfter('2026-11-05', 5, 'yearly')).toBe('2027-11-05');
  });
});

describe('expectedCredits', () => {
  it('LI-I8 — nothing is expected before the day, and one is expected on it', () => {
    expect(expectedCredits(rule(), '2026-10-31')).toEqual([]);
    expect(expectedCredits(rule(), '2026-11-01')).toEqual(['2026-11-01']);
  });

  it('a rule three months behind lists three, oldest first', () => {
    expect(expectedCredits(rule({ nextDue: '2026-09-01' }), '2026-11-13')).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
  });

  it('a paused or archived rule expects nothing', () => {
    expect(expectedCredits(rule({ status: 'paused' }), '2026-11-13')).toEqual([]);
    expect(expectedCredits(rule({ status: 'archived' }), '2026-11-13')).toEqual([]);
  });

  it('is bounded, so a rule left for years does not list for ever', () => {
    expect(expectedCredits(rule({ nextDue: '2010-01-01' }), '2026-11-13').length).toBeLessThanOrEqual(24);
  });
});

describe('dueHistory', () => {
  const credits = [
    { dueDate: '2026-08-01', amountMinor: 14_200_000n },
    { dueDate: '2026-09-01', amountMinor: 13_000_000n },
  ];

  it('says what each due date came to: confirmed, confirmed at a different amount, passed over, or expected', () => {
    // The rule's next due is 1 November: 1 October was moved past ("not this month") and wrote nothing.
    const history = dueHistory(rule(), credits, { from: '2026-08-01', today: '2026-11-13' });
    expect(history.map((h) => [h.dueDate, h.status])).toEqual([
      ['2026-08-01', 'confirmed'],
      ['2026-09-01', 'confirmed-different'],
      ['2026-10-01', 'passed-over'],
      ['2026-11-01', 'expected'],
    ]);
  });

  it('puts the rule\'s amount beside a different one, so the screen can say "was ₹1,42,000"', () => {
    const history = dueHistory(rule(), credits, { from: '2026-08-01', today: '2026-11-13' });
    expect(history[1]).toMatchObject({ creditAmountMinor: 13_000_000n, ruleAmountMinor: 14_200_000n });
  });

  it('a date after today is upcoming and nothing yet', () => {
    const history = dueHistory(rule({ nextDue: '2026-12-01' }), credits, { from: '2026-11-01', today: '2026-11-13', through: '2027-01-01' });
    expect(history.map((h) => [h.dueDate, h.status])).toEqual([
      ['2026-11-01', 'passed-over'],
      ['2026-12-01', 'upcoming'],
      ['2027-01-01', 'upcoming'],
    ]);
  });

  it('works nothing posted out from the dates and the credits, and stores nothing', () => {
    const a = dueHistory(rule(), [], { from: '2026-09-01', today: '2026-11-13' });
    const b = dueHistory(rule(), [], { from: '2026-09-01', today: '2026-11-13' });
    expect(a).toEqual(b);
    expect(a.map((h) => h.status)).toEqual(['passed-over', 'passed-over', 'expected']);
  });
});

describe('reminderText', () => {
  it('LI-I14 — names the rule and never an amount: no digit and no currency symbol', () => {
    for (const days of [0, 1, 2, 5, 30]) {
      const text = reminderText('Salary', days);
      expect(text).toContain('Salary');
      expect(text).not.toMatch(/[0-9₹$€£]/);
    }
  });

  it('says today, tomorrow or soon, without counting days', () => {
    expect(reminderText('Salary', 0)).toBe('Salary is due today.');
    expect(reminderText('Salary', 1)).toBe('Salary is due tomorrow.');
    expect(reminderText('Salary', 4)).toBe('Salary is due soon.');
  });
});
