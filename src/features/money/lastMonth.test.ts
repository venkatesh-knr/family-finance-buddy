import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { MonthFigures } from '../../domain/money-month.ts';
import { lastMonthView, modeLine } from './lastMonth.ts';

/**
 * Last month, on the month surface (docs/design/ledger-income.md section 4: *Last month is closed, or shows the open state if nobody has closed it
 * yet*; a closed month says *from balances, 3 of 3 accounts*). The figures are the close's, worked out in `closeMonth.ts`; this decides what the
 * surface shows of them.
 */

const figures = (currency: string, cameIn: number, spent: number, saved: number): MonthFigures =>
  ({ currency, cameIn: BigInt(cameIn) * 100n, spent: BigInt(spent) * 100n, saved: BigInt(saved) * 100n }) as unknown as MonthFigures;

const closed = { status: 'figures', currencies: [figures('INR', 143_250, 69_670, 73_580)] } as const;

describe('lastMonthView', () => {
  it('is the close\u2019s own came in, spent and saved when the month was closed, with how many accounts it covers', () => {
    const view = lastMonthView({ month: '2026-10', close: closed, readable: 3 });
    expect(view).toEqual({
      kind: 'closed',
      month: '2026-10',
      cameIn: [money(14_325_000n, 'INR')],
      spent: [money(6_967_000n, 'INR')],
      saved: [money(7_358_000n, 'INR')],
      counted: 3,
      total: 3,
      unnamedEntries: 0,
    });
  });

  it('says how many of the month’s purchases and sales named no account, whose money is still in spent', () => {
    const view = lastMonthView({ month: '2026-10', close: closed, readable: 3, unnamedEntries: 2 });
    expect(view.kind === 'closed' && view.unnamedEntries).toBe(2);
  });

  it('keeps one line for each currency, as the close has them', () => {
    const view = lastMonthView({
      month: '2026-10',
      close: { status: 'figures', currencies: [figures('INR', 100, 40, 60), figures('USD', 10, 4, 6)] },
      readable: 2,
    });
    expect(view.kind === 'closed' && view.saved.map((line) => line.currency)).toEqual(['INR', 'USD']);
  });

  it('is the open state when a balance is still missing, when there is no account in use, and never a month of nothing', () => {
    expect(lastMonthView({ month: '2026-10', close: { status: 'missing', missing: ['card'] }, readable: 3 })).toEqual({
      kind: 'open',
      month: '2026-10',
      noAccounts: false,
    });
  });

  it('says a household with no account in use is on what was entered, and not that a month is waiting to be closed: it cannot be', () => {
    expect(lastMonthView({ month: '2026-10', close: { status: 'no-accounts' }, readable: 0 })).toEqual({ kind: 'open', month: '2026-10', noAccounts: true });
  });

  it('says it is still being read, or could not be read, instead of showing the open state: a month that is closed must not look open', () => {
    expect(lastMonthView({ month: '2026-10', close: closed, readable: 3, reading: 'loading' })).toEqual({ kind: 'reading', month: '2026-10' });
    expect(lastMonthView({ month: '2026-10', close: closed, readable: 3, reading: 'failed' })).toEqual({ kind: 'failed', month: '2026-10' });
  });
});

describe('modeLine', () => {
  it('says where the figures come from and how many accounts it covers', () => {
    expect(modeLine(3, 3)).toBe('from balances, 3 of 3 accounts');
    expect(modeLine(3, 4)).toBe('from balances, 3 of 4 accounts');
    expect(modeLine(1, 1)).toBe('from balances, 1 of 1 account');
  });
});
