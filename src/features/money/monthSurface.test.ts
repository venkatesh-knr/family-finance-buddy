import { describe, expect, it } from 'vitest';
import { money } from '../../lib/money.ts';
import type { MoneyTotals } from '../../repo/types.ts';
import { monthLabel, spentShortReasons, surfaceFigures } from './monthSurface.ts';

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
  const none = { itemised: [], privateSpend: [] };

  it('LI-I1 — came in is what the household’s totals say, and saved is not shown for a month that is not closed (LI-I7)', () => {
    const figures = surfaceFigures({ totals: [totals('INR', 261_250, 0)], ...none, currency: 'INR' });
    expect(figures.cameIn).toEqual([money(26_125_000n, 'INR')]);
    expect(figures.saved).toBeNull();
  });

  it('LI-I3 — spent so far is the itemised spending less the refunds: ₹37,790 less ₹1,299 is ₹36,491', () => {
    const figures = surfaceFigures({
      totals: [totals('INR', 261_250, 1_299)],
      itemised: [money(2_000_000n, 'INR'), money(1_779_000n, 'INR')],
      privateSpend: [],
      currency: 'INR',
    });
    expect(figures.spent).toEqual([money(3_649_100n, 'INR')]);
    // A refund is not came in.
    expect(figures.cameIn).toEqual([money(26_125_000n, 'INR')]);
  });

  it('adds other members’ private spending of the same currency, which reaches the screen only as a sum', () => {
    const figures = surfaceFigures({ totals: [], itemised: [money(1_000_000n, 'INR')], privateSpend: [money(250_000n, 'INR')], currency: 'INR' });
    expect(figures.spent).toEqual([money(1_250_000n, 'INR')]);
  });

  it('LI-I5 — spent is per currency as came in is, each with its own refunds, and never added across them', () => {
    const figures = surfaceFigures({
      totals: [totals('INR', 1_000, 100), totals('USD', 200, 50)],
      itemised: [money(900_000n, 'INR'), money(12_000n, 'USD'), money(8_000n, 'USD')],
      privateSpend: [money(100_000n, 'INR'), money(1_000n, 'USD')],
      currency: 'INR',
    });
    // Rupees first. INR: 9,000 + 1,000 private − 100 refunded; USD: 120 + 80 + 10 − 50.
    expect(figures.spent).toEqual([money(990_000n, 'INR'), money(16_000n, 'USD')]);
    expect(figures.cameIn).toEqual([money(100_000n, 'INR'), money(20_000n, 'USD')]);
  });

  it('shows the currency it is read in even with nothing spent, as nothing and not as an absence', () => {
    const figures = surfaceFigures({ totals: [], ...none, currency: 'INR' });
    expect(figures.cameIn).toEqual([money(0n, 'INR')]);
    expect(figures.spent).toEqual([money(0n, 'INR')]);
  });

  it('LI-I5 — another currency is its own line, rupees first, and is never added to them', () => {
    const figures = surfaceFigures({ totals: [totals('USD', 200, 0), totals('INR', 1_000, 0)], ...none, currency: 'INR' });
    expect(figures.cameIn).toEqual([money(100_000n, 'INR'), money(20_000n, 'USD')]);
  });

  it('leaves out a currency that has nothing came in and nothing spent', () => {
    const figures = surfaceFigures({ totals: [totals('USD', 0, 0), totals('INR', 1_000, 0)], itemised: [money(500_000n, 'INR')], privateSpend: [], currency: 'INR' });
    expect(figures.cameIn).toEqual([money(100_000n, 'INR')]);
    expect(figures.spent).toEqual([money(500_000n, 'INR')]);
  });

  it('LI-I5 — keeps a currency that was spent in and refunded in full, as a line of nothing: something was spent and refunded in it', () => {
    const figures = surfaceFigures({ totals: [totals('USD', 0, 50)], itemised: [money(5_000n, 'USD')], privateSpend: [], currency: 'INR' });
    expect(figures.spent).toEqual([money(0n, 'INR'), money(0n, 'USD')]);
  });

  it('a refund above what was itemised in its currency makes that spent go below nothing, as the design says it can', () => {
    const figures = surfaceFigures({ totals: [totals('USD', 0, 50)], itemised: [], privateSpend: [], currency: 'INR' });
    expect(figures.spent).toEqual([money(0n, 'INR'), money(-5_000n, 'USD')]);
  });
});

describe('spentShortReasons — what may make the spent figure short, said on the figure', () => {
  it('says nothing when nothing may be missing', () => {
    expect(spentShortReasons({ privateUnreadable: false, partial: false })).toEqual({ reasons: [], fixable: false });
  });

  it('says private spending could not be read, which reloading can put right', () => {
    const said = spentShortReasons({ privateUnreadable: true, partial: false });
    expect(said.reasons).toEqual(['Other members’ private spending could not be read just now, so spent may be short. Reload to read it again.']);
    expect(said.fixable).toBe(true);
  });

  it('says the month holds more entries than the screen reads, which is a limit of the screen and nothing to act on', () => {
    const said = spentShortReasons({ privateUnreadable: false, partial: true });
    expect(said.reasons).toEqual(['This month holds more entries than this screen reads, so spent is short by the older ones.']);
    expect(said.fixable).toBe(false);
  });

  it('says both, and the figure is marked as one to act on', () => {
    const said = spentShortReasons({ privateUnreadable: true, partial: true });
    expect(said.reasons).toHaveLength(2);
    expect(said.fixable).toBe(true);
  });
});
