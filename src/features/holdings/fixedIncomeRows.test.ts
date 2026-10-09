import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { DepositRenewal, FixedIncomeTerms, RatingChange } from '../../repo/types.ts';
import { daysPhrase, fixedIncomeAlerts, paidOutHoldings } from './fixedIncomeRows.ts';

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

  it('says a deposit that renews itself renews, since the money does not come back', () => {
    // The advice the bank sends is what is awaited, and "decide where it goes" would be wrong.
    const alerts = run({
      terms: [terms({ start: '2024-10-20', maturity: '2025-10-20', autoRenew: true })],
    });
    expect(alerts).toEqual([{ holdingId: 'h1', kind: 'renews', on: '2026-10-20', daysAway: 11 }]);
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

  it('says so when a rating change could not be judged, instead of staying silent', () => {
    const alerts = run({
      terms: [bond()],
      ratingChanges: [change({ from: 'CRISIL A1+', to: 'CRISIL A4' })],
    });
    expect(alerts).toEqual([
      { holdingId: 'b1', kind: 'rating-unclear', on: '2026-09-01', from: 'CRISIL A1+', to: 'CRISIL A4' },
    ]);
  });

  it('says so when a rating was removed', () => {
    const alerts = run({ terms: [bond()], ratingChanges: [change({ from: 'CRISIL AA', to: null })] });
    expect(alerts).toEqual([
      { holdingId: 'b1', kind: 'rating-removed', on: '2026-09-01', from: 'CRISIL AA', to: null },
    ]);
  });

  it('calls a downgrade made as a clear and a re-entry a downgrade', () => {
    const alerts = run({
      terms: [bond()],
      ratingChanges: [
        change({ seq: 1, from: null, to: 'CRISIL AA', changedOn: '2026-01-01' }),
        change({ seq: 2, from: 'CRISIL AA', to: null, changedOn: '2026-09-01' }),
        change({ seq: 3, from: null, to: 'CRISIL BB', changedOn: '2026-09-02' }),
      ],
    });
    expect(alerts.map((a) => a.kind)).toEqual(['downgraded']);
  });

  it('is silent about a position the caller cannot see', () => {
    // Another member's private deposit: its maturity and its rating are theirs to hear about.
    expect(run({ terms: [terms(), bond()], ratingChanges: [change()], visible: [] })).toEqual([]);
  });

  it('is empty when there is nothing, and does not read the clock', () => {
    expect(run({})).toEqual([]);
  });
});

describe('daysPhrase', () => {
  it('says today and tomorrow, and is right about one day', () => {
    expect(daysPhrase(0)).toBe('today');
    expect(daysPhrase(1)).toBe('tomorrow');
    expect(daysPhrase(2)).toBe('in 2 days');
    expect(daysPhrase(30)).toBe('in 30 days');
  });
});

describe('paidOutHoldings', () => {
  const renewal = (over: Partial<DepositRenewal> = {}): DepositRenewal => ({
    id: 'r1',
    holdingId: 'h1',
    start: '2025-01-01',
    maturity: '2026-01-01',
    principal: money(10_750_000n, 'INR'),
    ratePct: '7.000',
    compounding: 'yearly',
    note: null,
    ...over,
  });
  const today = '2026-10-09';

  it('names a deposit that has paid out, and the day it did', () => {
    const paid = paidOutHoldings([terms({ start: '2025-01-01', maturity: '2026-01-01' })], [], today);
    expect([...paid]).toEqual([['h1', '2026-01-01']]);
  });

  it('takes the end of the last term it was renewed into, not the first', () => {
    const paid = paidOutHoldings(
      [terms({ start: '2024-01-01', maturity: '2025-01-01' })],
      [renewal()],
      today,
    );
    expect(paid.get('h1')).toBe('2026-01-01');
  });

  it('never calls a deposit that renews itself paid out: the money stays in', () => {
    const paid = paidOutHoldings(
      [terms({ start: '2024-01-01', maturity: '2025-01-01', autoRenew: true })],
      [],
      today,
    );
    expect(paid.size).toBe(0);
  });

  it('names a bond that has been repaid', () => {
    const paid = paidOutHoldings([bond({ start: '2024-01-01', maturity: '2026-05-01' })], [], today);
    expect(paid.get('b1')).toBe('2026-05-01');
  });

  it('leaves out what is still running, has not started, or cannot be valued', () => {
    const paid = paidOutHoldings(
      [terms(), bond({ start: '2027-01-01', maturity: '2029-01-01' }), terms({ holdingId: 'x', compounding: null })],
      [],
      today,
    );
    expect(paid.size).toBe(0);
  });

  it('is empty for nothing, and does not read the clock', () => {
    expect(paidOutHoldings([], [], today).size).toBe(0);
  });
});
