import { describe, expect, it } from 'vitest';
import { parseQuantity } from '../../lib/quantity.ts';
import type { BrokerExit, BrokerHolding, BrokerTrade } from './common.ts';
import { planExits, planHoldings, planTrades, type ExistingPosition } from './plan.ts';

/**
 * What a broker's file does to the household's records (docs/decisions.md, "Broker files", 23 November 2026; build-plan 7c). A tradewise exit is a lot and a disposal, paired by the app's own
 * first-in-first-out and not by the broker; a buy already a lot is not written twice; a pairing that differs from the broker's is refused with a sentence. Numbers are invented.
 */

const exit = (over: Partial<BrokerExit> = {}): BrokerExit => ({
  source: 'zerodha',
  symbol: 'INFY',
  isin: 'INE009A01021',
  entryDate: '2024-01-05',
  exitDate: '2025-03-10',
  quantity: '10',
  buyValueMinor: 1_500_000n, // ₹15,000: ₹1,500 a share
  sellValueMinor: 1_800_000n,
  currency: 'INR',
  ...over,
});

const none: ReadonlyMap<string, ExistingPosition> = new Map();
const held = (key: string, position: Partial<ExistingPosition>): ReadonlyMap<string, ExistingPosition> =>
  new Map([[key, { lots: [], disposals: [], ...position }]]);

describe('planExits — a tradewise exit is a lot and a disposal', () => {
  it('writes the buy as a lot on its entry date at its buy value, and the sale as a disposal on its exit date at its sell value', () => {
    const plan = planExits({ exits: [exit()], existing: none });
    expect(plan.refusals).toEqual([]);
    const [position] = plan.positions;
    expect(position).toMatchObject({ symbol: 'INFY', isin: 'INE009A01021', currency: 'INR' });
    expect(position?.lots).toMatchObject([{ acquiredOn: '2024-01-05', quantity: '10', costMinor: 1_500_000n }]);
    expect(position?.disposals).toMatchObject([{ disposedOn: '2025-03-10', quantity: '10', proceedsMinor: 1_800_000n }]);
  });

  it('writes one lot for a buy sold in two parts, since the broker lists a pair for each part', () => {
    const plan = planExits({
      exits: [exit({ quantity: '4', buyValueMinor: 600_000n, sellValueMinor: 700_000n }), exit({ quantity: '6', buyValueMinor: 900_000n, sellValueMinor: 1_100_000n, exitDate: '2025-04-01' })],
      existing: none,
    });
    expect(plan.refusals).toEqual([]);
    expect(plan.positions[0]?.lots).toMatchObject([{ acquiredOn: '2024-01-05', quantity: '10', costMinor: 1_500_000n }]);
    expect(plan.positions[0]?.disposals).toHaveLength(2);
  });

  it('keeps two buys on one day at different prices as two lots', () => {
    const plan = planExits({
      exits: [exit({ quantity: '5', buyValueMinor: 750_000n }), exit({ quantity: '5', buyValueMinor: 800_000n, exitDate: '2025-03-11' })],
      existing: none,
    });
    expect(plan.positions[0]?.lots).toHaveLength(2);
  });

  it('writes no lot for a buy that is already one on the same day at the same price, and says so', () => {
    const existing = held('INE009A01021', { lots: [{ id: 'l1', acquiredOn: '2024-01-05', quantity: parseQuantity('10'), costMinor: 1_500_000n }] });
    const plan = planExits({ exits: [exit()], existing });
    expect(plan.refusals).toEqual([]);
    expect(plan.positions[0]?.lots).toEqual([]);
    expect(plan.positions[0]?.disposals).toHaveLength(1);
    expect(plan.positions[0]?.alreadyRecorded).toMatchObject({ lots: 1, disposals: 0 });
  });

  it('covers part of a larger lot already held: 4 of 10 units bought that day at that price', () => {
    const existing = held('INE009A01021', { lots: [{ id: 'l1', acquiredOn: '2024-01-05', quantity: parseQuantity('10'), costMinor: 1_500_000n }] });
    const plan = planExits({ exits: [exit({ quantity: '4', buyValueMinor: 600_000n, sellValueMinor: 720_000n })], existing });
    expect(plan.positions[0]?.lots).toEqual([]);
    expect(plan.positions[0]?.alreadyRecorded.lots).toBe(1);
  });

  it('is the same file twice: nothing is written the second time', () => {
    const first = planExits({ exits: [exit()], existing: none }).positions[0];
    const existing = held('INE009A01021', {
      lots: (first?.lots ?? []).map((lot, at) => ({ id: `l${String(at)}`, acquiredOn: lot.acquiredOn, quantity: parseQuantity(lot.quantity), costMinor: lot.costMinor })),
      disposals: (first?.disposals ?? []).map((sale, at) => ({ id: `d${String(at)}`, disposedOn: sale.disposedOn, quantity: parseQuantity(sale.quantity), proceedsMinor: sale.proceedsMinor })),
    });
    const again = planExits({ exits: [exit()], existing });
    expect(again.refusals).toEqual([]);
    expect(again.positions[0]?.lots).toEqual([]);
    expect(again.positions[0]?.disposals).toEqual([]);
    expect(again.positions[0]?.alreadyRecorded).toMatchObject({ lots: 1, disposals: 1 });
  });

  it('refuses a symbol whose sale first-in-first-out takes from an older purchase than the broker names, saying both dates', () => {
    // An older lot of the same stock is already held, so FIFO sells it first; the broker says the sale was of the 2024 purchase.
    const existing = held('INE009A01021', { lots: [{ id: 'old', acquiredOn: '2023-06-01', quantity: parseQuantity('10'), costMinor: 1_000_000n }] });
    const plan = planExits({ exits: [exit()], existing });
    expect(plan.positions).toEqual([]);
    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]).toContain('INFY');
    expect(plan.refusals[0]).toContain('2024-01-05');
    expect(plan.refusals[0]).toContain('2023-06-01');
    expect(plan.refusals[0]).toMatch(/Nothing for INFY was written/);
  });

  it('refuses nothing when the older purchase has already been sold by an earlier recorded sale', () => {
    const existing = held('INE009A01021', {
      lots: [{ id: 'old', acquiredOn: '2023-06-01', quantity: parseQuantity('10'), costMinor: 1_000_000n }],
      disposals: [{ id: 'sold', disposedOn: '2024-06-01', quantity: parseQuantity('10'), proceedsMinor: 1_300_000n }],
    });
    const plan = planExits({ exits: [exit()], existing });
    expect(plan.refusals).toEqual([]);
    expect(plan.positions[0]?.disposals).toHaveLength(1);
  });

  it('orders a day’s sales by the purchase they came from, so FIFO takes the oldest first as the broker’s rows say', () => {
    const plan = planExits({
      exits: [
        exit({ entryDate: '2024-03-01', quantity: '5', buyValueMinor: 800_000n, sellValueMinor: 900_000n }),
        exit({ entryDate: '2024-01-05', quantity: '5', buyValueMinor: 750_000n, sellValueMinor: 900_000n }),
      ],
      existing: none,
    });
    expect(plan.refusals).toEqual([]);
    expect(plan.positions[0]?.disposals).toHaveLength(2);
  });

  it('keeps one stock’s refusal from stopping another’s', () => {
    const existing = held('INE009A01021', { lots: [{ id: 'old', acquiredOn: '2023-06-01', quantity: parseQuantity('10'), costMinor: 1_000_000n }] });
    const plan = planExits({ exits: [exit(), exit({ symbol: 'TCS', isin: 'INE467B01029' })], existing });
    expect(plan.refusals).toHaveLength(1);
    expect(plan.positions.map((each) => each.symbol)).toEqual(['TCS']);
  });

  it('keys a position by its ISIN where the file has one, and by its symbol where it has not', () => {
    const plan = planExits({ exits: [exit({ isin: null })], existing: held('INFY', { lots: [{ id: 'l1', acquiredOn: '2024-01-05', quantity: parseQuantity('10'), costMinor: 1_500_000n }] }) });
    expect(plan.positions[0]?.lots).toEqual([]);
  });
});

const holding = (over: Partial<BrokerHolding> = {}): BrokerHolding => ({
  source: 'zerodha',
  symbol: 'INFY',
  name: null,
  isin: 'INE009A01021',
  instrument: 'equity',
  currency: 'INR',
  quantity: '25',
  averagePrice: '1520.5',
  costMinor: 3_801_250n,
  asOf: '2026-11-19',
  ...over,
});

describe('planHoldings — a holdings statement is a stated quantity as at its day, never a lot', () => {
  it('states the quantity and the broker’s average price with its currency and date, and no lot', () => {
    const plan = planHoldings([holding()]);
    expect(plan.refusals).toEqual([]);
    expect(plan.stated).toEqual([
      { source: 'zerodha', symbol: 'INFY', isin: 'INE009A01021', name: null, instrument: 'equity', currency: 'INR', quantity: '25', asOf: '2026-11-19', averagePrice: '1520.5' },
    ]);
  });

  it('states no price where the file gives none, and keeps a fractional US quantity exact', () => {
    const plan = planHoldings([holding({ symbol: 'AAPL', isin: null, instrument: 'us_stock', currency: 'USD', source: 'indmoney', quantity: '0.4375', averagePrice: null })]);
    expect(plan.stated[0]).toMatchObject({ quantity: '0.4375', averagePrice: null, currency: 'USD' });
  });

  it('refuses a holding with no date, since a balance with no date ages into a wrong figure', () => {
    const plan = planHoldings([holding({ asOf: null })]);
    expect(plan.stated).toEqual([]);
    expect(plan.refusals[0]).toMatch(/INFY.*date/);
  });
});

const trade = (over: Partial<BrokerTrade> = {}): BrokerTrade => ({
  source: 'indmoney',
  date: '2025-02-03',
  symbol: 'AAPL',
  side: 'buy',
  currency: 'USD',
  quantity: '2.5',
  price: '200',
  amountMinor: 50_000n,
  commissionMinor: 100n,
  ...over,
});

describe('planTrades — INDmoney trades are lots and disposals in dollars, fractional units allowed', () => {
  it('writes a buy as a lot costing its amount and commission, and a sell as a disposal fetching its amount less commission', () => {
    const plan = planTrades({
      trades: [trade(), trade({ date: '2025-06-10', side: 'sell', quantity: '1.25', price: '240', amountMinor: 30_000n, commissionMinor: 100n })],
      existing: none,
    });
    expect(plan.positions[0]?.lots).toMatchObject([{ acquiredOn: '2025-02-03', quantity: '2.5', costMinor: 50_100n }]);
    expect(plan.positions[0]?.disposals).toMatchObject([{ disposedOn: '2025-06-10', quantity: '1.25', proceedsMinor: 29_900n }]);
    expect(plan.positions[0]?.currency).toBe('USD');
  });

  it('says a sale the records cannot cover instead of writing a cost of nothing', () => {
    const plan = planTrades({ trades: [trade({ side: 'sell', quantity: '1', amountMinor: 24_000n })], existing: none });
    expect(plan.positions[0]?.disposals).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/AAPL.*1.*no purchase/);
  });

  it('writes nothing twice: the same trades again are already recorded', () => {
    const first = planTrades({ trades: [trade()], existing: none }).positions[0];
    const existing = held('AAPL', { lots: (first?.lots ?? []).map((lot) => ({ id: 'l1', acquiredOn: lot.acquiredOn, quantity: parseQuantity(lot.quantity), costMinor: lot.costMinor })) });
    const again = planTrades({ trades: [trade()], existing });
    expect(again.positions[0]?.lots).toEqual([]);
    expect(again.positions[0]?.alreadyRecorded.lots).toBe(1);
  });
});
