import { describe, expect, it } from 'vitest';
import { parseQuantity } from '../lib/quantity.ts';
import type { PlannedPosition, StatedPosition } from '../domain/broker/plan.ts';
import { existingDisposalOf, existingLotOf, instrumentRow, positionKey, specOfPosition, specOfStated, statedUpdate } from './brokerImport.ts';

/** What the broker writer puts in the database, said as columns (docs/build-plan.md 7c). The calls themselves are the policies' and the e2e's; these are the rows it builds. */

const position = (over: Partial<PlannedPosition> = {}): PlannedPosition => ({
  source: 'zerodha',
  symbol: 'INFY',
  isin: 'INE009A01021',
  currency: 'INR',
  lots: [],
  disposals: [],
  alreadyRecorded: { lots: 0, disposals: 0 },
  ...over,
});

const stated = (over: Partial<StatedPosition> = {}): StatedPosition => ({
  source: 'zerodha',
  symbol: 'INFY',
  isin: 'INE009A01021',
  name: 'Infosys Ltd',
  instrument: 'equity',
  currency: 'INR',
  quantity: '25',
  asOf: '2026-11-19',
  averagePrice: '1520.5',
  ...over,
});

describe('positionKey', () => {
  it('is the ISIN where there is one and the symbol where there is not, as the plan keys it', () => {
    expect(positionKey({ isin: 'INE009A01021', symbol: 'INFY' })).toBe('INE009A01021');
    expect(positionKey({ isin: null, symbol: 'AAPL' })).toBe('AAPL');
  });
});

describe('instrumentRow — the instrument a broker’s file makes', () => {
  it('makes an Indian equity in rupees, held in India, with no price driver', () => {
    expect(instrumentRow('h-1', specOfPosition(position()))).toMatchObject({
      household_id: 'h-1',
      name: 'INFY',
      symbol: 'INFY',
      kind: 'equity',
      isin: 'INE009A01021',
      currency: 'INR',
      exposure_currency: 'INR',
      is_foreign_asset: false,
      price_source: null,
      price_external_id: null,
    });
  });

  it('makes a US stock a direct foreign holding: dollars, dollar exposure, held abroad', () => {
    expect(instrumentRow('h-1', specOfPosition(position({ symbol: 'AAPL', isin: null, currency: 'USD', source: 'indmoney' })))).toMatchObject({
      currency: 'USD',
      exposure_currency: 'USD',
      is_foreign_asset: true,
    });
  });

  it('names a stated holding by the broker’s name where it gives one, and prices a broker’s mutual fund from its ISIN as any fund is', () => {
    const fund = instrumentRow('h-1', specOfStated(stated({ symbol: 'Some Fund', isin: 'INF000A00001', name: 'Some Fund - Direct Growth', instrument: 'mutual_fund' })));
    expect(fund).toMatchObject({ name: 'Some Fund - Direct Growth', kind: 'mutual_fund', symbol: null, price_source: 'amfi', price_external_id: 'INF000A00001' });
    expect(instrumentRow('h-1', specOfStated(stated()))).toMatchObject({ name: 'Infosys Ltd', symbol: 'INFY', kind: 'equity' });
  });
});

describe('existing rows, read back as the plan reads them', () => {
  it('keeps a lot’s quantity exact and its cost a bigint, from the text the database gives', () => {
    expect(existingLotOf({ id: 'l1', acquired_on: '2024-01-05', quantity: '0.43750000', cost_minor: '9007199254740993' })).toEqual({
      id: 'l1',
      acquiredOn: '2024-01-05',
      quantity: parseQuantity('0.4375'),
      costMinor: 9_007_199_254_740_993n,
    });
  });

  it('reads a disposal the same way', () => {
    expect(existingDisposalOf({ id: 'd1', disposed_on: '2025-03-10', quantity: '10.00000000', proceeds_minor: '1800000' })).toMatchObject({ quantity: parseQuantity('10'), proceedsMinor: 1_800_000n });
  });
});

describe('statedUpdate — the quantity a broker states, with its average price beside it', () => {
  it('states the quantity, its day and the batch, and the price in the currency of the holding', () => {
    expect(statedUpdate(stated(), 'batch-1')).toEqual({
      stated_quantity: '25.00000000',
      stated_as_at: '2026-11-19',
      stated_source_batch_id: 'batch-1',
      stated_average_price: '1520.5',
      stated_average_price_currency: 'INR',
    });
  });

  it('states no currency where it states no price, so the database’s pairing holds', () => {
    expect(statedUpdate(stated({ averagePrice: null }), 'batch-1')).toMatchObject({ stated_average_price: null, stated_average_price_currency: null });
  });

  it('states a US stock’s price in dollars', () => {
    expect(statedUpdate(stated({ currency: 'USD', averagePrice: '132.5143', quantity: '0.4375' }), 'b')).toMatchObject({ stated_average_price_currency: 'USD', stated_quantity: '0.43750000' });
  });
});
