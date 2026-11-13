/**
 * How FIRE reads income, and which of Tax's typed figures is in force (docs/design/ledger-income.md sections 7 and 8).
 *
 * FIRE reads the credits the person entered in Money. Salary is the **usual** month's salary times twelve: a month's salary is the sum of
 * that member's Salary credits in the IST month, the months entered are those with more than nothing, and the usual amount is the one that
 * occurs most often among the last six months entered, compared to the paisa. On a tie the amount seen most recently wins, and when
 * nothing repeats that gives the latest month's, which the screen says. Business income is the total of the last 12 complete months,
 * starting no earlier than the month of the member's first Business income credit, or with fewer months their average times twelve,
 * labelled. The current month is never in the window. Neither is ever grown by inflation: a figure changes only when a credit does.
 *
 * The database holds the same rule for the Household view (`public.household_yearly_income`, a named exception to the rule that
 * calculations are pure functions, because the household total must not disclose each earner's months). This file is the rule for Mine,
 * and the two are held to the same vectors: supabase/tests/ledger_income.test.sql and income.test.ts. A change to the rule changes both.
 *
 * Tax does not read the credits, which are take-home: it takes gross figures typed per member and tax year, and this file says which is in
 * force. Pure: no I/O, no clock; the day is passed in. Money is integer minor units.
 */

import type { IsoDate } from '../lib/dates.ts';
import type { CreditCategory } from './credit.ts';

export interface IncomeCredit {
  readonly memberId: string;
  readonly category: CreditCategory;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly date: IsoDate;
}

const monthOf = (date: IsoDate): string => date.slice(0, 7);
const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthAt = (index: number): string => `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;

// ─────────────────────────────────────────────────────────────────────── salary

export interface SalaryMonth {
  readonly month: string;
  readonly totalMinor: bigint;
  /** Whether this month's salary is the usual amount, so the screen can say which months it came from. */
  readonly usual: boolean;
}

export type UsualSalary =
  | { readonly kind: 'none' }
  | {
      /** `usual`: an amount that came in more than once. `latest`: nothing repeats, so it is the latest month's, and the screen says so. */
      readonly kind: 'usual' | 'latest';
      readonly amountMinor: bigint;
      /** How many of the months counted had this amount. */
      readonly occurrences: number;
      /** How many months were counted: at most six. */
      readonly monthsCounted: number;
      /** The months counted, oldest first. */
      readonly months: readonly SalaryMonth[];
    };

/** The usual month's salary of one member in one currency, as at a day. */
export function usualSalary(credits: readonly IncomeCredit[], memberId: string, currency: string, asOf: IsoDate): UsualSalary {
  const totals = new Map<string, bigint>();
  for (const c of credits) {
    if (c.memberId !== memberId || c.currency !== currency || c.category !== 'salary' || c.date > asOf) continue;
    const month = monthOf(c.date);
    totals.set(month, (totals.get(month) ?? 0n) + c.amountMinor);
  }
  const entered = [...totals.entries()]
    .filter(([, total]) => total > 0n)
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, 6);
  if (entered.length === 0) return { kind: 'none' };

  // Each amount: how many of the months it occurred in, and the latest of them. Most often wins; on a tie, the most recent.
  const amounts = new Map<bigint, { n: number; latest: string }>();
  for (const [month, total] of entered) {
    const seen = amounts.get(total);
    amounts.set(total, { n: (seen?.n ?? 0) + 1, latest: seen === undefined || month > seen.latest ? month : seen.latest });
  }
  const [amountMinor, chosen] = [...amounts.entries()].sort(([, a], [, b]) => b.n - a.n || (a.latest < b.latest ? 1 : -1))[0] ?? [0n, { n: 0, latest: '' }];

  return {
    kind: chosen.n >= 2 ? 'usual' : 'latest',
    amountMinor,
    occurrences: chosen.n,
    monthsCounted: entered.length,
    months: [...entered].reverse().map(([month, totalMinor]) => ({ month, totalMinor, usual: totalMinor === amountMinor })),
  };
}

// ───────────────────────────────────────────────────────────────────── business

export interface BusinessMonth {
  readonly month: string;
  readonly totalMinor: bigint;
}

export type YearlyBusiness =
  | { readonly kind: 'none' }
  /** Only the current month is entered: the first figure comes when it ends. */
  | { readonly kind: 'waiting'; readonly firstMonth: string }
  | { readonly kind: 'full'; readonly yearlyMinor: bigint; readonly totalMinor: bigint; readonly monthsCounted: 12; readonly months: readonly BusinessMonth[] }
  /** Fewer than twelve months since the first: their total divided by their number, times twelve, and labelled as that. */
  | { readonly kind: 'average'; readonly yearlyMinor: bigint; readonly totalMinor: bigint; readonly monthsCounted: number; readonly months: readonly BusinessMonth[] };

/** Business income over the last 12 complete months, for one member in one currency, as at a day. */
export function yearlyBusiness(credits: readonly IncomeCredit[], memberId: string, currency: string, asOf: IsoDate): YearlyBusiness {
  const mine = credits.filter((c) => c.memberId === memberId && c.category === 'business' && c.date <= asOf);
  const here = mine.filter((c) => c.currency === currency);
  if (here.length === 0) return { kind: 'none' };

  // The member's first Business income credit, in any currency: the window starts no earlier than its month.
  const firstMonth = mine.map((c) => monthOf(c.date)).sort()[0] ?? monthOf(asOf);
  const thisMonth = monthIndex(monthOf(asOf));
  const start = Math.max(monthIndex(firstMonth), thisMonth - 12);
  const end = thisMonth - 1;
  if (start > end) return { kind: 'waiting', firstMonth };

  const months: BusinessMonth[] = [];
  for (let at = start; at <= end; at += 1) {
    const month = monthAt(at);
    months.push({ month, totalMinor: here.filter((c) => monthOf(c.date) === month).reduce((sum, c) => sum + c.amountMinor, 0n) });
  }
  const totalMinor = months.reduce((sum, m) => sum + m.totalMinor, 0n);
  if (months.length === 12) return { kind: 'full', yearlyMinor: totalMinor, totalMinor, monthsCounted: 12, months };

  // Half up, to the paisa: the same as the database's numeric round.
  const n = BigInt(months.length);
  return { kind: 'average', yearlyMinor: (totalMinor * 12n * 2n + n) / (2n * n), totalMinor, monthsCounted: months.length, months };
}

// ───────────────────────────────────────────────────────────────────── together

export type MemberYearlyIncome =
  /** No Salary and no Business income credit to read: FIRE shows its number without a yearly income, and never zero (LI-I10). */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'income';
      readonly salaryMinor: bigint;
      readonly businessMinor: bigint;
      readonly totalMinor: bigint;
      readonly salary: UsualSalary;
      readonly business: YearlyBusiness;
    };

/** One member's yearly income in one currency: the usual salary times twelve plus the business income. Never grown by inflation. */
export function memberYearlyIncome(credits: readonly IncomeCredit[], memberId: string, currency: string, asOf: IsoDate): MemberYearlyIncome {
  const salary = usualSalary(credits, memberId, currency, asOf);
  const business = yearlyBusiness(credits, memberId, currency, asOf);
  const hasBusiness = business.kind === 'full' || business.kind === 'average';
  if (salary.kind === 'none' && !hasBusiness) return { kind: 'none' };
  const salaryMinor = salary.kind === 'none' ? 0n : salary.amountMinor * 12n;
  const businessMinor = hasBusiness ? business.yearlyMinor : 0n;
  return { kind: 'income', salaryMinor, businessMinor, totalMinor: salaryMinor + businessMinor, salary, business };
}

/**
 * The household's yearly income in one currency: the sum over every earner (Household on the FIRE screen). Null when nobody has an
 * income credit to read. The database computes the same figure for an owner or a partner without disclosing a member's months.
 */
export function householdYearlyIncome(
  credits: readonly IncomeCredit[],
  currency: string,
  asOf: IsoDate,
): { readonly salaryMinor: bigint; readonly businessMinor: bigint } | null {
  let salaryMinor = 0n;
  let businessMinor = 0n;
  let any = false;
  for (const memberId of new Set(credits.map((c) => c.memberId))) {
    const income = memberYearlyIncome(credits, memberId, currency, asOf);
    if (income.kind === 'none') continue;
    any = true;
    salaryMinor += income.salaryMinor;
    businessMinor += income.businessMinor;
  }
  return any ? { salaryMinor, businessMinor } : null;
}

// ───────────────────────────────────────────────────────────────── Tax's figures

export type TaxHead = 'salary' | 'business' | 'other_sources';
export type TaxSource = 'payslip' | 'form16' | 'typed';

export interface TaxInputRow {
  readonly head: TaxHead;
  readonly amountMinor: bigint;
  readonly tdsMinor: bigint | null;
  readonly source: TaxSource;
}

export interface TaxInput {
  readonly amountMinor: bigint;
  readonly tdsMinor: bigint | null;
  readonly source: TaxSource;
  /** The payslip figure a Form 16 one replaced, kept in sight beside it (LI-I11); null when nothing was replaced. */
  readonly was: { readonly source: 'payslip'; readonly amountMinor: bigint } | null;
}

const PRECEDENCE: readonly TaxSource[] = ['form16', 'payslip', 'typed'];

/**
 * The figure in force for a head: the Form 16 one if there is one, otherwise the payslip's (or the typed one, for business and other
 * sources). Null when nothing is typed, so the estimate covers only what is (LI-I11).
 */
export function taxInputInForce(rows: readonly TaxInputRow[], head: TaxHead): TaxInput | null {
  const mine = rows.filter((row) => row.head === head);
  for (const source of PRECEDENCE) {
    const row = mine.find((r) => r.source === source);
    if (row === undefined) continue;
    const payslip = source === 'form16' ? mine.find((r) => r.source === 'payslip') : undefined;
    return {
      amountMinor: row.amountMinor,
      tdsMinor: row.tdsMinor,
      source,
      was: payslip === undefined ? null : { source: 'payslip', amountMinor: payslip.amountMinor },
    };
  }
  return null;
}

/** A typed business profit is nothing or more. A loss is refused by name and not guessed at (LI-I19). */
export function checkTypedProfit(profitMinor: bigint): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (profitMinor >= 0n) return { ok: true };
  return { ok: false, reason: 'A loss is not handled by this estimate yet, so it is not guessed at. Type the profit, or leave it empty.' };
}
