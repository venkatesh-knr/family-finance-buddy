import { describe, expect, it } from 'vitest';
import { ratingMove, ratingRank, recentDowngrade, type RatingChangeInput } from './ratings.ts';

describe('ratingRank', () => {
  it('reads the grade out of what an agency prints, whoever the agency is', () => {
    expect(ratingRank('CRISIL A')).toBe(ratingRank('A'));
    expect(ratingRank('ICRA A+')).toBe(ratingRank('A+'));
    expect(ratingRank('CARE AA-')).toBe(ratingRank('AA-'));
    expect(ratingRank('IND AAA')).toBe(0);
  });

  it('ignores an outlook, a suffix and the case', () => {
    expect(ratingRank('CRISIL AA (Stable)')).toBe(ratingRank('AA'));
    expect(ratingRank('IND AA/Stable')).toBe(ratingRank('AA'));
    expect(ratingRank('BWR AAA(SO)')).toBe(0);
    expect(ratingRank('crisil aa+')).toBe(ratingRank('AA+'));
  });

  it('puts the grades in order, best first, with a plus above and a minus below', () => {
    const order = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB', 'B', 'C', 'D'];
    const ranks = order.map((r) => ratingRank(r));
    expect(ranks.every((r) => r !== null)).toBe(true);
    expect([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(ranks);
    expect(new Set(ranks).size).toBe(order.length);
  });

  it('does not guess at what it cannot read', () => {
    expect(ratingRank('A1+')).toBeNull(); // a short-term rating, on its own scale
    expect(ratingRank('unrated')).toBeNull();
    expect(ratingRank('')).toBeNull();
    expect(ratingRank(null)).toBeNull();
  });
});

describe('ratingMove', () => {
  it('calls a lower grade a downgrade, and a higher one an upgrade', () => {
    expect(ratingMove('CRISIL AA', 'CRISIL A')).toBe('downgrade');
    expect(ratingMove('CRISIL A', 'CRISIL AA')).toBe('upgrade');
    expect(ratingMove('AA', 'AA-')).toBe('downgrade');
    expect(ratingMove('BBB-', 'BBB')).toBe('upgrade');
  });

  it('is not a move when only the agency or the outlook changed', () => {
    expect(ratingMove('CRISIL AA', 'CARE AA')).toBe('same-grade');
    expect(ratingMove('CRISIL AA (Stable)', 'CRISIL AA (Negative)')).toBe('same-grade');
  });

  it('says so when a rating first appears or goes', () => {
    expect(ratingMove(null, 'CRISIL A')).toBe('first');
    expect(ratingMove('CRISIL A', null)).toBe('withdrawn');
  });

  it('says it cannot tell when either side is not a grade it knows', () => {
    expect(ratingMove('A1+', 'A2')).toBe('unknown');
    expect(ratingMove('CRISIL A', 'unrated')).toBe('unknown');
  });
});

describe('recentDowngrade', () => {
  const change = (seq: number, from: string | null, to: string | null, changedOn: string): RatingChangeInput => ({
    seq,
    from,
    to,
    changedOn,
  });

  it('finds a downgrade inside the window', () => {
    const found = recentDowngrade(
      [change(1, null, 'CRISIL AA', '2026-01-10'), change(2, 'CRISIL AA', 'CRISIL A', '2026-08-01')],
      '2026-10-09',
      180,
    );
    expect(found).toEqual({ from: 'CRISIL AA', to: 'CRISIL A', changedOn: '2026-08-01' });
  });

  it('lets it go once the window has passed, and not before', () => {
    const changes = [change(1, 'CRISIL AA', 'CRISIL A', '2026-04-12')];
    // 180 days after 12 Apr is 9 Oct.
    expect(recentDowngrade(changes, '2026-10-09', 180)).not.toBeNull();
    expect(recentDowngrade(changes, '2026-10-10', 180)).toBeNull();
  });

  it('is cleared by a later upgrade back, since the latest word is the one that stands', () => {
    const found = recentDowngrade(
      [change(1, 'CRISIL AA', 'CRISIL A', '2026-08-01'), change(2, 'CRISIL A', 'CRISIL AA', '2026-09-01')],
      '2026-10-09',
      180,
    );
    expect(found).toBeNull();
  });

  it('takes the latest by sequence, not by the order it was handed', () => {
    const found = recentDowngrade(
      [change(2, 'CRISIL A', 'CRISIL BBB', '2026-09-01'), change(1, 'CRISIL AA', 'CRISIL A', '2026-08-01')],
      '2026-10-09',
      180,
    );
    expect(found).toEqual({ from: 'CRISIL A', to: 'CRISIL BBB', changedOn: '2026-09-01' });
  });

  it('is empty when there is nothing, and does not read the clock', () => {
    expect(recentDowngrade([], '2026-10-09', 180)).toBeNull();
  });
});
