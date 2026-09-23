/**
 * One member's sales for one tax year, laid out for the Tax screen.
 *
 * Tax is filed per person, and the ₹1.25 lakh allowance is each person's own —
 * so the unit here is a member, never the household. Two people who each sold
 * ₹1.25 lakh of gain owe nothing; one person who sold ₹2.5 lakh does. Summing
 * a household and netting it once would get both of them wrong in opposite
 * directions, which is why the first assertion below is about exactly that.
 *
 * The other thing worth holding: a sale this screen does not net is still
 * listed, with the reason. Nothing that happened in the year vanishes because
 * this slice does not know what to do with it yet.
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

describe('taxLotsFor', () => {
  it('takes one member at a time, so two allowances are never merged into one', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [long('a', 'i1', 12_500_000n)]),
      holding('meera', 'i2', 'Index fund', 'equity_fund', [long('b', 'i2', 12_500_000n)]),
    ];

    const ravi = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules });
    const meera = taxLotsFor({ rows, memberId: 'meera', fy: 2026, rules });

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
    const result = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules });
    expect(result.lots.map((l) => l.parcel.disposalId)).toEqual(['late-sale', 'early-sale']);
  });

  it('says a class-known equity sale is netted, with its term', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [
        long('a', 'i1', 500n),
        parcel('s', 'i1', '2026-06-01', '2026-09-18', 100n),
      ]),
    ];
    const lots = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules }).lots;
    const byId = Object.fromEntries(lots.map((l) => [l.parcel.disposalId, l]));

    expect(byId['a-sale']).toMatchObject({ treatment: 'netted', term: 'long' });
    expect(byId['s-sale']).toMatchObject({ treatment: 'netted', term: 'short' });
  });

  it('still lists a gold sale, and says it is not netted here rather than dropping it', () => {
    const rows = [holding('ravi', 'g1', 'Gold ETF', 'gold', [long('a', 'g1', 700n)])];
    const lot = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules }).lots[0];
    expect(lot).toMatchObject({ treatment: 'other-class', term: 'long', assetClass: 'gold' });
  });

  it('marks a sale of an unclassified instrument, with no term at all', () => {
    const rows = [holding('ravi', 'i1', 'Mystery fund', null, [long('a', 'i1', 500n)])];
    const lot = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules }).lots[0];
    expect(lot).toMatchObject({ treatment: 'unclassified', term: null });
  });

  it('marks a sale no rule covers, rather than classifying it on today’s', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [
        parcel('old', 'i1', '2022-01-01', '2024-01-01', 500n),
      ]),
    ];
    const lot = taxLotsFor({ rows, memberId: 'ravi', fy: 2023, rules }).lots[0];
    expect(lot).toMatchObject({ treatment: 'no-rule', term: null });
  });

  it('marks an equity sale in another currency, which should not happen', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [
        parcel('usd', 'i1', '2024-08-01', '2026-09-18', 500n, 'USD'),
      ]),
    ];
    const lot = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules }).lots[0];
    expect(lot).toMatchObject({ treatment: 'currency-mismatch' });
  });

  it('gives the netter every parcel of the member and every instrument’s class', () => {
    const rows = [
      holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [long('a', 'i1', 500n)]),
      holding('ravi', 'g1', 'Gold ETF', 'gold', [long('b', 'g1', 700n)]),
      holding('ravi', 'u1', 'Mystery', null, [long('c', 'u1', 900n)]),
    ];
    const result = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules });
    expect(result.parcels).toHaveLength(3);
    expect(result.assetClassOf.get('i1')).toBe('equity_fund');
    expect(result.assetClassOf.get('g1')).toBe('gold');
    expect(result.assetClassOf.get('u1')).toBeNull();
  });

  it('carries the holding’s name onto each lot, for the table', () => {
    const rows = [holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [long('a', 'i1', 500n)])];
    expect(taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules }).lots[0]?.holdingName).toBe(
      'Nifty fund',
    );
  });

  it('is empty for a member with nothing sold', () => {
    const rows = [holding('ravi', 'i1', 'Nifty fund', 'equity_fund', [])];
    const result = taxLotsFor({ rows, memberId: 'ravi', fy: 2026, rules });
    expect(result.lots).toEqual([]);
    expect(result.parcels).toEqual([]);
  });
});
