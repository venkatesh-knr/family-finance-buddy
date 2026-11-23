import { addDays, type IsoDate } from '../../lib/dates.ts';
import type { ParsedStatement, StatementLine } from './common.ts';
import { isEmiConversionCredit, isEmiPrincipalDebit } from './match.ts';

/**
 * The balances a statement states (docs/design/spending-capture.md section 2; ledger-income.md section 1a). The month close reads an account's balance on the last day of a month and on
 * the last day of the month before, and prefers one a statement states to one a person typed. A pure function of the parsed statement; nothing is guessed.
 *
 * - A **bank** statement that prints a balance on every line gives the balance at the end of any day it covers: that of the last line on or before the day. So it states the balance on
 *   its own last day (`closing`), at each month end it crosses (`month-end`), and on the day before it begins (`opening`, worked back from its first line).
 * - A **card** statement states what is due on its statement date (`due`), which is the card's balance: positive owed, negative in credit.
 *
 * Only a balance dated on the **last day of a month that has ended** is stated. That is the only day the month close reads, and the cash reserve takes an account's latest balance on or
 * before a month end, so a balance dated mid-month would be read as the month end's and skew it (a card's due on its statement date, for one). A card whose statement is not dated on a
 * month end states nothing, unless the card closes on its statement date (card-cycles.md 5, below).
 *
 * A statement with a problem, with a line that has no balance, or whose lines are not in date order states nothing, because its running figure is then not the statement's own.
 *
 * **A card that closes on its statement date** (docs/design/card-cycles.md 5; CY-I10) is the exception to the month-end rule: its close reads the cycle of its statement, so it states its
 * due on its statement date (`due`) and what was due at the start of the period on the day before the period begins (`opening`, the statement's own printed previous balance), whatever
 * day of the month either is. A statement that does not print its period dates the previous balance one month before the statement date (clamped to the month), and never after the day
 * before its first line. The due carries what the cycle converted to EMI plans and the principal of the instalments it billed (4a), from the lines. A card that closes at month end is as above.
 */
export interface StatedBalance {
  readonly asAt: IsoDate;
  readonly balanceMinor: bigint;
  readonly basis: 'closing' | 'month-end' | 'opening' | 'due';
  /** For a statement-date card's due: what the cycle converted to EMI plans, and the principal of the instalments billed in it. Absent is none. */
  readonly emiConvertedMinor?: bigint;
  readonly emiPrincipalMinor?: bigint;
}

/** When a card's month closes: at month end, or on its statement date. The setting of the account the statement is of (card-cycles.md 2.1). */
export type CycleEnds = 'month_end' | 'statement';

const lastDayOfMonth = (day: IsoDate): IsoDate => {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const next = month === 12 ? `${String(year + 1)}-01-01` : `${String(year)}-${String(month + 1).padStart(2, '0')}-01`;
  return addDays(next as IsoDate, -1);
};

/** Every month's last day from the one on or after `from` up to `to`. */
function monthEnds(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  let day = lastDayOfMonth(from);
  while (day <= to) {
    out.push(day);
    day = lastDayOfMonth(addDays(day, 1));
  }
  return out;
}

const sign = (line: StatementLine): bigint => (line.direction === 'credit' ? line.amountMinor : -line.amountMinor);

/** What the caller knows that the statement does not say (card-cycles.md 2.1, 4a). */
export interface StatedOptions {
  /** The day of the card's latest recorded due before this statement: where a statement that prints no period opens, since that statement's due is this one's previous balance. */
  readonly previousDue?: IsoDate | undefined;
  /** Whether a line the statement shows as an EMI conversion or an instalment's principal is still one: a line the person added as something else is not counted. All are by default. */
  readonly countsAsEmi?: ((line: StatementLine) => boolean) | undefined;
}

export function statedBalances(statement: ParsedStatement, today: IsoDate, cycleEnds: CycleEnds = 'month_end', options: StatedOptions = {}): readonly StatedBalance[] {
  if (statement.accountType === 'card' && cycleEnds === 'statement') return statedOnItsCycle(statement, options).filter((stated) => stated.asAt <= today);
  return statedOnAnyDay(statement, options).filter((stated) => stated.asAt === lastDayOfMonth(stated.asAt) && stated.asAt < today);
}

/** The same day one month earlier, clamped to that month's length: the 31st of March is the 28th of February. */
function monthBefore(day: IsoDate): IsoDate {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const dom = Number(day.slice(8, 10));
  const earlier = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const last = Number(lastDayOfMonth(`${String(earlier.y)}-${String(earlier.m).padStart(2, '0')}-01` as IsoDate).slice(8, 10));
  return `${String(earlier.y)}-${String(earlier.m).padStart(2, '0')}-${String(Math.min(dom, last)).padStart(2, '0')}` as IsoDate;
}

/**
 * The day the cycle opens on, which is the day of the previous statement: the day before the period where the statement prints it, otherwise the day of the card's earlier recorded
 * statement, otherwise one month before this one. A line dated before the period is no evidence of where it began (a late-posted purchase is listed under its own date).
 */
function openingDayOf(statement: ParsedStatement, asAt: IsoDate, previousDue: IsoDate | undefined): IsoDate {
  if (statement.periodStart !== null) return addDays(statement.periodStart, -1);
  return previousDue !== undefined && previousDue < asAt ? previousDue : monthBefore(asAt);
}

/** A card that closes on its statement date: its due on its statement date and its previous balance the day before its period, from the statement alone. */
function statedOnItsCycle(statement: ParsedStatement, options: StatedOptions): readonly StatedBalance[] {
  if (statement.problems.length > 0) return [];
  const card = statement.card;
  const asAt = card?.statementDate ?? statement.periodEnd;
  if (card === undefined || asAt === null) return [];

  const openingDay = openingDayOf(statement, asAt, options.previousDue);
  return [{ asAt: openingDay, balanceMinor: card.previousBalanceMinor, basis: 'opening' }, { asAt, balanceMinor: card.totalDueMinor, basis: 'due', ...emiOf(statement, options) }];
}

/** What a card statement's lines converted to EMI plans and the principal of the instalments it billed, for the due that carries them (card-cycles.md 4a). Only the lines still counted as EMI lines. */
function emiOf(statement: ParsedStatement, options: StatedOptions): { readonly emiConvertedMinor?: bigint; readonly emiPrincipalMinor?: bigint } {
  const counts = options.countsAsEmi ?? (() => true);
  const converted = statement.lines.filter((line) => line.direction === 'credit' && isEmiConversionCredit(line.raw) && counts(line)).reduce((total, line) => total + line.amountMinor, 0n);
  const principal = statement.lines.filter((line) => line.direction === 'debit' && isEmiPrincipalDebit(line.raw) && counts(line)).reduce((total, line) => total + line.amountMinor, 0n);
  return { ...(converted > 0n ? { emiConvertedMinor: converted } : {}), ...(principal > 0n ? { emiPrincipalMinor: principal } : {}) };
}

/**
 * What the preview says of a card statement (card-cycles.md 5), as the facts and not the words: for a card that closes on its statement date, that its statement closes its month and, where a
 * due was typed for the same cycle, that the statement replaces it, by how much they differ; for a card that closes at month end, that a statement dated on a month end closes that
 * month, and that one dated on any other day gives the close nothing, which is when the switch to the statement date is offered. A typed due in the same month is the same cycle, whatever
 * day each is dated (CY-I13).
 */
export type CardNote =
  | { readonly kind: 'closes'; readonly asAt: IsoDate; readonly dueMinor: bigint }
  | { readonly kind: 'gives-nothing'; readonly asAt: IsoDate; readonly dueMinor: bigint }
  | { readonly kind: 'replaces-typed'; readonly typedAsAt: IsoDate; readonly typedMinor: bigint; readonly asAt: IsoDate; readonly dueMinor: bigint; readonly differenceMinor: bigint };

/**
 * What is written of a card's statement balances, given the days the card already has a statement's balance on. A previous balance that opens a cycle is the previous statement's due, so
 * it never replaces a statement row already there for that day, which may carry the cycle's EMI figures that the opening does not (card-cycles.md 2.1: each cycle stands on its own, so
 * the order statements are imported in changes nothing). A due always replaces what was there, an opening included.
 */
export function balanceWrites(stated: readonly StatedBalance[], existingStatementDays: ReadonlySet<IsoDate>): StatedBalance[] {
  return stated.filter((each) => each.basis !== 'opening' || !existingStatementDays.has(each.asAt));
}

export function cardNotes(
  statement: ParsedStatement,
  cycleEnds: CycleEnds,
  typedDues: readonly { readonly asAt: IsoDate; readonly balanceMinor: bigint }[],
  previousDue?: IsoDate,
): CardNote[] {
  const card = statement.card;
  if (statement.accountType !== 'card' || statement.problems.length > 0 || card === undefined) return [];
  const asAt = card.statementDate ?? statement.periodEnd;
  if (asAt === null) return [];
  const dueMinor = card.totalDueMinor;

  if (cycleEnds === 'month_end') return [asAt === lastDayOfMonth(asAt) ? { kind: 'closes', asAt, dueMinor } : { kind: 'gives-nothing', asAt, dueMinor }];

  const notes: CardNote[] = [{ kind: 'closes', asAt, dueMinor }];
  const replaces = (typed: { readonly asAt: IsoDate; readonly balanceMinor: bigint }, stateAt: IsoDate, stateMinor: bigint): CardNote => {
    const difference = typed.balanceMinor - stateMinor;
    return { kind: 'replaces-typed', typedAsAt: typed.asAt, typedMinor: typed.balanceMinor, asAt: stateAt, dueMinor: stateMinor, differenceMinor: difference < 0n ? -difference : difference };
  };
  for (const typed of typedDues.filter((each) => each.asAt.slice(0, 7) === asAt.slice(0, 7))) notes.push(replaces(typed, asAt, dueMinor));
  // The previous balance is the previous statement's due, written for its own day, which may be in the month before: a due typed for that month is replaced too.
  const openingDay = openingDayOf(statement, asAt, previousDue);
  if (openingDay.slice(0, 7) !== asAt.slice(0, 7)) for (const typed of typedDues.filter((each) => each.asAt.slice(0, 7) === openingDay.slice(0, 7))) notes.push(replaces(typed, openingDay, card.previousBalanceMinor));
  return notes;
}

function statedOnAnyDay(statement: ParsedStatement, options: StatedOptions = {}): readonly StatedBalance[] {
  if (statement.problems.length > 0) return [];

  if (statement.accountType === 'card') {
    const card = statement.card;
    const asAt = card?.statementDate ?? statement.periodEnd;
    if (card === undefined || asAt === null) return [];
    return [{ asAt, balanceMinor: card.totalDueMinor, basis: 'due', ...emiOf(statement, options) }];
  }

  const lines = statement.lines;
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (first === undefined || last === undefined) return [];
  if (lines.some((line) => line.balanceMinor === null)) return [];
  for (let at = 1; at < lines.length; at += 1) if ((lines[at] as StatementLine).date < (lines[at - 1] as StatementLine).date) return [];

  const periodStart = statement.periodStart;
  const periodEnd = statement.periodEnd ?? last.date;
  const found = new Map<IsoDate, StatedBalance>();

  // What the balance was before the first line, which holds from the day before the period begins to the day before that line. Known only when no line comes before the period.
  const opening = periodStart !== null && first.date >= periodStart && first.balanceMinor !== null ? first.balanceMinor - sign(first) : null;
  const openingDay = periodStart === null ? null : addDays(periodStart, -1);

  // The balance at the end of a day: that after the last line on or before it.
  const at = (day: IsoDate): bigint | null => {
    if (day < first.date) return openingDay !== null && day >= openingDay ? opening : null;
    let balance: bigint | null = null;
    for (const line of lines) {
      if (line.date > day) break;
      balance = line.balanceMinor;
    }
    return balance;
  };

  const from = periodStart ?? first.date;
  for (const day of monthEnds(from, periodEnd)) {
    const balance = at(day);
    if (balance !== null) found.set(day, { asAt: day, balanceMinor: balance, basis: 'month-end' });
  }

  const closing = at(periodEnd);
  if (closing !== null) found.set(periodEnd, { asAt: periodEnd, balanceMinor: closing, basis: 'closing' });

  if (openingDay !== null && opening !== null && !found.has(openingDay)) found.set(openingDay, { asAt: openingDay, balanceMinor: opening, basis: 'opening' });

  return [...found.values()].sort((a, b) => (a.asAt < b.asAt ? -1 : a.asAt > b.asAt ? 1 : 0));
}
