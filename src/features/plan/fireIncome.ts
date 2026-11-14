/**
 * What FIRE says about income (docs/design/ledger-income.md section 7; the FireIncome and FireBusiness boards).
 *
 * Pure: the credits and the day are passed in, and nothing here reads a database or a clock. The arithmetic is `src/domain/income.ts`'s;
 * this turns it into what the screen says: the yearly income with its working, where the usual amount came from, each month marked usual
 * or not, business income over its twelve months with *nothing drawn* beside an empty one, and *a year, side by side*. Never grown by
 * inflation, never a guess, and never zero when there is nothing to read (LI-I10).
 */

import { memberYearlyIncome, usualSalary, yearlyBusiness, type IncomeCredit } from '../../domain/income.ts';
import type { IsoDate } from '../../lib/dates.ts';
import { formatMoney, money, type Money } from '../../lib/money.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

const monthLabel = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;
const monthName = (month: string): string => `${FULL_MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;
const word = (n: number): string => WORDS[n] ?? String(n);

export interface SalaryMonthLine {
  readonly label: string;
  readonly amount: Money;
  readonly usual: boolean;
  /** *usual* or *not the usual amount*: the word, so that a tick is never the only thing saying it. */
  readonly mark: string;
}

export interface SalaryView {
  readonly yearly: Money;
  readonly working: string;
  readonly origin: string;
  readonly months: readonly SalaryMonthLine[];
}

export interface BusinessMonthLine {
  readonly label: string;
  readonly amount: Money;
  /** *nothing drawn* beside a month that came to nothing. */
  readonly note: string | null;
}

export interface BusinessView {
  readonly kind: 'full' | 'average' | 'waiting';
  /** The months the figure covers, and that the current month joins when it ends; null while the first figure has not arrived. */
  readonly window: string | null;
  /** Null while the first figure has not arrived: it is never shown as nothing. */
  readonly yearly: Money | null;
  readonly working: string;
  readonly months: readonly BusinessMonthLine[];
}

export interface MineIncomeView {
  readonly kind: 'none' | 'income';
  readonly total: Money | null;
  readonly salary: SalaryView | null;
  readonly business: BusinessView | null;
}

/** One member's yearly income as the FIRE screen's Mine view says it. */
export function mineIncomeView(credits: readonly IncomeCredit[], memberId: string, currency: string, asOf: IsoDate, privacy: boolean): MineIncomeView {
  const income = memberYearlyIncome(credits, memberId, currency, asOf);
  const salary = usualSalary(credits, memberId, currency, asOf);
  const business = yearlyBusiness(credits, memberId, currency, asOf);

  const salaryView: SalaryView | null =
    salary.kind === 'none'
      ? null
      : {
          yearly: money(salary.amountMinor * 12n, currency),
          working: `${formatMoney(money(salary.amountMinor, currency), { privacy })} × 12 · never grown by inflation`,
          origin:
            salary.kind === 'usual'
              ? `came in ${word(salary.occurrences)} of the ${word(salary.monthsCounted)} months entered`
              : 'No amount repeats, so this is the latest month’s salary.',
          months: salary.months.map((month) => ({
            label: monthLabel(month.month),
            amount: money(month.totalMinor, currency),
            usual: month.usual,
            mark: month.usual ? 'usual' : 'not the usual amount',
          })),
        };

  const businessView: BusinessView | null =
    business.kind === 'none'
      ? null
      : business.kind === 'waiting'
        ? {
            kind: 'waiting',
            yearly: null,
            window: null,
            working: `Business income entered for ${monthName(business.firstMonth)} only. The first yearly figure comes when ${monthName(business.firstMonth)} ends.`,
            months: [],
          }
        : {
            kind: business.kind,
            yearly: money(business.yearlyMinor, currency),
            window: `${monthName(business.months[0]?.month ?? '')} to ${monthName(business.months[business.months.length - 1]?.month ?? '')}. ${monthName(asOf.slice(0, 7))} joins when it ends.`,
            working:
              business.kind === 'full'
                ? 'Business income, last 12 months · never grown by inflation'
                : `average of ${String(business.monthsCounted)} months × 12 · never grown by inflation`,
            months: business.months.map((month) => ({
              label: monthLabel(month.month),
              amount: money(month.totalMinor, currency),
              note: month.totalMinor === 0n ? 'nothing drawn' : null,
            })),
          };

  // Nothing that counts: no salary, and a business window with nothing in it, which is not an income of nothing (LI-I10).
  if (income.kind === 'none' || income.totalMinor === 0n) return { kind: 'none', total: null, salary: salaryView, business: businessView };
  return { kind: 'income', total: money(income.totalMinor, currency), salary: salaryView, business: businessView };
}

/**
 * The currencies a member has Salary or Business income in besides the one FIRE is reading. FIRE reads income in one currency and converts
 * none, so the others are named rather than dropped in silence, and the screen does not say that no income was entered when there is some.
 */
export function otherCurrencyIncome(credits: readonly IncomeCredit[], memberId: string, currency: string): string[] {
  return [
    ...new Set(
      credits
        .filter((c) => c.memberId === memberId && c.currency !== currency && (c.category === 'salary' || c.category === 'business'))
        .map((c) => c.currency),
    ),
  ].sort();
}

export interface HouseholdIncomeView {
  readonly kind: 'none' | 'income';
  readonly total: Money | null;
  /** The two figures the sum function returns, and nothing about a member or a month (the household total must not disclose them). */
  readonly lines: readonly { readonly label: string; readonly amount: Money }[];
}

/** The household's yearly income, from the sum function, as the FIRE screen's Household view says it. */
export function householdIncomeView(totals: { readonly yearlySalary: Money; readonly yearlyBusiness: Money } | null): HouseholdIncomeView {
  if (totals === null) return { kind: 'none', total: null, lines: [] };
  const lines = [
    ...(totals.yearlySalary.minor === 0n ? [] : [{ label: 'Salary', amount: totals.yearlySalary }]),
    ...(totals.yearlyBusiness.minor === 0n ? [] : [{ label: 'Business income', amount: totals.yearlyBusiness }]),
  ];
  if (lines.length === 0) return { kind: 'none', total: null, lines: [] };
  return { kind: 'income', total: money(totals.yearlySalary.minor + totals.yearlyBusiness.minor, totals.yearlySalary.currency), lines };
}

export interface SideBySide {
  readonly comesIn: Money;
  /** What the income is, under the figure: *usual salary × 12*, *business income, last 12 months*, *the two added*, *the household’s, added*. */
  readonly comesInNote: string;
  readonly spent: Money;
  readonly difference: Money;
  readonly note: string;
}

/**
 * *A year, side by side*: what comes in, what is spent from the plan, and the difference. Arithmetic only: FIRE never says what to do with it.
 * Nothing for a plan with nothing in it: there is no spent from the plan, and the difference would be the whole income (LI-I10).
 */
export function sideBySide(
  yearlyIncome: Money | null,
  annualExpense: Money | null,
  comesFrom: 'salary' | 'business' | 'both' | 'household',
): SideBySide | null {
  if (yearlyIncome === null || annualExpense === null || annualExpense.minor <= 0n || yearlyIncome.currency !== annualExpense.currency) return null;
  const notes = { salary: 'usual salary × 12', business: 'business income, last 12 months', both: 'the two added', household: 'the household’s, added' } as const;
  return {
    comesIn: yearlyIncome,
    comesInNote: notes[comesFrom],
    spent: annualExpense,
    difference: money(yearlyIncome.minor - annualExpense.minor, yearlyIncome.currency),
    note: 'arithmetic only, not advice',
  };
}
