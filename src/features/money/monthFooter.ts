/**
 * The foot of the Money month card (docs/drafts/month-actions.md; the MonthActions boards): what its status line says, and the name of the Accounts count.
 *
 * Pure: whether a month is waiting to be closed, and what Last month came to, are passed in. A month waiting to be closed says so, with the time it takes
 * under it, and has the one primary button; a closed month says it is closed and where its figures came from, and has none; anything else says nothing.
 */

import { monthWord } from './closeMonth.ts';
import { modeLine, type LastMonthView } from './lastMonth.ts';

export type MonthFooterStatus = { readonly kind: 'ready'; readonly title: string; readonly sub: string } | { readonly kind: 'closed'; readonly title: string; readonly sub: string } | null;

/**
 * The status line. A month to close leads, because it is the one thing with a deadline on it: *October is ready to close*, *from your balances · about 2
 * minutes*. When there is nothing to close and Last month was closed, it is *October is closed*, with where its figures came from. Otherwise there is no line.
 */
export function monthFooterStatus(input: { readonly closeMonthKey: string; readonly mayClose: boolean; readonly lastMonth: LastMonthView | null }): MonthFooterStatus {
  if (input.mayClose) {
    return { kind: 'ready', title: `${monthWord(input.closeMonthKey)} is ready to close`, sub: 'from your balances · about 2 minutes' };
  }
  const last = input.lastMonth;
  if (last !== null && last.kind === 'closed') {
    return { kind: 'closed', title: `${monthWord(last.month)} is closed`, sub: modeLine(last.counted, last.total) };
  }
  return null;
}

/** The count's accessible name: *1 account*, *3 accounts*. The badge shows the figure, and this says what it counts. */
export function accountsBadgeName(count: number): string {
  return `${String(count)} ${count === 1 ? 'account' : 'accounts'}`;
}
