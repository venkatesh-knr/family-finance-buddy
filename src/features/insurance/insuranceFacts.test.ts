import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
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
  renewalOn: null,
  linkedHoldingId: null,
  ...over,
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
  annualExpenses: inr(600000),
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
    const facts = insuranceFacts({ ...base, annualExpenses: null, liabilities: [], policies: [policy({ id: 't' })] });
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
