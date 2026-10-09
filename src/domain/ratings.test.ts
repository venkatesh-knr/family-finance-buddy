import { describe, expect, it } from 'vitest';
import { ratingMove, ratingMoves, ratingRank, ratingWatch, type RatingChangeInput } from './ratings.ts';

describe('ratingRank', () => {
  it('reads the grade out of what an agency prints, whoever the agency is', () => {
    expect(ratingRank('CRISIL A')).toBe(ratingRank('A'));
    expect(ratingRank('ICRA A+')).toBe(ratingRank('A+'));
    expect(ratingRank('CARE AA-')).toBe(ratingRank('AA-'));
    expect(ratingRank('IND AAA')).toBe(0);
  });

  it("reads ICRA's own notation, which wraps the agency in brackets", () => {
    expect(ratingRank('[ICRA]AA+')).toBe(ratingRank('AA+'));
    expect(ratingRank('[ICRA]A+(CE)')).toBe(ratingRank('A+'));
    expect(ratingRank('[ICRA]AA (Stable)')).toBe(ratingRank('AA'));
    expect(ratingRank('[ICRA] BBB-')).toBe(ratingRank('BBB-'));
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
    expect(ratingMove('[ICRA]AA+', '[ICRA]A')).toBe('downgrade');
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

const change = (seq: number, from: string | null, to: string | null, changedOn: string): RatingChangeInput => ({
  seq,
  from,
  to,
  changedOn,
});

describe('ratingMoves, judged against the last rating that was set', () => {
  it('judges a rating entered after one was cleared against the one before it, not as a first', () => {
    // Cleared, then a lower one entered: two saves, one downgrade.
    const moves = ratingMoves([
      change(1, null, 'CRISIL AA', '2026-01-10'),
      change(2, 'CRISIL AA', null, '2026-08-01'),
      change(3, null, 'CRISIL BB', '2026-08-02'),
    ]);
    expect(moves.map((m) => m.move)).toEqual(['first', 'withdrawn', 'downgrade']);
    expect(moves[2]?.from).toBe('CRISIL AA');
  });

  it('calls the very first rating the first, and only that one', () => {
    const moves = ratingMoves([change(1, null, 'CRISIL A', '2026-01-10')]);
    expect(moves.map((m) => m.move)).toEqual(['first']);
  });

  it('takes the changes in the order they were made, however they were handed over', () => {
    const moves = ratingMoves([
      change(2, 'CRISIL AA', 'CRISIL A', '2026-08-01'),
      change(1, null, 'CRISIL AA', '2026-01-10'),
    ]);
    expect(moves.map((m) => m.seq)).toEqual([1, 2]);
  });
});

describe('ratingWatch', () => {
  it('finds a downgrade inside the window', () => {
    const found = ratingWatch(
      [change(1, null, 'CRISIL AA', '2026-01-10'), change(2, 'CRISIL AA', 'CRISIL A', '2026-08-01')],
      '2026-10-09',
      180,
    );
    expect(found).toEqual({ kind: 'downgrade', from: 'CRISIL AA', to: 'CRISIL A', changedOn: '2026-08-01' });
  });

  it('finds a downgrade made as two saves, a rating cleared and a lower one entered', () => {
    const found = ratingWatch(
      [
        change(1, null, 'CRISIL AA', '2026-01-10'),
        change(2, 'CRISIL AA', null, '2026-09-01'),
        change(3, null, 'CRISIL BB', '2026-09-02'),
      ],
      '2026-10-09',
      180,
    );
    expect(found).toEqual({ kind: 'downgrade', from: 'CRISIL AA', to: 'CRISIL BB', changedOn: '2026-09-02' });
  });

  it('finds a downgrade written in ICRA notation', () => {
    const found = ratingWatch(
      [change(1, null, '[ICRA]AA+', '2026-01-10'), change(2, '[ICRA]AA+', '[ICRA]BBB', '2026-10-01')],
      '2026-10-09',
      180,
    );
    expect(found?.kind).toBe('downgrade');
  });

  it('lets it go once the window has passed, and not before', () => {
    const changes = [change(1, 'CRISIL AA', 'CRISIL A', '2026-04-12')];
    // 180 days after 12 Apr is 9 Oct.
    expect(ratingWatch(changes, '2026-10-09', 180)).not.toBeNull();
    expect(ratingWatch(changes, '2026-10-10', 180)).toBeNull();
  });

  it('is cleared by a later upgrade back, since the latest word is the one that stands', () => {
    const found = ratingWatch(
      [change(1, 'CRISIL AA', 'CRISIL A', '2026-08-01'), change(2, 'CRISIL A', 'CRISIL AA', '2026-09-01')],
      '2026-10-09',
      180,
    );
    expect(found).toBeNull();
  });

  it('is not moved by a change of agency or outlook at the same grade', () => {
    const found = ratingWatch(
      [change(1, 'CRISIL AA', 'CRISIL A', '2026-08-01'), change(2, 'CRISIL A', 'CARE A', '2026-09-01')],
      '2026-10-09',
      180,
    );
    expect(found?.kind).toBe('downgrade');
  });

  it('says so when a change cannot be ranked, instead of staying silent', () => {
    // A short-term rating falling from A1+ to A4 is severe, and is on a scale not read.
    const found = ratingWatch([change(1, 'CRISIL A1+', 'CRISIL A4', '2026-09-01')], '2026-10-09', 180);
    expect(found).toEqual({ kind: 'unclear', from: 'CRISIL A1+', to: 'CRISIL A4', changedOn: '2026-09-01' });
  });

  it('says so when a rating was removed and has not come back', () => {
    const found = ratingWatch(
      [change(1, null, 'CRISIL AA', '2026-01-10'), change(2, 'CRISIL AA', null, '2026-09-01')],
      '2026-10-09',
      180,
    );
    expect(found).toEqual({ kind: 'withdrawn', from: 'CRISIL AA', to: null, changedOn: '2026-09-01' });
  });

  it('is empty when nothing has been recorded or the only change is the first rating', () => {
    expect(ratingWatch([], '2026-10-09', 180)).toBeNull();
    expect(ratingWatch([change(1, null, 'CRISIL A', '2026-10-01')], '2026-10-09', 180)).toBeNull();
  });
});
