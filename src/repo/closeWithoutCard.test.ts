import { describe, expect, it } from 'vitest';
import { MalformedRowError } from '../lib/guards.ts';
import { toCloseWithoutCard } from './closeWithoutCard.ts';

/**
 * A month an owner or a partner closed without a statement-date card's statement (docs/design/card-cycles.md 2.4; the table is `close_without_card`). The month is a first-of-month
 * date in the database and a `YYYY-MM` everywhere else.
 */
describe('toCloseWithoutCard', () => {
  const row = { id: 'c-1', household_id: 'h-1', account_id: 'a-1', month: '2026-10-01' };

  it('reads the card and the month, as the close names a month', () => {
    expect(toCloseWithoutCard(row)).toEqual({ id: 'c-1', accountId: 'a-1', month: '2026-10' });
  });

  it('refuses a row without a card, and a month that is not a date', () => {
    expect(() => toCloseWithoutCard({ ...row, account_id: null })).toThrow(MalformedRowError);
    expect(() => toCloseWithoutCard({ ...row, month: 'October' })).toThrow(MalformedRowError);
  });
});
