/**
 * One member's sales for one tax year, laid out for the Tax screen.
 *
 * Tax is filed per person, and the ₹1.25 lakh allowance is each person's own —
 * so the unit here is a member, never the household. Two people who each sold
 * ₹1.25 lakh of gain owe nothing; one person who sold ₹2.5 lakh does. Summing
 * a household and netting it once would get both of them wrong in opposite
 * directions, which is why the first assertion below is about exactly that.
 *
 * The other thing worth holding: a sale the netter will not place is still
 * listed, with the reason. Nothing that happened in the year vanishes because
 * the arithmetic cannot handle it yet. Where a sale goes is decided by
 * `placeParcel`, which the netter asks too, so nothing here re-derives it.
 */

import { describe, expect, it } from 'vitest';
import type { Parcel } from '../../domain/lots.ts';
import type { AssetClass, TaxRule } from '../../domain/tax-rules.ts';
import { money } from '../../lib/money.ts';
import { taxLotsFor, type TaxHolding } from './taxLots.ts';

const rule = (assetClass: AssetClass, months: number): TaxRule => ({
  jurisdiction: 'IN',
  kind: 'holding_period',
  assetClass,
  months,
  ratePct: null,
  term: null,
  effectiveFrom: '2024-07-23',
  effectiveTo: null,
  authority: 'Finance (No. 2) Act 2024, s. 2(42A)',
  bandFromMinor: null,
  bandToMinor: null,
});

const rules: readonly TaxRule[] = [
  rule('listed_equity', 12),
  rule('equity_fund', 12),
  rule('gold', 24),
  rule('foreign_equity', 24),
];

function parcel(
  id: string,
  instrumentId: string,
  acquiredOn: string,
  disposedOn: string,
  gainMinor: bigint,
  currency = 'INR',
): Parcel {
  const gain = money(gainMinor, currency);
  return {
    lotId: `${id}-lot`,
    disposalId: `${id}-sale`,
    instrumentId,
    acquiredOn,
    disposedOn,
    quantity: 1n,
    cost: money(0n, currency),
    proceeds: gain,
    gain,
    heldDays: 0,
  };
}

const holding = (
  memberId: string,
  instrumentId: string,
  name: string,
  taxAssetClass: AssetClass | null,
  parcels: readonly Parcel[],
): TaxHolding => ({
  holding: {
    member: { id: memberId },
    instrument: { id: instrumentId, name, taxAssetClass },
  },
  parcels,
});

const long = (id: string, instrumentId: string, gain: bigint) =>
  parcel(id, instrumentId, '2024-08-01', '2026-09-18', gain);

const lots = (
  rows: readonly TaxHolding[],
  over: { memberId?: string; fy?: number; kinds?: ReadonlyMap<string, string> } = {},
) =>
  taxLotsFor({
    rows,
    memberId: over.memberId ?? 'ravi',
    fy: over.fy ?? 2026,
    rules,
    disposalKindOf: over.kinds ?? new Map(),
  });

describe('taxLotsFor', () => {
  it('takes one member at a time, so two allowances are never merged into one', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [long('a', 'i1', 12_500_000n)]),
      holding('meera', 'i2', 'Index fund', 'equity_fund', [long('b', 'i2', 12_500_000n)]),
    ];

    const ravi = lots(rows, { memberId: 'ravi' });
    const meera = lots(rows, { memberId: 'meera' });

    expect(ravi.parcels).toHaveLength(1);
    expect(ravi.parcels[0]?.gain.minor).toBe(12_500_000n);
    expect(meera.parcels).toHaveLength(1);
  });

  it('lists only the sales in the tax year asked about, newest first', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [
        parcel('early', 'i1', '2024-08-01', '2026-04-02', 100n),
        parcel('late', 'i1', '2024-08-01', '2027-03-30', 200n),
        parcel('before', 'i1', '2024-08-01', '2026-03-31', 999n),
        parcel('after', 'i1', '2024-08-01', '2027-04-01', 999n),
      ]),
    ];
    expect(lots(rows).lots.map((l) => l.parcel.disposalId)).toEqual(['late-sale', 'early-sale']);
  });

  it('says a classified equity sale is placed, with its bucket and term', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [
        long('a', 'i1', 500n),
        parcel('s', 'i1', '2026-06-01', '2026-09-18', 100n),
      ]),
    ];
    const byId = Object.fromEntries(lots(rows).lots.map((l) => [l.parcel.disposalId, l]));

    expect(byId['a-sale']).toMatchObject({ term: 'long', placement: { placed: true, bucket: 'equity-long' } });
    expect(byId['s-sale']).toMatchObject({ term: 'short', placement: { placed: true, bucket: 'equity-short' } });
  });

  it('places a gold sale in the other buckets now, rather than listing it as not netted', () => {
    const rows = [holding('ravi', 'g1', 'Gold ETF', 'gold', [long('a', 'g1', 700n)])];
    expect(lots(rows).lots[0]).toMatchObject({
      term: 'long',
      assetClass: 'gold',
      placement: { placed: true, bucket: 'other-long' },
    });
  });

  it('marks a sale of an unclassified instrument, with no term at all', () => {
    const rows = [holding('ravi', 'i1', 'Mystery fund', null, [long('a', 'i1', 500n)])];
    expect(lots(rows).lots[0]).toMatchObject({
      term: null,
      placement: { placed: false, reason: 'unclassified-asset' },
    });
  });

  it('marks a sale no rule covers, rather than classifying it on today’s', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [
        parcel('old', 'i1', '2022-01-01', '2024-01-01', 500n),
      ]),
    ];
    expect(lots(rows, { fy: 2023 }).lots[0]).toMatchObject({
      term: null,
      placement: { placed: false, reason: 'no-rule-for-date' },
    });
  });

  it('marks foreign equity as needing the prescribed rate, and still says how long it was held', () => {
    const rows = [
      holding('ravi', 'f1', 'US index ETF', 'foreign_equity', [
        parcel('usd', 'f1', '2024-08-01', '2026-09-18', 500n, 'USD'),
      ]),
    ];
    expect(lots(rows).lots[0]).toMatchObject({
      term: 'long',
      placement: { placed: false, reason: 'needs-prescribed-rate' },
    });
  });

  it('marks a gift as not a sale, using the kind of the disposal it came from', () => {
    const rows = [holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [long('a', 'i1', -500n)])];
    const kinds = new Map([['a-sale', 'gift']]);
    expect(lots(rows, { kinds }).lots[0]).toMatchObject({
      placement: { placed: false, reason: 'not-a-sale' },
    });
  });

  it('marks matured gold as possibly exempt', () => {
    const rows = [holding('ravi', 'g1', 'Sovereign Gold Bond', 'gold', [long('a', 'g1', 700n)])];
    const kinds = new Map([['a-sale', 'maturity']]);
    expect(lots(rows, { kinds }).lots[0]).toMatchObject({
      placement: { placed: false, reason: 'possibly-exempt' },
    });
  });

  it('gives the netter every parcel of the member’s and every instrument’s class', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [long('a', 'i1', 500n)]),
      holding('ravi', 'g1', 'Gold ETF', 'gold', [long('b', 'g1', 700n)]),
      holding('ravi', 'u1', 'Mystery', null, [long('c', 'u1', 900n)]),
    ];
    const result = lots(rows);
    expect(result.parcels).toHaveLength(3);
    expect(result.assetClassOf.get('i1')).toBe('equity_fund');
    expect(result.assetClassOf.get('g1')).toBe('gold');
    expect(result.assetClassOf.get('u1')).toBeNull();
  });

  it('carries the holding’s name onto each lot, for the list', () => {
    const rows = [holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [long('a', 'i1', 500n)])];
    expect(lots(rows).lots[0]?.holdingName).toBe('Nifty fund');
  });

  it('is empty for a member with nothing sold', () => {
    const rows = [holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [])];
    const result = lots(rows);
    expect(result.lots).toEqual([]);
    expect(result.parcels).toEqual([]);
  });
});
