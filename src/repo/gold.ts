/**
 * Gold: physical gold, and gold ETFs and funds (docs/design/gold.md; the schema is `supabase/migrations/20261106120000_gold_physical_etf.sql`).
 *
 * Physical gold is a holding of the kind gold and the form `physical`, with a purity, and its purchases are lots of grams. It is valued at
 * its grams times the household's typed rate for its purity (GD-I3), and net worth reads a value as it reads every holding's, from the
 * latest reading (HD-I1): so a value is worked out here, by `src/domain/gold.ts`, and recorded as a reading whenever a rate is typed or the
 * grams change. With no rate for its purity no reading is written, and the holding is not valued, which the screen says.
 *
 * A gold ETF or fund is kind `gold` and form `etf` or `fund`, and is priced as any fund is, by the price driver. No gold rate is fetched
 * from anywhere (gold.md section 3): the household types it, from IBJA's published rate.
 *
 * Nothing here works out a figure of its own. That is `src/domain/gold.ts`.
 */

import { formatGrams, gramsHeld, physicalGoldValue, type GoldRate } from '../domain/gold.ts';
import { formatMoney, money } from '../lib/money.ts';
import { parseQuantity, quantityToNumeric } from '../lib/quantity.ts';
import { supabase } from './client.ts';
import { addHolding, archiveHolding, recordValuation } from './holdings.ts';
import { addLot } from './lots.ts';
import { toGoldRate } from './mapping.ts';
import type { IsoDate } from '../lib/dates.ts';
import type { GoldPurity, GoldRateRow, NewGold, NewGoldRate, Uuid } from './types.ts';

const RATE_COLUMNS = 'id, purity, rate_per_gram_minor::text, currency, as_at, created_by, created_at';

const CURRENCY = 'INR';
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Every gold rate the caller can read in a household, oldest first. Everyone in the household reads them (a viewer too). */
export async function listGoldRates(householdId: Uuid): Promise<readonly GoldRateRow[]> {
  const { data, error } = await supabase()
    .from('gold_rate')
    .select(RATE_COLUMNS)
    .eq('household_id', householdId)
    .order('as_at', { ascending: true })
    .order('created_at', { ascending: true });
  if (error !== null) throw asRepositoryError(error);
  return (data ?? []).map(toGoldRate);
}

/** The domain's view of a rate row. */
export function asDomainRates(rows: readonly GoldRateRow[]): readonly GoldRate[] {
  return rows.map((row) => ({
    purity: row.purity,
    asOf: row.asAt,
    perGramMinor: row.perGram.minor,
    currency: row.perGram.currency,
    typedAt: row.typedAt,
  }));
}

/**
 * Type a rate: a new dated row, never a change to an earlier one (GD-I12). Then every physical holding of that purity is valued again
 * on `on`, so net worth moves with the rate. The write is the household's own statement of a rate read from IBJA: nothing here fetches one.
 */
export async function recordGoldRate(input: NewGoldRate, on: IsoDate): Promise<{ readonly revalued: number }> {
  if (input.perGram.minor <= 0n) throw new Error('A gold rate is above nothing.');
  if (input.asAt > on) throw new Error('A rate cannot be dated after today.');

  const { error } = await supabase().from('gold_rate').insert({
    household_id: input.householdId,
    purity: input.purity,
    rate_per_gram_minor: input.perGram.minor.toString(),
    currency: input.perGram.currency,
    as_at: input.asAt,
  });
  if (error !== null) throw asRepositoryError(error);

  return { revalued: await revalueGold(input.householdId, on, input.purity) };
}

interface PhysicalHolding {
  readonly holdingId: Uuid;
  readonly purity: GoldPurity;
  readonly currency: string;
  readonly statedQuantity: string;
}

/** The household's physical gold still held, as the caller can read it, optionally of one purity. */
async function physicalHoldings(householdId: Uuid, only: Uuid | null, purity: GoldPurity | null): Promise<readonly PhysicalHolding[]> {
  let instruments = supabase()
    .from('instrument')
    .select('id, gold_purity, currency')
    .eq('household_id', householdId)
    .eq('gold_form', 'physical')
    .eq('status', 'active');
  if (purity !== null) instruments = instruments.eq('gold_purity', purity);
  const found = await instruments;
  if (found.error !== null) throw asRepositoryError(found.error);
  const byInstrument = new Map(
    (found.data ?? []).map((row) => {
      const record = row as unknown as { id: string; gold_purity: GoldPurity; currency: string };
      return [record.id, record] as const;
    }),
  );
  if (byInstrument.size === 0) return [];

  let holdings = supabase()
    .from('holding')
    .select('id, instrument_id, quantity::text')
    .eq('household_id', householdId)
    .eq('status', 'active')
    .in('instrument_id', [...byInstrument.keys()]);
  if (only !== null) holdings = holdings.eq('id', only);
  const read = await holdings;
  if (read.error !== null) throw asRepositoryError(read.error);

  return (read.data ?? []).flatMap((row) => {
    const record = row as unknown as { id: string; instrument_id: string; quantity: string };
    const instrument = byInstrument.get(record.instrument_id);
    return instrument === undefined
      ? []
      : [{ holdingId: record.id, purity: instrument.gold_purity, currency: instrument.currency, statedQuantity: record.quantity }];
  });
}

/**
 * Value physical gold on a day and record the value as that day's reading: its grams held (the purchases less the sales) at the latest
 * typed rate for its purity on or before the day (GD-I3). A holding with no rate for its purity is left without a reading, and so is not
 * valued; a holding sold out has nothing to value. Returns how many readings were written.
 *
 * A private holding of another member is not readable by the caller, so it is not revalued here: its owner's next change does it.
 */
export async function revalueGold(householdId: Uuid, on: IsoDate, purity: GoldPurity | null = null, only: Uuid | null = null): Promise<number> {
  const holdings = await physicalHoldings(householdId, only, purity);
  if (holdings.length === 0) return 0;
  const ids = holdings.map((holding) => holding.holdingId);

  const [lots, sales, rates] = await Promise.all([
    supabase().from('lot').select('holding_id, quantity::text').in('holding_id', ids),
    supabase().from('disposal').select('holding_id, quantity::text').in('holding_id', ids),
    listGoldRates(householdId),
  ]);
  if (lots.error !== null) throw asRepositoryError(lots.error);
  if (sales.error !== null) throw asRepositoryError(sales.error);

  const quantitiesOf = (rows: readonly unknown[] | null, holdingId: string): bigint[] =>
    (rows ?? [])
      .map((row) => row as { holding_id: string; quantity: string })
      .filter((row) => row.holding_id === holdingId)
      .map((row) => parseQuantity(row.quantity));

  const domainRates = asDomainRates(rates);
  let written = 0;
  for (const holding of holdings) {
    const bought = quantitiesOf(lots.data, holding.holdingId);
    // Where nothing was recorded as a purchase, the holding's own stated quantity is what there is.
    const grams = bought.length === 0 ? parseQuantity(holding.statedQuantity) : gramsHeld(bought, quantitiesOf(sales.data, holding.holdingId));
    if (grams <= 0n) continue;

    const worth = physicalGoldValue({ grams, purity: holding.purity, currency: holding.currency }, domainRates, on);
    if (!worth.ok) continue;

    await recordValuation({
      householdId,
      holdingId: holding.holdingId,
      date: on,
      quantity: quantityToNumeric(grams),
      amount: money(worth.value.minor, worth.value.currency),
      source: 'manual',
      note: `Worked out: ${formatGrams(grams)} g at the ${holding.purity.toUpperCase()} rate of ${formatMoney(money(worth.rate.perGramMinor, worth.rate.currency))} a gram typed for ${worth.rate.asOf}.`,
    });
    written += 1;
  }
  return written;
}

function checkGold(input: NewGold): void {
  if (input.name.trim() === '') throw new Error('Say what it is: a necklace, a coin, a fund.');
  if (parseQuantity(input.quantity) <= 0n) throw new Error(input.form === 'physical' ? 'The weight is above nothing.' : 'The units are above nothing.');
  if (input.cost.minor < 0n) throw new Error('A cost is not negative.');
  if (input.form === 'physical') {
    if (input.purity === undefined || input.purity === null) throw new Error('Physical gold is valued at a rate for its purity, so it needs one.');
    if (input.isGift !== true && input.cost.minor === 0n) throw new Error('What it cost is above nothing. If it was a gift, say so.');
  } else {
    if (input.purity !== undefined && input.purity !== null) throw new Error('A gold ETF or fund has no purity: it is whatever the fund holds.');
    // The ISIN is what the price driver finds a fund by, and a fund no driver prices is not valued as one (GD-I9): so it is needed.
    if (input.isin === undefined || input.isin === null || input.isin.trim() === '') {
      throw new Error('The ISIN is needed: it is what prices the fund every day. It is on the fund’s factsheet or the AMFI list.');
    }
    if (!ISIN.test(input.isin.trim().toUpperCase())) throw new Error('An ISIN is twelve letters and digits, such as INF846K01W80.');
  }
}

/**
 * Add gold: its instrument, its holding and its first lot, then, for physical gold, its first value from the rate for its purity. If the
 * lot is refused the holding is archived and the failure said, so there is no holding half made. A gold ETF or fund is found by its ISIN,
 * which is also what the price driver reads it by; one with no ISIN is valued by a reading the household types.
 */
export async function addGold(input: NewGold, on: IsoDate): Promise<{ readonly holdingId: string; readonly valued: boolean }> {
  checkGold(input);
  const physical = input.form === 'physical';
  const isin = !physical && input.isin !== undefined && input.isin !== null && input.isin.trim() !== '' ? input.isin.trim().toUpperCase() : null;

  const { holdingId } = await addHolding({
    householdId: input.householdId,
    memberId: input.memberId,
    instrument: {
      name: input.name.trim(),
      kind: 'gold',
      goldForm: input.form,
      ...(physical && input.purity !== undefined && input.purity !== null ? { goldPurity: input.purity } : {}),
      // The form decides the class of physical gold: it is `gold`, whose rows carry 24 months (gold.md section 5). A gift is left without
      // one: its cost is not known, and a gain on it must not be worked out as if it were nil (see decisions.md, Gold).
      ...(physical && input.isGift !== true ? { taxAssetClass: 'gold' as const } : {}),
      ...(isin === null ? {} : { isin, priceSource: 'amfi', priceExternalId: isin }),
      currency: CURRENCY,
      exposureCurrency: CURRENCY,
      isForeignAsset: false,
    },
    quantity: input.quantity.trim(),
    cost: input.cost,
    openedOn: input.boughtOn,
    ...(input.earmark === undefined || input.earmark === 'none' ? {} : { earmark: input.earmark }),
  });

  try {
    await addLot({
      householdId: input.householdId,
      holdingId,
      acquiredOn: input.boughtOn,
      quantity: input.quantity.trim(),
      cost: input.cost,
      kind: input.isGift === true ? 'gift' : 'purchase',
      note: input.isGift === true ? 'A gift: what it cost is not known.' : (input.costNote ?? null),
    });
  } catch (error) {
    await archiveHolding(holdingId).catch(() => undefined);
    throw error;
  }

  if (physical) return { holdingId, valued: (await revalueGold(input.householdId, on, null, holdingId)) > 0 };

  if (input.worth !== undefined && input.worth !== null && input.worth.minor > 0n) {
    await recordValuation({
      householdId: input.householdId,
      holdingId,
      date: on,
      quantity: input.quantity.trim(),
      amount: input.worth,
      source: 'manual',
    });
    return { holdingId, valued: true };
  }
  return { holdingId, valued: false };
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') return new Error('You do not have permission to do that in this household.');
  if (error.code === '23505') return new Error('That already exists — check whether it has been recorded once already.');
  if (error.code === '23514') return new Error('That does not fit: check the amounts and the dates.');
  return new Error(error.message);
}
