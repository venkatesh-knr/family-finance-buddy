/**
 * Writing what a broker's file said (docs/build-plan.md step 7c; docs/decisions.md, "Broker files", 23 November 2026).
 *
 * `src/domain/broker/plan.ts` decides what a file does to the household's records; this is the only part that writes it. It takes that plan (lots and disposals, and stated positions) and turns
 * it into instruments, holdings, lots, disposals and a stated quantity with the broker's average price beside it. It is the equity and US-stock counterpart of `imports.ts`, which is for a
 * registrar's mutual-fund statement: the instrument is an equity (or a fund, for a broker's mutual funds), a sale is a `sale` and not a `redemption`, and nothing is priced by AMFI.
 *
 * ── the same file twice ───────────────────────────────────────────────────
 *
 * The plan already leaves out what the household holds (`planExits`, `planTrades` read `readExistingPositions`), so the same file again plans nothing. The unique index on
 * (household_id, source_hash) is the guarantee behind that, as for `imports.ts`: a row the plan did not see is recognised by its hash and skipped, and a failure part way is put right by
 * running the import again. Not a transaction, on purpose, for the reason `imports.ts` gives.
 *
 * ── the average price is a stated figure ──────────────────────────────────
 *
 * It rides on the holding beside the stated quantity and under the same rule: one conditional update, written only if the holding has no balance or an older one. It is never read for
 * cost, gain, return or tax (nothing here, and nothing in the database, does).
 */

import { isIsoDate } from '../lib/dates.ts';
import { sha256Hex } from '../lib/hash.ts';
import { parseQuantity, quantityToNumeric } from '../lib/quantity.ts';
import type { ExistingDisposal, ExistingLot, ExistingPosition, PlannedPosition, StatedPosition } from '../domain/broker/plan.ts';
import { supabase } from './client.ts';
import { alreadyImported } from './imports.ts';
import { toBigIntExact } from '../lib/guards.ts';
import type { Uuid } from './types.ts';

/** What an instrument is, as a broker's file names it. */
export interface InstrumentSpec {
  readonly symbol: string;
  readonly isin: string | null;
  /** The broker's own name for it, where it gives one. */
  readonly name: string | null;
  readonly kind: 'equity' | 'mutual_fund';
  readonly currency: 'INR' | 'USD';
}

export interface BrokerImportRequest {
  readonly householdId: Uuid;
  readonly memberId: Uuid;
  readonly label: string | null;
  readonly positions: readonly PlannedPosition[];
  readonly stated: readonly StatedPosition[];
}

export interface BrokerImportOutcome {
  readonly batchId: Uuid;
  readonly lotsWritten: number;
  readonly disposalsWritten: number;
  /** Rows the plan had that were already recorded, by hash: two imports running together, most likely. */
  readonly alreadyPresent: number;
  readonly instrumentsCreated: number;
  readonly holdingsCreated: number;
  readonly balancesRecorded: number;
  /** Balances left alone because the holding already had one as late or later. */
  readonly balancesKept: number;
}

/** A position's key: its ISIN where it has one, and its symbol where it has not. The same as the planner's. */
export const positionKey = (spec: { readonly isin: string | null; readonly symbol: string }): string => spec.isin ?? spec.symbol;

/** The instrument a planned position is: an equity in its own currency; a US stock is held abroad. */
export function specOfPosition(position: PlannedPosition): InstrumentSpec {
  return { symbol: position.symbol, isin: position.isin, name: null, kind: 'equity', currency: position.currency };
}

/** The instrument a stated position is. A broker's mutual fund is a fund; its US stock and its equity are equities. */
export function specOfStated(stated: StatedPosition): InstrumentSpec {
  return { symbol: stated.symbol, isin: stated.isin, name: stated.name, kind: stated.instrument === 'mutual_fund' ? 'mutual_fund' : 'equity', currency: stated.currency };
}

/** The columns a new instrument is made with. A US stock is a direct foreign holding: dollars, and dollar exposure, and held abroad (Schedule FA). Nothing here is priced by a driver. */
export function instrumentRow(householdId: Uuid, spec: InstrumentSpec): Record<string, unknown> {
  const abroad = spec.currency === 'USD';
  const fund = spec.kind === 'mutual_fund' && spec.isin !== null;
  return {
    household_id: householdId,
    name: spec.name ?? spec.symbol,
    symbol: fund ? null : spec.symbol,
    kind: spec.kind,
    isin: spec.isin,
    currency: spec.currency,
    exposure_currency: spec.currency,
    is_foreign_asset: abroad,
    // A broker's mutual fund is priced as any fund is, from its ISIN; an equity has no driver and is valued from a price a person types.
    price_source: fund ? 'amfi' : null,
    price_external_id: fund ? spec.isin : null,
  };
}

/** A lot the household holds, from the columns `readExistingPositions` selects. Quantities and amounts arrive as text so nothing passes through a double. */
export function existingLotOf(row: { readonly id: string; readonly acquired_on: string; readonly quantity: string; readonly cost_minor: string }): ExistingLot {
  return { id: row.id, acquiredOn: row.acquired_on as ExistingLot['acquiredOn'], quantity: parseQuantity(row.quantity), costMinor: toBigIntExact(row.cost_minor, 'lot.cost_minor') };
}

export function existingDisposalOf(row: { readonly id: string; readonly disposed_on: string; readonly quantity: string; readonly proceeds_minor: string }): ExistingDisposal {
  return { id: row.id, disposedOn: row.disposed_on as ExistingDisposal['disposedOn'], quantity: parseQuantity(row.quantity), proceedsMinor: toBigIntExact(row.proceeds_minor, 'disposal.proceeds_minor') };
}

/** The update that states a position's quantity and the broker's average price beside it. */
export function statedUpdate(stated: StatedPosition, batchId: Uuid): Record<string, unknown> {
  return {
    stated_quantity: quantityToNumeric(parseQuantity(stated.quantity)),
    stated_as_at: stated.asOf,
    stated_source_batch_id: batchId,
    stated_average_price: stated.averagePrice,
    stated_average_price_currency: stated.averagePrice === null ? null : stated.currency,
  };
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asBrokerError(error: ProviderError): Error {
  if (error.code === '42501') return new Error('Only an owner, partner or contributor can import a broker’s file.');
  if (error.code === '23505') return new Error('Part of this file is already recorded. Nothing was doubled; run the import again to write the rest.');
  return new Error(error.message);
}

/** The instrument a spec already is for this household, matched on ISIN first, then on symbol, then on name. */
async function findInstrument(householdId: Uuid, spec: InstrumentSpec): Promise<Uuid | null> {
  const client = supabase();
  const tries: readonly [string, string][] = [
    ...(spec.isin === null ? [] : ([['isin', spec.isin]] as [string, string][])),
    ['symbol', spec.symbol],
    ['name', spec.name ?? spec.symbol],
  ];
  for (const [column, value] of tries) {
    const { data, error } = await client.from('instrument').select('id').eq('household_id', householdId).eq(column, value).limit(1);
    if (error !== null) throw asBrokerError(error);
    const found = (data ?? [])[0];
    if (found !== undefined) return String(found.id);
  }
  return null;
}

async function findHolding(householdId: Uuid, memberId: Uuid, instrumentId: Uuid): Promise<Uuid | null> {
  const { data, error } = await supabase().from('holding').select('id').eq('household_id', householdId).eq('member_id', memberId).eq('instrument_id', instrumentId).limit(1);
  if (error !== null) throw asBrokerError(error);
  const found = (data ?? [])[0];
  return found === undefined ? null : String(found.id);
}

/**
 * What the household already holds of each instrument, for the member whose file it is: the lots and disposals the plan reads so it does not write a buy or a sale twice and can pair sales by
 * first in, first out. Keyed as the plan keys: ISIN, else symbol. An instrument the household does not have is simply absent.
 */
export async function readExistingPositions(householdId: Uuid, memberId: Uuid, specs: readonly InstrumentSpec[]): Promise<ReadonlyMap<string, ExistingPosition>> {
  const client = supabase();
  const out = new Map<string, ExistingPosition>();
  for (const spec of specs) {
    const instrumentId = await findInstrument(householdId, spec);
    if (instrumentId === null) continue;
    const holdingId = await findHolding(householdId, memberId, instrumentId);
    if (holdingId === null) continue;
    const [lots, disposals] = await Promise.all([
      client.from('lot').select('id, acquired_on, quantity::text, cost_minor::text').eq('holding_id', holdingId),
      client.from('disposal').select('id, disposed_on, quantity::text, proceeds_minor::text').eq('holding_id', holdingId),
    ]);
    if (lots.error !== null) throw asBrokerError(lots.error);
    if (disposals.error !== null) throw asBrokerError(disposals.error);
    out.set(positionKey(spec), {
      lots: (lots.data ?? []).map((row) => existingLotOf(row as never)),
      disposals: (disposals.data ?? []).map((row) => existingDisposalOf(row as never)),
    });
  }
  return out;
}

async function findOrCreateInstrument(householdId: Uuid, spec: InstrumentSpec): Promise<{ id: Uuid; created: boolean }> {
  const existing = await findInstrument(householdId, spec);
  if (existing !== null) return { id: existing, created: false };
  const created = await supabase().from('instrument').insert(instrumentRow(householdId, spec)).select('id').single();
  if (created.error !== null) throw asBrokerError(created.error);
  return { id: String(created.data.id), created: true };
}

async function findOrCreateHolding(householdId: Uuid, memberId: Uuid, instrumentId: Uuid): Promise<{ id: Uuid; created: boolean }> {
  const existing = await findHolding(householdId, memberId, instrumentId);
  if (existing !== null) return { id: existing, created: false };
  // Zero, and not the broker's quantity: what is held is derived from the lots and sales written beside it, and the stated quantity has columns of its own.
  const created = await supabase().from('holding').insert({ household_id: householdId, member_id: memberId, instrument_id: instrumentId, quantity: '0' }).select('id').single();
  if (created.error !== null) throw asBrokerError(created.error);
  return { id: String(created.data.id), created: true };
}

/** State a position's quantity and average price if that is news: one conditional update, so two imports running together cannot leave the older winning. True when it was written. */
async function recordStated(holdingId: Uuid, stated: StatedPosition, batchId: Uuid): Promise<boolean> {
  // Interpolated into a filter below, so it is checked rather than trusted.
  if (!isIsoDate(stated.asOf)) throw new Error('A stated quantity needs a real date to be recorded against.');
  const { data, error } = await supabase()
    .from('holding')
    .update(statedUpdate(stated, batchId))
    .eq('id', holdingId)
    .or(`stated_as_at.is.null,stated_as_at.lt.${stated.asOf}`)
    .select('id');
  if (error !== null) throw asBrokerError(error);
  return (data ?? []).length > 0;
}

/** Write a broker's file as the plan made it. */
export async function importBrokerFile(request: BrokerImportRequest): Promise<BrokerImportOutcome> {
  const client = supabase();

  const hashedPositions = await Promise.all(
    request.positions.map(async (position) => ({
      position,
      lots: await Promise.all(position.lots.map(async (lot) => ({ lot, hash: await sha256Hex(lot.key) }))),
      disposals: await Promise.all(position.disposals.map(async (sale) => ({ sale, hash: await sha256Hex(sale.key) }))),
    })),
  );
  const present = await alreadyImported(request.householdId, hashedPositions.flatMap((entry) => [...entry.lots.map((each) => each.hash), ...entry.disposals.map((each) => each.hash)]));
  const toWrite = hashedPositions.map((entry) => ({
    position: entry.position,
    lots: entry.lots.filter((each) => !present.has(each.hash)),
    disposals: entry.disposals.filter((each) => !present.has(each.hash)),
  }));
  const rowCount = toWrite.reduce((total, entry) => total + entry.lots.length + entry.disposals.length, 0);

  // The count goes in at insert because `import_batch` has no update grant: a batch says what happened and is never revised.
  const batch = await client
    .from('import_batch')
    .insert({ household_id: request.householdId, kind: 'broker_csv', period_start: null, period_end: null, label: request.label, row_count: rowCount })
    .select('id')
    .single();
  if (batch.error !== null) throw asBrokerError(batch.error);
  const batchId = String(batch.data.id);

  let lotsWritten = 0;
  let disposalsWritten = 0;
  let instrumentsCreated = 0;
  let holdingsCreated = 0;
  let balancesRecorded = 0;
  let balancesKept = 0;

  const holdingFor = async (spec: InstrumentSpec): Promise<Uuid> => {
    const instrument = await findOrCreateInstrument(request.householdId, spec);
    if (instrument.created) instrumentsCreated += 1;
    const holding = await findOrCreateHolding(request.householdId, request.memberId, instrument.id);
    if (holding.created) holdingsCreated += 1;
    return holding.id;
  };

  for (const entry of toWrite) {
    if (entry.lots.length === 0 && entry.disposals.length === 0) continue;
    const holdingId = await holdingFor(specOfPosition(entry.position));
    const currency = entry.position.currency;
    if (entry.lots.length > 0) {
      const { error } = await client.from('lot').insert(
        entry.lots.map(({ lot, hash }) => ({
          household_id: request.householdId,
          holding_id: holdingId,
          acquired_on: lot.acquiredOn,
          quantity: quantityToNumeric(parseQuantity(lot.quantity)),
          cost_minor: lot.costMinor.toString(),
          currency,
          kind: 'purchase',
          note: lot.note,
          source_batch_id: batchId,
          source_hash: hash,
        })),
      );
      if (error !== null) throw asBrokerError(error);
      lotsWritten += entry.lots.length;
    }
    if (entry.disposals.length > 0) {
      const { error } = await client.from('disposal').insert(
        entry.disposals.map(({ sale, hash }) => ({
          household_id: request.householdId,
          holding_id: holdingId,
          disposed_on: sale.disposedOn,
          quantity: quantityToNumeric(parseQuantity(sale.quantity)),
          proceeds_minor: sale.proceedsMinor.toString(),
          currency,
          kind: 'sale',
          note: sale.note,
          source_batch_id: batchId,
          source_hash: hash,
        })),
      );
      if (error !== null) throw asBrokerError(error);
      disposalsWritten += entry.disposals.length;
    }
  }

  // Last, so a failure above leaves rows and no balance rather than a balance and no rows; running the import again writes the rest.
  for (const stated of request.stated) {
    const holdingId = await holdingFor(specOfStated(stated));
    if (await recordStated(holdingId, stated, batchId)) balancesRecorded += 1;
    else balancesKept += 1;
  }

  return { batchId, lotsWritten, disposalsWritten, alreadyPresent: present.size, instrumentsCreated, holdingsCreated, balancesRecorded, balancesKept };
}
