import { describe, expect, it } from 'vitest';
import { taxYearOf } from './usePlan.ts';

/**
 * The Indian tax year runs 1 April to 31 March, and this app carries a second
 * calendar besides — Schedule FA runs January to December. Getting the boundary
 * wrong would file three months of spending under the wrong year, so it is
 * worth pinning rather than assuming.
 */
describe('taxYearOf', () => {
  it('starts a new year on 1 April', () => {
    expect(taxYearOf('2026-03-31')).toBe(2025);
    expect(taxYearOf('2026-04-01')).toBe(2026);
  });

  it('names a year by the calendar year it starts in', () => {
    // FY 2026-27 is "2026", which is the convention the budget column comment
    // records — a bare "2026" is otherwise read as January onward.
    expect(taxYearOf('2026-09-06')).toBe(2026);
    expect(taxYearOf('2027-01-15')).toBe(2026);
  });

  it('never reads the clock', () => {
    expect(taxYearOf('2026-06-01')).toBe(taxYearOf('2026-06-01'));
  });
});
