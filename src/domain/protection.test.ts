import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import {
  coverGap,
  cumulativePremiums,
  premiumsPerYear,
  renewalsDue,
  surrenderGap,
  type PolicyForRenewal,
} from './protection.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

describe('cumulativePremiums — what has been paid in, counted from the start date and the cadence', () => {
  it('counts the first premium on the start date', () => {
    const paid = cumulativePremiums({
      premium: inr(50000),
      cadence: 'yearly',
      startedOn: '2026-03-01',
      today: '2026-03-01',
    });
    expect(paid?.minor).toBe(5000000n);
  });

  it('counts one more each time the cadence comes round, and not before', () => {
    const base = { premium: inr(50000), cadence: 'yearly' as const, startedOn: '2022-03-01' };
    expect(cumulativePremiums({ ...base, today: '2026-02-28' })?.minor).toBe(4n * 5000000n);
    expect(cumulativePremiums({ ...base, today: '2026-03-01' })?.minor).toBe(5n * 5000000n);
    expect(cumulativePremiums({ ...base, today: '2026-10-11' })?.minor).toBe(5n * 5000000n);
  });

  it('counts a monthly premium monthly, a quarterly one quarterly and a half-yearly one twice a year', () => {
    const base = { premium: inr(1000), startedOn: '2026-01-15', today: '2026-10-11' };
    // 15 Jan to 11 Oct is eight whole months and a bit: nine payments in January..September.
    expect(cumulativePremiums({ ...base, cadence: 'monthly' })?.minor).toBe(9n * 100000n);
    // Quarterly: January, April, July.
    expect(cumulativePremiums({ ...base, cadence: 'quarterly' })?.minor).toBe(3n * 100000n);
    // Half-yearly: January, July.
    expect(cumulativePremiums({ ...base, cadence: 'half_yearly' })?.minor).toBe(2n * 100000n);
  });

  it('is null without a premium or a start date, never zero', () => {
    expect(
      cumulativePremiums({ premium: null, cadence: 'yearly', startedOn: '2026-01-01', today: '2026-10-11' }),
    ).toBeNull();
    expect(
      cumulativePremiums({ premium: inr(1), cadence: 'yearly', startedOn: null, today: '2026-10-11' }),
    ).toBeNull();
  });

  it('stops at the day a policy lapsed, and does not keep adding premiums after it', () => {
    const base = { premium: inr(50000), cadence: 'yearly' as const, startedOn: '2022-03-01' };
    // Lapsed in June 2024: the March 2022, 2023 and 2024 premiums fell due, and nothing after.
    expect(cumulativePremiums({ ...base, lapsedOn: '2024-06-10', today: '2026-10-11' })?.minor).toBe(3n * 5000000n);
    expect(cumulativePremiums({ ...base, lapsedOn: '2024-06-10', today: '2031-10-11' })?.minor).toBe(3n * 5000000n);
  });

  it('stops at the end of the premium term, for a policy paid over a limited time', () => {
    const base = { premium: inr(50000), cadence: 'yearly' as const, startedOn: '2022-03-01' };
    // Five years of premiums on a ten-year policy: March 2022 to March 2026.
    expect(cumulativePremiums({ ...base, premiumsEndOn: '2026-03-01', today: '2031-10-11' })?.minor).toBe(5n * 5000000n);
    // Before the term ends it is still counting.
    expect(cumulativePremiums({ ...base, premiumsEndOn: '2026-03-01', today: '2024-10-11' })?.minor).toBe(3n * 5000000n);
  });

  it('stops at whichever of the two came first', () => {
    const base = { premium: inr(50000), cadence: 'yearly' as const, startedOn: '2022-03-01' };
    expect(
      cumulativePremiums({ ...base, lapsedOn: '2023-06-01', premiumsEndOn: '2026-03-01', today: '2026-10-11' })?.minor,
    ).toBe(2n * 5000000n);
  });

  it('is null for a policy that has not started yet', () => {
    expect(
      cumulativePremiums({ premium: inr(1), cadence: 'yearly', startedOn: '2027-01-01', today: '2026-10-11' }),
    ).toBeNull();
  });
});

describe('premiumsPerYear', () => {
  it('annualises each cadence', () => {
    expect(premiumsPerYear('monthly')).toBe(12);
    expect(premiumsPerYear('quarterly')).toBe(4);
    expect(premiumsPerYear('half_yearly')).toBe(2);
    expect(premiumsPerYear('yearly')).toBe(1);
  });
});

describe('surrenderGap — paid in against what it would pay out today (PF-C4)', () => {
  it('is paid in less surrender value, and negative for the household when the policy is under water', () => {
    // Paid ₹2,00,000, worth ₹1,45,000 now: the household is ₹55,000 behind.
    const gap = surrenderGap({ paidIn: inr(200000), surrenderValue: inr(145000) });
    expect(gap?.minor).toBe(5500000n);
  });

  it('is negative the other way when it is worth more than was paid', () => {
    expect(surrenderGap({ paidIn: inr(100000), surrenderValue: inr(130000) })?.minor).toBe(-3000000n);
  });

  it('is null where either side is missing or the currencies differ, not a guess', () => {
    expect(surrenderGap({ paidIn: null, surrenderValue: inr(1) })).toBeNull();
    expect(surrenderGap({ paidIn: inr(1), surrenderValue: null })).toBeNull();
    expect(surrenderGap({ paidIn: inr(1), surrenderValue: usd(1) })).toBeNull();
  });
});

describe('PF-C12 — the cover gap is a stated calculation over inputs the household can see', () => {
  const inputs = {
    liabilities: inr(5000000),
    annualExpenses: inr(600000),
    years: 10,
    liquidCorpus: inr(1500000),
    termCover: inr(10000000),
  };

  it('is outstanding liabilities, plus annual expenses over the years of dependency, less liquid money', () => {
    const result = coverGap(inputs);
    expect(result).not.toBeNull();
    // 50,00,000 + 6,00,000 x 10 - 15,00,000 = 95,00,000 suggested; 1,00,00,000 in force.
    expect(result?.expensesOverYears.minor).toBe(600000000n);
    expect(result?.suggested.minor).toBe(9500000n * 100n);
    expect(result?.gap.minor).toBe(-500000n * 100n);
    // Cover above what the arithmetic gives is not a gap.
    expect(result?.short.minor).toBe(0n);
  });

  it('reports the shortfall when the cover in force is below the suggestion', () => {
    const result = coverGap({ ...inputs, termCover: inr(4000000) });
    expect(result?.gap.minor).toBe(5500000n * 100n);
    expect(result?.short.minor).toBe(5500000n * 100n);
  });

  it('floors what is suggested at nothing when liquid money alone covers it, and says what it started from', () => {
    const result = coverGap({ ...inputs, liquidCorpus: inr(999999999) });
    expect(result?.suggested.minor).toBe(0n);
    expect(result?.short.minor).toBe(0n);
  });

  it('is nothing to cover at zero years of dependency and no loans', () => {
    const result = coverGap({ ...inputs, years: 0, liabilities: inr(0), liquidCorpus: inr(0) });
    expect(result?.suggested.minor).toBe(0n);
  });

  it('is null in mixed currencies, never a number added across them', () => {
    expect(coverGap({ ...inputs, termCover: usd(1) })).toBeNull();
  });

  it('refuses a negative or fractional number of years', () => {
    expect(coverGap({ ...inputs, years: -1 })).toBeNull();
    expect(coverGap({ ...inputs, years: 2.5 })).toBeNull();
  });
});

describe('renewalsDue — what falls due within thirty days, and what is already past', () => {
  const policy = (over: Partial<PolicyForRenewal> & { id: string }): PolicyForRenewal => ({
    name: over.id,
    renewalOn: null,
    isLapsed: false,
    ...over,
  });
  const today = '2026-10-11';

  it('lists a renewal within thirty days with the days left, soonest first', () => {
    const due = renewalsDue(
      [
        policy({ id: 'b', renewalOn: '2026-11-05' }),
        policy({ id: 'a', renewalOn: '2026-10-20' }),
        policy({ id: 'far', renewalOn: '2027-03-01' }),
      ],
      today,
    );
    expect(due.map((d) => [d.id, d.daysLeft, d.overdue])).toEqual([
      ['a', 9, false],
      ['b', 25, false],
    ]);
  });

  it('includes today and the thirtieth day, and not the thirty-first', () => {
    const due = renewalsDue(
      [
        policy({ id: 'today', renewalOn: '2026-10-11' }),
        policy({ id: 'edge', renewalOn: '2026-11-10' }),
        policy({ id: 'past', renewalOn: '2026-11-11' }),
      ],
      today,
    );
    expect(due.map((d) => d.id)).toEqual(['today', 'edge']);
  });

  it('names a renewal date that has passed as overdue and puts it first', () => {
    const due = renewalsDue(
      [policy({ id: 'soon', renewalOn: '2026-10-15' }), policy({ id: 'late', renewalOn: '2026-10-01' })],
      today,
    );
    expect(due.map((d) => [d.id, d.overdue, d.daysLeft])).toEqual([
      ['late', true, -10],
      ['soon', false, 4],
    ]);
  });

  it('leaves out a lapsed policy and one with no renewal date', () => {
    const due = renewalsDue(
      [policy({ id: 'x', renewalOn: '2026-10-15', isLapsed: true }), policy({ id: 'y', renewalOn: null })],
      today,
    );
    expect(due).toEqual([]);
  });
});

describe('PF-C3 — cover is never an input to net worth, allocation or FIRE', () => {
  // A structural guard and not a behaviour: these are the calculations a figure a person acts on comes
  // from, and the way cover reaches one is by something importing it. If a future calculation wants it,
  // that is a conversation, and this test is where the conversation starts.
  const calculations = [
    'src/domain/networth.ts',
    'src/domain/fx.ts',
    'src/domain/fire.ts',
    'src/domain/history.ts',
    'src/domain/summary.ts',
    'src/domain/earmark.ts',
    'src/domain/annual-expense.ts',
  ];

  for (const file of calculations) {
    it(`${file} does not read a policy's cover`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} mentions cover_minor`).not.toMatch(/cover_minor/);
      expect(source, `${file} imports protection`).not.toMatch(/from '\.\/protection\.ts'/);
    });
  }
});
