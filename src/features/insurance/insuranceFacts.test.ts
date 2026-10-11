import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { AnnualExpense } from '../../domain/annual-expense.ts';
import type { InsurancePolicy, Liability } from '../../repo/types.ts';
import { insuranceFacts } from './insuranceFacts.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

const policy = (over: Partial<InsurancePolicy> & { id: string }): InsurancePolicy => ({
  name: over.id,
  kind: 'term_life',
  premium: inr(18000),
  cadence: 'yearly',
  memberId: null,
  isLapsed: false,
  insurer: null,
  policyLast4: null,
  cover: inr(10000000),
  startedOn: null,
  premiumsEndOn: null,
  lapsedOn: null,
  renewalOn: null,
  note: null,
  linkedHoldingId: null,
  ...over,
});

/** A year's expenses, with what part of it is loan instalments and what part policy premiums. */
const annualOf = (rupees: number, instalments = 0, premiums = 0): AnnualExpense => ({
  total: inr(rupees),
  compulsory: inr(rupees),
  bySource: { category: inr(rupees - instalments - premiums), liability: inr(instalments), policy: inr(premiums) },
  unplanned: [],
});

const loan = (over: Partial<Liability> & { id: string }): Liability => ({
  name: over.id,
  kind: 'home_loan',
  instalment: inr(40000),
  cadence: 'monthly',
  memberId: null,
  isClosed: false,
  outstanding: inr(5000000),
  outstandingAsOf: '2026-09-30',
  ...over,
});

const base = {
  base: 'INR',
  rates: [],
  today: '2026-10-11',
  annual: annualOf(600000),
  years: 10,
  liquid: inr(1500000),
  surrenderValues: new Map<string, ReturnType<typeof inr>>(),
};

describe('insuranceFacts — the cover gap, from what is recorded and nothing else', () => {
  it('adds only term cover in force toward what is in force', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [loan({ id: 'l' })],
      policies: [
        policy({ id: 'term', cover: inr(10000000) }),
        policy({ id: 'health', kind: 'health', cover: inr(1000000) }),
        policy({ id: 'lapsed', cover: inr(5000000), isLapsed: true }),
      ],
    });
    expect(facts.termCover?.minor).toBe(1000000000n);
    expect(facts.gap).not.toBeNull();
    // 50,00,000 owed + 6,00,000 x 10 - 15,00,000 liquid = 95,00,000 suggested.
    expect(facts.gap?.suggested.minor).toBe(950000000n);
  });

  it('counts a policy with no cover recorded as not known, and says how many', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [policy({ id: 'a', cover: null }), policy({ id: 'b', cover: inr(100) })],
    });
    expect(facts.termCount).toBe(2);
    expect(facts.termCoverUnknown).toBe(1);
    expect(facts.termCover?.minor).toBe(10000n);
  });

  it('says how many open loans have no balance recorded, since the figure is short by them', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [loan({ id: 'a', outstanding: null }), loan({ id: 'b' }), loan({ id: 'c', isClosed: true, outstanding: null })],
      policies: [policy({ id: 't' })],
    });
    expect(facts.loansWithoutBalance).toBe(1);
  });

  it('refuses the gap without annual expenses, naming why, and does not guess a figure', () => {
    const facts = insuranceFacts({ ...base, annual: null, liabilities: [], policies: [policy({ id: 't' })] });
    expect(facts.gap).toBeNull();
    expect(facts.gapRefusedBecause).toMatch(/annual expenses/i);
  });

  it('refuses the gap where liquid money could not be added into one figure', () => {
    const facts = insuranceFacts({ ...base, liquid: null, liabilities: [], policies: [policy({ id: 't' })] });
    expect(facts.gap).toBeNull();
    expect(facts.gapRefusedBecause).toMatch(/liquid/i);
  });

  it('converts a policy in another currency at the dated rate, or refuses without one', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [policy({ id: 'us', cover: usd(100000), premium: usd(1000) })],
    });
    expect(facts.termCover).toBeNull();
    expect(facts.gapRefusedBecause).toMatch(/rate/i);
  });

  it('has no gap, and says so, where cover in force is above what the arithmetic gives', () => {
    const facts = insuranceFacts({ ...base, liabilities: [], policies: [policy({ id: 't', cover: inr(99999999) })] });
    expect(facts.gap?.short.minor).toBe(0n);
  });

  it('gives health cover as a list, with no suggested figure', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [
        policy({ id: 'floater', kind: 'health', cover: inr(1000000) }),
        policy({ id: 'own', kind: 'health', cover: inr(500000), memberId: 'm1' }),
        policy({ id: 'term' }),
      ],
    });
    expect(facts.health.map((h) => h.id)).toEqual(['floater', 'own']);
  });
});

describe('insuranceFacts — a loan is counted once (PF-C12)', () => {
  it('leaves the instalments out of the expense term, since the balance is already a term of the sum', () => {
    // ₹50,000 a month planned for the household, a ₹40,000 EMI inside the annual figure, ₹40L still owed.
    const facts = insuranceFacts({
      ...base,
      annual: annualOf(1098000, 480000, 18000),
      liabilities: [loan({ id: 'l', outstanding: inr(4000000) })],
      policies: [policy({ id: 't', cover: inr(10000000) })],
      liquid: inr(0),
    });
    // Without the 4,80,000 of instalments: 6,18,000 a year over ten years, plus 40,00,000 owed.
    expect(facts.annualForCover?.minor).toBe(61800000n);
    expect(facts.instalmentsLeftOut?.minor).toBe(48000000n);
    expect(facts.gap?.suggested.minor).toBe((4000000n + 6180000n) * 100n);
  });
});

describe('insuranceFacts — what is wrong with the gap travels with it', () => {
  it('says so when a term policy has no cover recorded, and when a loan has no balance', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [loan({ id: 'l', outstanding: null })],
      policies: [policy({ id: 't', cover: null })],
    });
    expect(facts.notes).toHaveLength(2);
    expect(facts.notes.join(' ')).toMatch(/no cover recorded/);
    expect(facts.notes.join(' ')).toMatch(/no balance recorded/);
  });

  it('has no notes when everything is recorded', () => {
    expect(insuranceFacts({ ...base, liabilities: [loan({ id: 'l' })], policies: [policy({ id: 't' })] }).notes).toEqual([]);
  });
});

describe('insuranceFacts — health cover is a list by whose it is', () => {
  it('groups in-force health policies by member, the household first, and leaves out lapsed ones', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [
        policy({ id: 'own', kind: 'health', cover: inr(500000), memberId: 'm1' }),
        policy({ id: 'floater', kind: 'health', cover: inr(1000000) }),
        policy({ id: 'old', kind: 'health', isLapsed: true }),
        policy({ id: 'term' }),
      ],
    });
    expect(facts.healthByMember.map((g) => [g.memberId, g.policies.map((p) => p.id)])).toEqual([
      [null, ['floater']],
      ['m1', ['own']],
    ]);
  });
});

describe('insuranceFacts — a hybrid policy shows what was paid in against what it would pay out (PF-C4)', () => {
  it('sets the premiums paid so far against the linked holding\'s latest reading', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [
        policy({
          id: 'ulip',
          kind: 'ulip',
          premium: inr(50000),
          startedOn: '2023-03-01',
          linkedHoldingId: 'h1',
        }),
      ],
      surrenderValues: new Map([['h1', inr(145000)]]),
    });
    const ulip = facts.byPolicy.get('ulip');
    // March 2023 to October 2026: payments in 2023, 2024, 2025 and 2026, four of fifty thousand.
    expect(ulip?.paidIn?.minor).toBe(20000000n);
    expect(ulip?.surrenderValue?.minor).toBe(14500000n);
    expect(ulip?.behind?.minor).toBe(5500000n);
  });

  it('stops counting premiums at the day the policy lapsed', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [
        policy({
          id: 'ulip',
          kind: 'ulip',
          premium: inr(50000),
          startedOn: '2022-03-01',
          isLapsed: true,
          lapsedOn: '2024-06-10',
          linkedHoldingId: 'h1',
        }),
      ],
      surrenderValues: new Map([['h1', inr(145000)]]),
    });
    expect(facts.byPolicy.get('ulip')?.paidIn?.minor).toBe(3n * 5000000n);
  });

  it('has no figures for protection with no value, rather than a zero', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [policy({ id: 'term', startedOn: '2023-03-01' })],
    });
    expect(facts.byPolicy.get('term')?.surrenderValue).toBeNull();
    expect(facts.byPolicy.get('term')?.behind).toBeNull();
  });
});

describe('insuranceFacts — renewals', () => {
  it('lists those due within thirty days, soonest first', () => {
    const facts = insuranceFacts({
      ...base,
      liabilities: [],
      policies: [
        policy({ id: 'later', renewalOn: '2026-11-05' }),
        policy({ id: 'soon', renewalOn: '2026-10-15' }),
        policy({ id: 'far', renewalOn: '2027-06-01' }),
      ],
    });
    expect(facts.renewals.map((r) => r.id)).toEqual(['soon', 'later']);
  });
});
