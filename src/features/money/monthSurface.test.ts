import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { MoneyTotals } from '../../repo/types.ts';
import { monthLabel, surfaceFigures } from './monthSurface.ts';

/**
 * The month surface's figures (docs/design/ledger-income.md section 4; the MoneyLedger board): what came in, what is spent so far, and saved,
 * which is not shown for a month that has not been closed. Came in is per currency and is never added across them (LI-I5); spent so far is
 * what was itemised, less the refunds (LI-I3), in the currency the figures are read in.
 */

const totals = (currency: string, cameIn: number, refunds: number): MoneyTotals => ({
  cameIn: money(BigInt(cameIn) * 100n, currency),
  refunds: money(BigInt(refunds) * 100n, currency),
});

describe('monthLabel — the surface’s title', () => {
  it('names the month, so far', () => {
    expect(monthLabel('2026-11-14')).toBe('November so far');
    expect(monthLabel('2026-01-02')).toBe('January so far');
  });
});

describe('surfaceFigures', () => {
  it('LI-I1 — came in is what the household’s totals say, and saved is not shown for a month that is not closed (LI-I7)', () => {
    const figures = surfaceFigures({ totals: [totals('INR', 261_250, 0)], spent: money(3_779_000n, 'INR'), currency: 'INR' });
    expect(figures.cameIn).toEqual([money(26_125_000n, 'INR')]);
    expect(figures.saved).toBeNull();
  });

  it('LI-I3 — spent so far is the itemised spending less the refunds in that currency: ₹37,790 less ₹1,299 is ₹36,491', () => {
    const figures = surfaceFigures({ totals: [totals('INR', 261_250, 1_299)], spent: money(3_779_000n, 'INR'), currency: 'INR' });
    expect(figures.spent).toEqual(money(3_649_100n, 'INR'));
    // A refund is not came in.
    expect(figures.cameIn).toEqual([money(26_125_000n, 'INR')]);
  });

  it('shows the currency it is read in even with nothing in it, as nothing and not as an absence', () => {
    const figures = surfaceFigures({ totals: [], spent: money(0n, 'INR'), currency: 'INR' });
    expect(figures.cameIn).toEqual([money(0n, 'INR')]);
  });

  it('LI-I5 — another currency is its own line, rupees first, and is never added to them', () => {
    const figures = surfaceFigures({
      totals: [totals('USD', 200, 0), totals('INR', 1_000, 0)],
      spent: money(0n, 'INR'),
      currency: 'INR',
    });
    expect(figures.cameIn).toEqual([money(100_000n, 'INR'), money(20_000n, 'USD')]);
  });

  it('leaves out a currency that has nothing came in, and refunds in another currency are not taken off spent here', () => {
    const figures = surfaceFigures({
      totals: [totals('USD', 0, 50), totals('INR', 1_000, 0)],
      spent: money(500_000n, 'INR'),
      currency: 'INR',
    });
    expect(figures.cameIn).toEqual([money(100_000n, 'INR')]);
    expect(figures.spent).toEqual(money(500_000n, 'INR'));
    expect(figures.refundsInOtherCurrencies).toBe(true);
  });

  it('says there are none when every refund is in the currency being read', () => {
    const figures = surfaceFigures({ totals: [totals('INR', 1_000, 10)], spent: money(500_000n, 'INR'), currency: 'INR' });
    expect(figures.refundsInOtherCurrencies).toBe(false);
  });
});
