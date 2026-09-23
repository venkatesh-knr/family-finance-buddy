/**
 * Netting equity capital gains for a tax year, and the ₹1.25 lakh allowance.
 *
 * docs/blueprint.md's pipeline: "Net short-term losses against any gains;
 * long-term losses against long-term gains only" then "Exempt — apply the
 * ₹1.25 lakh equity allowance to long-term equity gains." This module is
 * those two steps, for listed equity and equity mutual funds only — the one
 * asset group the allowance applies to, per the seeded `tax_rule` rows.
 *
 * Deliberately narrower than the whole engine. Carrying an unrelieved loss
 * into a later year needs `loss_carry_forward`, which does not exist yet; this
 * reports the amount and does not pretend to carry it anywhere. Gold, debt
 * funds, foreign equity, unlisted equity and property are out of scope —
 * "short-term losses against any gains" is the general rule, but netting
 * across every asset class is a later slice, not this one.
 *
 * Written before the implementation, as anything numeric is.
 */

import { describe, expect, it } from 'vitest';
import { money, type Money } from '../lib/money.ts';
import { netEquityGains, type ExcludedParcel } from './capital-gains.ts';
import type { Parcel } from './lots.ts';
import type { TaxRule } from './tax-rules.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');

const rules: readonly TaxRule[] = [
  {
    jurisdiction: 'IN',
    kind: 'holding_period',
    assetClass: 'listed_equity',
    months: 12,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024, s. 2(42A)',
    bandFromMinor: null,
    bandToMinor: null,
  },
  {
    jurisdiction: 'IN',
    kind: 'holding_period',
    assetClass: 'equity_fund',
    months: 12,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024, s. 2(42A)',
    bandFromMinor: null,
    bandToMinor: null,
  },
  {
    jurisdiction: 'IN',
    kind: 'holding_period',
    assetClass: 'gold',
    months: 24,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024, s. 2(42A)',
    bandFromMinor: null,
    bandToMinor: null,
  },
  {
    jurisdiction: 'IN',
    kind: 'exemption',
    assetClass: 'listed_equity',
    months: null,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024, s. 112A — annual exemption',
    bandFromMinor: 0n,
    bandToMinor: 12_500_000n,
  },
  {
    jurisdiction: 'IN',
    kind: 'exemption',
    assetClass: 'equity_fund',
    months: null,
    ratePct: null,
    term: null,
    effectiveFrom: '2024-07-23',
    effectiveTo: null,
    authority: 'Finance (No. 2) Act 2024, s. 112A — annual exemption',
    bandFromMinor: 0n,
    bandToMinor: 12_500_000n,
  },
];

function parcel(
  over: Partial<Parcel> & { id: string; instrumentId: string; acquiredOn: string; disposedOn: string; gain: Money },
): Parcel {
  return {
    lotId: `${over.id}-lot`,
    disposalId: `${over.id}-disposal`,
    quantity: 1n,
    cost: money(0n, over.gain.currency),
    proceeds: over.gain,
    heldDays: 0,
    ...over,
  };
}

// Listed equity, held past twelve months from the fixed point of 2026-09-18.
const lt = (id: string, gain: Money, instrumentId = 'listed-1') =>
  parcel({ id, instrumentId, acquiredOn: '2024-08-01', disposedOn: '2026-09-18', gain });

// Listed equity, held under twelve months.
const st = (id: string, gain: Money, instrumentId = 'listed-1') =>
  parcel({ id, instrumentId, acquiredOn: '2026-06-01', disposedOn: '2026-09-18', gain });

const assetClassOf = new Map([
  ['listed-1', 'listed_equity' as const],
  ['fund-1', 'equity_fund' as const],
  ['gold-1', 'gold' as const],
]);

describe('netEquityGains', () => {
  it('nets short-term gains together with no allowance involved', () => {
    const result = netEquityGains({
      parcels: [st('a', inr(50_000)), st('b', inr(20_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.shortTerm.net).toEqual(inr(70_000));
    expect(result.shortTerm.taxable).toEqual(inr(70_000));
    expect(result.longTerm.net).toEqual(inr(0));
    expect(result.unrelieved.shortTerm).toBeNull();
  });

  it('exempts a long-term gain under the allowance in full', () => {
    const result = netEquityGains({
      parcels: [lt('a', inr(90_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.longTerm.exemption?.used).toEqual(inr(90_000));
    expect(result.longTerm.taxable).toEqual(inr(0));
  });

  it('taxes only what is left after ₹1.25 lakh, on a gain that exceeds it', () => {
    const result = netEquityGains({
      parcels: [lt('a', inr(300_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.longTerm.exemption?.available).toEqual(inr(125_000));
    expect(result.longTerm.exemption?.used).toEqual(inr(125_000));
    expect(result.longTerm.taxable).toEqual(inr(175_000));
  });

  it('exempts exactly the allowance and nothing more on the boundary', () => {
    const result = netEquityGains({
      parcels: [lt('a', inr(125_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.longTerm.exemption?.used).toEqual(inr(125_000));
    expect(result.longTerm.taxable).toEqual(inr(0));
  });

  it('sets a short-term loss off against a long-term gain before the allowance applies', () => {
    // ST loss ₹40,000 brings the ₹2,00,000 LT gain down to ₹1,60,000 before
    // the ₹1,25,000 allowance, leaving ₹35,000 taxable.
    const result = netEquityGains({
      parcels: [st('a', inr(-40_000)), lt('b', inr(200_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.setOffAgainstLongTerm).toEqual(inr(40_000));
    expect(result.longTerm.net).toEqual(inr(200_000));
    expect(result.longTerm.exemption?.used).toEqual(inr(125_000));
    expect(result.longTerm.taxable).toEqual(inr(35_000));
    expect(result.shortTerm.taxable).toEqual(inr(0));
    expect(result.unrelieved.shortTerm).toBeNull();
  });

  it('leaves an unrelieved short-term loss once it exceeds the long-term gain it offset', () => {
    const result = netEquityGains({
      parcels: [st('a', inr(-300_000)), lt('b', inr(200_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.setOffAgainstLongTerm).toEqual(inr(200_000));
    expect(result.longTerm.taxable).toEqual(inr(0));
    expect(result.longTerm.exemption?.used).toEqual(inr(0));
    expect(result.shortTerm.taxable).toEqual(inr(0));
    expect(result.unrelieved.shortTerm).toEqual(inr(100_000));
  });

  it('never lets a long-term loss reduce a short-term gain', () => {
    // "Long-term losses against long-term gains only." A ₹50,000 LT loss
    // must not touch the ₹80,000 ST gain, however tempting the total looks.
    const result = netEquityGains({
      parcels: [lt('a', inr(-50_000)), st('b', inr(80_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.setOffAgainstLongTerm).toEqual(inr(0));
    expect(result.shortTerm.taxable).toEqual(inr(80_000));
    expect(result.unrelieved.longTerm).toEqual(inr(50_000));
  });

  it('reports both losses as unrelieved when there is nothing to set off against', () => {
    const result = netEquityGains({
      parcels: [st('a', inr(-20_000)), lt('b', inr(-30_000))],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.setOffAgainstLongTerm).toEqual(inr(0));
    expect(result.unrelieved.shortTerm).toEqual(inr(20_000));
    expect(result.unrelieved.longTerm).toEqual(inr(30_000));
    expect(result.shortTerm.taxable).toEqual(inr(0));
    expect(result.longTerm.taxable).toEqual(inr(0));
    expect(result.longTerm.exemption?.used).toEqual(inr(0));
  });

  it('combines listed shares and equity funds under one allowance, not one each', () => {
    const result = netEquityGains({
      parcels: [lt('a', inr(100_000), 'listed-1'), lt('b', inr(100_000), 'fund-1')],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.longTerm.net).toEqual(inr(200_000));
    expect(result.longTerm.exemption?.used).toEqual(inr(125_000));
    expect(result.longTerm.taxable).toEqual(inr(75_000));
  });

  it('excludes a gold parcel rather than treating it as equity', () => {
    const result = netEquityGains({
      parcels: [lt('a', inr(100_000)), lt('b', inr(50_000), 'gold-1')],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.longTerm.net).toEqual(inr(100_000));
  });

  it('excludes a parcel whose instrument has no tax asset class, and says why', () => {
    const result = netEquityGains({
      parcels: [lt('a', inr(100_000), 'unknown-1')],
      assetClassOf,
      rules,
      fy: 2026,
    });
    expect(result.longTerm.net).toEqual(inr(0));
    expect(result.excluded).toEqual<readonly ExcludedParcel[]>([
      { lotId: 'a-lot', disposalId: 'a-disposal', instrumentId: 'unknown-1', reason: 'unclassified-asset' },
    ]);
  });

  it('excludes a sale with no holding-period rule for its date, and says why', () => {
    // Before the regime this fixture seeds — 2024-07-23.
    const early = parcel({
      id: 'a',
      instrumentId: 'listed-1',
      acquiredOn: '2022-01-01',
      disposedOn: '2024-01-01',
      gain: inr(100_000),
    });
    const result = netEquityGains({ parcels: [early], assetClassOf, rules, fy: 2023 });
    expect(result.excluded).toEqual<readonly ExcludedParcel[]>([
      { lotId: 'a-lot', disposalId: 'a-disposal', instrumentId: 'listed-1', reason: 'no-rule-for-date' },
    ]);
  });

  it('only counts sales within the tax year asked about', () => {
    const inYear = lt('a', inr(50_000));
    const before = parcel({
      id: 'b',
      instrumentId: 'listed-1',
      acquiredOn: '2024-08-01',
      disposedOn: '2026-03-31',
      gain: inr(999_000),
    });
    const result = netEquityGains({ parcels: [inYear, before], assetClassOf, rules, fy: 2026 });
    expect(result.longTerm.net).toEqual(inr(50_000));
  });

  it('refuses the exemption, rather than assuming zero, when no rule covers the year', () => {
    const noExemption = rules.filter((r) => r.kind !== 'exemption');
    const result = netEquityGains({
      parcels: [lt('a', inr(300_000))],
      assetClassOf,
      rules: noExemption,
      fy: 2026,
    });
    expect(result.longTerm.exemption).toBeNull();
    expect(result.longTerm.taxable).toBeNull();
  });

  it('has nothing to net for a year with no parcels', () => {
    const result = netEquityGains({ parcels: [], assetClassOf, rules, fy: 2026 });
    expect(result.shortTerm.net).toEqual(inr(0));
    expect(result.longTerm.net).toEqual(inr(0));
    expect(result.window).toEqual({ start: '2026-04-01', end: '2027-03-31' });
  });
});
