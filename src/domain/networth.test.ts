import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import {
  allocationByKind,
  assetTotals,
  latestValuationPerHolding,
  readingGaps,
  type HoldingInput,
  type ValuationInput,
} from './networth.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

const holding = (over: Partial<HoldingInput> & { id: string }): HoldingInput => ({
  memberId: 'm1',
  memberName: 'Ravi',
  kind: 'mutual_fund',
  currency: 'INR',
  cost: null,
  isArchived: false,
  ...over,
});

const reading = (holdingId: string, date: string, amount: ReturnType<typeof inr>): ValuationInput => ({
  holdingId,
  date,
  amount,
});

describe('latestValuationPerHolding', () => {
  it('takes the most recent reading for each holding', () => {
    const latest = latestValuationPerHolding([
      reading('h1', '2026-01-31', inr(100)),
      reading('h1', '2026-03-31', inr(130)),
      reading('h1', '2026-02-28', inr(110)),
      reading('h2', '2026-02-28', inr(500)),
    ]);

    expect(latest.get('h1')?.amount.minor).toBe(13_000n);
    expect(latest.get('h2')?.amount.minor).toBe(50_000n);
  });

  it('does not invent a reading for a holding that has none', () => {
    // The whole point of §606: a holding nobody read has no value, and a zero
    // would be a figure rather than an absence.
    const latest = latestValuationPerHolding([reading('h1', '2026-01-31', inr(100))]);
    expect(latest.has('h2')).toBe(false);
  });

  it('is not confused by dates arriving out of order', () => {
    const latest = latestValuationPerHolding([
      reading('h1', '2026-12-31', inr(999)),
      reading('h1', '2026-01-31', inr(1)),
    ]);
    expect(latest.get('h1')?.amount.minor).toBe(99_900n);
  });
});

/**
 * Totals, and the currency rule that governs them.
 *
 * "Every amount carries a currency… Never overwrite the original figure with a
 * converted one." There is no fx_rate table yet, so there is no honest way to
 * add a dollar to a rupee. These come back per currency, and a screen showing
 * one number would be inventing a rate at the display edge.
 */
describe('assetTotals', () => {
  const holdings = [
    holding({ id: 'h1', currency: 'INR', cost: inr(80_000) }),
    holding({ id: 'h2', currency: 'INR', cost: inr(20_000) }),
    holding({ id: 'h3', currency: 'USD', cost: usd(1_000) }),
  ];

  const valuations = [
    reading('h1', '2026-08-31', inr(95_000)),
    reading('h2', '2026-08-31', inr(18_000)),
    reading('h3', '2026-08-31', usd(1_250)),
  ];

  it('totals each currency on its own and never across them', () => {
    const totals = assetTotals({ holdings, valuations });
    const byCurrency = Object.fromEntries(totals.map((t) => [t.currency, t]));

    expect(byCurrency['INR']?.value.minor).toBe(11_300_000n); // 95,000 + 18,000
    expect(byCurrency['USD']?.value.minor).toBe(125_000n); // 1,250
    expect(totals).toHaveLength(2);
  });

  it('reports what was invested and what that has become', () => {
    const totals = assetTotals({ holdings, valuations });
    const rupees = totals.find((t) => t.currency === 'INR');

    expect(rupees?.invested.minor).toBe(10_000_000n); // 80,000 + 20,000
    expect(rupees?.gain.minor).toBe(1_300_000n); // 1,13,000 - 1,00,000
  });

  it('reports a loss as a negative gain rather than hiding it', () => {
    const totals = assetTotals({
      holdings: [holding({ id: 'h1', cost: inr(50_000) })],
      valuations: [reading('h1', '2026-08-31', inr(42_000))],
    });
    expect(totals[0]?.gain.minor).toBe(-800_000n);
  });

  it('counts a holding with no reading as unvalued, not as zero', () => {
    // A zero would drag the total down and read as a fact. It is not one.
    const totals = assetTotals({
      holdings: [holding({ id: 'h1', cost: inr(10_000) }), holding({ id: 'h2', cost: inr(5_000) })],
      valuations: [reading('h1', '2026-08-31', inr(12_000))],
    });

    expect(totals[0]?.value.minor).toBe(1_200_000n);
    expect(totals[0]?.unvalued).toBe(1);
    // Invested counts both, because both were bought. The gain is therefore
    // only meaningful for the part that has been valued, and the screen has to
    // say so rather than subtract the two and present the difference.
    expect(totals[0]?.investedValued.minor).toBe(1_000_000n);
  });

  it('leaves archived holdings out entirely', () => {
    const totals = assetTotals({
      holdings: [holding({ id: 'h1', cost: inr(10_000), isArchived: true })],
      valuations: [reading('h1', '2026-08-31', inr(12_000))],
    });
    expect(totals).toHaveLength(0);
  });

  it('has nothing to say about an empty household', () => {
    expect(assetTotals({ holdings: [], valuations: [] })).toEqual([]);
  });
});

describe('allocationByKind', () => {
  it('groups by instrument kind and gives each a share of the whole', () => {
    const rows = allocationByKind({
      holdings: [
        holding({ id: 'h1', kind: 'mutual_fund' }),
        holding({ id: 'h2', kind: 'mutual_fund' }),
        holding({ id: 'h3', kind: 'bond' }),
      ],
      valuations: [
        reading('h1', '2026-08-31', inr(60_000)),
        reading('h2', '2026-08-31', inr(20_000)),
        reading('h3', '2026-08-31', inr(20_000)),
      ],
      currency: 'INR',
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.kind).toBe('mutual_fund');
    expect(rows[0]?.value.minor).toBe(8_000_000n);
    expect(rows[0]?.share).toBeCloseTo(0.8, 6);
    expect(rows[1]?.share).toBeCloseTo(0.2, 6);
  });

  it('is ordered by size, because the largest holding is the question', () => {
    const rows = allocationByKind({
      holdings: [holding({ id: 'h1', kind: 'bond' }), holding({ id: 'h2', kind: 'equity' })],
      valuations: [
        reading('h1', '2026-08-31', inr(10_000)),
        reading('h2', '2026-08-31', inr(90_000)),
      ],
      currency: 'INR',
    });
    expect(rows.map((r) => r.kind)).toEqual(['equity', 'bond']);
  });

  it('considers only the currency it was asked about', () => {
    const rows = allocationByKind({
      holdings: [holding({ id: 'h1', currency: 'INR' }), holding({ id: 'h2', currency: 'USD' })],
      valuations: [
        reading('h1', '2026-08-31', inr(10_000)),
        reading('h2', '2026-08-31', usd(500)),
      ],
      currency: 'INR',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.share).toBe(1);
  });

  it('leaves out a kind that was read and found to be worth nothing', () => {
    // The zero-quantity holding case. It was read, so it is not a gap; it is
    // simply not a slice of anything, and a 0.0% row is a line with no
    // information in it.
    const rows = allocationByKind({
      holdings: [holding({ id: 'h1', kind: 'equity' }), holding({ id: 'h2', kind: 'other' })],
      valuations: [
        reading('h1', '2026-08-31', inr(50_000)),
        reading('h2', '2026-08-31', inr(0)),
      ],
      currency: 'INR',
    });

    expect(rows.map((r) => r.kind)).toEqual(['equity']);
    expect(rows[0]?.share).toBe(1);
  });

  it('carries what each class cost and what that has become', () => {
    const rows = allocationByKind({
      holdings: [
        holding({ id: 'h1', kind: 'equity', cost: inr(40_000) }),
        holding({ id: 'h2', kind: 'bond', cost: inr(60_000) }),
      ],
      valuations: [
        reading('h1', '2026-08-31', inr(52_000)),
        reading('h2', '2026-08-31', inr(57_000)),
      ],
      currency: 'INR',
    });

    const bond = rows.find((r) => r.kind === 'bond');
    expect(bond?.invested.minor).toBe(6_000_000n);
    expect(bond?.gain.minor).toBe(-300_000n);
    expect(bond?.returnOnCost).toBeCloseTo(-0.05, 6);
  });

  it('has no return to report for a class with no recorded cost', () => {
    // Null, not 0%. Zero would be a claim about performance; this is silence
    // about a cost nobody entered.
    const rows = allocationByKind({
      holdings: [holding({ id: 'h1', kind: 'equity', cost: null })],
      valuations: [reading('h1', '2026-08-31', inr(10_000))],
      currency: 'INR',
    });
    expect(rows[0]?.returnOnCost).toBeNull();
  });

  it('gives no shares at all when nothing has been valued', () => {
    // Dividing by a total of zero would be Infinity or NaN dressed as a
    // percentage, and a chart would draw it.
    expect(
      allocationByKind({ holdings: [holding({ id: 'h1' })], valuations: [], currency: 'INR' }),
    ).toEqual([]);
  });
});

/**
 * The gaps, which are the point of the whole valuation table.
 *
 * "Every month that passes before the app starts snapshotting is a month of
 * peak data gone." A screen that does not name the missing months lets a peak
 * be read as the figure when it is only a lower bound.
 */
describe('readingGaps', () => {
  it('names the months of the calendar year with no reading', () => {
    const gaps = readingGaps({
      holdings: [holding({ id: 'h1' })],
      valuations: [
        reading('h1', '2026-01-31', inr(100)),
        reading('h1', '2026-03-31', inr(120)),
      ],
      year: 2026,
      today: '2026-04-15',
    });

    // January and March read; February missing. April is not yet over, so it
    // is not a gap — it is simply not finished.
    expect(gaps.missingMonths).toEqual(['February']);
  });

  it('does not call a future month missing', () => {
    const gaps = readingGaps({
      holdings: [holding({ id: 'h1' })],
      valuations: [reading('h1', '2026-01-31', inr(100))],
      year: 2026,
      today: '2026-02-10',
    });
    expect(gaps.missingMonths).toEqual([]);
  });

  it('counts holdings that have never been read at all', () => {
    const gaps = readingGaps({
      holdings: [holding({ id: 'h1' }), holding({ id: 'h2' })],
      valuations: [reading('h1', '2026-01-31', inr(100))],
      year: 2026,
      today: '2026-02-10',
    });
    expect(gaps.neverRead).toEqual(['h2']);
  });

  it('says a year is complete when every finished month was read', () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      reading('h1', `2026-${String(i + 1).padStart(2, '0')}-28`, inr(100)),
    );
    const gaps = readingGaps({
      holdings: [holding({ id: 'h1' })],
      valuations: months,
      year: 2026,
      today: '2027-01-05',
    });
    expect(gaps.missingMonths).toEqual([]);
    expect(gaps.neverRead).toEqual([]);
  });

  it('never reads the clock: today is given', () => {
    const input = {
      holdings: [holding({ id: 'h1' })],
      valuations: [reading('h1', '2026-01-31', inr(100))],
      year: 2026,
      today: '2026-06-01',
    };
    expect(readingGaps(input)).toEqual(readingGaps(input));
  });
});
