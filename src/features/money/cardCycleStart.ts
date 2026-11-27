/**
 * Where a card's statement date starts, in words (docs/design/card-cycles.md 6.1; CY-I18). A card switched from month end keeps the months it was closed at month end, and starts on its statement
 * date from the month after its latest month-end due; the database sets that month when the card is switched, and this works out the same one beforehand, to say it. Pure.
 */

import { addMonths } from '../../domain/accrual.ts';
import { lastDayOf, monthWord } from './closeMonth.ts';

/** "November 2026". */
export function monthYear(month: string): string {
  return `${monthWord(month)} ${month.slice(0, 4)}`;
}

/** The month after the latest due dated on a month's last day (`YYYY-MM`), or null for a card with none: it is then on its statement date in every month. `dues` are days, `YYYY-MM-DD`. */
export function firstStatementMonth(dues: readonly string[]): string | null {
  const closes = dues.filter((day) => day === lastDayOf(day.slice(0, 7))).sort();
  const latest = closes[closes.length - 1];
  return latest === undefined ? null : addMonths(`${latest.slice(0, 7)}-01`, 1).slice(0, 7);
}

/** What changing a card's setting does, said before it is saved. */
export function cycleSwitchSentence(input: { readonly to: 'month_end' | 'statement'; readonly firstMonth: string | null }): string {
  if (input.to === 'month_end') {
    return 'This card will close at month end again. That is refused once a due is recorded on its statement date, because months already closed would change.';
  }
  if (input.firstMonth === null) return 'Every month will be worked out again with this card’s statements.';
  const before = addMonths(`${input.firstMonth}-01`, -1).slice(0, 7);
  return `Months up to ${monthYear(before)} stay as they were, closed at month end. From ${monthYear(input.firstMonth)} they are worked out with this card’s statements.`;
}

/** Whether a statement is dated in a month before the card's first month on its statement date: that month stays as it was closed. */
export function statementBeforeFirstMonth(statementDate: string, firstMonth: string | undefined): boolean {
  return firstMonth !== undefined && statementDate.slice(0, 7) < firstMonth;
}
