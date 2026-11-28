/**
 * What a broker's file does to the household's records (docs/decisions.md, "Broker files", 23 November 2026; docs/build-plan.md step 7c). Pure: the parsed file and what the household already
 * holds in, a plan out; nothing is read from a database or written to one here, and no hash is made (the repository makes it from `key`).
 *
 *   A holdings statement is a **stated quantity as at its day**, with the broker's average price beside it as a stated figure only. It is never a lot.
 *   A Zerodha tradewise exit is a **lot and a disposal**. The broker's pairing is not stored: the app's own first-in-first-out pairs them, and where it takes a sale from a different
 *   purchase than the broker names, the symbol is refused with a sentence and nothing for it is written.
 *   INDmoney trades are lots and disposals in dollars, fractional units allowed.
 *
 * A buy that is already a lot, on the same day at the same price, is not written twice, and a sale already recorded is not either; so the same file again writes nothing.
 */

import type { IsoDate } from '../../lib/dates.ts';
import { formatQuantity, parseQuantity } from '../../lib/quantity.ts';
import { money } from '../../lib/money.ts';
import { matchFifo, type Disposal as FifoDisposal, type Lot as FifoLot } from '../lots.ts';
import type { BrokerExit, BrokerHolding, BrokerSource, BrokerTrade } from './common.ts';

const BROKER_NAME: Record<BrokerSource, string> = { zerodha: 'Zerodha', indmoney: 'INDmoney' };

/** A purchase the household already has: units are scaled by the quantity scale, cost is minor units. */
export interface ExistingLot {
  readonly id: string;
  readonly acquiredOn: IsoDate;
  readonly quantity: bigint;
  readonly costMinor: bigint;
}

export interface ExistingDisposal {
  readonly id: string;
  readonly disposedOn: IsoDate;
  readonly quantity: bigint;
  readonly proceedsMinor: bigint;
}

/** What the household holds of one instrument, in its currency. */
export interface ExistingPosition {
  readonly lots: readonly ExistingLot[];
  readonly disposals: readonly ExistingDisposal[];
}

export interface PlannedBrokerLot {
  readonly acquiredOn: IsoDate;
  /** A decimal string, never a number. */
  readonly quantity: string;
  readonly costMinor: bigint;
  /** What the repository hashes to recognise the row again. */
  readonly key: string;
  readonly note: string;
}

export interface PlannedBrokerDisposal {
  readonly disposedOn: IsoDate;
  readonly quantity: string;
  readonly proceedsMinor: bigint;
  readonly key: string;
  readonly note: string;
}

export interface PlannedPosition {
  readonly source: BrokerSource;
  readonly symbol: string;
  readonly isin: string | null;
  readonly currency: 'INR' | 'USD';
  readonly lots: readonly PlannedBrokerLot[];
  readonly disposals: readonly PlannedBrokerDisposal[];
  /** Rows the file has that the household already has, and so are not written again. */
  readonly alreadyRecorded: { readonly lots: number; readonly disposals: number };
}

export interface PositionsPlan {
  readonly positions: readonly PlannedPosition[];
  /** A symbol refused, in a sentence: nothing for it is written. */
  readonly refusals: readonly string[];
  /** What is written but worth saying: a sale the records cannot cover. */
  readonly warnings: readonly string[];
}

interface Buy {
  readonly date: IsoDate;
  readonly quantity: bigint;
  readonly costMinor: bigint;
}
interface Sell {
  readonly date: IsoDate;
  readonly quantity: bigint;
  readonly proceedsMinor: bigint;
  /** The purchase the broker says it came from; absent where the broker does not say. */
  readonly entryDate?: IsoDate;
}
interface Row {
  readonly source: BrokerSource;
  readonly symbol: string;
  readonly isin: string | null;
  readonly currency: 'INR' | 'USD';
  readonly buy: Buy | null;
  readonly sell: Sell | null;
}

const keyOf = (row: { readonly isin: string | null; readonly symbol: string }): string => row.isin ?? row.symbol;

/** Whether two cost figures are of the same unit price, allowing the paisa each was rounded to: the cross products differ by at most half the two quantities. */
function samePrice(costA: bigint, quantityA: bigint, costB: bigint, quantityB: bigint): boolean {
  const gap = costA * quantityB - costB * quantityA;
  return (gap < 0n ? -gap : gap) <= (quantityA + quantityB) / 2n + 1n;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function planPosition(rows: readonly Row[], existing: ExistingPosition | undefined): { readonly position?: PlannedPosition; readonly refusal?: string; readonly warnings: string[] } {
  const first = rows[0] as Row;
  const broker = BROKER_NAME[first.source];
  const warnings: string[] = [];
  const prior = existing ?? { lots: [], disposals: [] };

  // Purchases: covered by a lot already held (same day, same unit price, units to spare), else one new lot, merged with another of the same day and price.
  const room = new Map(prior.lots.map((lot) => [lot.id, lot.quantity] as const));
  const created: { date: IsoDate; quantity: bigint; costMinor: bigint }[] = [];
  let lotsAlready = 0;
  const buys = rows.flatMap((row) => (row.buy === null ? [] : [row.buy])).sort((a, b) => compare(a.date, b.date));
  for (const buy of buys) {
    const covering = prior.lots.find((lot) => lot.acquiredOn === buy.date && (room.get(lot.id) ?? 0n) >= buy.quantity && samePrice(lot.costMinor, lot.quantity, buy.costMinor, buy.quantity));
    if (covering !== undefined) {
      room.set(covering.id, (room.get(covering.id) ?? 0n) - buy.quantity);
      lotsAlready += 1;
      continue;
    }
    const same = created.find((lot) => lot.date === buy.date && samePrice(lot.costMinor, lot.quantity, buy.costMinor, buy.quantity));
    if (same === undefined) created.push({ date: buy.date, quantity: buy.quantity, costMinor: buy.costMinor });
    else {
      same.quantity += buy.quantity;
      same.costMinor += buy.costMinor;
    }
  }

  // Sales: one already recorded on the same day for the same units and proceeds is not written again.
  const used = new Set<string>();
  const newSales: Sell[] = [];
  let salesAlready = 0;
  const sells = rows.flatMap((row) => (row.sell === null ? [] : [row.sell])).sort((a, b) => compare(a.date, b.date) || compare(a.entryDate ?? '', b.entryDate ?? ''));
  for (const sell of sells) {
    const recorded = prior.disposals.find((each) => !used.has(each.id) && each.disposedOn === sell.date && each.quantity === sell.quantity && (each.proceedsMinor - sell.proceedsMinor <= 1n && sell.proceedsMinor - each.proceedsMinor <= 1n));
    if (recorded !== undefined) {
      used.add(recorded.id);
      salesAlready += 1;
    } else newSales.push(sell);
  }

  // First in, first out over what is held and what would be written, as the app will pair them.
  const instrumentId = 'position';
  const lots: FifoLot[] = [
    ...prior.lots.map((lot) => ({ id: lot.id, instrumentId, acquiredOn: lot.acquiredOn, quantity: lot.quantity, cost: money(lot.costMinor, first.currency) })),
    ...created.map((lot, at) => ({ id: `new-lot-${String(at).padStart(4, '0')}`, instrumentId, acquiredOn: lot.date, quantity: lot.quantity, cost: money(lot.costMinor, first.currency) })),
  ];
  const disposals: FifoDisposal[] = [
    ...prior.disposals.map((sale) => ({ id: sale.id, instrumentId, disposedOn: sale.disposedOn, quantity: sale.quantity, proceeds: money(sale.proceedsMinor, first.currency) })),
    ...newSales.map((sale, at) => ({ id: `new-sale-${sale.date}-${sale.entryDate ?? ''}-${String(at).padStart(4, '0')}`, instrumentId, disposedOn: sale.date, quantity: sale.quantity, proceeds: money(sale.proceedsMinor, first.currency) })),
  ];
  const result = matchFifo(lots, disposals);

  for (const [at, sale] of newSales.entries()) {
    const id = `new-sale-${sale.date}-${sale.entryDate ?? ''}-${String(at).padStart(4, '0')}`;
    if (sale.entryDate !== undefined) {
      const wrong = result.parcels.find((parcel) => parcel.disposalId === id && parcel.acquiredOn !== sale.entryDate);
      if (wrong !== undefined) {
        return {
          refusal: `${first.symbol}: ${broker} says the ${formatQuantity(sale.quantity)} sold on ${sale.date} came from the purchase of ${sale.entryDate}, but first in, first out against what you already hold takes it from ${wrong.acquiredOn}. Nothing for ${first.symbol} was written.`,
          warnings,
        };
      }
    }
    const short = result.shortfalls.find((each) => each.disposalId === id);
    if (short !== undefined) warnings.push(`${first.symbol}: ${formatQuantity(short.quantity)} sold on ${sale.date} has no purchase on record to come from, so its gain cannot be worked out until the purchase is added.`);
  }

  const noun = first.source === 'zerodha' ? 'tradewise exits' : 'trades';
  const position: PlannedPosition = {
    source: first.source,
    symbol: first.symbol,
    isin: first.isin,
    currency: first.currency,
    lots: created.map((lot) => ({
      acquiredOn: lot.date,
      quantity: formatQuantity(lot.quantity),
      costMinor: lot.costMinor,
      key: `broker|${first.source}|${keyOf(first)}|lot|${lot.date}|${lot.quantity.toString()}|${lot.costMinor.toString()}`,
      note: `${broker} ${noun}`,
    })),
    disposals: newSales.map((sale) => ({
      disposedOn: sale.date,
      quantity: formatQuantity(sale.quantity),
      proceedsMinor: sale.proceedsMinor,
      key: `broker|${first.source}|${keyOf(first)}|sale|${sale.date}|${sale.entryDate ?? ''}|${sale.quantity.toString()}|${sale.proceedsMinor.toString()}`,
      note: sale.entryDate === undefined ? `${broker} ${noun}` : `${broker} ${noun}, bought ${sale.entryDate}`,
    })),
    alreadyRecorded: { lots: lotsAlready, disposals: salesAlready },
  };
  return { position, warnings };
}

function planRows(rows: readonly Row[], existing: ReadonlyMap<string, ExistingPosition>): PositionsPlan {
  const groups = new Map<string, Row[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  const positions: PlannedPosition[] = [];
  const refusals: string[] = [];
  const warnings: string[] = [];
  for (const [key, group] of groups) {
    const planned = planPosition(group, existing.get(key));
    warnings.push(...planned.warnings);
    if (planned.refusal !== undefined) refusals.push(planned.refusal);
    else if (planned.position !== undefined) positions.push(planned.position);
  }
  return { positions, refusals, warnings };
}

/** A Zerodha tradewise exit file: each row a buy and a sale. */
export function planExits(input: { readonly exits: readonly BrokerExit[]; readonly existing: ReadonlyMap<string, ExistingPosition> }): PositionsPlan {
  return planRows(
    input.exits.map((exit) => {
      const quantity = parseQuantity(exit.quantity);
      return {
        source: exit.source,
        symbol: exit.symbol,
        isin: exit.isin,
        currency: exit.currency,
        buy: { date: exit.entryDate, quantity, costMinor: exit.buyValueMinor },
        sell: { date: exit.exitDate, quantity, proceedsMinor: exit.sellValueMinor, entryDate: exit.entryDate },
      };
    }),
    input.existing,
  );
}

/**
 * An INDmoney trades file: a buy is a lot costing its amount and commission, a sell a disposal fetching its amount less commission. The broker names no pairing, so none is checked; a sale the
 * records cannot cover is said, and written, since the matcher never gives a sale a cost of nothing.
 */
export function planTrades(input: { readonly trades: readonly BrokerTrade[]; readonly existing: ReadonlyMap<string, ExistingPosition> }): PositionsPlan {
  return planRows(
    input.trades.map((trade) => {
      const quantity = parseQuantity(trade.quantity);
      return {
        source: trade.source,
        symbol: trade.symbol,
        isin: null,
        currency: trade.currency,
        buy: trade.side === 'buy' ? { date: trade.date, quantity, costMinor: trade.amountMinor + trade.commissionMinor } : null,
        sell: trade.side === 'sell' ? { date: trade.date, quantity, proceedsMinor: trade.amountMinor - trade.commissionMinor } : null,
      };
    }),
    input.existing,
  );
}

/** What a holdings statement states of a position: its quantity as at a day, and the broker's average price beside it. Never a lot, and never cost. */
export interface StatedPosition {
  readonly source: BrokerSource;
  readonly symbol: string;
  readonly isin: string | null;
  readonly name: string | null;
  readonly instrument: BrokerHolding['instrument'];
  readonly currency: 'INR' | 'USD';
  readonly quantity: string;
  readonly asOf: IsoDate;
  readonly averagePrice: string | null;
}

export function planHoldings(holdings: readonly BrokerHolding[]): { readonly stated: readonly StatedPosition[]; readonly refusals: readonly string[] } {
  const stated: StatedPosition[] = [];
  const refusals: string[] = [];
  for (const each of holdings) {
    if (each.asOf === null) {
      refusals.push(`${each.symbol}: the file does not say what day this holding was true, and a quantity with no date would age into a wrong figure, so it was not used.`);
      continue;
    }
    stated.push({ source: each.source, symbol: each.symbol, isin: each.isin, name: each.name, instrument: each.instrument, currency: each.currency, quantity: each.quantity, asOf: each.asOf, averagePrice: each.averagePrice });
  }
  return { stated, refusals };
}
