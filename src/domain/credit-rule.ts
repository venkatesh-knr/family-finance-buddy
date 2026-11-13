/**
 * A recurring credit, the salary rule (docs/design/ledger-income.md section 5).
 *
 * A credit rule never posts by itself (LI-I8): a due rule shows an **expected** credit, which is not a row and counts nowhere until a
 * person confirms it, so a salary that varies a little never reaches the month, FIRE or the household total unconfirmed. This is the
 * arithmetic a screen needs of it: which due dates are expected, what each past one came to (worked out from the dates and the credits,
 * never stored), and what the reminder says, which names the rule and never an amount (LI-I14). Pure: the day is passed in.
 */

import type { IsoDate } from '../lib/dates.ts';
import { cadenceMonths, type Cadence } from './recurring.ts';

export interface CreditRule {
  readonly id: string;
  readonly name: string;
  readonly amountMinor: bigint;
  readonly cadence: Cadence;
  /** The day of the month it is due: 1 to 28. */
  readonly dueDay: number;
  /** The next due date not yet confirmed or passed over. */
  readonly nextDue: IsoDate;
  readonly status: 'active' | 'paused' | 'archived';
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** The due date after one on `dueDay`, a period on. */
export function nextDueAfter(date: IsoDate, dueDay: number, cadence: Cadence): IsoDate {
  const index = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) + cadenceMonths(cadence);
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1, 2)}-${pad(dueDay, 2)}`;
}

/** How many due dates are listed at most: a rule left for years does not list for ever. */
const MOST_LISTED = 24;

/**
 * The due dates that are expected: each from the rule's next due up to today, oldest first. A rule three months behind lists three.
 * A paused or archived rule expects nothing.
 */
export function expectedCredits(rule: CreditRule, today: IsoDate): IsoDate[] {
  if (rule.status !== 'active') return [];
  const due: IsoDate[] = [];
  let at = rule.nextDue;
  while (at <= today && due.length < MOST_LISTED) {
    due.push(at);
    at = nextDueAfter(at, rule.dueDay, rule.cadence);
  }
  return due;
}

export type DueStatus = 'expected' | 'confirmed' | 'confirmed-different' | 'passed-over' | 'upcoming';

export interface DueLine {
  readonly dueDate: IsoDate;
  readonly status: DueStatus;
  /** For a confirmed date: what the credit was, and what the rule says, so a different amount can be shown beside it. */
  readonly creditAmountMinor?: bigint;
  readonly ruleAmountMinor?: bigint;
}

/**
 * What each due date came to. *Expected* is a date from the rule's next due up to today with no credit. *Confirmed* has a credit at the
 * rule's amount, and *confirmed at a different amount* has one at another. *Passed over* is a date before the rule's next due with no
 * credit: it was moved past ("not this month") and wrote nothing. A date after today is *upcoming*.
 */
export function dueHistory(
  rule: CreditRule,
  credits: readonly { readonly dueDate: IsoDate; readonly amountMinor: bigint }[],
  window: { readonly from: IsoDate; readonly today: IsoDate; readonly through?: IsoDate },
): DueLine[] {
  const through = window.through ?? window.today;
  const byDue = new Map(credits.map((c) => [c.dueDate, c.amountMinor] as const));
  const lines: DueLine[] = [];
  let at = window.from;
  while (at <= through && lines.length < 120) {
    const credited = byDue.get(at);
    if (credited !== undefined) {
      lines.push(
        credited === rule.amountMinor
          ? { dueDate: at, status: 'confirmed', creditAmountMinor: credited, ruleAmountMinor: rule.amountMinor }
          : { dueDate: at, status: 'confirmed-different', creditAmountMinor: credited, ruleAmountMinor: rule.amountMinor },
      );
    } else if (at > window.today) {
      lines.push({ dueDate: at, status: 'upcoming' });
    } else if (at < rule.nextDue) {
      lines.push({ dueDate: at, status: 'passed-over' });
    } else {
      lines.push({ dueDate: at, status: 'expected' });
    }
    at = nextDueAfter(at, rule.dueDay, rule.cadence);
  }
  return lines;
}

/**
 * The payday reminder. It names the rule and never an amount: no figure in a notification or an email (LI-I14), so it says today,
 * tomorrow or soon and does not count the days.
 */
export function reminderText(ruleName: string, daysUntilDue: number): string {
  const when = daysUntilDue <= 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : 'soon';
  return `${ruleName} is due ${when}.`;
}
