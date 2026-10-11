import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import { groupHoldings, type ListHolding } from './holdingGroups.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

const holding = (over: Partial<ListHolding> & { id: string }): ListHolding => ({
  kind: 'mutual_fund',
  currency: 'INR',
  earmark: 'none',
  latest: null,
  unitsHeld: 1n,
  paidOutOn: null,
  ...over,
});

const sample: ListHolding[] = [
  holding({ id: 'f1', kind: 'mutual_fund', latest: inr(628300) }),
  holding({ id: 'f2', kind: 'mutual_fund', latest: inr(422766) }),
  holding({ id: 'f3', kind: 'mutual_fund', latest: inr(145157) }),
  holding({ id: 'd1', kind: 'deposit', latest: inr(203365), earmark: 'none' }),
  holding({ id: 'd2', kind: 'deposit', latest: inr(104291), earmark: 'emergency' }),
  holding({ id: 'b1', kind: 'bond', latest: inr(201668) }),
  holding({ id: 'e1', kind: 'etf', currency: 'USD', latest: usd(41800) }),
  holding({ id: 'g1', kind: 'other', latest: inr(0), unitsHeld: 0n }),
];

describe("HD-I2 — group subtotals add up to the summary total, per currency, and a foreign holding is never summed into the rupee figure", () => {
  const result = groupHoldings({ holdings: sample, base: 'INR', filter: {} });

  it('has a subtotal per group that is the sum of its rows\' latest readings', () => {
    const funds = result.groups.find((g) => g.kind === 'mutual_fund');
    expect(funds?.subtotals.find((s) => s.currency === 'INR')?.minor).toBe((628300n + 422766n + 145157n) * 100n);
  });

  it('adds the group subtotals up to the currency total, for each currency', () => {
    for (const total of result.totals) {
      const sum = result.groups
        .flatMap((g) => g.subtotals)
        .filter((s) => s.currency === total.currency)
        .reduce((acc, s) => acc + s.minor, 0n);
      expect(sum, total.currency).toBe(total.value.minor);
    }
  });

  it('keeps the dollar holding out of the rupee total', () => {
    const inrTotal = result.totals.find((t) => t.currency === 'INR');
    const withoutDollar = groupHoldings({ holdings: sample.filter((h) => h.currency === 'INR'), base: 'INR', filter: {} });
    expect(inrTotal?.value.minor).toBe(withoutDollar.totals.find((t) => t.currency === 'INR')?.value.minor);
    expect(result.totals.map((t) => t.currency).sort()).toEqual(['INR', 'USD']);
  });

  it('gives a filtered group its share of the whole portfolio, not of itself', () => {
    const filtered = groupHoldings({ holdings: sample, base: 'INR', filter: { kind: 'deposit' } });
    const share = filtered.groups[0]?.shares.find((s) => s.currency === 'INR')?.share ?? 0;
    expect(share).toBeCloseTo(0.18, 1);
    expect(share).toBeLessThan(0.5);
    // What it is a share of is the unfiltered portfolio, and the summary can say so.
    expect(filtered.portfolio.find((t) => t.currency === 'INR')?.value.minor).toBe(
      result.totals.find((t) => t.currency === 'INR')?.value.minor,
    );
  });

  it('gives each group its share of its own currency\'s total', () => {
    const funds = result.groups.find((g) => g.kind === 'mutual_fund');
    const share = funds?.shares.find((s) => s.currency === 'INR')?.share ?? 0;
    expect(share).toBeCloseTo(0.7, 1);
    const etf = result.groups.find((g) => g.kind === 'etf');
    expect(etf?.shares.find((s) => s.currency === 'USD')?.share).toBe(1);
  });
});

describe('the order of groups', () => {
  it('is by subtotal in the household currency, with abroad-only groups after', () => {
    const result = groupHoldings({ holdings: sample, base: 'INR', filter: {} });
    expect(result.groups.map((g) => g.kind)).toEqual(['mutual_fund', 'deposit', 'bond', 'etf']);
  });
});

describe('Ended — no units left, or matured and paid out', () => {
  it('puts a holding with no units in a final group of its own, out of the subtotals', () => {
    const result = groupHoldings({ holdings: sample, base: 'INR', filter: {} });
    expect(result.ended.map((h) => h.id)).toEqual(['g1']);
    expect(result.groups.flatMap((g) => g.holdings).map((h) => h.id)).not.toContain('g1');
  });

  it('puts a deposit that has paid out there too, whatever it was last read at', () => {
    const result = groupHoldings({
      holdings: [holding({ id: 'd', kind: 'deposit', latest: inr(100), paidOutOn: '2026-05-01' })],
      base: 'INR',
      filter: {},
    });
    expect(result.ended.map((h) => h.id)).toEqual(['d']);
    expect(result.totals).toEqual([]);
  });

  it('is the only home of an ended holding, so it is not counted twice', () => {
    const result = groupHoldings({ holdings: sample, base: 'INR', filter: {} });
    const all = [...result.groups.flatMap((g) => g.holdings), ...result.ended].map((h) => h.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(sample.length);
  });
});

describe('a holding never read is counted, not zero', () => {
  it('counts it in its group and leaves it out of the subtotal', () => {
    const result = groupHoldings({
      holdings: [holding({ id: 'a', latest: inr(100) }), holding({ id: 'b', latest: null })],
      base: 'INR',
      filter: {},
    });
    const group = result.groups[0];
    expect(group?.holdings).toHaveLength(2);
    expect(group?.unvalued).toBe(1);
    expect(group?.subtotals[0]?.minor).toBe(10000n);
  });
});

describe('HD-I4 — chips: All, one per class in use, then the earmarks in use', () => {
  const result = groupHoldings({ holdings: sample, base: 'INR', filter: {} });

  it('counts the classes, in the order of the groups, and the earmarks in use', () => {
    expect(result.chips.kinds).toEqual([
      { kind: 'mutual_fund', count: 3 },
      { kind: 'deposit', count: 2 },
      { kind: 'bond', count: 1 },
      { kind: 'etf', count: 1 },
    ]);
    expect(result.chips.earmarks).toEqual([{ earmark: 'emergency', count: 1 }]);
  });

  it('filters to a class, leaving the summary to describe the filter', () => {
    const filtered = groupHoldings({ holdings: sample, base: 'INR', filter: { kind: 'deposit' } });
    expect(filtered.groups.map((g) => g.kind)).toEqual(['deposit']);
    expect(filtered.ended).toEqual([]);
    expect(filtered.totals.map((t) => [t.currency, t.value.minor])).toEqual([['INR', (203365n + 104291n) * 100n]]);
    // The chips still show every class, so a filter can be changed without going back.
    expect(filtered.chips.kinds).toHaveLength(4);
  });

  it('filters to an earmark, across classes', () => {
    const filtered = groupHoldings({ holdings: sample, base: 'INR', filter: { earmark: 'emergency' } });
    expect(filtered.groups.flatMap((g) => g.holdings).map((h) => h.id)).toEqual(['d2']);
  });

  it('filters to a currency as well, for a link from the Overview\'s per-currency allocation', () => {
    const filtered = groupHoldings({ holdings: sample, base: 'INR', filter: { kind: 'etf', currency: 'USD' } });
    expect(filtered.groups.flatMap((g) => g.holdings).map((h) => h.id)).toEqual(['e1']);
    const none = groupHoldings({ holdings: sample, base: 'INR', filter: { kind: 'etf', currency: 'INR' } });
    expect(none.groups).toEqual([]);
  });

  it('shows the Ended group under a filter only for the ended holdings that match it', () => {
    const filtered = groupHoldings({ holdings: sample, base: 'INR', filter: { kind: 'other' } });
    expect(filtered.ended.map((h) => h.id)).toEqual(['g1']);
  });
});
