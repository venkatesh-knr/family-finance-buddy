import { addDays, type IsoDate } from '../../lib/dates.ts';
import type { ParsedStatement, StatementLine } from './common.ts';

/**
 * The balances a statement states (docs/design/spending-capture.md section 2; ledger-income.md section 1a). The month close reads an account's balance on the last day of a month and on
 * the last day of the month before, and prefers one a statement states to one a person typed. A pure function of the parsed statement; nothing is guessed.
 *
 * - A **bank** statement that prints a balance on every line gives the balance at the end of any day it covers: that of the last line on or before the day. So it states the balance on
 *   its own last day (`closing`), at each month end it crosses (`month-end`), and on the day before it begins (`opening`, worked back from its first line).
 * - A **card** statement states what is due on its statement date (`due`), which is the card's balance: positive owed, negative in credit.
 *
 * A statement with a problem, with a line that has no balance, or whose lines are not in date order states nothing, because its running figure is then not the statement's own.
 */
export interface StatedBalance {
  readonly asAt: IsoDate;
  readonly balanceMinor: bigint;
  readonly basis: 'closing' | 'month-end' | 'opening' | 'due';
}

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

export function statedBalances(statement: ParsedStatement): readonly StatedBalance[] {
  if (statement.problems.length > 0) return [];

  if (statement.accountType === 'card') {
    const card = statement.card;
    const asAt = card?.statementDate ?? statement.periodEnd;
    if (card === undefined || asAt === null) return [];
    return [{ asAt, balanceMinor: card.totalDueMinor, basis: 'due' }];
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
