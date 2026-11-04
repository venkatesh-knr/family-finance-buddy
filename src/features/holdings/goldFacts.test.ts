import { describe, expect, it } from 'vitest';
import type { GoldInstalment, GoldSchemeTerms } from '../../repo/types.ts';
import { goldRowLine } from './goldFacts.ts';

const money = (minor: bigint) => ({ minor, currency: 'INR' });

const TERMS: GoldSchemeTerms = {
  holdingId: 'h1',
  variant: 'amount',
  jeweller: 'Demo Jewellers',
  instalment: money(500000n),
  instalments: 11,
  startDate: '2026-06-10',
  dueDay: 10,
  bonusText: 'one instalment',
  bonus: money(500000n),
  purity: null,
  schemeLast4: '2093',
  note: null,
};

const paid = (...dates: string[]): GoldInstalment[] =>
  dates.map((date, index) => ({ id: `i${String(index)}`, holdingId: 'h1', date, amount: money(500000n), grams: null, note: null }));

describe('a gold scheme’s row', () => {
  it('says who it is with and how far through it is', () => {
    expect(goldRowLine(TERMS, paid('2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10'), '2026-10-30')).toBe('Demo Jewellers · 5 of 11 paid');
  });

  it('says how many it has missed, since the person can put that right', () => {
    expect(goldRowLine(TERMS, paid('2026-06-10', '2026-07-10'), '2026-10-30')).toBe('Demo Jewellers · 2 of 11 paid · 3 missed');
  });

  it('counts only its own instalments, and says gold where it has no terms', () => {
    const other = paid('2026-06-10').map((instalment) => ({ ...instalment, holdingId: 'h2' }));
    expect(goldRowLine(TERMS, other, '2026-06-05')).toBe('Demo Jewellers · 0 of 11 paid');
    expect(goldRowLine(undefined, [], '2026-06-05')).toBe('Gold');
  });
});
