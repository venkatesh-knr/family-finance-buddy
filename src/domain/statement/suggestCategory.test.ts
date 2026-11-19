import { describe, expect, it } from 'vitest';
import { normalisePayee, suggestCategories, suggestionWords, type HistoryEntry } from './suggestCategory.ts';

/**
 * A category for an imported line, suggested from what the household has filed before and never from a list that ships with the app (docs/build-plan.md step 7: "Guess the category, and
 * be obviously guessing ... Learned from the household's own history"). A wrong category that arrived silently is worse than a blank, so no basis is no suggestion, and every one says
 * what it rests on. The data is invented.
 */
const entry = (payee: string | null, categoryId: string | null, date = '2026-09-01', amountMinor = 10_000n): HistoryEntry => ({ payee, categoryId, date, amountMinor });
const ACTIVE = new Set(['groceries', 'eating-out', 'fuel']);
const one = (payee: string | null, history: HistoryEntry[], amountMinor = 10_000n, active = ACTIVE) => suggestCategories({ lines: [{ payee, amountMinor }], history, active })[0] ?? null;

describe('how a payee is compared', () => {
  it('ignores case, spaces, punctuation and a trailing number, so a statement’s spelling matches a typed one', () => {
    expect(normalisePayee('Sample  Shop.')).toBe('SAMPLESHOP');
    expect(normalisePayee('SAMPLE SHOP 4421')).toBe('SAMPLESHOP');
    expect(normalisePayee('  ')).toBe('');
  });
});

describe('a suggestion from the household’s own history', () => {
  it('is the category the payee has been filed under, with how many times', () => {
    expect(one('SAMPLE SHOP', [entry('Sample Shop', 'groceries'), entry('SAMPLE SHOP', 'groceries', '2026-09-05')], 99_900n)).toEqual({ categoryId: 'groceries', basis: 'payee', count: 2 });
  });

  it('takes the category used most, and the latest when two are used the same number of times', () => {
    expect(one('SAMPLE SHOP', [entry('SAMPLE SHOP', 'groceries'), entry('SAMPLE SHOP', 'groceries'), entry('SAMPLE SHOP', 'eating-out')])?.categoryId).toBe('groceries');
    expect(one('SAMPLE SHOP', [entry('SAMPLE SHOP', 'groceries', '2026-08-01'), entry('SAMPLE SHOP', 'eating-out', '2026-09-01')])?.categoryId).toBe('eating-out');
  });

  it('says it is a repeat when the same amount has been filed under that category before', () => {
    expect(one('SAMPLE SHOP', [entry('SAMPLE SHOP', 'groceries', '2026-09-01', 12_345n)], 12_345n)).toMatchObject({ basis: 'repeat' });
    expect(one('SAMPLE SHOP', [entry('SAMPLE SHOP', 'groceries', '2026-09-01', 12_345n)], 99_900n)).toMatchObject({ basis: 'payee' });
  });

  it('matches a name a statement cut short against the whole one, from six letters', () => {
    expect(one('HOTEL ARIY', [entry('Hotel Ariyas Veg', 'eating-out')])?.categoryId).toBe('eating-out');
    expect(one('HOTEL ARIYAS VEG', [entry('Hotel Ariy', 'eating-out')])?.categoryId).toBe('eating-out');
    expect(one('SHOP', [entry('Shop Two', 'groceries')])).toBeNull();
  });
});

describe('no suggestion is better than a wrong one', () => {
  it('has none for a payee never filed, a line with no payee, or entries with no category', () => {
    expect(one('NEW PLACE', [entry('SAMPLE SHOP', 'groceries')])).toBeNull();
    expect(one(null, [entry('SAMPLE SHOP', 'groceries')])).toBeNull();
    expect(one('SAMPLE SHOP', [entry('SAMPLE SHOP', null), entry(null, 'groceries')])).toBeNull();
  });

  it('never suggests a category that is archived or not the household’s', () => {
    expect(one('SAMPLE SHOP', [entry('SAMPLE SHOP', 'old-category')])).toBeNull();
    expect(one('SAMPLE SHOP', [entry('SAMPLE SHOP', 'old-category'), entry('SAMPLE SHOP', 'groceries')])?.categoryId).toBe('groceries');
  });

  it('suggests for each line on its own', () => {
    const out = suggestCategories({
      lines: [{ payee: 'SAMPLE SHOP', amountMinor: 1n }, { payee: 'NEW PLACE', amountMinor: 1n }, { payee: 'PETROL BUNK', amountMinor: 1n }],
      history: [entry('Sample Shop', 'groceries'), entry('Petrol Bunk', 'fuel')],
      active: ACTIVE,
    });
    expect(out.map((s) => s?.categoryId ?? null)).toEqual(['groceries', null, 'fuel']);
  });
});

describe('saying what a suggestion rests on', () => {
  it('names the category and the count, or that it is a repeat', () => {
    expect(suggestionWords({ categoryId: 'g', basis: 'payee', count: 3 }, 'Groceries')).toBe('Suggested: you have filed this payee under Groceries 3 times.');
    expect(suggestionWords({ categoryId: 'g', basis: 'payee', count: 1 }, 'Groceries')).toBe('Suggested: you have filed this payee under Groceries once.');
    expect(suggestionWords({ categoryId: 'g', basis: 'repeat', count: 4 }, 'Groceries')).toBe('Suggested: the same amount to this payee was filed under Groceries before.');
  });
});
