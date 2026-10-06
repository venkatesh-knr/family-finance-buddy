import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { recentMonths, summariseAssets, summariseSpending } from './summary.ts';

const inr = (rupees: number) => money(BigInt(rupees) * 100n, 'INR');
const usd = (dollars: number) => money(BigInt(dollars) * 100n, 'USD');

describe('summariseSpending', () => {
  it('totals each currency on its own, and sorts the categories largest first', () => {
    const groups = summariseSpending([
      { categoryId: 'a', categoryName: 'Groceries', total: inr(6000) },
      { categoryId: 'b', categoryName: 'Utilities', total: inr(1000) },
      { categoryId: 'c', categoryName: 'School', total: inr(8000) },
      { categoryId: 'a', categoryName: 'Groceries', total: usd(40) },
    ]);
    expect(groups.map((g) => g.currency)).toEqual(['INR', 'USD']);
    expect(groups[0]?.total).toEqual(inr(15000));
    expect(groups[0]?.rows.map((r) => r.name)).toEqual(['School', 'Groceries', 'Utilities']);
    expect(groups[1]?.total).toEqual(usd(40));
  });

  it('shares are of that currency alone, and sum to one', () => {
    const [group] = summariseSpending([
      { categoryId: 'a', categoryName: 'A', total: inr(3000) },
      { categoryId: 'b', categoryName: 'B', total: inr(1000) },
    ]);
    expect(group?.rows.map((r) => r.share)).toEqual([0.75, 0.25]);
  });

  it('names an uncategorised entry as such, and keeps it as a row of its own', () => {
    const [group] = summariseSpending([
      { categoryId: null, categoryName: null, total: inr(500) },
      { categoryId: 'a', categoryName: 'A', total: inr(1500) },
    ]);
    expect(group?.rows.map((r) => r.name)).toEqual(['A', 'Uncategorised']);
    expect(group?.rows[1]?.categoryId).toBeNull();
  });

  it('merges two rows for the same category and currency, rather than listing it twice', () => {
    const [group] = summariseSpending([
      { categoryId: 'a', categoryName: 'A', total: inr(100) },
      { categoryId: 'a', categoryName: 'A', total: inr(250) },
    ]);
    expect(group?.rows).toHaveLength(1);
    expect(group?.rows[0]?.total).toEqual(inr(350));
  });

  it('is empty for no spending, and does not invent a zero row', () => {
    expect(summariseSpending([])).toEqual([]);
  });
});

describe('summariseAssets', () => {
  it('groups the kinds by currency, largest first, with the unvalued counted', () => {
    const groups = summariseAssets([
      { kind: 'bond', currency: 'INR', total: inr(1000), valued: 1, unvalued: 0 },
      { kind: 'mutual_fund', currency: 'INR', total: inr(9000), valued: 2, unvalued: 1 },
      { kind: 'etf', currency: 'USD', total: usd(500), valued: 1, unvalued: 0 },
    ]);
    expect(groups.map((g) => g.currency)).toEqual(['INR', 'USD']);
    expect(groups[0]?.rows.map((r) => r.kind)).toEqual(['mutual_fund', 'bond']);
    expect(groups[0]?.total).toEqual(inr(10000));
    expect(groups[0]?.unvalued).toBe(1);
    expect(groups[1]?.unvalued).toBe(0);
  });

  it('leaves out a kind with nothing valued, which has no share of anything', () => {
    const [group] = summariseAssets([
      { kind: 'bond', currency: 'INR', total: inr(0), valued: 0, unvalued: 2 },
      { kind: 'etf', currency: 'INR', total: inr(400), valued: 1, unvalued: 0 },
    ]);
    expect(group?.rows.map((r) => r.kind)).toEqual(['etf']);
    // But the two it could not value are not hidden: they are said.
    expect(group?.unvalued).toBe(2);
  });

  it('leaves out a kind that was valued at nothing, as the allocation on Overview does', () => {
    // A holding read as worth zero (sold, matured) was read, so it is not unvalued
    // and it is not hidden as such; it simply has no share of anything.
    const [group] = summariseAssets([
      { kind: 'other', currency: 'INR', total: inr(0), valued: 1, unvalued: 0 },
      { kind: 'etf', currency: 'INR', total: inr(400), valued: 1, unvalued: 0 },
    ]);
    expect(group?.rows.map((r) => r.kind)).toEqual(['etf']);
    expect(group?.unvalued).toBe(0);
  });

  it('is empty for no holdings', () => {
    expect(summariseAssets([])).toEqual([]);
  });
});

describe('recentMonths', () => {
  it('lists the month of a date and the ones before it, newest first, as first-of-month dates', () => {
    expect(recentMonths('2026-10-06', 3)).toEqual(['2026-10-01', '2026-09-01', '2026-08-01']);
  });

  it('crosses a year boundary', () => {
    expect(recentMonths('2026-02-15', 4)).toEqual(['2026-02-01', '2026-01-01', '2025-12-01', '2025-11-01']);
  });

  it('is empty for a count of nothing', () => {
    expect(recentMonths('2026-10-06', 0)).toEqual([]);
  });
});
