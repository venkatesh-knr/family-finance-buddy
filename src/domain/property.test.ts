import { describe, expect, it } from 'vitest';
import { money } from '../lib/money.ts';
import {
  latestValuationOn,
  propertyCostBasis,
  propertyEquity,
  shareOfMoney,
  valuationAge,
  type PropertyImprovement,
  type PropertyValuationPoint,
} from './property.ts';

/**
 * What a property cost, for the day it is sold.
 *
 * docs/blueprint.md, Property: "Purchase price, stamp duty and registration all form part of what you actually paid
 * ... Capital improvements are dated entries that add to the basis; repairs are recorded but don't." These are the
 * known answers, worked by hand in rupees, written before the function.
 */

const inr = (rupees: number) => money(BigInt(Math.round(rupees * 100)), 'INR');
const usd = (dollars: number) => money(BigInt(Math.round(dollars * 100)), 'USD');

const improvement = (date: string, rupees: number, isCapital: boolean): PropertyImprovement => ({
  date,
  amount: inr(rupees),
  isCapital,
});

describe('the cost of a property is everything paid to hold it', () => {
  it('adds the price, the stamp duty and the registration', () => {
    // 80,00,000 + 5,60,000 (7%) + 80,000 (1%) = 86,40,000.
    const result = propertyCostBasis({
      purchaseCost: inr(8_000_000),
      stampDuty: inr(560_000),
      registration: inr(80_000),
      improvements: [],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.whole).toEqual(inr(8_640_000));
    expect(result.share).toEqual(inr(8_640_000));
    expect(result.capitalImprovements).toEqual(inr(0));
  });

  it('allows a nil stamp duty and registration, as on a gift or an inheritance', () => {
    const result = propertyCostBasis({
      purchaseCost: inr(2_500_000),
      stampDuty: inr(0),
      registration: inr(0),
      improvements: [],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.whole).toEqual(inr(2_500_000));
  });
});

describe('capital improvements add to it and repairs do not', () => {
  const base = {
    purchaseCost: inr(8_000_000),
    stampDuty: inr(560_000),
    registration: inr(80_000),
  };

  it('counts the capital work and leaves the repair out, and says what it left out', () => {
    // 86,40,000 + 3,50,000 (a new kitchen) + 1,20,000 (waterproofing) = 91,10,000. The 40,000 repainting is a repair.
    const result = propertyCostBasis({
      ...base,
      improvements: [
        improvement('2019-03-10', 350_000, true),
        improvement('2021-07-02', 120_000, true),
        improvement('2022-01-15', 40_000, false),
      ],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.capitalImprovements).toEqual(inr(470_000));
    expect(result.repairsExcluded).toEqual(inr(40_000));
    expect(result.whole).toEqual(inr(9_110_000));
  });

  it('counts only the work done by the day it is read for, the day itself included', () => {
    const improvements = [
      improvement('2019-03-10', 350_000, true),
      improvement('2021-07-02', 120_000, true),
      improvement('2024-09-01', 200_000, true),
    ];
    const at = (asOf: string) => {
      const result = propertyCostBasis({ ...base, improvements, asOf });
      if (!result.ok) throw new Error('refused');
      return result.whole;
    };
    // A sale on 2 July 2021 takes the work done that day; one on 1 July 2021 does not; the 2024 work is after both.
    expect(at('2021-07-02')).toEqual(inr(9_110_000));
    expect(at('2021-07-01')).toEqual(inr(8_990_000));
    expect(at('2019-03-09')).toEqual(inr(8_640_000));
    // And with no day given, all of it.
    expect(at('2030-01-01')).toEqual(inr(9_310_000));
  });

  it('does not count a repair dated before the day either way', () => {
    const result = propertyCostBasis({ ...base, improvements: [improvement('2019-03-10', 90_000, false)], asOf: '2020-01-01' });
    if (!result.ok) throw new Error('refused');
    expect(result.whole).toEqual(inr(8_640_000));
    expect(result.repairsExcluded).toEqual(inr(90_000));
  });
});

describe("the household's share of a jointly owned property", () => {
  const whole = {
    purchaseCost: inr(8_000_000),
    stampDuty: inr(560_000),
    registration: inr(80_000),
    improvements: [improvement('2019-03-10', 470_000, true)],
  };

  it('is the whole when no share is given', () => {
    const result = propertyCostBasis(whole);
    if (!result.ok) throw new Error('refused');
    expect(result.sharePct).toBe('100');
    expect(result.share).toEqual(result.whole);
  });

  it('is half of the cost for a half share: 91,10,000 becomes 45,55,000', () => {
    const result = propertyCostBasis({ ...whole, sharePct: '50' });
    if (!result.ok) throw new Error('refused');
    expect(result.whole).toEqual(inr(9_110_000));
    expect(result.share).toEqual(inr(4_555_000));
  });

  it('takes a share to two decimal places, in integer arithmetic', () => {
    // 91,10,000 rupees is 911,000,000 paise; 33.33% of that is 303,636,300 paise, exactly (911 x 3333 = 3,036,363).
    const result = propertyCostBasis({ ...whole, sharePct: '33.33' });
    if (!result.ok) throw new Error('refused');
    expect(result.share.minor).toBe(303_636_300n);
  });

  it('rounds a half paisa up, once, on the share and not on the parts', () => {
    // 5 paise at 50% is 2.5: up to 3. 3 paise at 50% is 1.5: up to 2. 4 paise at 33.33% is 1.3332: down to 1.
    const paise = (minor: bigint, sharePct: string) => {
      const result = propertyCostBasis({
        purchaseCost: money(minor, 'INR'),
        stampDuty: money(0n, 'INR'),
        registration: money(0n, 'INR'),
        improvements: [],
        sharePct,
      });
      if (!result.ok) throw new Error('refused');
      return result.share.minor;
    };
    expect(paise(5n, '50')).toBe(3n);
    expect(paise(3n, '50')).toBe(2n);
    expect(paise(4n, '33.33')).toBe(1n);
  });
});

describe('what it refuses', () => {
  const parts = {
    purchaseCost: inr(8_000_000),
    stampDuty: inr(560_000),
    registration: inr(80_000),
    improvements: [] as PropertyImprovement[],
  };

  it('refuses amounts in two currencies rather than adding them', () => {
    expect(propertyCostBasis({ ...parts, stampDuty: usd(7_000) })).toEqual({ ok: false, reason: 'mixed-currency' });
    expect(propertyCostBasis({ ...parts, improvements: [{ date: '2020-01-01', amount: usd(5_000), isCapital: true }] })).toEqual({
      ok: false,
      reason: 'mixed-currency',
    });
  });

  it('reads a property bought abroad in its own currency', () => {
    const result = propertyCostBasis({
      purchaseCost: usd(400_000),
      stampDuty: usd(8_000),
      registration: usd(1_500),
      improvements: [{ date: '2022-05-05', amount: usd(25_000), isCapital: true }],
    });
    if (!result.ok) throw new Error('refused');
    expect(result.whole).toEqual(usd(434_500));
  });

  it('refuses a negative amount', () => {
    expect(propertyCostBasis({ ...parts, purchaseCost: inr(-1) })).toEqual({ ok: false, reason: 'negative-amount' });
    expect(propertyCostBasis({ ...parts, improvements: [improvement('2020-01-01', -5, true)] })).toEqual({
      ok: false,
      reason: 'negative-amount',
    });
  });

  it.each(['0', '100.01', '150', '33.333', '-5', 'half', '', '5%'])('refuses a share of %j', (sharePct) => {
    expect(propertyCostBasis({ ...parts, sharePct })).toEqual({ ok: false, reason: 'invalid-share' });
  });

  it.each(['1', '0.01', '99.99', '100', '100.00', '12.5'])('accepts a share of %j', (sharePct) => {
    expect(propertyCostBasis({ ...parts, sharePct })).toMatchObject({ ok: true });
  });
});

// ─── the rest of what a property screen works out ─────────────────────────────────────────────────────────────────

describe("the household's share of a value", () => {
  it('is the value when the share is the whole of it', () => {
    expect(shareOfMoney(inr(11_000_000), '100')).toEqual({ ok: true, amount: inr(11_000_000) });
  });

  it('is half for a half share, and takes two decimal places', () => {
    expect(shareOfMoney(inr(11_000_000), '50')).toEqual({ ok: true, amount: inr(5_500_000) });
    // 1,10,00,000 rupees is 1,100,000,000 paise; 33.33% of that is 366,630,000 paise, exactly.
    expect(shareOfMoney(inr(11_000_000), '33.33')).toEqual({ ok: true, amount: money(366_630_000n, 'INR') });
  });

  it('rounds half a paisa up, the same rule as the cost', () => {
    expect(shareOfMoney(money(5n, 'INR'), '50')).toEqual({ ok: true, amount: money(3n, 'INR') });
  });

  it.each(['0', '100.01', 'half', ''])('refuses a share of %j', (sharePct) => {
    expect(shareOfMoney(inr(100), sharePct)).toEqual({ ok: false, reason: 'invalid-share' });
  });

  it('refuses a negative value', () => {
    expect(shareOfMoney(inr(-1), '50')).toEqual({ ok: false, reason: 'negative-amount' });
  });
});

describe('the latest valuation on a day', () => {
  const v = (asOf: string, rupees: number): PropertyValuationPoint => ({ asOf, value: inr(rupees) });
  const valuations = [v('2024-04-01', 5_000_000), v('2026-04-01', 6_400_000), v('2025-04-01', 5_600_000)];

  it('is the newest at or before the day, whatever order they come in', () => {
    expect(latestValuationOn(valuations, '2026-12-31')).toEqual(v('2026-04-01', 6_400_000));
    expect(latestValuationOn(valuations, '2026-03-31')).toEqual(v('2025-04-01', 5_600_000));
  });

  it('includes the day itself, so a figure recorded for a day counts that day', () => {
    expect(latestValuationOn(valuations, '2025-04-01')).toEqual(v('2025-04-01', 5_600_000));
  });

  it('does not move an earlier day when a later one is recorded: yesterday stays yesterday', () => {
    const before = latestValuationOn(valuations, '2025-06-30');
    const after = latestValuationOn([...valuations, v('2026-09-01', 7_000_000)], '2025-06-30');
    expect(after).toEqual(before);
  });

  it('is nothing before the first, and nothing when there are none', () => {
    expect(latestValuationOn(valuations, '2024-03-31')).toBeNull();
    expect(latestValuationOn([], '2026-01-01')).toBeNull();
  });
});

describe('how old a valuation is, and when it is stale', () => {
  it('is twelve months old on its anniversary and not yet stale: stale is past the setting, not at it', () => {
    expect(valuationAge('2025-10-26', '2026-10-26', 12)).toEqual({ months: 12, stale: false });
  });

  it('is stale the day after', () => {
    expect(valuationAge('2025-10-26', '2026-10-27', 12)).toEqual({ months: 12, stale: true });
  });

  it('counts whole months: 3 April to 1 September is four', () => {
    expect(valuationAge('2026-04-03', '2026-09-01', 12)).toEqual({ months: 4, stale: false });
  });

  it('is stale at seventeen months, as the prototype shows one', () => {
    expect(valuationAge('2025-04-03', '2026-09-10', 12)).toEqual({ months: 17, stale: true });
  });

  it('ends a month on its last day when the day does not exist: 31 January plus one month is 28 February', () => {
    expect(valuationAge('2025-01-31', '2025-02-28', 1).stale).toBe(false);
    expect(valuationAge('2025-01-31', '2025-03-01', 1).stale).toBe(true);
  });

  it('is nought months and not stale for a valuation dated after today', () => {
    expect(valuationAge('2026-12-01', '2026-10-26', 12)).toEqual({ months: 0, stale: false });
  });

  it('follows the household setting', () => {
    expect(valuationAge('2026-01-01', '2026-08-01', 6)).toEqual({ months: 7, stale: true });
    expect(valuationAge('2026-01-01', '2026-08-01', 12)).toEqual({ months: 7, stale: false });
  });
});

describe('equity after the loan', () => {
  it('is the value less what is outstanding', () => {
    // 55,00,000 less 20,00,000.
    expect(propertyEquity(inr(5_500_000), inr(2_000_000))).toEqual({ ok: true, equity: inr(3_500_000) });
  });

  it('is the value when there is no loan', () => {
    expect(propertyEquity(inr(5_500_000), null)).toEqual({ ok: true, equity: inr(5_500_000) });
  });

  it('can be negative: a loan larger than the property is said, not floored at nothing', () => {
    expect(propertyEquity(inr(1_000_000), inr(1_500_000))).toEqual({ ok: true, equity: inr(-500_000) });
  });

  it('refuses a loan in another currency rather than subtracting across them', () => {
    expect(propertyEquity(inr(5_500_000), usd(10_000))).toEqual({ ok: false, reason: 'mixed-currency' });
  });
});
