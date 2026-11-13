import { describe, expect, it } from 'vitest';
import { checkTypedProfit, householdYearlyIncome, memberYearlyIncome, taxInputInForce, usualSalary, yearlyBusiness, type IncomeCredit } from './income.ts';

/**
 * How FIRE reads income, and which of Tax's typed figures is in force (docs/design/ledger-income.md sections 7 and 8).
 *
 * The vectors are the design's own (LI-I9, LI-I18, LI-I20), and the Household ones are the same as the database's: supabase/tests/
 * ledger_income.test.sql holds `household_yearly_income` to them, so the rule written twice gives one answer. Amounts are rupees here,
 * stored as paise.
 */

const credit = (memberId: string, category: IncomeCredit['category'], rupees: number, date: string, currency = 'INR'): IncomeCredit => ({
  memberId,
  category,
  amountMinor: BigInt(Math.round(rupees * 100)),
  currency,
  date,
});
const salaries = (memberId: string, ...monthly: [string, number][]): IncomeCredit[] => monthly.map(([month, rupees]) => credit(memberId, 'salary', rupees, `${month}-01`));
const paise = (rupees: number): bigint => BigInt(Math.round(rupees * 100));

describe('usualSalary', () => {
  it('LI-I9 — the amount that occurs most often in the last six months entered: 1,42,000 four times, 1,38,450 once, 2,10,000 once', () => {
    const credits = salaries('a', ['2026-05', 142_000], ['2026-06', 142_000], ['2026-07', 138_450], ['2026-08', 142_000], ['2026-09', 210_000], ['2026-10', 142_000]);
    const usual = usualSalary(credits, 'a', 'INR', '2026-11-13');
    expect(usual).toMatchObject({ kind: 'usual', amountMinor: paise(142_000), occurrences: 4, monthsCounted: 6 });
  });

  it('LI-I9 — marks each of the months as the usual amount or not, so the screen can say which', () => {
    const credits = salaries('a', ['2026-05', 142_000], ['2026-06', 142_000], ['2026-07', 138_450], ['2026-08', 142_000], ['2026-09', 210_000], ['2026-10', 142_000]);
    const usual = usualSalary(credits, 'a', 'INR', '2026-11-13');
    expect(usual.kind === 'none' ? [] : usual.months.map((m) => [m.month, m.usual])).toEqual([
      ['2026-05', true],
      ['2026-06', true],
      ['2026-07', false],
      ['2026-08', true],
      ['2026-09', false],
      ['2026-10', true],
    ]);
  });

  it('LI-I20 — on a tie the more recent amount: 1,30,000 three times then 1,42,000 three times gives 1,42,000', () => {
    const credits = salaries('a', ['2026-05', 130_000], ['2026-06', 130_000], ['2026-07', 130_000], ['2026-08', 142_000], ['2026-09', 142_000], ['2026-10', 142_000]);
    expect(usualSalary(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'usual', amountMinor: paise(142_000) });
  });

  it('LI-I20 — and the most common wins when it is the older: 1,30,000 four times then 1,42,000 twice gives 1,30,000', () => {
    const credits = salaries('a', ['2026-05', 130_000], ['2026-06', 130_000], ['2026-07', 130_000], ['2026-08', 130_000], ['2026-09', 142_000], ['2026-10', 142_000]);
    expect(usualSalary(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'usual', amountMinor: paise(130_000), occurrences: 4 });
  });

  it('LI-I20 — when nothing repeats, the latest month, and it says so', () => {
    const credits = salaries('a', ['2026-05', 100_000], ['2026-06', 110_000], ['2026-07', 120_000], ['2026-08', 130_000], ['2026-09', 140_000], ['2026-10', 150_000]);
    expect(usualSalary(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'latest', amountMinor: paise(150_000) });
  });

  it('LI-I20 — a seventh month drops the oldest from the count', () => {
    // April equals May. With April counted, 1,00,000 would occur twice and win; the six latest are all different, so the latest wins.
    const credits = salaries('a', ['2026-04', 100_000], ['2026-05', 100_000], ['2026-06', 110_000], ['2026-07', 120_000], ['2026-08', 130_000], ['2026-09', 140_000], ['2026-10', 150_000]);
    expect(usualSalary(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'latest', amountMinor: paise(150_000), monthsCounted: 6 });
  });

  it('LI-I20 — with a single month entered, that month, and it says so', () => {
    expect(usualSalary(salaries('a', ['2026-10', 142_000]), 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'latest', amountMinor: paise(142_000), monthsCounted: 1 });
  });

  it('counts the months entered and not the calendar: a gap in the year is not a month with nothing in it', () => {
    const credits = salaries('a', ['2026-01', 142_000], ['2026-02', 142_000], ['2026-08', 142_000], ['2026-09', 138_450], ['2026-10', 142_000]);
    expect(usualSalary(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'usual', amountMinor: paise(142_000), occurrences: 4, monthsCounted: 5 });
  });

  it('LI-I9 — a salary in two parts is one month: FIRE reads monthly sums, not single credits', () => {
    const credits = [credit('a', 'salary', 100_000, '2026-10-01'), credit('a', 'salary', 42_000, '2026-10-15'), ...salaries('a', ['2026-09', 142_000])];
    expect(usualSalary(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'usual', amountMinor: paise(142_000), occurrences: 2 });
  });

  it('with no Salary credit there is no usual salary, and not a zero', () => {
    expect(usualSalary([credit('a', 'business', 50_000, '2026-10-03')], 'a', 'INR', '2026-11-13')).toEqual({ kind: 'none' });
    expect(usualSalary([], 'a', 'INR', '2026-11-13')).toEqual({ kind: 'none' });
  });

  it('reads one member and one currency, and nothing dated after the day it is asked', () => {
    const credits = [...salaries('a', ['2026-10', 142_000]), ...salaries('b', ['2026-10', 99_000]), credit('a', 'salary', 1, '2026-10-02', 'USD'), credit('a', 'salary', 777_000, '2026-12-01')];
    expect(usualSalary(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ amountMinor: paise(142_000) });
  });
});

describe('yearlyBusiness', () => {
  /** Ten of the twelve months November 2025 to October 2026 at 1,44,000, none in February and March. */
  const tenMonths = ['2025-11', '2025-12', '2026-01', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month) =>
    credit('a', 'business', 144_000, `${month}-03`),
  );

  it('LI-I18 — the total over the last 12 complete months, a month with nothing counting as zero: ₹14,40,000', () => {
    const result = yearlyBusiness([...tenMonths, credit('a', 'business', 999_000, '2026-11-05')], 'a', 'INR', '2026-11-13');
    expect(result).toMatchObject({ kind: 'full', yearlyMinor: paise(1_440_000), monthsCounted: 12 });
    expect(result.kind === 'full' && result.months.filter((m) => m.totalMinor === 0n).map((m) => m.month)).toEqual(['2026-02', '2026-03']);
  });

  it('LI-I18 — the current month is never in the window: a credit dated in it changes nothing until the month ends', () => {
    const before = yearlyBusiness([...tenMonths, credit('a', 'business', 999_000, '2026-11-05')], 'a', 'INR', '2026-11-13');
    const without = yearlyBusiness(tenMonths, 'a', 'INR', '2026-11-13');
    expect(before).toEqual(without);
    const after = yearlyBusiness([...tenMonths, credit('a', 'business', 999_000, '2026-11-05')], 'a', 'INR', '2026-12-05');
    expect(after).toMatchObject({ kind: 'full', yearlyMinor: paise(144_000 * 9 + 999_000) });
  });

  it('LI-I18 — with fewer months since the first, their average times twelve, labelled: five complete months of ₹5,40,000 give ₹12,96,000', () => {
    const credits = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month) => credit('a', 'business', 108_000, `${month}-03`));
    expect(yearlyBusiness(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'average', yearlyMinor: paise(1_296_000), totalMinor: paise(540_000), monthsCounted: 5 });
  });

  it('LI-I18 — only the current month entered: the first figure comes when it ends', () => {
    expect(yearlyBusiness([credit('a', 'business', 200_000, '2026-11-05')], 'a', 'INR', '2026-11-13')).toEqual({ kind: 'waiting', firstMonth: '2026-11' });
  });

  it('LI-I18 — a credit older than twelve months starts no earlier than the window', () => {
    const credits = [credit('a', 'business', 100_000, '2025-01-05'), credit('a', 'business', 120_000, '2026-10-05')];
    expect(yearlyBusiness(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'full', yearlyMinor: paise(120_000), monthsCounted: 12 });
  });

  it('says nothing when there is no Business income credit, and not a zero', () => {
    expect(yearlyBusiness([credit('a', 'salary', 1, '2026-10-01')], 'a', 'INR', '2026-11-13')).toEqual({ kind: 'none' });
  });

  it('rounds the average to the paisa, half up', () => {
    // 3 months totalling 10 paise... 1.00 rupee over 3 months times 12 is 4.00; use 100 paise over 8 months: 100 * 12 / 8 = 150.
    const credits = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month, at) => credit('a', 'business', at === 0 ? 1 : 0, `${month}-03`));
    expect(yearlyBusiness(credits.filter((c) => c.amountMinor > 0n), 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'average', yearlyMinor: 150n });
  });
});

describe('memberYearlyIncome', () => {
  it('LI-I9 — the usual salary times twelve is ₹17,04,000, and adding the business months gives ₹31,44,000', () => {
    const credits = [
      ...salaries('a', ['2026-05', 142_000], ['2026-06', 142_000], ['2026-07', 138_450], ['2026-08', 142_000], ['2026-09', 210_000], ['2026-10', 142_000]),
      ...['2025-11', '2025-12', '2026-01', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => credit('a', 'business', 144_000, `${m}-03`)),
    ];
    const salaryOnly = memberYearlyIncome(credits.filter((c) => c.category === 'salary'), 'a', 'INR', '2026-11-13');
    expect(salaryOnly).toMatchObject({ kind: 'income', salaryMinor: paise(1_704_000), businessMinor: 0n, totalMinor: paise(1_704_000) });
    expect(memberYearlyIncome(credits, 'a', 'INR', '2026-11-13')).toMatchObject({ kind: 'income', totalMinor: paise(3_144_000) });
  });

  it('LI-I9 — a year later, with no new credit, the salary figure is unchanged: it is never grown by inflation', () => {
    const credits = salaries('a', ['2026-05', 142_000], ['2026-06', 142_000], ['2026-07', 142_000]);
    const now = memberYearlyIncome(credits, 'a', 'INR', '2026-11-13');
    const later = memberYearlyIncome(credits, 'a', 'INR', '2027-11-13');
    expect(later).toEqual(now);
  });

  it('with no Salary or Business income credit there is no yearly income: never zero, never an estimate', () => {
    expect(memberYearlyIncome([credit('a', 'interest', 5_000, '2026-10-01')], 'a', 'INR', '2026-11-13')).toEqual({ kind: 'none' });
  });
});

describe('householdYearlyIncome: the same rule as the database, to the same vectors', () => {
  // Household T of the pgTAP file, as at 13 November 2026.
  const fixture: IncomeCredit[] = [
    ...salaries('c1', ['2026-05', 142_000], ['2026-06', 142_000], ['2026-07', 138_450], ['2026-08', 142_000], ['2026-09', 210_000], ['2026-10', 142_000]),
    ...salaries('c2', ['2026-05', 130_000], ['2026-06', 130_000], ['2026-07', 130_000], ['2026-08', 150_000], ['2026-09', 150_000], ['2026-10', 150_000]),
    ...salaries('c3', ['2026-04', 100_000], ['2026-05', 100_000], ['2026-06', 110_000], ['2026-07', 120_000], ['2026-08', 130_000], ['2026-09', 140_000], ['2026-10', 150_000]),
    ...['2025-11', '2025-12', '2026-01', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => credit('c1', 'business', 144_000, `${m}-03`)),
    credit('c1', 'business', 999_000, '2026-11-05'),
    ...['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => credit('c2', 'business', 108_000, `${m}-03`)),
  ];

  it('is the sum over the earners: usual salary times twelve and business over the last twelve complete months', () => {
    expect(householdYearlyIncome(fixture, 'INR', '2026-11-13')).toEqual({ salaryMinor: 530_400_000n, businessMinor: 273_600_000n });
  });

  it('a month later the window has moved on: November 2025 drops out and the November credit counts', () => {
    expect(householdYearlyIncome(fixture, 'INR', '2026-12-05')?.businessMinor).toBe(337_500_000n);
  });

  it('says nothing when nobody has an income credit yet, and reads only the currency it is asked for', () => {
    expect(householdYearlyIncome(fixture, 'INR', '2025-01-01')).toBeNull();
    expect(householdYearlyIncome(fixture, 'USD', '2026-11-13')).toBeNull();
  });
});

describe('taxInputInForce', () => {
  const row = (source: 'payslip' | 'form16' | 'typed', rupees: number, tds: number | null = null) => ({
    head: 'salary' as const,
    amountMinor: paise(rupees),
    tdsMinor: tds === null ? null : paise(tds),
    source,
  });

  it('the payslip figure is in force until a Form 16 figure is typed', () => {
    expect(taxInputInForce([row('payslip', 2_280_000)], 'salary')).toMatchObject({ source: 'payslip', amountMinor: paise(2_280_000), was: null });
  });

  it('a Form 16 figure takes precedence, and the payslip figure stays visible beside it as what it was', () => {
    const result = taxInputInForce([row('payslip', 2_280_000), row('form16', 2_250_000, 310_000)], 'salary');
    expect(result).toMatchObject({ source: 'form16', amountMinor: paise(2_250_000), tdsMinor: paise(310_000) });
    expect(result?.was).toEqual({ source: 'payslip', amountMinor: paise(2_280_000) });
  });

  it('a typed figure is in force where there is no payslip (business and other sources)', () => {
    expect(taxInputInForce([{ head: 'business', amountMinor: paise(600_000), tdsMinor: null, source: 'typed' }], 'business')).toMatchObject({ source: 'typed' });
  });

  it('nothing typed is nothing in force, so the estimate covers only what is typed', () => {
    expect(taxInputInForce([], 'salary')).toBeNull();
    expect(taxInputInForce([row('payslip', 1)], 'business')).toBeNull();
  });
});

describe('checkTypedProfit', () => {
  it('a profit of nothing or more is accepted', () => {
    expect(checkTypedProfit(0n)).toEqual({ ok: true });
    expect(checkTypedProfit(paise(600_000))).toEqual({ ok: true });
  });

  it('a loss is refused by name, with its reason, and not guessed at', () => {
    const result = checkTypedProfit(-1n);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/loss/i);
  });
});
