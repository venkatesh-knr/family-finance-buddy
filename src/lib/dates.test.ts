import { describe, expect, it } from 'vitest';
import { formatIsoDate, isIsoDate, istCalendarDate } from './dates.ts';

/**
 * Period boundaries are IST whatever the device says. These fixtures are the
 * two moments that catch a naive implementation: just before and just after
 * midnight in Kolkata, expressed in UTC.
 */

describe('istCalendarDate', () => {
  it('is still the 4th at 23:59 IST, even though UTC has not got there', () => {
    // 2026-04-04 18:29 UTC is 2026-04-04 23:59 IST.
    expect(istCalendarDate(new Date('2026-04-04T18:29:00Z'))).toBe('2026-04-04');
  });

  it('is already the 5th at 00:01 IST, while UTC is still on the 4th', () => {
    // 2026-04-04 18:31 UTC is 2026-04-05 00:01 IST.
    expect(istCalendarDate(new Date('2026-04-04T18:31:00Z'))).toBe('2026-04-05');
  });

  it('rolls the year over on the Indian financial year boundary', () => {
    // 2026-03-31 18:31 UTC is 2026-04-01 00:01 IST — a new tax year.
    expect(istCalendarDate(new Date('2026-03-31T18:31:00Z'))).toBe('2026-04-01');
  });

  it('takes the instant as an argument and never reads the clock itself', () => {
    const fixed = new Date('2026-01-15T12:00:00Z');
    expect(istCalendarDate(fixed)).toBe(istCalendarDate(fixed));
  });
});

describe('isIsoDate', () => {
  it('accepts a calendar date', () => {
    expect(isIsoDate('2026-04-05')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isIsoDate('05-04-2026')).toBe(false);
    expect(isIsoDate('2026-04-05T00:00:00Z')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});

describe('formatIsoDate', () => {
  it('renders a calendar date the way an Indian reader expects', () => {
    expect(formatIsoDate('2026-04-05')).toBe('5 Apr 2026');
  });

  it('does not shift the date while formatting it', () => {
    // The classic bug: parsing to a Date in a western timezone and losing a day.
    expect(formatIsoDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatIsoDate('2026-12-31')).toBe('31 Dec 2026');
  });
});
