/**
 * Netting capital gains across asset classes, for one person and one tax year.
 *
 * docs/blueprint.md's pipeline: "Net — short-term losses against any gains;
 * long-term losses against long-term gains only" then "Exempt — apply the
 * ₹1.25 lakh equity allowance to long-term equity gains." The equity slice came
 * first. This is the same two steps across the rest of what the app can honestly
 * net: gold and unlisted shares as well as listed equity and equity funds.
 *
 * Four buckets, because the four are taxed four ways:
 *
 *   equity short   20%
 *   equity long    12.5% after the ₹1.25 lakh allowance — and only this bucket
 *                  has one
 *   other long     12.5%, no allowance (gold, unlisted shares)
 *   other short    the taxpayer's slab, which is not built yet, so it is an
 *                  amount to add to income and never a tax
 *
 * What it will not net, and says so by name: foreign equity (needs the
 * prescribed exchange rate, which is not stored), debt funds (their treatment
 * turns on the ACQUISITION date and `tax_rule` is dated by sale), property (the
 * indexation election), gold disposed at maturity (a Sovereign Gold Bond
 * redeemed with the RBI is exempt), and gifts and transfers, which are not sales.
 *
 * Written before the implementation, as anything numeric is. Every figure was
 * worked by hand.
 */

import { describe, expect, it } from 'vitest';
import { money, type Money } from '../lib/money.ts';
import {
  capitalGainsTax,
  netCapitalGains,
  placeParcel,
  type ExcludedParcel,
} from './capital-gains.ts';
import type { Parcel } from './lots.ts';
import type { AssetClass, TaxRule } from './tax-rules.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');

// ─── the rules ────────────────────────────────────────────────────────────

const base = {
  jurisdiction: 'IN',
  months: null,
  ratePct: null,
  term: null,
  effectiveFrom: '2024-07-23',
  effectiveTo: null,
  bandFromMinor: null,
  bandToMinor: null,
  regime: null,
  amountMinor: null,
  subject: null,
  verifiedOn: null,
} as const;

const holdingPeriod = (assetClass: AssetClass, months: number): TaxRule => ({
  ...base,
  kind: 'holding_period',
  assetClass,
  months,
  authority: 'Finance (No. 2) Act 2024, s. 2(42A)',
});

const cgRate = (assetClass: AssetClass, term: 'long' | 'short', ratePct: string): TaxRule => ({
  ...base,
  kind: 'cg_rate',
  assetClass,
  term,
  ratePct,
  authority: term === 'long' ? 'Finance (No. 2) Act 2024, s. 112A/112' : 'Finance (No. 2) Act 2024, s. 111A',
});

const exemption = (assetClass: AssetClass): TaxRule => ({
  ...base,
  kind: 'exemption',
  assetClass,
  bandFromMinor: 0n,
  bandToMinor: 12_500_000n,
  authority: 'Finance (No. 2) Act 2024, s. 112A — annual exemption',
});

const rules: readonly TaxRule[] = [
  holdingPeriod('listed_equity', 12),
  holdingPeriod('equity_fund', 12),
  holdingPeriod('gold', 24),
  holdingPeriod('unlisted_equity', 24),
  holdingPeriod('foreign_equity', 24),
  holdingPeriod('property', 24),
  exemption('listed_equity'),
  exemption('equity_fund'),
  cgRate('listed_equity', 'long', '12.500'),
  cgRate('equity_fund', 'long', '12.500'),
  cgRate('gold', 'long', '12.500'),
  cgRate('unlisted_equity', 'long', '12.500'),
  cgRate('listed_equity', 'short', '20.000'),
  cgRate('equity_fund', 'short', '20.000'),
];

// ─── the parcels ──────────────────────────────────────────────────────────

function parcel(
  id: string,
  instrumentId: string,
  acquiredOn: string,
  disposedOn: string,
  gain: Money,
): Parcel {
  return {
    lotId: `${id}-lot`,
    disposalId: `${id}-disposal`,
    instrumentId,
    acquiredOn,
    disposedOn,
    quantity: 1n,
    cost: money(0n, gain.currency),
    proceeds: gain,
    gain,
    heldDays: 0,
  };
}

// Held past twelve months, and past twenty-four, as at 2026-09-18.
const lt = (id: string, gain: Money, instrumentId = 'listed-1') =>
  parcel(id, instrumentId, '2024-08-01', '2026-09-18', gain);

// Held under twelve months.
const st = (id: string, gain: Money, instrumentId = 'listed-1') =>
  parcel(id, instrumentId, '2026-06-01', '2026-09-18', gain);

const assetClassOf = new Map<string, AssetClass | null>([
  ['listed-1', 'listed_equity'],
  ['fund-1', 'equity_fund'],
  ['gold-1', 'gold'],
  ['unlisted-1', 'unlisted_equity'],
  ['foreign-1', 'foreign_equity'],
  ['debt-1', 'debt_fund'],
  ['property-1', 'property'],
]);

const net = (
  parcels: readonly Parcel[],
  over: Partial<{ rules: readonly TaxRule[]; fy: number; kinds: ReadonlyMap<string, string> }> = {},
) =>
  netCapitalGains({
    parcels,
    assetClassOf,
    disposalKindOf: over.kinds ?? new Map(),
    rules: over.rules ?? rules,
    fy: over.fy ?? 2026,
  });

// ═══════════════════════════════════════════════════════ where a sale goes

describe('placeParcel', () => {
  const place = (
    parcelToPlace: Parcel,
    assetClass: AssetClass | null,
    disposalKind: string | null = 'sale',
  ) => placeParcel({ parcel: parcelToPlace, assetClass, disposalKind, rules });

  it('puts listed equity and equity funds in the equity buckets by term', () => {
    expect(place(lt('a', inr(1)), 'listed_equity')).toEqual({ placed: true, bucket: 'equity-long', term: 'long' });
    expect(place(st('a', inr(1)), 'equity_fund')).toEqual({ placed: true, bucket: 'equity-short', term: 'short' });
  });

  it('puts gold and unlisted shares in the other buckets by term', () => {
    expect(place(lt('a', inr(1), 'gold-1'), 'gold')).toEqual({ placed: true, bucket: 'other-long', term: 'long' });
    expect(place(st('a', inr(1), 'unlisted-1'), 'unlisted_equity')).toEqual({
      placed: true,
      bucket: 'other-short',
      term: 'short',
    });
  });

  it('uses twenty-four months for gold where equity gets twelve', () => {
    // The same eighteen months: long for listed equity, short for gold. The
    // reason a term is asked of the class and never assumed.
    const eighteen = parcel('a', 'x', '2025-03-01', '2026-09-18', inr(1));
    expect(place(eighteen, 'listed_equity')).toMatchObject({ bucket: 'equity-long' });
    expect(place(eighteen, 'gold')).toMatchObject({ bucket: 'other-short' });
  });

  it('refuses an instrument with no tax asset class, and gives no term', () => {
    expect(place(lt('a', inr(1)), null)).toEqual({ placed: false, reason: 'unclassified-asset', term: null });
  });

  it('refuses a sale no rule covers, and gives no term', () => {
    const early = parcel('a', 'listed-1', '2022-01-01', '2024-01-01', inr(1));
    expect(place(early, 'listed_equity')).toEqual({ placed: false, reason: 'no-rule-for-date', term: null });
  });

  it('refuses foreign equity — it needs the prescribed rate — but still says the term', () => {
    const usd = parcel('a', 'foreign-1', '2024-08-01', '2026-09-18', money(500n, 'USD'));
    expect(place(usd, 'foreign_equity')).toEqual({ placed: false, reason: 'needs-prescribed-rate', term: 'long' });
  });

  it('refuses a debt fund, whose treatment turns on the acquisition date', () => {
    expect(place(lt('a', inr(1), 'debt-1'), 'debt_fund')).toEqual({
      placed: false,
      reason: 'debt-fund-not-modelled',
      term: null,
    });
  });

  it('refuses property, which carries an indexation election, but still says the term', () => {
    expect(place(lt('a', inr(1), 'property-1'), 'property')).toEqual({
      placed: false,
      reason: 'property-election',
      term: 'long',
    });
  });

  it('refuses gold disposed at maturity — a bond redeemed with the RBI is exempt', () => {
    expect(place(lt('a', inr(1), 'gold-1'), 'gold', 'maturity')).toEqual({
      placed: false,
      reason: 'possibly-exempt',
      term: 'long',
    });
  });

  it('still nets gold redeemed from a fund, which is not the bond case', () => {
    expect(place(lt('a', inr(1), 'gold-1'), 'gold', 'redemption')).toMatchObject({ placed: true });
  });

  it('does not treat a maturity of anything else as exempt', () => {
    expect(place(lt('a', inr(1)), 'listed_equity', 'maturity')).toMatchObject({ placed: true });
  });

  it('refuses a gift or a transfer, which are not sales', () => {
    // A gift recorded with no proceeds would otherwise book the whole cost as
    // a capital loss — a fictitious one, offsetting a real gain.
    expect(place(lt('a', inr(1)), 'listed_equity', 'gift')).toMatchObject({ placed: false, reason: 'not-a-sale' });
    expect(place(lt('a', inr(1)), 'listed_equity', 'transfer')).toMatchObject({ placed: false, reason: 'not-a-sale' });
  });

  it('refuses an equity sale in another currency, which should not happen', () => {
    const usd = parcel('a', 'listed-1', '2024-08-01', '2026-09-18', money(500n, 'USD'));
    expect(place(usd, 'listed_equity')).toMatchObject({ placed: false, reason: 'currency-mismatch' });
  });

  it('treats a sale with no recorded kind as an ordinary sale', () => {
    expect(place(lt('a', inr(1)), 'listed_equity', null)).toMatchObject({ placed: true });
  });
});

// ════════════════════════════════════════ equity only: the slice that shipped

describe('netCapitalGains — listed equity and equity funds', () => {
  it('nets short-term gains together with no allowance involved', () => {
    const result = net([st('a', inr(50_000)), st('b', inr(20_000))]);
    expect(result.equityShort.net).toEqual(inr(70_000));
    expect(result.equityShort.taxable).toEqual(inr(70_000));
    expect(result.equityLong.net).toEqual(inr(0));
    expect(result.losses.short.unrelieved).toBeNull();
  });

  it('exempts a long-term gain under the allowance in full', () => {
    const result = net([lt('a', inr(90_000))]);
    expect(result.equityLong.exemption?.used).toEqual(inr(90_000));
    expect(result.equityLong.taxable).toEqual(inr(0));
  });

  it('taxes only what is left after ₹1.25 lakh, on a gain that exceeds it', () => {
    const result = net([lt('a', inr(300_000))]);
    expect(result.equityLong.exemption?.available).toEqual(inr(125_000));
    expect(result.equityLong.exemption?.used).toEqual(inr(125_000));
    expect(result.equityLong.taxable).toEqual(inr(175_000));
  });

  it('exempts exactly the allowance and nothing more on the boundary', () => {
    const result = net([lt('a', inr(125_000))]);
    expect(result.equityLong.exemption?.used).toEqual(inr(125_000));
    expect(result.equityLong.taxable).toEqual(inr(0));
  });

  it('sets a short-term loss off against a long-term gain before the allowance applies', () => {
    // ST loss ₹40,000 brings the ₹2,00,000 LT gain down to ₹1,60,000 before
    // the ₹1,25,000 allowance, leaving ₹35,000 taxable.
    const result = net([st('a', inr(-40_000)), lt('b', inr(200_000))]);
    expect(result.losses.short.setOff).toEqual(inr(40_000));
    expect(result.equityLong.net).toEqual(inr(200_000));
    expect(result.equityLong.setOff).toEqual(inr(40_000));
    expect(result.equityLong.exemption?.used).toEqual(inr(125_000));
    expect(result.equityLong.taxable).toEqual(inr(35_000));
    expect(result.equityShort.taxable).toEqual(inr(0));
    expect(result.losses.short.unrelieved).toBeNull();
  });

  it('leaves an unrelieved short-term loss once it exceeds the long-term gain it offset', () => {
    const result = net([st('a', inr(-300_000)), lt('b', inr(200_000))]);
    expect(result.losses.short.setOff).toEqual(inr(200_000));
    expect(result.equityLong.taxable).toEqual(inr(0));
    expect(result.equityLong.exemption?.used).toEqual(inr(0));
    expect(result.equityShort.taxable).toEqual(inr(0));
    expect(result.losses.short.unrelieved).toEqual(inr(100_000));
  });

  it('never lets a long-term loss reduce a short-term gain', () => {
    // "Long-term losses against long-term gains only." A ₹50,000 LT loss
    // must not touch the ₹80,000 ST gain, however tempting the total looks.
    const result = net([lt('a', inr(-50_000)), st('b', inr(80_000))]);
    expect(result.losses.long.setOff).toEqual(inr(0));
    expect(result.equityShort.taxable).toEqual(inr(80_000));
    expect(result.losses.long.unrelieved).toEqual(inr(50_000));
  });

  it('reports both losses as unrelieved when there is nothing to set off against', () => {
    const result = net([st('a', inr(-20_000)), lt('b', inr(-30_000))]);
    expect(result.losses.short.setOff).toEqual(inr(0));
    expect(result.losses.short.unrelieved).toEqual(inr(20_000));
    expect(result.losses.long.unrelieved).toEqual(inr(30_000));
    expect(result.equityShort.taxable).toEqual(inr(0));
    expect(result.equityLong.taxable).toEqual(inr(0));
    expect(result.equityLong.exemption?.used).toEqual(inr(0));
  });

  it('combines listed shares and equity funds under one allowance, not one each', () => {
    const result = net([lt('a', inr(100_000), 'listed-1'), lt('b', inr(100_000), 'fund-1')]);
    expect(result.equityLong.net).toEqual(inr(200_000));
    expect(result.equityLong.exemption?.used).toEqual(inr(125_000));
    expect(result.equityLong.taxable).toEqual(inr(75_000));
  });

  it('only counts sales within the tax year asked about', () => {
    const before = parcel('b', 'listed-1', '2024-08-01', '2026-03-31', inr(999_000));
    const after = parcel('c', 'listed-1', '2024-08-01', '2027-04-01', inr(999_000));
    const result = net([lt('a', inr(50_000)), before, after]);
    expect(result.equityLong.net).toEqual(inr(50_000));
  });

  it('refuses the exemption, rather than assuming zero, when no rule covers the year', () => {
    const result = net([lt('a', inr(300_000))], { rules: rules.filter((r) => r.kind !== 'exemption') });
    expect(result.equityLong.exemption).toBeNull();
    expect(result.equityLong.taxable).toBeNull();
  });

  it('has nothing to net for a year with no parcels', () => {
    const result = net([]);
    expect(result.equityShort.net).toEqual(inr(0));
    expect(result.equityLong.net).toEqual(inr(0));
    expect(result.window).toEqual({ start: '2026-04-01', end: '2027-03-31' });
  });
});

// ═════════════════════════════════════════════════════ across asset classes

describe('netCapitalGains — gold and unlisted shares', () => {
  it('nets a long-term gold gain at its own bucket, with no allowance', () => {
    const result = net([lt('a', inr(200_000), 'gold-1')]);
    expect(result.otherLong.net).toEqual(inr(200_000));
    expect(result.otherLong.taxable).toEqual(inr(200_000));
    // The allowance is for equity, and gold does not touch it.
    expect(result.equityLong.exemption?.used).toEqual(inr(0));
  });

  it('nets gold and unlisted shares together, as one long-term bucket', () => {
    const result = net([lt('a', inr(100_000), 'gold-1'), lt('b', inr(60_000), 'unlisted-1')]);
    expect(result.otherLong.net).toEqual(inr(160_000));
  });

  it('does not let a gold gain use the equity allowance', () => {
    // ₹1,25,000 of equity inside the allowance, and ₹1,00,000 of gold beside
    // it: the equity is exempt, the gold is not.
    const result = net([lt('a', inr(125_000)), lt('b', inr(100_000), 'gold-1')]);
    expect(result.equityLong.taxable).toEqual(inr(0));
    expect(result.otherLong.taxable).toEqual(inr(100_000));
  });

  it('carries a short-term gain on gold as an amount for the slab, not a tax', () => {
    const result = net([st('a', inr(20_000), 'gold-1')]);
    expect(result.otherShort.net).toEqual(inr(20_000));
    expect(result.otherShort.taxable).toEqual(inr(20_000));
  });

  it('sets a long-term equity loss off against a long-term gold gain', () => {
    // A long-term loss can offset a long-term gain of any class.
    const result = net([lt('a', inr(-50_000)), lt('b', inr(100_000), 'gold-1')]);
    expect(result.otherLong.setOff).toEqual(inr(50_000));
    expect(result.otherLong.taxable).toEqual(inr(50_000));
    expect(result.losses.long.unrelieved).toBeNull();
  });

  it('sets a long-term gold loss off against a long-term equity gain, before the allowance', () => {
    const result = net([lt('a', inr(-50_000), 'gold-1'), lt('b', inr(200_000))]);
    expect(result.equityLong.setOff).toEqual(inr(50_000));
    // 2,00,000 − 50,000 = 1,50,000; less the allowance 1,25,000 = 25,000.
    expect(result.equityLong.taxable).toEqual(inr(25_000));
  });

  it('sets a short-term equity loss off against a short-term gold gain', () => {
    // A short-term loss offsets a gain in any class, taxed however it is taxed.
    const result = net([st('a', inr(-30_000)), st('b', inr(50_000), 'gold-1')]);
    expect(result.otherShort.setOff).toEqual(inr(30_000));
    expect(result.otherShort.taxable).toEqual(inr(20_000));
    expect(result.losses.short.unrelieved).toBeNull();
  });

  it('spills a short-term loss onward once the first gain is used up', () => {
    // ₹40,000 of loss: ₹30,000 takes the gold gain, and the ₹10,000 left goes
    // on to the long-term equity gain.
    const result = net([st('a', inr(-40_000)), st('b', inr(30_000), 'gold-1'), lt('c', inr(200_000))]);
    expect(result.otherShort.setOff).toEqual(inr(30_000));
    expect(result.equityLong.setOff).toEqual(inr(10_000));
    expect(result.losses.short.setOff).toEqual(inr(40_000));
    expect(result.losses.short.unrelieved).toBeNull();
  });

  it('offsets the equity short-term gain before the slab-taxed one, whose rate is not known yet', () => {
    // The order is a stated policy, not a law: the Act lets the taxpayer
    // choose. A loss goes first against the gain whose rate is known.
    const result = net([st('a', inr(-50_000), 'gold-1'), st('b', inr(80_000))]);
    expect(result.equityShort.setOff).toEqual(inr(50_000));
    expect(result.equityShort.taxable).toEqual(inr(30_000));
  });

  it('offsets a long-term gold gain before a long-term equity one, which the allowance may cover', () => {
    const result = net([
      st('a', inr(-40_000)),
      lt('b', inr(100_000), 'gold-1'),
      lt('c', inr(150_000)),
    ]);
    expect(result.otherLong.setOff).toEqual(inr(40_000));
    expect(result.equityLong.setOff).toEqual(inr(0));
  });

  it('uses the inflexible long-term loss first, so the flexible short-term one is what is left', () => {
    // ₹60,000 of long-term gold gain; a ₹50,000 long-term loss (equity) and a
    // ₹30,000 short-term loss (equity). The long-term loss can only ever go
    // against this gain, so it goes first; the short-term loss then has
    // ₹10,000 left to take, and ₹20,000 of it is unrelieved — the loss that
    // can still be set against anything next year.
    const result = net([lt('a', inr(60_000), 'gold-1'), lt('b', inr(-50_000)), st('c', inr(-30_000))]);
    expect(result.losses.long.setOff).toEqual(inr(50_000));
    expect(result.losses.long.unrelieved).toBeNull();
    expect(result.losses.short.setOff).toEqual(inr(10_000));
    expect(result.losses.short.unrelieved).toEqual(inr(20_000));
    expect(result.otherLong.taxable).toEqual(inr(0));
  });

  it('never uses a short-term loss on a bucket that is itself a loss', () => {
    const result = net([st('a', inr(-20_000)), lt('b', inr(-30_000), 'gold-1')]);
    expect(result.losses.short.setOff).toEqual(inr(0));
    expect(result.losses.long.setOff).toEqual(inr(0));
    expect(result.losses.short.unrelieved).toEqual(inr(20_000));
    expect(result.losses.long.unrelieved).toEqual(inr(30_000));
  });
});

describe('netCapitalGains — what it refuses', () => {
  const excludedOf = (parcels: readonly Parcel[], kinds?: ReadonlyMap<string, string>) =>
    net(parcels, kinds === undefined ? {} : { kinds }).excluded;

  it('names a parcel it cannot place, by parcel and by reason', () => {
    const unclassified = lt('a', inr(100_000), 'mystery-1');
    expect(excludedOf([unclassified])).toEqual<readonly ExcludedParcel[]>([
      { lotId: 'a-lot', disposalId: 'a-disposal', instrumentId: 'mystery-1', reason: 'unclassified-asset' },
    ]);
  });

  it('keeps foreign equity, debt funds and property out of every bucket', () => {
    const usd = parcel('f', 'foreign-1', '2024-08-01', '2026-09-18', money(500_000n, 'USD'));
    const result = net([usd, lt('d', inr(100_000), 'debt-1'), lt('p', inr(100_000), 'property-1')]);

    expect(result.excluded.map((e) => e.reason).sort()).toEqual([
      'debt-fund-not-modelled',
      'needs-prescribed-rate',
      'property-election',
    ]);
    expect(result.equityLong.net).toEqual(inr(0));
    expect(result.otherLong.net).toEqual(inr(0));
    expect(result.otherShort.net).toEqual(inr(0));
  });

  it('keeps a gift out of the figures, so it cannot book a loss', () => {
    const gift = lt('g', inr(-100_000));
    const result = net([gift, lt('a', inr(200_000))], { kinds: new Map([['g-disposal', 'gift']]) });
    expect(result.excluded.map((e) => e.reason)).toEqual(['not-a-sale']);
    expect(result.equityLong.net).toEqual(inr(200_000));
    expect(result.losses.long.total).toEqual(inr(0));
  });

  it('keeps a matured gold bond out, and says why', () => {
    const matured = lt('m', inr(80_000), 'gold-1');
    const result = net([matured], { kinds: new Map([['m-disposal', 'maturity']]) });
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.reason).toBe('possibly-exempt');
    expect(result.otherLong.net).toEqual(inr(0));
  });

  it('does not report a sale outside the year as excluded, because it is simply not this year', () => {
    const early = parcel('a', 'mystery-1', '2022-01-01', '2024-01-01', inr(1));
    expect(net([early], { fy: 2026 }).excluded).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════ the tax

/**
 * What the netted gains cost, before surcharge and cess.
 *
 * Three buckets have a rate of their own, so they get a tax. The fourth —
 * short-term gain on gold and unlisted shares — is taxed at the taxpayer's slab,
 * which needs the rest of their income and is not built. It is handed back as an
 * amount to add to income, and never folded into a total that would then read as
 * complete.
 *
 * Rates come from `tax_rule` as text (`12.500` from `numeric(6,3)`), and every
 * figure is a multiplication of money by a decimal, which is exactly where a
 * float is quietly wrong. Applied in bigint, half a paisa rounding up.
 */
describe('capitalGainsTax', () => {
  const taxed = (parcels: readonly Parcel[], ruleSet: readonly TaxRule[] = rules) =>
    capitalGainsTax(net(parcels, { rules: ruleSet }), ruleSet);

  it('applies 12.5% to the equity long-term gain left after the allowance, and 20% to the short', () => {
    // LT ₹3,00,000 less ₹1,25,000 = ₹1,75,000 at 12.5% = ₹21,875.
    // ST ₹70,000 at 20% = ₹14,000. Together ₹35,875.
    const tax = taxed([lt('a', inr(300_000)), st('b', inr(70_000))]);
    expect(tax.equityLong?.tax).toEqual(inr(21_875));
    expect(tax.equityLong?.ratePct).toBe('12.500');
    expect(tax.equityShort.tax).toEqual(inr(14_000));
    expect(tax.equityShort.ratePct).toBe('20.000');
    expect(tax.total).toEqual(inr(35_875));
  });

  it('applies 12.5% to a long-term gold gain with no allowance', () => {
    // ₹2,00,000 × 12.5% = ₹25,000, every rupee of it.
    const tax = taxed([lt('a', inr(200_000), 'gold-1')]);
    expect(tax.otherLong.taxable).toEqual(inr(200_000));
    expect(tax.otherLong.tax).toEqual(inr(25_000));
    expect(tax.total).toEqual(inr(25_000));
  });

  it('adds the equity and the gold tax together', () => {
    // Equity ₹3,00,000 → ₹21,875. Gold ₹1,00,000 → ₹12,500. Together ₹34,375.
    const tax = taxed([lt('a', inr(300_000)), lt('b', inr(100_000), 'gold-1')]);
    expect(tax.total).toEqual(inr(34_375));
  });

  it('hands back the short-term gold gain as income for the slab, and leaves it out of the total', () => {
    const tax = taxed([lt('a', inr(300_000)), st('b', inr(20_000), 'gold-1')]);
    expect(tax.otherShortAtSlab).toEqual(inr(20_000));
    expect(tax.total).toEqual(inr(21_875));
  });

  it('carries where each rate came from, so a figure can be traced', () => {
    const tax = taxed([lt('a', inr(300_000)), st('b', inr(70_000)), lt('c', inr(1_000), 'gold-1')]);
    expect(tax.equityLong?.authority).toContain('112A');
    expect(tax.equityShort.authority).toContain('111A');
    expect(tax.otherLong.authority).toContain('112');
  });

  it('rounds a half paisa up, in integers', () => {
    // ₹100.04 = 10,004 paise. At 12.5% that is 1,250.5 → 1,251, not 1,250.
    const tax = taxed([lt('a', money(12_500_000n + 10_004n, 'INR'))]);
    expect(tax.equityLong?.tax?.minor).toBe(1_251n);
  });

  it('needs no rate for a bucket with nothing taxable in it', () => {
    // A year of exempt gains never asks the rate table anything, so a missing
    // rate row is not a reason to refuse a tax of zero.
    const noRates = rules.filter((r) => r.kind !== 'cg_rate');
    const tax = taxed([lt('a', inr(90_000))], noRates);
    expect(tax.equityLong?.tax).toEqual(inr(0));
    expect(tax.equityShort.tax).toEqual(inr(0));
    expect(tax.otherLong.tax).toEqual(inr(0));
    expect(tax.total).toEqual(inr(0));
  });

  it('refuses a tax on a taxable gain with no rate to apply, rather than assuming none', () => {
    const noRates = rules.filter((r) => r.kind !== 'cg_rate');
    const tax = taxed([st('a', inr(70_000))], noRates);
    expect(tax.equityShort.taxable).toEqual(inr(70_000));
    expect(tax.equityShort.tax).toBeNull();
    expect(tax.total).toBeNull();
  });

  it('refuses the equity long-term side when the exemption itself is unknown', () => {
    const noExemption = rules.filter((r) => r.kind !== 'exemption');
    const tax = taxed([lt('a', inr(300_000))], noExemption);
    expect(tax.equityLong).toBeNull();
    expect(tax.total).toBeNull();
  });

  it('refuses a bucket whose classes disagree on the rate', () => {
    // Gold and unlisted shares are one bucket, so one rate. Two rates would
    // mean choosing one, which is a guess.
    const disagree = rules.map((r) =>
      r.kind === 'cg_rate' && r.assetClass === 'unlisted_equity' ? { ...r, ratePct: '10.000' } : r,
    );
    const tax = taxed([lt('a', inr(100_000), 'gold-1')], disagree);
    expect(tax.otherLong.tax).toBeNull();
    expect(tax.total).toBeNull();
  });
});

/**
 * The basic exemption, used up by capital gains when nothing else uses it.
 *
 * For a resident individual whose other income falls short of the basic
 * exemption limit, the shortfall is set against the gains before they are taxed:
 * a member with no salary and a small gain owes nothing on it. The order is
 * short-term equity, then long-term equity, then other long-term — the short-term
 * gain carries the highest rate. `capitalGainsTax` takes the shortfall as an
 * amount, because working it out needs the other income, which is not this
 * module's to know.
 */
describe('capitalGainsTax with a basic-exemption shortfall', () => {
  const taxedWith = (parcels: readonly Parcel[], shortfallRupees: number) =>
    capitalGainsTax(net(parcels), rules, { basicExemptionShortfall: inr(shortfallRupees) });

  it('does nothing with no shortfall', () => {
    const tax = taxedWith([lt('a', inr(300_000))], 0);
    expect(tax.adjustedForBasicExemption).toEqual(inr(0));
    expect(tax.equityLong?.taxable).toEqual(inr(175_000));
  });

  it('clears a gain the shortfall covers entirely', () => {
    // ₹3,00,000 long-term leaves ₹1,75,000 after the allowance; a ₹4,00,000
    // shortfall covers all of it, and only that much is used.
    const tax = taxedWith([lt('a', inr(300_000))], 400_000);
    expect(tax.adjustedForBasicExemption).toEqual(inr(175_000));
    expect(tax.equityLong?.taxable).toEqual(inr(0));
    expect(tax.total).toEqual(inr(0));
  });

  it('takes the short-term equity gain first, then the long-term, then other long-term', () => {
    // Short ₹1,00,000 · long ₹3,25,000 (₹2,00,000 after the allowance) · gold
    // long ₹50,000. A ₹2,50,000 shortfall clears the short (1,00,000) and
    // ₹1,50,000 of the equity long, leaving ₹50,000 there and all of the gold.
    const tax = taxedWith(
      [st('s', inr(100_000)), lt('l', inr(325_000)), lt('g', inr(50_000), 'gold-1')],
      250_000,
    );
    expect(tax.adjustedForBasicExemption).toEqual(inr(250_000));
    expect(tax.equityShort.taxable).toEqual(inr(0));
    expect(tax.equityLong?.taxable).toEqual(inr(50_000));
    expect(tax.otherLong.taxable).toEqual(inr(50_000));
    // 12.5% of 50,000 and of 50,000 = 6,250 + 6,250.
    expect(tax.total).toEqual(inr(12_500));
  });

  it('never touches the short-term gold gain, which is income for the slab and not a gain', () => {
    const tax = taxedWith([st('a', inr(20_000), 'gold-1')], 400_000);
    expect(tax.adjustedForBasicExemption).toEqual(inr(0));
    expect(tax.otherShortAtSlab).toEqual(inr(20_000));
  });
});
