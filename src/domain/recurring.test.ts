import { describe, expect, it } from 'vitest';
import { cadenceMonths, firstDueFrom, perYear, resumeFrom } from './recurring.ts';

describe('the first due day of a rule', () => {
  it('is the day itself when the rule starts on or before it in the month', () => {
    expect(firstDueFrom('2026-11-03', 5)).toBe('2026-11-05');
    expect(firstDueFrom('2026-11-05', 5)).toBe('2026-11-05');
  });

  it('is the next month’s when the day has gone by', () => {
    expect(firstDueFrom('2026-11-06', 5)).toBe('2026-12-05');
  });

  it('crosses the year', () => {
    expect(firstDueFrom('2026-12-29', 28)).toBe('2027-01-28');
    expect(firstDueFrom('2026-12-28', 28)).toBe('2026-12-28');
  });
});

describe('where a stopped rule picks up again', () => {
  it('skips the period it was stopped for: paused in August, resumed in November, it next falls due in November or December, not in September', () => {
    expect(resumeFrom('2026-09-01', 1, '2026-11-04')).toBe('2026-12-01');
    expect(resumeFrom('2026-09-01', 5, '2026-11-04')).toBe('2026-11-05');
  });

  it('enters today’s due day when the rule is resumed on it', () => {
    expect(resumeFrom('2026-09-01', 4, '2026-11-04')).toBe('2026-11-04');
  });

  it('keeps a next due day that is already later, so resuming never brings a date forward', () => {
    expect(resumeFrom('2027-03-01', 1, '2026-11-04')).toBe('2027-03-01');
  });
});

describe('what a rule comes to in a year', () => {
  it('is the amount times the number of times it recurs, in whole minor units', () => {
    expect(perYear(150000n, 'monthly')).toBe(1800000n);
    expect(perYear(150000n, 'quarterly')).toBe(600000n);
    expect(perYear(150000n, 'half_yearly')).toBe(300000n);
    expect(perYear(150000n, 'yearly')).toBe(150000n);
  });

  it('has a step in months for each cadence', () => {
    expect([cadenceMonths('monthly'), cadenceMonths('quarterly'), cadenceMonths('half_yearly'), cadenceMonths('yearly')]).toEqual([1, 3, 6, 12]);
  });
});
