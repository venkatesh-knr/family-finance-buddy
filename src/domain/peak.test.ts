import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { calendarYearPeak } from './peak.ts';

/**
 * Schedule FA asks for the highest value a foreign holding reached during the
 * CALENDAR year — not its closing value, and not the tax year. These fixtures
 * exist because the wrong answer here is a wrong number on a tax form, and the
 * most dangerous wrong answer is a confident one computed from missing months.
 */

const usd = (minor: number) => money(BigInt(minor), 'USD');

const reading = (date: string, minor: number) => ({ date, amount: usd(minor) });

describe('calendarYearPeak', () => {
  it('takes the highest reading, not the last', () => {
    const result = calendarYearPeak({
      values: [
        reading('2025-03-31', 500000),
        reading('2025-07-31', 910000), // the peak
        reading('2025-12-31', 620000), // what a year-end statement would show
      ],
      year: 2025,
      today: '2026-09-05',
    });

    expect(result.peak?.minor).toBe(910000n);
    expect(result.peakDate).toBe('2025-07-31');
  });

  it('is provisional when a month has no reading, and names which', () => {
    const result = calendarYearPeak({
      values: [reading('2025-01-31', 100000), reading('2025-02-28', 120000)],
      year: 2025,
      today: '2026-09-05',
    });

    expect(result.isProvisional).toBe(true);
    expect(result.missingMonths).toEqual([
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
  });

  it('is not provisional when every month of a past year was read', () => {
    const values = Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0');
      return reading(`2025-${month}-28`, 100000 + i);
    });

    const result = calendarYearPeak({ values, year: 2025, today: '2026-09-05' });

    expect(result.isProvisional).toBe(false);
    expect(result.missingMonths).toEqual([]);
    expect(result.peak?.minor).toBe(100011n);
  });

  it('does not count months that have not happened yet', () => {
    // Five months into 2026: nothing after May can be missing.
    const result = calendarYearPeak({
      values: [reading('2026-01-31', 100000)],
      year: 2026,
      today: '2026-05-20',
    });

    expect(result.missingMonths).toEqual(['2026-02', '2026-03', '2026-04', '2026-05']);
  });

  it('does not count months before the holding existed', () => {
    // Bought in September: January to August were never ours to report.
    const result = calendarYearPeak({
      values: [reading('2026-09-30', 400000)],
      year: 2026,
      today: '2026-10-15',
      heldFrom: '2026-09-14',
    });

    expect(result.missingMonths).toEqual(['2026-10']);
    expect(result.isProvisional).toBe(true);
  });

  it('reports no peak at all rather than zero when nothing was recorded', () => {
    const result = calendarYearPeak({ values: [], year: 2025, today: '2026-09-05' });

    // Zero would be a figure. Null is the truth: we do not know.
    expect(result.peak).toBeNull();
    expect(result.peakDate).toBeNull();
    expect(result.isProvisional).toBe(true);
    expect(result.missingMonths).toHaveLength(12);
  });

  it('ignores readings from other years', () => {
    const result = calendarYearPeak({
      values: [
        reading('2024-06-30', 5000000), // much larger, wrong year
        reading('2025-06-30', 300000),
      ],
      year: 2025,
      today: '2026-09-05',
    });

    expect(result.peak?.minor).toBe(300000n);
  });

  it('takes the later date when two readings tie at the peak', () => {
    const result = calendarYearPeak({
      values: [reading('2025-04-30', 700000), reading('2025-09-30', 700000)],
      year: 2025,
      today: '2026-09-05',
    });

    expect(result.peakDate).toBe('2025-09-30');
  });

  it('counts a month as read if it holds any reading, not only a month end', () => {
    const result = calendarYearPeak({
      values: [reading('2026-01-09', 100000), reading('2026-02-17', 110000)],
      year: 2026,
      today: '2026-02-20',
    });

    expect(result.missingMonths).toEqual([]);
    expect(result.isProvisional).toBe(false);
  });

  it('refuses to compare amounts in different currencies', () => {
    expect(() =>
      calendarYearPeak({
        values: [reading('2025-01-31', 100000), { date: '2025-02-28', amount: money(90000n, 'INR') }],
        year: 2025,
        today: '2026-09-05',
      }),
    ).toThrow(/mixed currencies/i);
  });

  it('never reads the clock: the same inputs give the same answer', () => {
    const input = { values: [reading('2026-01-31', 100000)], year: 2026, today: '2026-03-02' };
    expect(calendarYearPeak(input)).toEqual(calendarYearPeak(input));
  });
});
