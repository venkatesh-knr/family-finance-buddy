import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { CREDIT_CATEGORIES, CREDIT_LABEL, cameInByCurrency, defaultVisibility, isIncome, ledgerWord, type CreditLike } from './credit.ts';

/**
 * What a credit is and what a month's credits come to (docs/design/ledger-income.md sections 1 and 4).
 *
 * The figures are the design's own worked examples. Money is integer minor units, so ₹1,42,000 is 14,200,000.
 */

const rupees = (value: number, currency = 'INR') => money(BigInt(value) * 100n, currency);
const credit = (category: CreditLike['category'], amount: number, date: string, currency = 'INR'): CreditLike => ({
  category,
  amount: rupees(amount, currency),
  date,
});

describe('a credit has one of seven categories, and says so in words', () => {
  it('lists them in the order the screen offers them', () => {
    expect(CREDIT_CATEGORIES).toEqual(['salary', 'business', 'interest', 'rent', 'dividend', 'other_income', 'refund']);
  });

  it('names each as the screen does: Business income, and Refund or money back', () => {
    expect(CREDIT_LABEL.salary).toBe('Salary');
    expect(CREDIT_LABEL.business).toBe('Business income');
    expect(CREDIT_LABEL.other_income).toBe('Other income');
    expect(CREDIT_LABEL.refund).toBe('Refund or money back');
  });

  it('counts every category but the refund as income', () => {
    expect(CREDIT_CATEGORIES.filter(isIncome)).toEqual(['salary', 'business', 'interest', 'rent', 'dividend', 'other_income']);
    expect(isIncome('refund')).toBe(false);
  });
});

describe('cameInByCurrency', () => {
  it('LI-I1 — came in is the sum of everything but the refund: ₹1,42,000 + ₹1,250 is ₹1,43,250, and the ₹1,299 refund is apart', () => {
    const october = [credit('salary', 142_000, '2026-10-01'), credit('interest', 1_250, '2026-10-05'), credit('refund', 1_299, '2026-10-07')];
    expect(cameInByCurrency(october, '2026-10')).toEqual([{ currency: 'INR', cameIn: 14_325_000n, refunds: 129_900n }]);
  });

  it('LI-I1 — a ₹50,000 Business income credit raises it to ₹1,93,250', () => {
    const october = [
      credit('salary', 142_000, '2026-10-01'),
      credit('interest', 1_250, '2026-10-05'),
      credit('refund', 1_299, '2026-10-07'),
      credit('business', 50_000, '2026-10-20'),
    ];
    expect(cameInByCurrency(october, '2026-10')[0]?.cameIn).toBe(19_325_000n);
  });

  it('counts the month by its IST calendar days: the 31st is in, the 1st of the next month is not, nor the day before', () => {
    const credits = [credit('salary', 100, '2026-09-30'), credit('salary', 200, '2026-10-01'), credit('salary', 300, '2026-10-31'), credit('salary', 400, '2026-11-01')];
    expect(cameInByCurrency(credits, '2026-10')[0]?.cameIn).toBe(50_000n);
  });

  it('keeps each currency apart, rupees first, and never adds them', () => {
    const credits = [credit('dividend', 200, '2026-10-09', 'USD'), credit('salary', 142_000, '2026-10-01')];
    expect(cameInByCurrency(credits, '2026-10')).toEqual([
      { currency: 'INR', cameIn: 14_200_000n, refunds: 0n },
      { currency: 'USD', cameIn: 20_000n, refunds: 0n },
    ]);
  });

  it('says nothing for a month with no credit, so a screen can tell nothing from zero', () => {
    expect(cameInByCurrency([credit('salary', 1, '2026-09-01')], '2026-10')).toEqual([]);
  });

  it('LI-I3 — a refund is never in came in, in its own month or another', () => {
    const credits = [credit('refund', 1_299, '2026-11-02')];
    expect(cameInByCurrency(credits, '2026-11')).toEqual([{ currency: 'INR', cameIn: 0n, refunds: 129_900n }]);
    expect(cameInByCurrency(credits, '2026-10')).toEqual([]);
  });
});

describe('ledgerWord: direction is a sign, an icon and a word, never a colour alone', () => {
  it('says what each line does to the month, with a sign', () => {
    expect(ledgerWord('spending')).toEqual({ word: 'spent', sign: '−' });
    expect(ledgerWord('income')).toEqual({ word: 'came in', sign: '+' });
    expect(ledgerWord('refund')).toEqual({ word: 'takes away from spent', sign: '+' });
    expect(ledgerWord('move')).toEqual({ word: 'moved · not spent', sign: '' });
    expect(ledgerWord('into-holding')).toEqual({ word: 'into a holding', sign: '−' });
    expect(ledgerWord('out-of-holding')).toEqual({ word: 'out of a holding', sign: '+' });
  });

  it('every word is a word a screen reader can say, and a move has none of the signs', () => {
    for (const kind of ['spending', 'income', 'refund', 'move', 'into-holding', 'out-of-holding'] as const) {
      expect(ledgerWord(kind).word.length).toBeGreaterThan(3);
    }
    expect(ledgerWord('move').sign).toBe('');
  });
});

describe('defaultVisibility', () => {
  it('makes income private by default and a refund the household’s', () => {
    expect(CREDIT_CATEGORIES.filter((c) => defaultVisibility(c) === 'personal')).toEqual(['salary', 'business', 'interest', 'rent', 'dividend', 'other_income']);
    expect(defaultVisibility('refund')).toBe('household');
  });
});
