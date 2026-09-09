/**
 * Classifying a gain against dated rules.
 *
 * The whole reason `tax_rule` exists: a threshold that has moved, applied to a
 * sale by the rule that covered its date rather than by the rule in force
 * today. Every assertion here is about a date boundary or about refusing to
 * answer, because those are the two ways this goes wrong.
 *
 * Written before the implementation, as anything numeric is.
 */

import { describe, expect, it } from 'vitest';
import { classify, longTermRate, type TaxRule } from './tax-rules.ts';

const rules: readonly TaxRule[] = [
  // The regime from 23 July 2024.
  {
    jurisdiction: 'IN',
    kind: 'holding_period',
    assetClass: 'listed_equity',
    months: 12,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024',
  },
  {
    jurisdiction: 'IN',
    kind: 'holding_period',
    assetClass: 'foreign_equity',
    months: 24,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024',
  },
  {
    jurisdiction: 'IN',
    kind: 'cg_rate',
    assetClass: 'listed_equity',
    months: null,
    ratePct: '12.5',
    term: 'long',
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 's. 112A',
  },
  {
    jurisdiction: 'IN',
    kind: 'cg_rate',
    assetClass: 'listed_equity',
    months: null,
    ratePct: '20',
    term: 'short',
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 's. 111A',
  },
  // An earlier, closed rule — the case the dating exists for.
  {
    jurisdiction: 'IN',
    kind: 'holding_period',
    assetClass: 'gold',
    months: 36,
    ratePct: null,
    term: null,
    effectiveFrom: '2020-04-01',
    effectiveTo: '2024-07-22',
    authority: 'pre-2024 regime',
  },
  {
    jurisdiction: 'IN',
    kind: 'holding_period',
    assetClass: 'gold',
    months: 24,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024',
  },
];

describe('classify', () => {
  it('is long term past the threshold', () => {
    // Bought 10 Jan 2023, sold 10 Jun 2025: well past twelve months.
    const result = classify(rules, {
      assetClass: 'listed_equity',
      acquiredOn: '2023-01-10',
      disposedOn: '2025-06-10',
    });

    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.term).toBe('long');
    expect(result.months).toBe(12);
  });

  it('is short term inside it', () => {
    const result = classify(rules, {
      assetClass: 'listed_equity',
      acquiredOn: '2025-01-10',
      disposedOn: '2025-06-10',
    });

    expect(result.known).toBe(true);
    if (!result.known) return;
    expect(result.term).toBe('short');
  });

  it('counts calendar months, not 365 days', () => {
    // Exactly twelve months is not MORE than twelve months: held from 10 Jan
    // 2024 and sold on 10 Jan 2025 is short term, and one day later is long.
    const onTheDay = classify(rules, {
      assetClass: 'listed_equity',
      acquiredOn: '2024-01-10',
      disposedOn: '2025-01-10',
    });
    const dayAfter = classify(rules, {
      assetClass: 'listed_equity',
      acquiredOn: '2024-01-10',
      disposedOn: '2025-01-11',
    });

    expect(onTheDay.known && onTheDay.term).toBe('short');
    expect(dayAfter.known && dayAfter.term).toBe('long');
  });

  it('handles a month that has no such day', () => {
    // 31 August plus one month is not 31 September. Held from 31 Aug 2023,
    // twelve months lands on 31 Aug 2024, so 30 Aug 2024 is still short.
    const before = classify(rules, {
      assetClass: 'listed_equity',
      acquiredOn: '2023-08-31',
      disposedOn: '2024-08-30',
    });
    expect(before.known && before.term).toBe('short');
  });

  it('gives a US ETF twice the period an Indian one gets', () => {
    // The same eighteen months, two different answers. This is the whole
    // reason lot dates matter for foreign holdings.
    const indian = classify(rules, {
      assetClass: 'listed_equity',
      acquiredOn: '2024-01-10',
      disposedOn: '2025-07-10',
    });
    const foreign = classify(rules, {
      assetClass: 'foreign_equity',
      acquiredOn: '2024-01-10',
      disposedOn: '2025-07-10',
    });

    expect(indian.known && indian.term).toBe('long');
    expect(foreign.known && foreign.term).toBe('short');
  });
});

describe('classify — the rule that applied then', () => {
  it('uses the rule in force on the sale date, not the one in force now', () => {
    // Gold sold in June 2024 was under the 36-month rule. Twenty-six months
    // held is long term today and was short term then, and the answer for
    // that sale must not change because the law did afterwards.
    const then = classify(rules, {
      assetClass: 'gold',
      acquiredOn: '2022-04-10',
      disposedOn: '2024-06-10',
    });
    const now = classify(rules, {
      assetClass: 'gold',
      acquiredOn: '2022-04-10',
      disposedOn: '2024-08-10',
    });

    expect(then.known && then.months).toBe(36);
    expect(then.known && then.term).toBe('short');
    expect(now.known && now.months).toBe(24);
    expect(now.known && now.term).toBe('long');
  });

  it('takes the boundary day as the new rule, not the old one', () => {
    const onTheDay = classify(rules, {
      assetClass: 'gold',
      acquiredOn: '2022-04-10',
      disposedOn: '2024-07-23',
    });
    expect(onTheDay.known && onTheDay.months).toBe(24);
  });

  it('takes the day before as the old one', () => {
    const dayBefore = classify(rules, {
      assetClass: 'gold',
      acquiredOn: '2022-04-10',
      disposedOn: '2024-07-22',
    });
    expect(dayBefore.known && dayBefore.months).toBe(36);
  });
});

describe('classify — what it will not answer', () => {
  it('refuses when no rule covers the date, rather than using today’s', () => {
    // A 2019 sale, with nothing seeded for 2019. Applying the current rule
    // would give a confident, wrong, entirely plausible answer — which is
    // worse than saying nothing.
    const result = classify(rules, {
      assetClass: 'listed_equity',
      acquiredOn: '2018-01-10',
      disposedOn: '2019-06-10',
    });

    expect(result.known).toBe(false);
    if (result.known) return;
    expect(result.reason).toBe('no-rule-for-date');
  });

  it('refuses when the asset class has not been set', () => {
    // A fund's treatment depends on what it holds, not on its wrapper. The
    // app asks rather than guessing, and until it is answered there is no
    // classification to make.
    const result = classify(rules, {
      assetClass: null,
      acquiredOn: '2024-01-10',
      disposedOn: '2025-06-10',
    });

    expect(result.known).toBe(false);
    if (result.known) return;
    expect(result.reason).toBe('unclassified-asset');
  });

  it('refuses for an asset class with no holding period at all', () => {
    // Debt funds bought on or after 1 Apr 2023 are always short term, which
    // is a rule and not a period. Nothing is seeded for them, so nothing is
    // claimed about them.
    const result = classify(rules, {
      assetClass: 'debt_fund',
      acquiredOn: '2024-01-10',
      disposedOn: '2025-06-10',
    });

    expect(result.known).toBe(false);
    if (result.known) return;
    expect(result.reason).toBe('no-rule-for-date');
  });
});

describe('longTermRate', () => {
  it('finds the rate for the term and the date', () => {
    expect(longTermRate(rules, 'listed_equity', 'long', '2025-06-10')?.ratePct).toBe('12.5');
    expect(longTermRate(rules, 'listed_equity', 'short', '2025-06-10')?.ratePct).toBe('20');
  });

  it('is null where the rate is the slab rather than a capital-gains rate', () => {
    // Short-term gain on gold is taxed at the taxpayer's slab, which is not a
    // cg_rate at all. No row, and no invented one.
    expect(longTermRate(rules, 'gold', 'short', '2025-06-10')).toBeNull();
  });

  it('carries the authority, so a figure can be traced rather than argued about', () => {
    expect(longTermRate(rules, 'listed_equity', 'long', '2025-06-10')?.authority).toBe('s. 112A');
  });
});
