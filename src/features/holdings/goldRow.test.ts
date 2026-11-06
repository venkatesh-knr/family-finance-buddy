import { describe, expect, it } from 'vitest';
import { parseQuantity } from '../../lib/quantity.ts';
import type { GoldRate } from '../../domain/gold.ts';
import { goldRowLine } from './goldRow.ts';

const rate = (purity: GoldRate['purity'], asOf: string): GoldRate => ({ purity, asOf, perGramMinor: 1_155_000n, currency: 'INR', typedAt: `${asOf}T10:00:00Z` });
const twenty = parseQuantity('20');

describe('GD-I3 — the row of physical gold says what it is, and says when it is not valued', () => {
  it('says what it is, its purity and its weight', () => {
    expect(goldRowLine({ purity: '22k', grams: twenty, rates: [rate('22k', '2026-11-05')], today: '2026-11-06' })).toBe('Physical gold · 22K · 20.000 g');
  });

  it('says it is not valued, and what to do, when its purity has no rate', () => {
    expect(goldRowLine({ purity: '22k', grams: twenty, rates: [rate('24k', '2026-11-05')], today: '2026-11-06' })).toBe(
      "Physical gold · 22K · 20.000 g · not valued: add today's 22K rate",
    );
  });

  it('says nothing of a missing rate while the rates are still being read: they may not be missing', () => {
    expect(goldRowLine({ purity: '22k', grams: twenty, rates: null, today: '2026-11-06' })).toBe('Physical gold · 22K · 20.000 g');
  });
});
