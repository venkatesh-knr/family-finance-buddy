/**
 * How many units a position holds, and whether its history agrees.
 *
 * "How much is this worth" and "what did it cost" have different sources. A
 * statement's closing balance is the registrar's own count of units on a date;
 * the lots are the purchases somebody could see. These fixtures are the first
 * real import, worked by hand: a statement for April to September that itemises
 * 280.479 units of a fund whose closing balance on 30 Sep 2026 is 4,013.730.
 *
 * What is asserted is the split — units come from the closing balance, and the
 * disagreement with the lots is reported rather than absorbed — and that the
 * split does not misfire on the positions that have nothing wrong with them.
 */

import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import { parseQuantity as q } from '../lib/quantity.ts';
import type { Disposal, Lot } from './lots.ts';
import { historyOf, isQualified, unitsHeld, type StatedBalance } from './position.ts';

const inr = (minor: bigint) => money(minor, 'INR');

function lot(id: string, acquiredOn: string, quantity: string): Lot {
  return { id, instrumentId: 'i1', acquiredOn, quantity: q(quantity), cost: inr(100000n) };
}

function sale(id: string, disposedOn: string, quantity: string): Disposal {
  return { id, instrumentId: 'i1', disposedOn, quantity: q(quantity), proceeds: inr(100000n) };
}

const stated = (units: string, asOf: string): StatedBalance => ({ units: q(units), asOf });

// Three instalments in the window the statement covered.
const partial = [
  lot('l1', '2026-04-05', '100.000'),
  lot('l2', '2026-05-05', '100.000'),
  lot('l3', '2026-06-05', '80.479'),
];

describe('a statement that covers only part of the history', () => {
  const closing = stated('4013.730', '2026-09-30');

  it('values the position on the closing balance, not on the purchases it lists', () => {
    expect(unitsHeld({ lots: partial, disposals: [], stated: closing, unstated: q('280.479') })).toBe(
      q('4013.730'),
    );
  });

  it('says the two disagree, and by how much', () => {
    expect(historyOf({ lots: partial, disposals: [], stated: closing })).toEqual({
      kind: 'short',
      lotUnits: q('280.479'),
      statedUnits: q('4013.730'),
      asOf: '2026-09-30',
    });
  });

  it('is qualified, so the return is refused', () => {
    expect(isQualified(historyOf({ lots: partial, disposals: [], stated: closing }))).toBe(true);
  });

  it('carries what happened after the statement on top of the closing balance', () => {
    // An SIP still running after the statement was cut: 10 units bought on
    // 5 Oct and 4 sold on 1 Nov. 4,013.730 + 10 − 4 = 4,019.730.
    const after = [...partial, lot('l4', '2026-10-05', '10.000')];
    const sold = [sale('s1', '2026-11-01', '4.000')];
    expect(unitsHeld({ lots: after, disposals: sold, stated: closing, unstated: 0n })).toBe(
      q('4019.730'),
    );
  });

  it('judges the history as at the statement, not as at today', () => {
    // The October purchase is not part of what the statement could have
    // itemised, so it neither closes the gap nor widens it.
    const after = [...partial, lot('l4', '2026-10-05', '10.000')];
    const history = historyOf({ lots: after, disposals: [], stated: closing });
    expect(history).toMatchObject({ kind: 'short', lotUnits: q('280.479') });
  });

  it('counts a purchase on the statement date itself as already in the balance', () => {
    const onTheDay = [...partial, lot('l4', '2026-09-30', '5.000')];
    expect(unitsHeld({ lots: onTheDay, disposals: [], stated: closing, unstated: 0n })).toBe(
      q('4013.730'),
    );
    expect(historyOf({ lots: onTheDay, disposals: [], stated: closing })).toMatchObject({
      lotUnits: q('285.479'),
    });
  });

  it('is short by everything when no purchase was itemised at all', () => {
    expect(historyOf({ lots: [], disposals: [], stated: closing })).toMatchObject({
      kind: 'short',
      lotUnits: 0n,
    });
  });
});

describe('a statement that agrees with the purchases', () => {
  it('is complete, and the units are the same either way', () => {
    const whole = [lot('l1', '2020-01-10', '4000.000'), lot('l2', '2026-06-05', '13.730')];
    const closing = stated('4013.730', '2026-09-30');
    expect(historyOf({ lots: whole, disposals: [], stated: closing })).toEqual({
      kind: 'complete',
      lotUnits: q('4013.730'),
      statedUnits: q('4013.730'),
      asOf: '2026-09-30',
    });
    expect(unitsHeld({ lots: whole, disposals: [], stated: closing, unstated: 0n })).toBe(
      q('4013.730'),
    );
    expect(isQualified(historyOf({ lots: whole, disposals: [], stated: closing }))).toBe(false);
  });

  it('nets sales made before the statement out of the purchases', () => {
    // 500 bought, 100 redeemed in June, 400 reported in September.
    const purchases = [lot('l1', '2025-01-10', '500.000')];
    const sales = [sale('s1', '2026-06-10', '100.000')];
    const closing = stated('400.000', '2026-09-30');
    expect(historyOf({ lots: purchases, disposals: sales, stated: closing }).kind).toBe('complete');
  });

  it('forgives the third decimal, which is all a registrar prints', () => {
    // Sub-thousandth differences are rounding, not a missing instalment.
    const whole = [lot('l1', '2020-01-10', '4013.72999999')];
    expect(historyOf({ lots: whole, disposals: [], stated: stated('4013.730', '2026-09-30') }).kind).toBe(
      'complete',
    );
  });

  it('does not forgive a thousandth and a bit', () => {
    const whole = [lot('l1', '2020-01-10', '4013.728')];
    expect(historyOf({ lots: whole, disposals: [], stated: stated('4013.730', '2026-09-30') }).kind).toBe(
      'short',
    );
  });
});

describe('purchases that account for more than the statement says', () => {
  it('is marked too, and named as the other way round', () => {
    const lots = [lot('l1', '2020-01-10', '5000.000')];
    const history = historyOf({ lots, disposals: [], stated: stated('4013.730', '2026-09-30') });
    expect(history).toMatchObject({ kind: 'over', lotUnits: q('5000.000') });
    expect(isQualified(history)).toBe(true);
  });
});

describe('a position with no statement behind it', () => {
  it('is unstated, and is not qualified', () => {
    const history = historyOf({ lots: partial, disposals: [], stated: null });
    expect(history).toEqual({ kind: 'unstated' });
    expect(isQualified(history)).toBe(false);
  });

  it('keeps whatever the caller derived, exactly as before', () => {
    expect(unitsHeld({ lots: partial, disposals: [], stated: null, unstated: q('280.479') })).toBe(
      q('280.479'),
    );
  });
});
