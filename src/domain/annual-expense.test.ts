import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { annualPlannedExpense, annualise, type PlannedOutgoing } from './annual-expense.ts';

/**
 * The approximate annual expense: what the workbook's M&Y Total computes, and
 * what the FIRE number is built on.
 *
 * These fixtures matter more than most. This figure is multiplied by 25, 30 or
 * 50 to produce a retirement target, so an error here is not off by a rupee —
 * it is off by twenty-five times a rupee, in a number somebody plans a decade
 * around.
 */

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');

describe('annualise', () => {
  it('multiplies a monthly figure by twelve', () => {
    expect(annualise(inr(1000), 'monthly').minor).toBe(1_200_000n);
  });

  it('leaves a yearly figure alone', () => {
    expect(annualise(inr(1000), 'yearly').minor).toBe(100_000n);
  });

  it('handles quarterly and half-yearly, which insurance actually uses', () => {
    expect(annualise(inr(1000), 'quarterly').minor).toBe(400_000n);
    expect(annualise(inr(1000), 'half_yearly').minor).toBe(200_000n);
  });

  it('stays exact on a figure that a float would round', () => {
    // 8,333.33 a month is the classic "annual divided by twelve" figure.
    // x12 must give 99,999.96 exactly, not 99,999.960000000001.
    expect(annualise(inr(8333.33), 'monthly').minor).toBe(9_999_996n);
  });
});

describe('annualPlannedExpense', () => {
  const outgoings: readonly PlannedOutgoing[] = [
    // Categories, as the workbook records them.
    { label: 'Grocery', amount: inr(12_000), cadence: 'monthly', source: 'category' },
    { label: 'School fee', amount: inr(60_000), cadence: 'yearly', source: 'category' },
    // The second block on that sheet.
    { label: 'Home Loan', amount: inr(35_000), cadence: 'monthly', source: 'liability' },
    { label: 'Term insurance', amount: inr(24_000), cadence: 'yearly', source: 'policy' },
  ];

  it('adds monthly x12 and yearly x1, the way M&Y Total does', () => {
    // 12,000x12 + 60,000 + 35,000x12 + 24,000 = 144,000 + 60,000 + 420,000 + 24,000
    expect(annualPlannedExpense(outgoings).total.minor).toBe(64_800_000n);
  });

  it('counts loans and policies, because that is why they are on the sheet', () => {
    const withoutCommitments = annualPlannedExpense(
      outgoings.filter((o) => o.source === 'category'),
    );
    // Leaving them out understates the annual figure by 444,000 — and the FIRE
    // target by twenty-five times that.
    expect(annualPlannedExpense(outgoings).total.minor - withoutCommitments.total.minor).toBe(
      44_400_000n,
    );
  });

  it('breaks the total down by where it came from', () => {
    const result = annualPlannedExpense(outgoings);
    expect(result.bySource.category.minor).toBe(20_400_000n);
    expect(result.bySource.liability.minor).toBe(42_000_000n);
    expect(result.bySource.policy.minor).toBe(2_400_000n);
  });

  it('separates compulsory from discretionary, which is what fixed and variable mean', () => {
    const result = annualPlannedExpense([
      { label: 'Grocery', amount: inr(12_000), cadence: 'monthly', source: 'category', compulsory: true },
      { label: 'Vacation', amount: inr(50_000), cadence: 'yearly', source: 'category', compulsory: false },
    ]);
    // The compulsory figure is the one a FIRE floor is built on: it is what the
    // household cannot simply stop spending.
    expect(result.compulsory.minor).toBe(14_400_000n);
    expect(result.total.minor).toBe(19_400_000n);
  });

  it('treats a commitment as compulsory unless told otherwise', () => {
    // A loan instalment is not optional, and a term premium keeps the cover.
    const result = annualPlannedExpense([
      { label: 'Home Loan', amount: inr(35_000), cadence: 'monthly', source: 'liability' },
    ]);
    expect(result.compulsory.minor).toBe(42_000_000n);
  });

  it('is zero, not undefined, when nothing is planned', () => {
    const result = annualPlannedExpense([]);
    expect(result.total.minor).toBe(0n);
    expect(result.compulsory.minor).toBe(0n);
  });

  it('refuses to add different currencies rather than producing a meaningless sum', () => {
    expect(() =>
      annualPlannedExpense([
        { label: 'Grocery', amount: inr(12_000), cadence: 'monthly', source: 'category' },
        { label: 'A US thing', amount: money(10_000n, 'USD'), cadence: 'monthly', source: 'category' },
      ]),
    ).toThrow(/currencies/i);
  });

  it('ignores an outgoing with no amount rather than counting it as zero', () => {
    // A category nobody has budgeted yet is unknown, not free. It is reported
    // as unplanned so the screen can say how much of the estimate is missing.
    const result = annualPlannedExpense([
      { label: 'Grocery', amount: inr(12_000), cadence: 'monthly', source: 'category' },
      { label: 'Dress', amount: null, cadence: 'monthly', source: 'category' },
    ]);
    expect(result.total.minor).toBe(14_400_000n);
    expect(result.unplanned).toEqual(['Dress']);
  });
});
