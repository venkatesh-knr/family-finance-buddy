import { describe, expect, it } from 'vitest';
import { investedInMonth } from '../../domain/invested.ts';
import { money } from '../../lib/money.ts';
import type { HoldingListing } from '../../repo/types.ts';
import { investedInput } from './investedInput.ts';

/**
 * The invested figure's input, from the holdings listing (docs/design/spending-capture.md section 10; SC-I11): a lot dated in the month is put in at its cost, in the
 * class Holdings groups by, and a member's own scope leaves out the household's other holdings. The listing is the minimum the builder reads.
 */
const listing = {
  holdings: [
    { id: 'h1', member: { id: 'm1' }, instrument: { kind: 'mutual_fund', scheme: null, currency: 'INR' }, openedOn: '2020-01-01', cost: null },
    { id: 'h2', member: { id: 'm2' }, instrument: { kind: 'etf', scheme: null, currency: 'INR' }, openedOn: '2020-01-01', cost: null },
  ],
  lots: [
    { holdingId: 'h1', acquiredOn: '2026-10-05', cost: money(50_000_00n, 'INR'), kind: 'purchase' },
    { holdingId: 'h2', acquiredOn: '2026-10-07', cost: money(5_000_00n, 'INR'), kind: 'purchase' },
    { holdingId: 'h1', acquiredOn: '2026-09-05', cost: money(9_999_00n, 'INR'), kind: 'purchase' },
  ],
  disposals: [],
} as unknown as HoldingListing;

const base = { listing, terms: [], renewals: [], ppf: [], month: '2026-10', mine: 'm1', today: '2026-11-18' } as const;

describe('SC-I11 — the invested input', () => {
  it('counts every holding of the household, by the date on each lot', () => {
    const out = investedInMonth(investedInput({ ...base, scope: 'household' }));
    expect(out.currencies[0]?.putIn).toBe(55_000_00n);
    expect(out.currencies[0]?.net).toBe(55_000_00n);
  });

  it('counts only the member’s own holdings in their own scope', () => {
    const out = investedInMonth(investedInput({ ...base, scope: 'mine' }));
    expect(out.currencies[0]?.putIn).toBe(50_000_00n);
  });

  it('is nothing for a month with no entries, and never market movement', () => {
    expect(investedInMonth(investedInput({ ...base, month: '2026-08', scope: 'household' })).currencies).toEqual([]);
  });
});
