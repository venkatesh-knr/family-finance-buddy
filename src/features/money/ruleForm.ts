/**
 * The salary rule and its expected credits (docs/design/ledger-income.md section 5; the SalaryRule board and the Expected panel of MoneyLedger).
 *
 * Pure: the day is passed in, and nothing here reads a database or a clock. A credit rule reminds and never posts (LI-I8): when it is due it
 * shows an expected credit, which is not a row and counts nowhere until a person confirms it.
 */

import { CREDIT_LABEL, type CreditCategory } from '../../domain/credit.ts';
import { expectedCredits, nextDueAfter } from '../../domain/credit-rule.ts';
import { cadenceMonths } from '../../domain/recurring.ts';
import { formatShortDate } from '../../lib/dates.ts';
import { formatMoney, type Money } from '../../lib/money.ts';
import type { Account, IncomeRule, Visibility } from '../../repo/types.ts';
import { titleOf } from './accountRows.ts';

/** A payday as a person says it: "1st of the month", "22nd of the month". A day is from 1 to 28, so that it falls in every month. */
export function ordinalDay(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${String(day)}${suffix} of the month`;
}

/** The days a payday can be: 1 to 28. */
export const PAYDAYS: readonly number[] = Array.from({ length: 28 }, (_, index) => index + 1);


const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * The first payday a new rule falls due on, after the credit it repeats: the same month's payday when that is after the credit's day,
 * otherwise next month's. A credit of an earlier month therefore gives a payday that is already due, and it is expected at once.
 */
export function firstDueAfter(creditDate: string, payday: number): string {
  const year = Number(creditDate.slice(0, 4));
  const month = Number(creditDate.slice(5, 7));
  const day = Number(creditDate.slice(8, 10));
  if (payday > day) return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(payday)}`;
  const index = year * 12 + (month - 1) + 1;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad((index % 12) + 1)}-${pad(payday)}`;
}

/** *Repeats every month*, from a credit just entered: its day is the payday (the 28th at most) and the rule first falls due a month on. */
export function dueAfterCredit(creditDate: string): { payday: number; firstDue: string } {
  const payday = Math.min(Number(creditDate.slice(8, 10)), 28);
  return { payday, firstDue: firstDueAfter(creditDate, payday) };
}

export interface RuleDraft {
  readonly name: string;
  readonly category: CreditCategory;
  readonly memberId: string;
  readonly accountId: string | null;
  readonly amount: Money;
  readonly visibility: Visibility;
  readonly payday: string;
  /** The day of the credit the rule repeats: the rule first falls due after it. */
  readonly creditDate: string;
}

/** The rule a credit just entered becomes, for the form to open with: named for the payer, or for its kind when it had none. */
export function ruleFromCredit(credit: {
  readonly payer: string | null;
  readonly category: CreditCategory;
  readonly memberId: string;
  readonly accountId: string | null;
  readonly amount: Money;
  readonly visibility: Visibility;
  readonly date: string;
}): RuleDraft {
  const payer = credit.payer?.trim() ?? '';
  return {
    name: payer === '' ? CREDIT_LABEL[credit.category] : payer,
    category: credit.category,
    memberId: credit.memberId,
    accountId: credit.accountId,
    amount: credit.amount,
    visibility: credit.visibility,
    payday: String(dueAfterCredit(credit.date).payday),
    creditDate: credit.date,
  };
}

export interface ExpectedRow {
  readonly ruleId: string;
  readonly dueDate: string;
  /**
   * Whether Confirm, Change amount and Not this month apply to this row. A rule moves on one due date at a time, from its next due, so only
   * a rule's oldest due date can be acted on; a later one waits for it.
   */
  readonly actionable: boolean;
  readonly title: string;
  readonly sub: string;
  readonly amount: string;
  readonly word: string;
}

/**
 * What is waiting to be confirmed: each active rule's due dates up to today, oldest first, so a rule three months behind lists three. A due
 * date that already has a credit is not waiting, a voided one included, since it holds the date. A paused or archived rule expects nothing,
 * and neither does one that is not yet due.
 */
export function expectedRows(
  rules: readonly IncomeRule[],
  context: {
    readonly accounts: readonly Account[];
    readonly today: string;
    readonly privacy: boolean;
    /** The credits the caller can read, for the rule and due date each answers. */
    readonly credits: readonly { readonly ruleId: string | null; readonly dueDate: string | null }[];
  },
): ExpectedRow[] {
  const rows: ExpectedRow[] = [];
  const held = new Set(context.credits.filter((c) => c.ruleId !== null && c.dueDate !== null).map((c) => `${String(c.ruleId)}|${String(c.dueDate)}`));
  for (const rule of rules) {
    const account = rule.accountId === null ? null : (context.accounts.find((each) => each.id === rule.accountId) ?? null);
    const where = rule.accountId === null ? 'no account' : account === null ? 'an account' : titleOf(account);
    const due = expectedCredits(
      { id: rule.id, name: rule.name, amountMinor: rule.amount.minor, cadence: rule.cadence, dueDay: rule.dueDay, nextDue: rule.nextDue, status: rule.status },
      context.today,
    );
    let oldest = true;
    for (const dueDate of due) {
      if (held.has(`${rule.id}|${dueDate}`)) continue;
      rows.push({
        ruleId: rule.id,
        dueDate,
        actionable: oldest,
        title: rule.name,
        sub: `${where} · due ${formatShortDate(dueDate)} · not counted yet`,
        amount: formatMoney(rule.amount, { privacy: context.privacy }),
        word: 'expected',
      });
      oldest = false;
    }
  }
  return rows.sort((a, b) => (a.dueDate === b.dueDate ? a.title.localeCompare(b.title) : a.dueDate < b.dueDate ? -1 : 1));
}

export interface HistoryLine {
  readonly dueDate: string;
  /** What became of this due date, in the board's words. */
  readonly word: string;
  /** The credit's figure with its sign, the rule's figure for a date still to come, or a dash where nothing counted. */
  readonly amount: string;
  readonly note: string | null;
}

const HISTORY_LINES = 12;

const pad2 = (value: number): string => String(value).padStart(2, '0');
const monthIndex = (date: string): number => Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1);
const monthKey = (index: number): string => `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad2((index % 12) + 1)}`;

/**
 * A rule's due dates and what came of each: *Its credits* on the SalaryRule board. Worked out from the dates and the credits, never stored
 * (ledger-income.md section 5). Every credit is listed by the due date it recorded, so a payday that was changed later does not lose one:
 * confirmed, confirmed at a different amount (the rule's amount is today's, so the line says *rule now*, not what it said then), or voided
 * (a voided credit holds its date and does not count). A period between the first credit and the rule's next due that has none was passed
 * over: *not this month*, nothing posted, said only on a rule the viewer owns, because on another member's rule the credit may be one they
 * cannot read. An active rule then lists each date it is expecting up to today and the next to come. A paused rule expects nothing.
 * Newest first, the latest twelve. Dates before the rule's first credit are not listed: the rule does not keep its first due date.
 */
export function ruleHistory(
  rule: IncomeRule,
  credits: readonly { readonly ruleId: string | null; readonly dueDate: string | null; readonly amount: Money; readonly isVoided: boolean }[],
  context: { readonly today: string; readonly privacy: boolean; readonly viewerMemberId: string },
): HistoryLine[] {
  const mine = credits.filter((c) => c.ruleId === rule.id && c.dueDate !== null) as readonly { dueDate: string; amount: Money; isVoided: boolean }[];
  const figure = (value: Money): string => formatMoney(value, { privacy: context.privacy });
  const lines: HistoryLine[] = [];
  const dated = new Set<string>();

  // Each due date that has a credit, as the credit recorded it. A live credit beats a voided one for the same date.
  for (const dueDate of [...new Set(mine.map((c) => c.dueDate))]) {
    dated.add(dueDate);
    const live = mine.find((c) => c.dueDate === dueDate && !c.isVoided);
    if (live === undefined) {
      lines.push({ dueDate, word: 'voided', amount: '—', note: 'not counted' });
    } else if (live.amount.minor === rule.amount.minor) {
      lines.push({ dueDate, word: 'confirmed', amount: `+${figure(live.amount)}`, note: null });
    } else {
      lines.push({ dueDate, word: 'confirmed at a different amount', amount: `+${figure(live.amount)}`, note: `rule now ${figure(rule.amount)}` });
    }
  }

  // A period from the first credit up to the rule's next due with no credit in it was passed over.
  const first = [...dated].sort()[0];
  if (first !== undefined) {
    const withCredit = new Set([...dated].map((d) => d.slice(0, 7)));
    const step = cadenceMonths(rule.cadence);
    for (let at = monthIndex(first); at < monthIndex(rule.nextDue); at += step) {
      const key = monthKey(at);
      if (withCredit.has(key)) continue;
      const dueDate = `${key}-${pad2(rule.dueDay)}`;
      lines.push(
        rule.memberId === context.viewerMemberId
          ? { dueDate, word: 'not this month', amount: '—', note: 'nothing posted' }
          : { dueDate, word: 'no credit shown to you', amount: '—', note: null },
      );
    }
  }

  // An active rule expects each date from its next due up to today, and then the next to come.
  if (rule.status === 'active') {
    let at = rule.nextDue;
    for (let count = 0; at <= context.today && count < 24; count += 1) {
      if (!dated.has(at)) lines.push({ dueDate: at, word: 'expected', amount: figure(rule.amount), note: 'not counted yet' });
      at = nextDueAfter(at, rule.dueDay, rule.cadence);
    }
    if (!dated.has(at)) lines.push({ dueDate: at, word: 'upcoming', amount: figure(rule.amount), note: null });
  }

  return lines.sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0)).slice(0, HISTORY_LINES);
}

export interface RuleListRow {
  readonly ruleId: string;
  readonly title: string;
  readonly sub: string;
}

/** The rules in use or paused, by name, with the usual amount and when each is next due, so that one that is not due can be reached. */
export function ruleListRows(rules: readonly IncomeRule[], context: { readonly accounts: readonly Account[]; readonly privacy: boolean }): RuleListRow[] {
  return rules
    .filter((rule) => rule.status !== 'archived')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((rule) => ({
      ruleId: rule.id,
      title: rule.name,
      sub: `${formatMoney(rule.amount, { privacy: context.privacy })} · ${rule.status === 'paused' ? 'paused, it expects nothing' : `next due ${formatShortDate(rule.nextDue)}`}`,
    }));
}
