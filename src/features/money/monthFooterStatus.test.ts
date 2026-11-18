import { describe, expect, it } from 'vitest';
import { accountsBadgeName, monthFooterStatus } from './monthFooter.ts';
import type { LastMonthView } from './lastMonth.ts';

/**
 * What the month card's footer says (docs/drafts/month-actions.md): a month waiting to be closed leads and has the one primary button; a closed month
 * says so and has none; anything else says nothing.
 */

const closedLast: LastMonthView = { kind: 'closed', month: '2026-10', cameIn: [], spent: [], saved: [], counted: 1, total: 1, unnamedEntries: 0 };
const openLast: LastMonthView = { kind: 'open', month: '2026-10', noAccounts: false };

describe('monthFooterStatus', () => {
  it('says a month is ready to close, with the time under it', () => {
    expect(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: true, lastMonth: openLast })).toEqual({
      kind: 'ready',
      title: 'October is ready to close',
      sub: 'from your balances · about 2 minutes',
    });
  });

  it('says it is closed, and where its figures came from, when there is nothing to close and Last month was closed', () => {
    expect(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: false, lastMonth: closedLast })).toEqual({
      kind: 'closed',
      title: 'October is closed',
      sub: 'from balances, 1 of 1 account',
    });
  });

  it('leads with the month to close, and never says closed beside it', () => {
    expect(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: true, lastMonth: closedLast })?.kind).toBe('ready');
  });

  it('says nothing when there is nothing to close and Last month is not closed, or is not known', () => {
    expect(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: false, lastMonth: openLast })).toBeNull();
    expect(monthFooterStatus({ closeMonthKey: '2026-10', mayClose: false, lastMonth: null })).toBeNull();
  });
});

describe('accountsBadgeName', () => {
  it('names what the figure counts', () => {
    expect(accountsBadgeName(1)).toBe('1 account');
    expect(accountsBadgeName(3)).toBe('3 accounts');
  });
});
