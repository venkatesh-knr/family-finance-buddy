import { describe, expect, it } from 'vitest';
import { cardEmiOutstanding, planCardEmiDebt, type EmiFigures } from './cardEmiDebt.ts';

/**
 * A card's EMI plans as one debt (docs/design/card-cycles.md 4a; CY-I17): outstanding = what it was before + what was converted - the principal billed, as at each statement. The worked
 * example is the design's: ₹60,000 converted in the October cycle, ₹5,000 of principal billed in November. Every figure here is invented.
 */
const row = (asAt: string, converted: bigint, principal: bigint): EmiFigures => ({ asAt, converted, principal });

describe('CY-I17 — a card’s EMI outstanding follows its statements', () => {
  it('a conversion of 6000000 is owed at its statement date, and the next statement’s principal of 500000 leaves 5500000', () => {
    expect(cardEmiOutstanding([row('2026-10-17', 6_000_000n, 0n)])).toEqual({ outstanding: 6_000_000n, asOf: '2026-10-17', unmatched: false });
    expect(cardEmiOutstanding([row('2026-10-17', 6_000_000n, 0n), row('2026-11-17', 0n, 500_000n)])).toEqual({ outstanding: 5_500_000n, asOf: '2026-11-17', unmatched: false });
  });

  it('a second conversion on the same card adds to the same figure', () => {
    const rows = [row('2026-10-17', 6_000_000n, 0n), row('2026-11-17', 1_200_000n, 500_000n), row('2026-12-17', 0n, 600_000n)];
    expect(cardEmiOutstanding(rows)).toEqual({ outstanding: 6_100_000n, asOf: '2026-12-17', unmatched: false });
  });

  it('is as at the card’s latest statement, even one that converted and billed nothing', () => {
    expect(cardEmiOutstanding([row('2026-10-17', 6_000_000n, 0n), row('2026-11-17', 0n, 0n)]).asOf).toBe('2026-11-17');
  });

  it('is the same whatever order the statements were recorded in', () => {
    const rows = [row('2026-11-17', 0n, 500_000n), row('2026-10-17', 6_000_000n, 0n)];
    expect(cardEmiOutstanding(rows)).toEqual({ outstanding: 5_500_000n, asOf: '2026-11-17', unmatched: false });
  });

  it('never goes below nothing: principal billed on a plan the card never stated as converted owes nothing more, and a later conversion starts from nothing', () => {
    expect(cardEmiOutstanding([row('2026-10-17', 0n, 500_000n)]).outstanding).toBe(0n);
    expect(cardEmiOutstanding([row('2026-10-17', 0n, 500_000n), row('2026-11-17', 6_000_000n, 0n)]).outstanding).toBe(6_000_000n);
  });

  it('is nothing, as at no date, for a card with no statements', () => {
    expect(cardEmiOutstanding([])).toEqual({ outstanding: 0n, asOf: null, unmatched: false });
  });
});

describe('CY-I17 — the debt is made, kept and closed from the same figures', () => {
  const converted = [row('2026-10-17', 6_000_000n, 0n)];

  it('makes the debt when the person ticked it, with the outstanding at the statement date', () => {
    expect(planCardEmiDebt({ rows: converted, debt: null, add: true })).toEqual({ create: true, outstanding: 6_000_000n, asOf: '2026-10-17', closed: false, changesStatus: true });
  });

  it('makes nothing when it is unticked, or when the card converted nothing', () => {
    expect(planCardEmiDebt({ rows: converted, debt: null, add: false })).toBeNull();
    expect(planCardEmiDebt({ rows: [row('2026-10-17', 0n, 0n)], debt: null, add: true })).toBeNull();
  });

  it('keeps an existing debt, whether or not it is ticked again, and writes nothing when it already says so', () => {
    const debt = { outstanding: 6_000_000n, asOf: '2026-10-17', isClosed: false };
    expect(planCardEmiDebt({ rows: converted, debt, add: false })).toBeNull();
    const later = [...converted, row('2026-11-17', 0n, 500_000n)];
    expect(planCardEmiDebt({ rows: later, debt, add: false })).toEqual({ create: false, outstanding: 5_500_000n, asOf: '2026-11-17', closed: false, changesStatus: false });
  });

  it('closes the debt on the statement that takes it to nothing, and reopens it when the card converts again', () => {
    const paidOff = [...converted, row('2026-11-17', 0n, 6_000_000n)];
    const open = { outstanding: 6_000_000n, asOf: '2026-10-17', isClosed: false };
    expect(planCardEmiDebt({ rows: paidOff, debt: open, add: false })).toEqual({ create: false, outstanding: 0n, asOf: '2026-11-17', closed: true, changesStatus: true });
    const closed = { outstanding: 0n, asOf: '2026-11-17', isClosed: true };
    const again = [...paidOff, row('2026-12-17', 1_000_000n, 0n)];
    expect(planCardEmiDebt({ rows: again, debt: closed, add: false })).toEqual({ create: false, outstanding: 1_000_000n, asOf: '2026-12-17', closed: false, changesStatus: true });
  });

  it('closes once: a debt that stays at nothing is not closed again on each later statement', () => {
    const paidOff = [...converted, row('2026-11-17', 0n, 6_000_000n), row('2026-12-17', 0n, 0n)];
    const closed = { outstanding: 0n, asOf: '2026-11-17', isClosed: true };
    expect(planCardEmiDebt({ rows: paidOff, debt: closed, add: false })).toEqual({ create: false, outstanding: 0n, asOf: '2026-12-17', closed: true, changesStatus: false });
    const open = { outstanding: 6_000_000n, asOf: '2026-10-17', isClosed: false };
    expect(planCardEmiDebt({ rows: paidOff.slice(0, 2), debt: open, add: false })).toMatchObject({ closed: true, changesStatus: true });
  });

  it('says when what was billed could not all be matched to a plan the card converted', () => {
    expect(cardEmiOutstanding([row('2026-10-17', 0n, 500_000n), row('2026-11-17', 6_000_000n, 500_000n)])).toEqual({ outstanding: 5_500_000n, asOf: '2026-11-17', unmatched: true });
    expect(cardEmiOutstanding([row('2026-10-17', 6_000_000n, 0n), row('2026-11-17', 0n, 500_000n)]).unmatched).toBe(false);
  });

  it('writes again when only the closed state differs', () => {
    expect(planCardEmiDebt({ rows: converted, debt: { outstanding: 6_000_000n, asOf: '2026-10-17', isClosed: true }, add: false })).toEqual({ create: false, outstanding: 6_000_000n, asOf: '2026-10-17', closed: false, changesStatus: true });
  });
});
