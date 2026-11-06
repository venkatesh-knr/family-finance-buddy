import { describe, expect, it } from 'vitest';
import { parseQuantity } from '../lib/quantity.ts';
import {
  costFromRate,
  formatGrams,
  gramsHeld,
  latestRate,
  physicalGoldValue,
  ratePerGram,
  rateIsStale,
  type GoldRate,
} from './gold.ts';

const rate = (purity: GoldRate['purity'], asOf: string, rupeesAGram: number, typedAt = `${asOf}T10:00:00Z`): GoldRate => ({
  purity,
  asOf,
  perGramMinor: BigInt(rupeesAGram) * 100n,
  currency: 'INR',
  typedAt,
});

const grams = (text: string): bigint => parseQuantity(text);

describe('what physical gold is worth (GD-I3)', () => {
  it('GD-I3 — 20 g at a dated 22K rate of ₹11,550 is ₹2,31,000', () => {
    const worth = physicalGoldValue({ grams: grams('20'), purity: '22k', currency: 'INR' }, [rate('22k', '2026-11-05', 11550)], '2026-11-06');
    expect(worth.ok).toBe(true);
    if (worth.ok) {
      expect(worth.value).toEqual({ minor: 23_100_000n, currency: 'INR' });
      expect(worth.rate.asOf).toBe('2026-11-05');
    }
  });

  it('GD-I3 — with no rate for its purity it is not valued: not zero, and not what was paid', () => {
    const worth = physicalGoldValue({ grams: grams('20'), purity: '22k', currency: 'INR' }, [rate('24k', '2026-11-05', 12600)], '2026-11-06');
    expect(worth).toEqual({ ok: false, reason: 'no-rate' });
  });

  it('GD-I3 — a rate dated after the day is not used for that day', () => {
    const worth = physicalGoldValue({ grams: grams('20'), purity: '22k', currency: 'INR' }, [rate('22k', '2026-11-07', 11550)], '2026-11-06');
    expect(worth).toEqual({ ok: false, reason: 'no-rate' });
  });

  it('GD-I3 — a rate in another currency is refused, not converted at a guess', () => {
    const dollars: GoldRate = { ...rate('22k', '2026-11-05', 100), currency: 'USD' };
    expect(physicalGoldValue({ grams: grams('20'), purity: '22k', currency: 'INR' }, [dollars], '2026-11-06')).toEqual({
      ok: false,
      reason: 'mixed-currency',
    });
  });

  it('GD-I3 — a fractional gram is worked out in whole paise, rounded half up once at the end', () => {
    // 0.5 g at 333 paise a gram is 166.5 paise.
    const half: GoldRate = { purity: '22k', asOf: '2026-11-05', perGramMinor: 333n, currency: 'INR', typedAt: '2026-11-05T10:00:00Z' };
    const worth = physicalGoldValue({ grams: grams('0.5'), purity: '22k', currency: 'INR' }, [half], '2026-11-06');
    expect(worth.ok && worth.value.minor).toBe(167n);
  });
});

describe('the rate, as a dated row', () => {
  it('GD-I12 — a second 22K rate on a later date values the same gold higher from that date, and the earlier one is still there', () => {
    const rates = [rate('22k', '2026-09-07', 10900), rate('22k', '2026-11-04', 11550)];
    const held = { grams: grams('20'), purity: '22k' as const, currency: 'INR' };

    const before = physicalGoldValue(held, rates, '2026-10-01');
    const after = physicalGoldValue(held, rates, '2026-11-05');
    // The day before the new rate still reads the old one: yesterday's value does not move because a rate was typed today.
    const dayBefore = physicalGoldValue(held, rates, '2026-11-03');
    expect(before.ok && before.value.minor).toBe(21_800_000n);
    expect(after.ok && after.value.minor).toBe(23_100_000n);
    expect(dayBefore.ok && dayBefore.value.minor).toBe(21_800_000n);
    expect(rates).toHaveLength(2);
  });

  it('GD-I12 — two rates for one day: the one typed later wins', () => {
    const rates = [rate('22k', '2026-11-05', 11500, '2026-11-05T05:00:00Z'), rate('22k', '2026-11-05', 11550, '2026-11-05T09:00:00Z')];
    expect(latestRate(rates, '22k', '2026-11-05')?.perGramMinor).toBe(1_155_000n);
    // Whatever order they arrive in.
    expect(latestRate([...rates].reverse(), '22k', '2026-11-05')?.perGramMinor).toBe(1_155_000n);
  });

  it('is stale after thirty days, and not on the thirtieth', () => {
    expect(rateIsStale('2026-10-07', '2026-11-06')).toBe(false); // 30 days
    expect(rateIsStale('2026-10-06', '2026-11-06')).toBe(true); // 31 days
  });
});

describe('the cost, one figure either way in (GD-I8)', () => {
  it('GD-I8 — 20 g at a price of ₹1,16,400 and 20 g at a rate of ₹5,820 store the same cost', () => {
    const fromPrice = 11_640_000n; // typed as the price paid
    const fromRate = costFromRate(582_000n, grams('20')); // typed as the rate per gram
    expect(fromRate).toBe(fromPrice);
  });

  it('GD-I8 — the rate worked out from a price is the one shown beside it: ₹1,16,400 for 20 g is ₹5,820 a gram', () => {
    expect(ratePerGram(11_640_000n, grams('20'))).toBe(582_000n);
  });

  it('GD-I8 — a rate that does not divide evenly is rounded to the paisa, half up', () => {
    // ₹1,000 for 3 g is 333.33 paise... a gram: 100000 / 3 = 33333.33 paise.
    expect(ratePerGram(100_000n, grams('3'))).toBe(33_333n);
    expect(ratePerGram(200_000n, grams('3'))).toBe(66_667n);
  });

  it('has no rate per gram for no grams', () => {
    expect(ratePerGram(100n, 0n)).toBeNull();
  });
});

describe('grams held', () => {
  it('is the purchases less the sales', () => {
    expect(gramsHeld([grams('20'), grams('5.5')], [grams('3.25')])).toBe(grams('22.25'));
  });
});

describe('grams as a bill shows them', () => {
  it('shows three decimals', () => {
    expect(formatGrams(grams('20'))).toBe('20.000');
    expect(formatGrams(grams('5.5'))).toBe('5.500');
    expect(formatGrams(grams('0.125'))).toBe('0.125');
  });
});
