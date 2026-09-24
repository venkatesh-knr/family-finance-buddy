/**
 * Income tax on ordinary income: slabs, then rebate, then surcharge, then cess.
 *
 * docs/blueprint.md's pipeline, steps 5 and 6, on top of the capital gains the
 * netter already produced:
 *
 *   5  Aggregate   add the other heads; apply deductions the chosen regime permits
 *   6  Rate        slabs → rebate → surcharge → 4% cess
 *
 * Every figure below was worked by hand. Two anchor the rest. The prototype's own
 * new-regime example — a salary of ₹24 lakh — comes to ₹2,92,500 under these
 * slabs, which is what `docs/design/prototype.html` prints. And the marginal-relief
 * cases were worked from the definition: tax including surcharge may not exceed
 * the tax at the threshold plus the income above it.
 *
 * What it will not do, and says so by name rather than guess: put a surcharge on
 * capital gains (the 15% cap and its own relief), or apply the rebate's marginal
 * relief where there are capital gains beside the salary. Both return no total,
 * with the reason. A total that quietly left out a part is the failure this is
 * built against.
 *
 * Written before the implementation, as anything numeric is.
 */

import { describe, expect, it } from 'vitest';
import { money, type Money } from '../lib/money.ts';
import { netCapitalGains } from './capital-gains.ts';
import { computeIncomeTax } from './income-tax.ts';
import type { Parcel } from './lots.ts';
import type { AssetClass, Regime, TaxRule } from './tax-rules.ts';

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');

// ─── the rules, exactly as the migration seeds them (paise) ────────────────

const base = {
  jurisdiction: 'IN',
  assetClass: null,
  months: null,
  ratePct: null,
  term: null,
  effectiveFrom: '2025-04-01',
  effectiveTo: null,
  bandFromMinor: null,
  bandToMinor: null,
  regime: null,
  amountMinor: null,
  subject: null,
  verifiedOn: '2026-09-24',
  authority: 'a test',
} as const;

const slab = (regime: Regime, fromRupees: number, toRupees: number | null, rate: string): TaxRule => ({
  ...base,
  kind: 'slab',
  regime,
  bandFromMinor: BigInt(fromRupees) * 100n,
  bandToMinor: toRupees === null ? null : BigInt(toRupees) * 100n,
  ratePct: rate,
});

const surcharge = (regime: Regime, fromRupees: number, toRupees: number | null, rate: string): TaxRule => ({
  ...base,
  kind: 'surcharge',
  regime,
  bandFromMinor: BigInt(fromRupees) * 100n,
  bandToMinor: toRupees === null ? null : BigInt(toRupees) * 100n,
  ratePct: rate,
});

const LAKH = 100_000;
const CRORE = 100 * LAKH;

const incomeRules: readonly TaxRule[] = [
  slab('new', 0, 4 * LAKH, '0'),
  slab('new', 4 * LAKH, 8 * LAKH, '5'),
  slab('new', 8 * LAKH, 12 * LAKH, '10'),
  slab('new', 12 * LAKH, 16 * LAKH, '15'),
  slab('new', 16 * LAKH, 20 * LAKH, '20'),
  slab('new', 20 * LAKH, 24 * LAKH, '25'),
  slab('new', 24 * LAKH, null, '30'),

  slab('old', 0, 2.5 * LAKH, '0'),
  slab('old', 2.5 * LAKH, 5 * LAKH, '5'),
  slab('old', 5 * LAKH, 10 * LAKH, '20'),
  slab('old', 10 * LAKH, null, '30'),

  surcharge('new', 50 * LAKH, CRORE, '10'),
  surcharge('new', CRORE, 2 * CRORE, '15'),
  surcharge('new', 2 * CRORE, null, '25'),
  surcharge('old', 50 * LAKH, CRORE, '10'),
  surcharge('old', CRORE, 2 * CRORE, '15'),
  surcharge('old', 2 * CRORE, 5 * CRORE, '25'),
  surcharge('old', 5 * CRORE, null, '37'),

  { ...base, kind: 'rebate', regime: 'new', bandFromMinor: 0n, bandToMinor: 120_000_000n, amountMinor: 6_000_000n },
  { ...base, kind: 'rebate', regime: 'old', bandFromMinor: 0n, bandToMinor: 50_000_000n, amountMinor: 1_250_000n },

  { ...base, kind: 'deduction_cap', regime: 'new', subject: 'standard_deduction', amountMinor: 7_500_000n },
  { ...base, kind: 'deduction_cap', regime: 'old', subject: 'standard_deduction', amountMinor: 5_000_000n },

  { ...base, kind: 'cess', ratePct: '4' },
];

// The capital-gains rules, so the special-rate income has somewhere to be rated.
const gainRule = (over: Partial<TaxRule> & Pick<TaxRule, 'kind' | 'assetClass'>): TaxRule => ({
  ...base,
  effectiveFrom: '2024-07-23',
  ...over,
});

const cgRules: readonly TaxRule[] = [
  ...(['listed_equity', 'equity_fund', 'gold'] as const).map((assetClass) =>
    gainRule({ kind: 'holding_period', assetClass, months: assetClass === 'gold' ? 24 : 12 }),
  ),
  gainRule({ kind: 'exemption', assetClass: 'listed_equity', bandFromMinor: 0n, bandToMinor: 12_500_000n }),
  gainRule({ kind: 'exemption', assetClass: 'equity_fund', bandFromMinor: 0n, bandToMinor: 12_500_000n }),
  ...(['listed_equity', 'equity_fund'] as const).flatMap((assetClass) => [
    gainRule({ kind: 'cg_rate', assetClass, term: 'long', ratePct: '12.500' }),
    gainRule({ kind: 'cg_rate', assetClass, term: 'short', ratePct: '20.000' }),
  ]),
  gainRule({ kind: 'cg_rate', assetClass: 'gold', term: 'long', ratePct: '12.500' }),
];

const rules: readonly TaxRule[] = [...incomeRules, ...cgRules];

// ─── the capital gains, from parcels ───────────────────────────────────────

function parcel(id: string, instrumentId: string, acquiredOn: string, gain: Money): Parcel {
  return {
    lotId: `${id}-lot`,
    disposalId: `${id}-disposal`,
    instrumentId,
    acquiredOn,
    disposedOn: '2026-09-18',
    quantity: 1n,
    cost: money(0n, 'INR'),
    proceeds: gain,
    gain,
    heldDays: 0,
  };
}

const longEquity = (rupees: number) => parcel('le', 'eq', '2024-08-01', inr(rupees));
const shortEquity = (rupees: number) => parcel('se', 'eq', '2026-06-01', inr(rupees));
const shortGold = (rupees: number) => parcel('sg', 'gd', '2026-06-01', inr(rupees));

const assetClassOf = new Map<string, AssetClass | null>([
  ['eq', 'listed_equity'],
  ['gd', 'gold'],
]);

const gainsFrom = (parcels: readonly Parcel[], ruleSet: readonly TaxRule[] = rules, fy = 2026) =>
  netCapitalGains({ parcels, assetClassOf, disposalKindOf: new Map(), rules: ruleSet, fy });

const compute = (
  over: Partial<{
    regime: Regime;
    fy: number;
    salary: number;
    otherIncome: number;
    parcels: readonly Parcel[];
    rules: readonly TaxRule[];
  }> = {},
) => {
  const ruleSet = over.rules ?? rules;
  return computeIncomeTax({
    regime: over.regime ?? 'new',
    fy: over.fy ?? 2026,
    salary: inr(over.salary ?? 0),
    otherIncome: inr(over.otherIncome ?? 0),
    gains: gainsFrom(over.parcels ?? [], ruleSet, over.fy ?? 2026),
    rules: ruleSet,
  });
};

// ═════════════════════════════════════════════════════════ the new regime

describe('the new regime', () => {
  it('reproduces the prototype: a salary of ₹24 lakh is ₹2,92,500', () => {
    // ₹24,00,000 less the ₹75,000 standard deduction is ₹23,25,000.
    // 4–8L 5% = 20,000 · 8–12L 10% = 40,000 · 12–16L 15% = 60,000 ·
    // 16–20L 20% = 80,000 · 20–23.25L 25% of 3,25,000 = 81,250 → 2,81,250.
    // Cess 4% = 11,250. Total 2,92,500.
    const result = compute({ salary: 24 * LAKH });
    expect(result.standardDeduction).toEqual(inr(75_000));
    expect(result.taxableOrdinary).toEqual(inr(2_325_000));
    expect(result.slabTax).toEqual(inr(281_250));
    expect(result.rebate).toEqual(inr(0));
    expect(result.surcharge).toEqual(inr(0));
    expect(result.cess).toEqual(inr(11_250));
    expect(result.total).toEqual(inr(292_500));
    expect(result.refused).toEqual([]);
  });

  it('gives no tax at all up to ₹12 lakh, by the rebate', () => {
    // ₹12,75,000 less ₹75,000 is ₹12,00,000: slab tax 20,000 + 40,000 = 60,000,
    // and the rebate is exactly that.
    const result = compute({ salary: 12.75 * LAKH });
    expect(result.slabTax).toEqual(inr(60_000));
    expect(result.rebate).toEqual(inr(60_000));
    expect(result.taxAfterRebate).toEqual(inr(0));
    expect(result.total).toEqual(inr(0));
  });

  it('softens the cliff just above ₹12 lakh with marginal relief', () => {
    // Taxable ₹12,50,000: slab tax 60,000 + 15% of 50,000 = 67,500. But the tax
    // may not exceed the income above ₹12 lakh, which is 50,000. Cess 2,000.
    const result = compute({ salary: 13.25 * LAKH });
    expect(result.slabTax).toEqual(inr(67_500));
    expect(result.rebate).toEqual(inr(0));
    expect(result.marginalRelief).toEqual(inr(17_500));
    expect(result.taxAfterRebate).toEqual(inr(50_000));
    expect(result.cess).toEqual(inr(2_000));
    expect(result.total).toEqual(inr(52_000));
  });

  it('gives no relief once the slab tax is below the income above the ceiling', () => {
    // Taxable ₹13,00,000: slab tax 75,000, against ₹1,00,000 above the ceiling.
    const result = compute({ salary: 13.75 * LAKH });
    expect(result.marginalRelief).toEqual(inr(0));
    expect(result.taxAfterRebate).toEqual(inr(75_000));
    expect(result.cess).toEqual(inr(3_000));
    expect(result.total).toEqual(inr(78_000));
  });

  it('cannot deduct more than the salary', () => {
    const result = compute({ salary: 50_000 });
    expect(result.standardDeduction).toEqual(inr(50_000));
    expect(result.taxableOrdinary).toEqual(inr(0));
    expect(result.total).toEqual(inr(0));
  });

  it('gives income that is not salary no standard deduction', () => {
    // ₹5,00,000 of interest: 5% of the ₹1,00,000 above ₹4 lakh is 5,000, which
    // the rebate covers.
    const result = compute({ otherIncome: 5 * LAKH });
    expect(result.standardDeduction).toEqual(inr(0));
    expect(result.slabTax).toEqual(inr(5_000));
    expect(result.total).toEqual(inr(0));
  });

  it('adds a short-term gold gain to the income the slab taxes', () => {
    // A ₹18,000 short-term gain on gold is income at the slab, on top of the
    // salary: taxable ₹23,43,000 → 2,00,000 + 25% of 3,43,000 (85,750) =
    // 2,85,750, and cess 11,430.
    const result = compute({ salary: 24 * LAKH, parcels: [shortGold(18_000)] });
    expect(result.shortTermAtSlab).toEqual(inr(18_000));
    expect(result.taxableOrdinary).toEqual(inr(2_343_000));
    expect(result.slabTax).toEqual(inr(285_750));
    expect(result.cess).toEqual(inr(11_430));
    expect(result.total).toEqual(inr(297_180));
  });
});

// ═══════════════════════════════════════════════════════════ the old regime

describe('the old regime', () => {
  it('taxes a salary of ₹24 lakh on the old slabs', () => {
    // Less the ₹50,000 standard deduction: ₹23,50,000. 2.5–5L 5% = 12,500 ·
    // 5–10L 20% = 1,00,000 · 30% of ₹13,50,000 = 4,05,000 → 5,17,500.
    // Cess 20,700. Total 5,38,200.
    const result = compute({ regime: 'old', salary: 24 * LAKH });
    expect(result.standardDeduction).toEqual(inr(50_000));
    expect(result.slabTax).toEqual(inr(517_500));
    expect(result.cess).toEqual(inr(20_700));
    expect(result.total).toEqual(inr(538_200));
  });

  it('gives no tax at ₹5 lakh, by a rebate that is a cliff and not a slope', () => {
    const at = compute({ regime: 'old', salary: 5.5 * LAKH });
    expect(at.taxableOrdinary).toEqual(inr(500_000));
    expect(at.slabTax).toEqual(inr(12_500));
    expect(at.rebate).toEqual(inr(12_500));
    expect(at.total).toEqual(inr(0));

    // ₹10,000 over, and the whole ₹12,500 is gone and more is owed:
    // 12,500 + 20% of 10,000 = 14,500, with cess 580. No marginal relief here.
    const over = compute({ regime: 'old', salary: 5.6 * LAKH });
    expect(over.rebate).toEqual(inr(0));
    expect(over.marginalRelief).toEqual(inr(0));
    expect(over.slabTax).toEqual(inr(14_500));
    expect(over.total).toEqual(inr(15_080));
  });
});

// ═════════════════════════════════════════════════════════════ the surcharge

describe('the surcharge', () => {
  it('adds 10% above ₹50 lakh, where marginal relief does not bind', () => {
    // Taxable ₹60,00,000: 3,00,000 to ₹24 lakh + 30% of ₹36 lakh = 13,80,000.
    // Surcharge 1,38,000; the tax at ₹50 lakh is 10,80,000, so the limit is
    // 10,80,000 + 10,00,000 and 15,18,000 is well inside it. Cess 60,720.
    const result = compute({ salary: 60.75 * LAKH });
    expect(result.slabTax).toEqual(inr(1_380_000));
    expect(result.surcharge).toEqual(inr(138_000));
    expect(result.surchargeRelief).toEqual(inr(0));
    expect(result.cess).toEqual(inr(60_720));
    expect(result.total).toEqual(inr(1_578_720));
  });

  it('gives marginal relief just over ₹50 lakh', () => {
    // Taxable ₹50,10,000: tax 10,80,000 + 30% of 10,000 = 10,83,000. With a 10%
    // surcharge (1,08,300) that is 11,91,300 — but it may not exceed the tax at
    // ₹50 lakh plus the ₹10,000 above it, 10,90,000. So the surcharge is 7,000.
    const result = compute({ salary: 50.85 * LAKH });
    expect(result.slabTax).toEqual(inr(1_083_000));
    expect(result.surcharge).toEqual(inr(7_000));
    expect(result.surchargeRelief).toEqual(inr(101_300));
    expect(result.cess).toEqual(inr(43_600));
    expect(result.total).toEqual(inr(1_133_600));
  });

  it('gives marginal relief just over ₹1 crore, against the tax at ₹1 crore including its 10%', () => {
    // Taxable ₹1,00,10,000: tax at ₹1 crore is 25,80,000, so 28,38,000 with its
    // 10% surcharge. The limit is that plus ₹10,000 = 28,48,000. Tax here is
    // 25,83,000, so the surcharge is 2,65,000 and not 15% (3,87,450).
    const result = compute({ salary: 100.85 * LAKH });
    expect(result.slabTax).toEqual(inr(2_583_000));
    expect(result.surcharge).toEqual(inr(265_000));
    expect(result.cess).toEqual(inr(113_920));
    expect(result.total).toEqual(inr(2_961_920));
  });

  it('reaches 37% in the old regime above ₹5 crore and stops at 25% in the new', () => {
    // Old, taxable ₹6 crore: tax 1,78,12,500; 37% = 65,90,625; cess 9,76,125.
    const old = compute({ regime: 'old', salary: 6 * CRORE + 50_000 });
    expect(old.surcharge).toEqual(inr(6_590_625));
    expect(old.total).toEqual(inr(25_379_250));

    // New, taxable ₹6 crore: tax 3,00,000 + 30% of ₹5.76 crore = 1,75,80,000.
    // The 25% tier, never 37%: surcharge 43,95,000. Relief does not bind (the
    // limit at ₹2 crore is 64,17,000 plus ₹4 crore). Cess 8,79,000.
    const fresh = compute({ regime: 'new', salary: 6 * CRORE + 75_000 });
    expect(fresh.slabTax).toEqual(inr(17_580_000));
    expect(fresh.surcharge).toEqual(inr(4_395_000));
    expect(fresh.total).toEqual(inr(22_854_000));
  });
});

// ═══════════════════════════════════════════════════ capital gains beside it

describe('with capital gains', () => {
  it('taxes equity gains at their own rate and adds them, with cess on the whole', () => {
    // Salary ₹24 lakh: ordinary tax 2,81,250. A ₹1,50,000 long-term equity gain
    // leaves ₹25,000 after the allowance, at 12.5% = 3,125. Cess is 4% of the
    // two together, 2,84,375 → 11,375. Total 2,95,750.
    const result = compute({ salary: 24 * LAKH, parcels: [longEquity(150_000)] });
    expect(result.capitalGains.total).toEqual(inr(3_125));
    expect(result.capitalGainsTaxable).toEqual(inr(25_000));
    expect(result.cess).toEqual(inr(11_375));
    expect(result.total).toEqual(inr(295_750));
  });

  it('gives the rebate against the tax on ordinary income and never against a gain', () => {
    // Salary ₹8,75,000 → taxable ₹8,00,000, slab tax 20,000. A ₹2,25,000 equity
    // gain leaves ₹1,00,000 after the allowance. Total income ₹9 lakh is under
    // ₹12 lakh, so the rebate takes the 20,000 to nothing — and the gain's
    // 12,500 stays. Cess 500. Total 13,000.
    const result = compute({ salary: 8.75 * LAKH, parcels: [longEquity(225_000)] });
    expect(result.rebate).toEqual(inr(20_000));
    expect(result.taxAfterRebate).toEqual(inr(0));
    expect(result.capitalGains.total).toEqual(inr(12_500));
    expect(result.total).toEqual(inr(13_000));
  });

  it('counts the capital gain in the income the rebate is tested against', () => {
    // Salary ₹11,75,000 → taxable ₹11,00,000 (slab 50,000). A ₹2,25,000 gain
    // leaves ₹1,00,000, so total income is ₹12,00,000 exactly: rebate applies.
    // One rupee more of gain would tip it over the ceiling.
    const under = compute({ salary: 11.75 * LAKH, parcels: [longEquity(225_000)] });
    expect(under.rebate).toEqual(inr(50_000));

    const over = compute({ salary: 11.75 * LAKH, parcels: [longEquity(225_001)] });
    expect(over.rebate).toEqual(inr(0));
    expect(over.slabTax).toEqual(inr(50_000));
  });
});

// ═══════════════════════════════════════ income below the basic exemption

describe('income below the basic exemption', () => {
  it('spares a gain when there is no other income to use the exemption', () => {
    // A member with no salary and a ₹2,00,000 equity gain: ₹75,000 after the
    // allowance, and the ₹4 lakh basic exemption is entirely unused, so nothing
    // is taxed. Without this adjustment the ₹75,000 would be taxed at 12.5%.
    const result = compute({ parcels: [longEquity(200_000)] });
    expect(result.basicExemptionAdjustment).toEqual(inr(75_000));
    expect(result.capitalGains.total).toEqual(inr(0));
    expect(result.total).toEqual(inr(0));
  });

  it('uses only what other income has left of the exemption', () => {
    // ₹3,00,000 of interest leaves ₹1,00,000 of the exemption. A gain of
    // ₹1,00,000 after the allowance is spared exactly, and no more.
    const result = compute({ otherIncome: 3 * LAKH, parcels: [longEquity(225_000)] });
    expect(result.basicExemptionAdjustment).toEqual(inr(100_000));
    expect(result.capitalGains.total).toEqual(inr(0));
  });

  it('applies it to the short-term gain first, then the long-term', () => {
    // ₹3,00,000 short-term and ₹2,00,000 long-term after the allowance. The
    // ₹4,00,000 exemption clears the short-term gain and ₹1,00,000 of the
    // long-term, leaving ₹1,00,000 at 12.5% = 12,500, and cess 500.
    const result = compute({ parcels: [shortEquity(300_000), longEquity(325_000)] });
    expect(result.basicExemptionAdjustment).toEqual(inr(400_000));
    expect(result.capitalGains.equityShort.taxable).toEqual(inr(0));
    expect(result.capitalGains.equityLong?.taxable).toEqual(inr(100_000));
    expect(result.capitalGains.total).toEqual(inr(12_500));
    expect(result.total).toEqual(inr(13_000));
  });

  it('does nothing when the ordinary income already uses the whole exemption', () => {
    const result = compute({ salary: 24 * LAKH, parcels: [longEquity(150_000)] });
    expect(result.basicExemptionAdjustment).toEqual(inr(0));
  });
});

// ═════════════════════════════════════════════════════ what it will not do

describe('what it refuses', () => {
  it('gives no total for a surcharge on capital gains, and says why', () => {
    // Above ₹50 lakh with a gain beside it, the surcharge on the gain is capped
    // at 15% and has a relief of its own. That is not modelled, and a total
    // with the ordinary surcharge and no gain surcharge would read as complete.
    const result = compute({ salary: 60.75 * LAKH, parcels: [longEquity(300_000)] });
    expect(result.surcharge).toBeNull();
    expect(result.total).toBeNull();
    expect(result.refused).toContain('surcharge-on-capital-gains');
  });

  it('gives no total for the rebate’s marginal relief beside capital gains, and says why', () => {
    // Taxable ordinary ₹12,50,000 and a ₹10,000 short-term gain: total income
    // ₹12,60,000, slab tax 67,500 against ₹60,000 above the ceiling — inside
    // the relief window, where how relief and a special-rate gain combine is
    // not modelled.
    const result = compute({ salary: 13.25 * LAKH, parcels: [shortEquity(10_000)] });
    expect(result.total).toBeNull();
    expect(result.refused).toContain('rebate-relief-on-capital-gains');
  });

  it('gives no total for a year no rule covers, rather than using another year’s', () => {
    const result = compute({ salary: 24 * LAKH, fy: 2024 });
    expect(result.slabTax).toBeNull();
    expect(result.total).toBeNull();
    expect(result.refused).toEqual(['no-rule-for-year']);
    // What was entered is still there to show.
    expect(result.salary).toEqual(inr(24 * LAKH));
  });

  it('gives no total when a capital gain has no rate to be taxed at', () => {
    const noRates = rules.filter((r) => r.kind !== 'cg_rate');
    const result = compute({ salary: 24 * LAKH, parcels: [shortEquity(70_000)], rules: noRates });
    expect(result.total).toBeNull();
    expect(result.refused).toContain('capital-gains-tax-unknown');
  });
});

// ════════════════════════════════════════════════════════ when it was checked

describe('when the rules were checked', () => {
  it('reports the oldest check among the rules it used, so it is the weakest link that shows', () => {
    const older = rules.map((r) => (r.kind === 'cess' ? { ...r, verifiedOn: '2026-01-10' as const } : r));
    const result = compute({ salary: 24 * LAKH, rules: older });
    expect(result.verifiedOn).toBe('2026-01-10');
  });

  it('reports none, rather than the newest, when any rule it used was never checked', () => {
    const unchecked = rules.map((r) => (r.kind === 'cess' ? { ...r, verifiedOn: null } : r));
    expect(compute({ salary: 24 * LAKH, rules: unchecked }).verifiedOn).toBeNull();
  });
});
