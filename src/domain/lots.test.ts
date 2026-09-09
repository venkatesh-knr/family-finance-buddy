/**
 * Matching sales to purchases, which is where a capital gain comes from.
 *
 * "Capital gains are derived from lots. Never store a gain." Every number in
 * this file was worked out by hand first; that is the point of the convention.
 *
 * FIFO is not a preference here. For shares held in demat and for mutual fund
 * units, the Income Tax Act prescribes first-in-first-out, so there is one
 * matching rule and no setting to get wrong.
 *
 * Note what these tests never assert: whether a gain is long or short term.
 * That is a dated rule in `tax_rule`, not arithmetic, and this module returns
 * the held period in days so the rule can decide.
 */

import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { parseQuantity as q } from '../lib/quantity.ts';
import { matchFifo, openPosition, realised, type Disposal, type Lot } from './lots.ts';

const inr = (minor: bigint) => money(minor, 'INR');

function lot(id: string, acquiredOn: string, quantity: string, costMinor: bigint): Lot {
  return {
    id,
    instrumentId: 'i1',
    acquiredOn,
    quantity: q(quantity),
    cost: inr(costMinor),
  };
}

function sale(id: string, disposedOn: string, quantity: string, proceedsMinor: bigint): Disposal {
  return {
    id,
    instrumentId: 'i1',
    disposedOn,
    quantity: q(quantity),
    proceeds: inr(proceedsMinor),
  };
}

describe('matchFifo — the ordinary cases', () => {
  it('matches one sale against one purchase and derives the gain', () => {
    // 10 units cost ₹1,000.00, sold for ₹1,500.00. Gain ₹500.00.
    const result = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n)],
      [sale('d1', '2025-03-20', '10', 150000n)],
    );

    expect(result.shortfalls).toEqual([]);
    expect(result.parcels).toHaveLength(1);

    const parcel = result.parcels[0]!;
    expect(parcel.lotId).toBe('l1');
    expect(parcel.disposalId).toBe('d1');
    expect(parcel.cost.minor).toBe(100000n);
    expect(parcel.proceeds.minor).toBe(150000n);
    expect(parcel.gain.minor).toBe(50000n);
    expect(parcel.heldDays).toBe(435);
  });

  it('records a loss as a negative gain rather than as its own kind of thing', () => {
    // A loss is a gain with a sign. Two concepts here would mean every consumer
    // handling both, and one of them forgetting.
    const result = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n)],
      [sale('d1', '2024-06-10', '10', 60000n)],
    );

    expect(result.parcels[0]!.gain.minor).toBe(-40000n);
  });

  it('takes the oldest purchase first, not the cheapest', () => {
    // Both lots are 10 units. FIFO must consume the January one, cost ₹1,000,
    // and leave the cheaper March one alone — a cheapest-first matcher would
    // report a bigger gain and a smaller tax bill, which is the wrong answer
    // in the direction that gets noticed.
    const result = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n), lot('l2', '2024-03-10', '10', 50000n)],
      [sale('d1', '2025-06-10', '10', 150000n)],
    );

    expect(result.parcels).toHaveLength(1);
    expect(result.parcels[0]!.lotId).toBe('l1');
    expect(result.parcels[0]!.gain.minor).toBe(50000n);
  });

  it('orders by acquisition date, whatever order the rows arrived in', () => {
    const result = matchFifo(
      [lot('l2', '2024-03-10', '10', 50000n), lot('l1', '2024-01-10', '10', 100000n)],
      [sale('d1', '2025-06-10', '10', 150000n)],
    );

    expect(result.parcels[0]!.lotId).toBe('l1');
  });

  it('splits one sale across two purchases, as a parcel each', () => {
    // 15 sold from lots of 10 and 10. Twelve months apart, so the two parcels
    // will fall on opposite sides of a holding-period rule — which is exactly
    // why a sale cannot collapse into a single gain figure.
    const result = matchFifo(
      [lot('l1', '2023-01-10', '10', 100000n), lot('l2', '2024-01-10', '10', 200000n)],
      [sale('d1', '2024-06-10', '15', 450000n)],
    );

    expect(result.parcels).toHaveLength(2);

    const [first, second] = result.parcels;
    expect(first!.lotId).toBe('l1');
    expect(first!.cost.minor).toBe(100000n);
    expect(first!.proceeds.minor).toBe(300000n); // 10/15 of ₹4,500
    expect(first!.gain.minor).toBe(200000n);

    expect(second!.lotId).toBe('l2');
    expect(second!.cost.minor).toBe(100000n); // half of lot 2's ₹2,000
    expect(second!.proceeds.minor).toBe(150000n);
    expect(second!.gain.minor).toBe(50000n);
  });

  it('carries what is left of a part-sold purchase to the next sale', () => {
    const result = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n)],
      [sale('d1', '2024-06-10', '4', 60000n), sale('d2', '2024-09-10', '6', 90000n)],
    );

    expect(result.parcels).toHaveLength(2);
    expect(result.parcels[0]!.cost.minor).toBe(40000n);
    expect(result.parcels[1]!.cost.minor).toBe(60000n);
    expect(openPosition(result)).toEqual([]);
  });

  it('handles a fractional sale, which is ordinary on a US broker', () => {
    // 0.5 of a unit costing ₹1,000 for 2.5 units: cost ₹200.00.
    const result = matchFifo(
      [lot('l1', '2024-01-10', '2.5', 100000n)],
      [sale('d1', '2024-06-10', '0.5', 25000n)],
    );

    expect(result.parcels[0]!.cost.minor).toBe(20000n);
    expect(result.parcels[0]!.gain.minor).toBe(5000n);
  });
});

describe('matchFifo — the paise that must not go missing', () => {
  it('gives the last parcel the residue, so split costs sum to the lot exactly', () => {
    // ₹100.01 over three equal parts is 3333.67 paise each. Rounded, three
    // parcels of 3334 would total 10002 — one paise conjured out of nothing.
    const result = matchFifo(
      [lot('l1', '2024-01-10', '3', 10001n)],
      [
        sale('d1', '2024-02-10', '1', 5000n),
        sale('d2', '2024-03-10', '1', 5000n),
        sale('d3', '2024-04-10', '1', 5000n),
      ],
    );

    const total = result.parcels.reduce((sum, p) => sum + p.cost.minor, 0n);
    expect(total).toBe(10001n);
    expect(result.parcels.map((p) => p.cost.minor)).toEqual([3334n, 3334n, 3333n]);
  });

  it('splits proceeds across parcels so they sum to what the sale fetched', () => {
    const result = matchFifo(
      [lot('l1', '2024-01-10', '1', 1000n), lot('l2', '2024-02-10', '2', 2000n)],
      [sale('d1', '2024-06-10', '3', 10000n)],
    );

    const total = result.parcels.reduce((sum, p) => sum + p.proceeds.minor, 0n);
    expect(total).toBe(10000n);
  });

  it('keeps gain as proceeds minus cost on every parcel, never a separate sum', () => {
    const result = matchFifo(
      [lot('l1', '2024-01-10', '3', 10001n)],
      [sale('d1', '2024-02-10', '1', 3333n), sale('d2', '2024-03-10', '2', 6667n)],
    );

    for (const parcel of result.parcels) {
      expect(parcel.gain.minor).toBe(parcel.proceeds.minor - parcel.cost.minor);
    }
  });
});

describe('matchFifo — what it refuses to guess', () => {
  it('reports a sale with nothing to match rather than inventing a zero cost', () => {
    // A zero-cost parcel is a 100% gain. Reporting one because the purchase
    // has not been entered yet would put a fictitious tax bill on the screen.
    const result = matchFifo([], [sale('d1', '2024-06-10', '10', 150000n)]);

    expect(result.parcels).toEqual([]);
    expect(result.shortfalls).toHaveLength(1);
    expect(result.shortfalls[0]!.disposalId).toBe('d1');
    expect(result.shortfalls[0]!.quantity).toBe(q('10'));
    expect(result.shortfalls[0]!.reason).toBe('no-lots');
  });

  it('matches what it can and reports only the uncovered remainder', () => {
    const result = matchFifo(
      [lot('l1', '2024-01-10', '4', 40000n)],
      [sale('d1', '2024-06-10', '10', 150000n)],
    );

    expect(result.parcels).toHaveLength(1);
    expect(result.parcels[0]!.cost.minor).toBe(40000n);
    expect(result.shortfalls[0]!.quantity).toBe(q('6'));
  });

  it('will not match a sale against a purchase made after it', () => {
    // Buying in June cannot fund a sale in March. Silently matching it would
    // read as a tidy gain instead of the data-entry error it is.
    const result = matchFifo(
      [lot('l1', '2024-06-10', '10', 100000n)],
      [sale('d1', '2024-03-10', '10', 150000n)],
    );

    expect(result.parcels).toEqual([]);
    expect(result.shortfalls[0]!.reason).toBe('no-lots');
  });

  it('refuses to net a dollar cost against a rupee sale', () => {
    const usdLot: Lot = { ...lot('l1', '2024-01-10', '10', 100000n), cost: money(100000n, 'USD') };
    const result = matchFifo([usdLot], [sale('d1', '2024-06-10', '10', 150000n)]);

    expect(result.parcels).toEqual([]);
    expect(result.shortfalls[0]!.reason).toBe('currency-mismatch');
  });

  it('keeps instruments apart: one holding does not fund another', () => {
    const other: Lot = { ...lot('l1', '2024-01-10', '10', 100000n), instrumentId: 'i2' };
    const result = matchFifo([other], [sale('d1', '2024-06-10', '10', 150000n)]);

    expect(result.parcels).toEqual([]);
    expect(result.shortfalls[0]!.reason).toBe('no-lots');
  });
});

describe('openPosition', () => {
  it('reports what is still held, with the cost still attached to it', () => {
    const result = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n), lot('l2', '2024-02-10', '10', 300000n)],
      [sale('d1', '2024-06-10', '15', 450000n)],
    );

    const open = openPosition(result);
    expect(open).toHaveLength(1);
    expect(open[0]!.lotId).toBe('l2');
    expect(open[0]!.quantity).toBe(q('5'));
    expect(open[0]!.cost.minor).toBe(150000n);
  });

  it('drops a lot that has been fully sold rather than listing it at zero', () => {
    const result = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n)],
      [sale('d1', '2024-06-10', '10', 150000n)],
    );

    expect(openPosition(result)).toEqual([]);
  });

  it('is the whole holding when nothing has been sold', () => {
    const result = matchFifo([lot('l1', '2024-01-10', '10', 100000n)], []);

    expect(openPosition(result)[0]!.quantity).toBe(q('10'));
    expect(openPosition(result)[0]!.cost.minor).toBe(100000n);
  });
});

describe('realised', () => {
  it('sums the gains in one currency', () => {
    const result = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n), lot('l2', '2024-02-10', '10', 300000n)],
      [sale('d1', '2024-06-10', '15', 450000n)],
    );

    // Parcel one: ₹3,000 for ₹1,000 → +₹2,000. Parcel two: ₹1,500 for ₹1,500 → 0.
    expect(realised(result.parcels, 'INR')!.minor).toBe(200000n);
  });

  it('is null with nothing realised, rather than a zero that reads as a fact', () => {
    expect(realised([], 'INR')).toBeNull();
  });

  it('counts only the currency asked for, never adding across two', () => {
    const rupee = matchFifo(
      [lot('l1', '2024-01-10', '10', 100000n)],
      [sale('d1', '2024-06-10', '10', 150000n)],
    );

    expect(realised(rupee.parcels, 'USD')).toBeNull();
  });
});
