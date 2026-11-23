import { describe, expect, it } from 'vitest';
import { countBySource, coverAmounts, coverCaveat, coverSources, statementsForCover, monthSpend, restToTotal, savedFor, totalToRest } from './spend-source.ts';

/**
 * A month's spent and where it came from (docs/design/spending-capture.md section 11; SC-I15 to SC-I18). Amounts are paise: ₹82,000 is 8_200_000n.
 */
const rupees = (n: number): bigint => BigInt(n) * 100n;

describe('SC-I15 — the first available of balances, the stated spend and the itemised sum, named, and never blended', () => {
  it('takes the balances’ figure when there is a close, whatever else there is', () => {
    const out = monthSpend({ closed: rupees(91_000), stated: rupees(82_000), itemised: rupees(52_000) });
    expect(out.source).toBe('balances');
    expect(out.spent).toBe(rupees(91_000));
  });

  it('takes the stated figure when there is no close', () => {
    const out = monthSpend({ closed: null, stated: rupees(82_000), itemised: rupees(52_000) });
    expect(out.source).toBe('stated');
    expect(out.spent).toBe(rupees(82_000));
  });

  it('takes the itemised sum when there is neither', () => {
    const out = monthSpend({ closed: null, stated: null, itemised: rupees(52_000) });
    expect(out.source).toBe('itemised');
    expect(out.spent).toBe(rupees(52_000));
  });

  it('is never the sum or the mean of two of them', () => {
    const sources = [
      monthSpend({ closed: rupees(91_000), stated: rupees(82_000), itemised: rupees(52_000) }),
      monthSpend({ closed: null, stated: rupees(82_000), itemised: rupees(52_000) }),
      monthSpend({ closed: null, stated: null, itemised: rupees(52_000) }),
    ];
    const candidates = new Set([91_000, 82_000, 52_000].map(rupees));
    for (const out of sources) expect(candidates.has(out.spent)).toBe(true);
  });

  it('takes a stated spend of nothing as a figure, and not as an absence', () => {
    expect(monthSpend({ closed: null, stated: 0n, itemised: rupees(52_000) })).toMatchObject({ source: 'stated', spent: 0n });
    expect(monthSpend({ closed: 0n, stated: rupees(10), itemised: 0n })).toMatchObject({ source: 'balances', spent: 0n });
  });
});

describe('SC-I16 — with a stated spend and no close, not yet itemised is stated minus itemised', () => {
  it('is ₹30,000 when ₹82,000 is stated and ₹52,000 itemised', () => {
    const out = monthSpend({ closed: null, stated: rupees(82_000), itemised: rupees(52_000) });
    expect(out.notYetItemised).toBe(rupees(30_000));
    expect(out.itemisedOverBy).toBeNull();
  });

  it('keeps both figures and names the gap when more is itemised than stated, clamping neither', () => {
    const out = monthSpend({ closed: null, stated: rupees(50_000), itemised: rupees(55_000) });
    expect(out.spent).toBe(rupees(50_000));
    expect(out.notYetItemised).toBeNull();
    expect(out.itemisedOverBy).toBe(rupees(5_000));
    expect(out.itemised).toBe(rupees(55_000));
  });

  it('has nothing left to itemise, and no gap, when the two are equal', () => {
    const out = monthSpend({ closed: null, stated: rupees(50_000), itemised: rupees(50_000) });
    expect(out.notYetItemised).toBe(0n);
    expect(out.itemisedOverBy).toBeNull();
  });

  it('has no not-yet-itemised line for a month that is not stated', () => {
    expect(monthSpend({ closed: null, stated: null, itemised: rupees(1) }).notYetItemised).toBeNull();
  });

  it('saves itemised so far plus the rest as the total, and the rest is the total less itemised', () => {
    expect(restToTotal(rupees(52_000), rupees(30_000))).toBe(rupees(82_000));
    expect(totalToRest(rupees(82_000), rupees(52_000))).toBe(rupees(30_000));
  });

  it('has no rest to give when the total is below what is itemised', () => {
    expect(totalToRest(rupees(50_000), rupees(55_000))).toBeNull();
    expect(totalToRest(rupees(55_000), rupees(55_000))).toBe(0n);
  });
});

describe('SC-I17 — balances beat a stated spend, which sits beside them as a cross-check that never changes the figure', () => {
  it('shows ₹91,000 from balances, with ₹82,000 stated and the ₹9,000 difference', () => {
    const out = monthSpend({ closed: rupees(91_000), stated: rupees(82_000), itemised: rupees(52_000) });
    expect(out.spent).toBe(rupees(91_000));
    expect(out.crossCheck).toEqual({ stated: rupees(82_000), fromBalances: rupees(91_000), difference: rupees(9_000) });
  });

  it('gives a negative difference when the balances say less than was stated', () => {
    expect(monthSpend({ closed: rupees(70_000), stated: rupees(82_000), itemised: 0n }).crossCheck?.difference).toBe(-rupees(12_000));
  });

  it('has no cross-check without a stated spend, and none from a stated month', () => {
    expect(monthSpend({ closed: rupees(91_000), stated: null, itemised: 0n }).crossCheck).toBeNull();
    expect(monthSpend({ closed: null, stated: rupees(82_000), itemised: 0n }).crossCheck).toBeNull();
  });

  it('has no not-yet-itemised line for a month closed from balances: that is the close’s own gap', () => {
    expect(monthSpend({ closed: rupees(91_000), stated: rupees(82_000), itemised: rupees(52_000) }).notYetItemised).toBeNull();
  });
});

describe('SC-I18 — saved from a stated month is rough and claims no split', () => {
  it('is came in less spent, labelled rough, with no split into invested, loans and the cash reserve', () => {
    const saved = savedFor(rupees(120_000), monthSpend({ closed: null, stated: rupees(82_000), itemised: rupees(52_000) }));
    expect(saved).toEqual({ saved: rupees(38_000), label: 'rough', splitProven: false });
  });

  it('is from balances, and its split can be proved, for a closed month', () => {
    const saved = savedFor(rupees(120_000), monthSpend({ closed: rupees(91_000), stated: rupees(82_000), itemised: 0n }));
    expect(saved).toEqual({ saved: rupees(29_000), label: 'from balances', splitProven: true });
  });

  it('is from what was entered, with no split, for an itemised month', () => {
    const saved = savedFor(rupees(120_000), monthSpend({ closed: null, stated: null, itemised: rupees(52_000) }));
    expect(saved).toEqual({ saved: rupees(68_000), label: 'from what you entered', splitProven: false });
  });

  it('can be negative: spending more than came in is saved below nothing, not zero', () => {
    expect(savedFor(rupees(10_000), monthSpend({ closed: null, stated: rupees(12_000), itemised: 0n })).saved).toBe(-rupees(2_000));
  });
});

describe('the months of cover caveat counts a year’s months by source', () => {
  it('says 4 from balances, 3 stated and 5 itemised only', () => {
    const sources = [...Array(4).fill('balances'), ...Array(3).fill('stated'), ...Array(5).fill('itemised')] as ('balances' | 'stated' | 'itemised')[];
    expect(countBySource(sources)).toEqual({ balances: 4, stated: 3, itemised: 5 });
  });

  it('counts none as none', () => {
    expect(countBySource([])).toEqual({ balances: 0, stated: 0, itemised: 0 });
  });
});

describe('SC-I15, SC-I17 — a statement never stands in for a month closed from balances', () => {
  const statement = (month: string) => ({ month });
  it('leaves out the statements of closed months, which then count as itemised', () => {
    const kept = statementsForCover([statement('2026-08'), statement('2026-09')], new Set(['2026-09']));
    expect(kept.map((entry) => entry.month)).toEqual(['2026-08']);
    expect(coverSources(['2026-08', '2026-09'], new Set(kept.map((entry) => entry.month)))).toEqual(['stated', 'itemised']);
  });

  it('keeps every statement when no month is closed', () => {
    expect(statementsForCover([statement('2026-08')], new Set())).toHaveLength(1);
  });
});

describe('SC-I9 — months of cover says how many of its months were stated and how many itemised', () => {
  it('takes a month as stated when it has a statement, and as itemised otherwise', () => {
    expect(coverSources(['2026-08', '2026-09', '2026-10'], new Set(['2026-09']))).toEqual(['itemised', 'stated', 'itemised']);
  });

  it('ignores a statement for a month outside the window', () => {
    expect(coverSources(['2026-09'], new Set(['2025-01']))).toEqual(['itemised']);
  });

  it('says the months by source, and why the itemised ones matter, when any are itemised', () => {
    expect(coverCaveat({ balances: 0, stated: 3, itemised: 9 })).toEqual({
      counts: 'Of the 12 months: 3 stated, 9 itemised.',
      reading: 'Itemised months read low, which makes the cover read high.',
    });
  });

  it('leaves out a source with no months, and has no reading when nothing is itemised', () => {
    expect(coverCaveat({ balances: 0, stated: 12, itemised: 0 })).toEqual({ counts: 'Of the 12 months: 12 stated.', reading: null });
    expect(coverCaveat({ balances: 0, stated: 0, itemised: 1 })).toEqual({ counts: 'Of the 1 month: 1 itemised.', reading: 'Itemised months read low, which makes the cover read high.' });
  });

  it('names the balances too when any month is from them', () => {
    expect(coverCaveat({ balances: 4, stated: 3, itemised: 5 })?.counts).toBe('Of the 12 months: 4 from balances, 3 stated, 5 itemised.');
  });

  it('has no caveat for no months', () => {
    expect(coverCaveat({ balances: 0, stated: 0, itemised: 0 })).toBeNull();
  });
});

/**
 * Months of cover reads each month's best source (the owner, 23 November 2026; spending-capture.md 11.4; card-cycles.md 8.4): the balances at a close, then a stated spend, then the itemised
 * sum, in each currency on its own, and the caveat counts the months by source.
 */
describe('months of cover names each month’s best source', () => {
  it('names a month closed from balances as such, even when it has a stated spend: balances beat a statement (SC-I17)', () => {
    expect(coverSources(['2026-08', '2026-09', '2026-10'], new Set(['2026-09', '2026-10']), new Set(['2026-10']))).toEqual(['itemised', 'stated', 'balances']);
  });

  it('is as it was with no month closed', () => {
    expect(coverSources(['2026-08', '2026-09'], new Set(['2026-09']))).toEqual(['itemised', 'stated']);
  });

  it('counts the months by source for the caveat: 4 from balances, 3 stated, 5 itemised', () => {
    const window = Array.from({ length: 12 }, (_unused, at) => `2026-${String(at + 1).padStart(2, '0')}`);
    const closed = new Set(window.slice(0, 4));
    const stated = new Set(window.slice(4, 7));
    expect(countBySource(coverSources(window, stated, closed))).toEqual({ balances: 4, stated: 3, itemised: 5 });
  });
});

describe('coverAmounts — what a month contributes, in each currency from its best source', () => {
  const inr = (minor: bigint) => ({ minor, currency: 'INR' });
  const usd = (minor: bigint) => ({ minor, currency: 'USD' });

  it('SC-I15 — is the close’s spent for a month closed from balances, and never the itemised sum beside it', () => {
    expect(coverAmounts({ closed: [inr(6_967_000n)], stated: [], itemised: [inr(100n), inr(200n)] })).toEqual([inr(6_967_000n)]);
  });

  it('takes a stated spend for a month with no close, and the itemised sum where there is neither', () => {
    expect(coverAmounts({ closed: null, stated: [inr(5_000n)], itemised: [inr(100n), inr(200n)] })).toEqual([inr(5_000n)]);
    expect(coverAmounts({ closed: null, stated: [], itemised: [inr(100n), inr(200n)] })).toEqual([inr(100n), inr(200n)]);
  });

  it('is per currency: a currency the close does not cover is stated or itemised on its own, and is not lost', () => {
    const out = coverAmounts({ closed: [inr(6_967_000n)], stated: [usd(4_999n)], itemised: [inr(100n), usd(300n), { minor: 50n, currency: 'AED' }] });
    expect(out).toEqual([inr(6_967_000n), usd(4_999n), { minor: 50n, currency: 'AED' }]);
  });
});
