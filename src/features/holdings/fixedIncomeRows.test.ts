import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { DepositRenewal, FixedIncomeTerms, RatingChange } from '../../repo/types.ts';
import { fixedIncomeAlerts } from './fixedIncomeRows.ts';

const terms = (over: Partial<FixedIncomeTerms> = {}): FixedIncomeTerms => ({
  holdingId: 'h1',
  householdId: 'hh',
  kind: 'deposit',
  principal: money(10_000_000n, 'INR'),
  ratePct: '7.500',
  start: '2025-10-20',
  maturity: '2026-10-20',
  compounding: 'yearly',
  couponFrequency: null,
  rating: null,
  repayMode: null,
  autoRenew: false,
  renewalRatePct: null,
  institution: null,
  accountLast4: null,
  note: null,
  ...over,
});

const bond = (over: Partial<FixedIncomeTerms> = {}): FixedIncomeTerms =>
  terms({
    holdingId: 'b1',
    kind: 'bond',
    compounding: null,
    couponFrequency: 'yearly',
    rating: 'CRISIL A',
    maturity: '2028-10-20',
    ...over,
  });

const change = (over: Partial<RatingChange> = {}): RatingChange => ({
  id: 'rc',
  seq: 1,
  holdingId: 'b1',
  from: 'CRISIL AA',
  to: 'CRISIL A',
  changedOn: '2026-09-01',
  ...over,
});

const run = (over: {
  terms?: FixedIncomeTerms[];
  renewals?: DepositRenewal[];
  ratingChanges?: RatingChange[];
  visible?: string[];
}) =>
  fixedIncomeAlerts({
    terms: over.terms ?? [],
    renewals: over.renewals ?? [],
    ratingChanges: over.ratingChanges ?? [],
    visibleHoldingIds: new Set(over.visible ?? ['h1', 'b1']),
    today: '2026-10-09',
  });

describe('fixedIncomeAlerts', () => {
  it('names a deposit that matures within thirty days, and how far off', () => {
    const alerts = run({ terms: [terms()] });
    expect(alerts).toEqual([{ holdingId: 'h1', kind: 'matures', on: '2026-10-20', daysAway: 11 }]);
  });

  it('says nothing of one that is further off than that', () => {
    expect(run({ terms: [terms({ maturity: '2026-12-31', start: '2025-12-31' })] })).toEqual([]);
  });

  it('says nothing of one that has already paid out: that is on its own row', () => {
    expect(run({ terms: [terms({ start: '2025-01-01', maturity: '2026-01-01' })] })).toEqual([]);
  });

  it('counts the term the day is in, so a renewing deposit is named for its next renewal', () => {
    const alerts = run({
      terms: [terms({ start: '2024-10-20', maturity: '2025-10-20', autoRenew: true })],
    });
    expect(alerts).toEqual([{ holdingId: 'h1', kind: 'matures', on: '2026-10-20', daysAway: 11 }]);
  });

  it('names a bond downgraded recently, from what it was to what it is', () => {
    const alerts = run({ terms: [bond()], ratingChanges: [change()] });
    expect(alerts).toEqual([
      { holdingId: 'b1', kind: 'downgraded', on: '2026-09-01', from: 'CRISIL AA', to: 'CRISIL A' },
    ]);
  });

  it('lets an old downgrade go, and an upgrade back clear one', () => {
    expect(run({ terms: [bond()], ratingChanges: [change({ changedOn: '2025-01-01' })] })).toEqual([]);
    expect(
      run({
        terms: [bond()],
        ratingChanges: [change(), change({ seq: 2, from: 'CRISIL A', to: 'CRISIL AA', changedOn: '2026-09-20' })],
      }),
    ).toEqual([]);
  });

  it('is silent about a position the caller cannot see', () => {
    // Another member's private deposit: its maturity and its rating are theirs to hear about.
    expect(run({ terms: [terms(), bond()], ratingChanges: [change()], visible: [] })).toEqual([]);
  });

  it('is empty when there is nothing, and does not read the clock', () => {
    expect(run({})).toEqual([]);
  });
});
