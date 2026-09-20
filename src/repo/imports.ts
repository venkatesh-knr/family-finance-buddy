/**
 * Writing what a statement said.
 *
 * The parser reads a file and the screen shows what it found; this is the only
 * part that writes. It takes a plan — folios, purchases, sales, each carrying
 * the hash of the line it came from — and turns it into instruments, holdings,
 * lots and disposals.
 *
 * ── the same file twice ─────────────────────────────────────────────────
 *
 * A CAS covers a date range somebody will re-request, so the second import of
 * an overlapping file is the normal case, not the careless one. Two things
 * stop it doubling a cost basis, and they are not alternatives:
 *
 *   The unique index on (household_id, source_hash) is the guarantee. It is in
 *   the database, it cannot be talked out of it, and it is what makes this
 *   safe even if this file has a bug.
 *
 *   The check below is the courtesy. Asking which hashes are already present
 *   lets the screen say "eleven of these are already in" rather than reporting
 *   eleven constraint violations, which is the difference between an import
 *   somebody trusts and one they abandon.
 *
 * ── not a transaction, on purpose ───────────────────────────────────────
 *
 * PostgREST has no multi-statement transaction, and the same reasoning applies
 * here as in `addHolding`: what a partial failure leaves is a batch, perhaps an
 * instrument and a holding, and some of the rows. Running the import again
 * completes it, because every row already written is recognised by its hash and
 * skipped. The failure mode is "run it again", which is the one failure mode
 * worth having.
 */

import { supabase } from './client.ts';
import { isIsoDate } from '../lib/dates.ts';
import { parseQuantity, quantityToNumeric } from '../lib/quantity.ts';
import type { Uuid } from './types.ts';

export type ImportKind =
  | 'ecas_cams'
  | 'ecas_kfintech'
  | 'depository_cas'
  | 'bank_csv'
  | 'card_csv'
  | 'broker_csv'
  | 'template';

export interface PlannedLot {
  readonly acquiredOn: string;
  /** A decimal string, never a number — a fractional unit must not meet a double. */
  readonly quantity: string;
  readonly costMinor: bigint;
  readonly sourceHash: string;
  readonly note: string | null;
}

export interface PlannedDisposal {
  readonly disposedOn: string;
  readonly quantity: string;
  readonly proceedsMinor: bigint;
  readonly sourceHash: string;
  readonly note: string | null;
}

/**
 * The registrar's own count of units, on a date.
 *
 * Kept apart from the purchases on purpose: it answers "how many units", which
 * a statement covering only part of the history answers completely, where the
 * purchases answer it only for the part the statement reached.
 */
export interface StatedClosing {
  /** A decimal string, never a number. */
  readonly units: string;
  /** The date the statement says the balance was true. */
  readonly asOf: string;
}

export interface PlannedFolio {
  readonly scheme: string;
  readonly isin: string | null;
  /** Four characters at most. The whole folio never reaches this layer. */
  readonly folioLast4: string;
  readonly memberId: Uuid;
  readonly currency: string;
  readonly purchases: readonly PlannedLot[];
  readonly sales: readonly PlannedDisposal[];
  /** Null when the statement printed no closing balance, or no date to put on one. */
  readonly closing: StatedClosing | null;
}

export interface ImportOutcome {
  readonly batchId: Uuid;
  readonly purchasesWritten: number;
  readonly salesWritten: number;
  /** Lines that were already in, from an earlier import of an overlapping file. */
  readonly alreadyPresent: number;
  readonly instrumentsCreated: number;
  readonly holdingsCreated: number;
  /** Closing balances now on a holding, from this statement. */
  readonly balancesRecorded: number;
  /** Closing balances left alone because the holding already had one as late or later. */
  readonly balancesKept: number;
}

export interface ImportRequest {
  readonly householdId: Uuid;
  readonly kind: ImportKind;
  readonly label: string | null;
  readonly period: { readonly from: string; readonly to: string } | null;
  readonly folios: readonly PlannedFolio[];
}

/**
 * Which of these statement lines are already recorded.
 *
 * Asked before anything is written, so the screen can say what will happen
 * rather than reporting what went wrong.
 */
export async function alreadyImported(
  householdId: Uuid,
  hashes: readonly string[],
): Promise<ReadonlySet<string>> {
  const present = new Set<string>();
  if (hashes.length === 0) return present;

  const client = supabase();

  // In batches: a three-year statement is a few hundred lines, and a URL with
  // a few hundred hashes in it is longer than some proxies will carry.
  const size = 100;
  for (let at = 0; at < hashes.length; at += size) {
    const slice = hashes.slice(at, at + size);

    for (const table of ['lot', 'disposal'] as const) {
      const { data, error } = await client
        .from(table)
        .select('source_hash')
        .eq('household_id', householdId)
        .in('source_hash', slice);

      if (error !== null) throw asRepositoryError(error);

      for (const row of data ?? []) {
        const hash = (row as { source_hash?: string | null }).source_hash;
        if (typeof hash === 'string') present.add(hash);
      }
    }
  }

  return present;
}

/**
 * Write a statement.
 *
 * Returns what it did, in the terms a person checks against the file: how many
 * purchases and sales went in, how many were already there, and how many
 * positions had to be created.
 */
export async function importStatement(request: ImportRequest): Promise<ImportOutcome> {
  const client = supabase();

  const hashes = request.folios.flatMap((folio) => [
    ...folio.purchases.map((row) => row.sourceHash),
    ...folio.sales.map((row) => row.sourceHash),
  ]);

  const present = await alreadyImported(request.householdId, hashes);

  const toWrite = request.folios.map((folio) => ({
    folio,
    purchases: folio.purchases.filter((row) => !present.has(row.sourceHash)),
    sales: folio.sales.filter((row) => !present.has(row.sourceHash)),
  }));

  const rowCount = toWrite.reduce((total, f) => total + f.purchases.length + f.sales.length, 0);

  // The count goes in at insert because `import_batch` has no update grant: a
  // batch says what happened and is never revised afterwards.
  const batchResult = await client
    .from('import_batch')
    .insert({
      household_id: request.householdId,
      kind: request.kind,
      period_start: request.period?.from ?? null,
      period_end: request.period?.to ?? null,
      label: request.label,
      row_count: rowCount,
    })
    .select('id')
    .single();

  if (batchResult.error !== null) throw asRepositoryError(batchResult.error);
  const batchId = String(batchResult.data.id);

  let purchasesWritten = 0;
  let salesWritten = 0;
  let instrumentsCreated = 0;
  let holdingsCreated = 0;
  let balancesRecorded = 0;
  let balancesKept = 0;

  const stateBalance = async (holdingId: Uuid, closing: StatedClosing | null) => {
    if (closing === null) return;
    if (await recordStatedBalance(holdingId, closing, batchId)) balancesRecorded += 1;
    else balancesKept += 1;
  };

  for (const entry of toWrite) {
    if (entry.purchases.length === 0 && entry.sales.length === 0) {
      // Nothing new to write, and still worth a look. A statement re-requested
      // to a later date repeats every line — all "already in" — and carries a
      // newer closing balance than the one on file. A fund that was quiet in
      // the period is the same. Neither may create a position from nothing,
      // but an existing one takes the newer balance.
      if (entry.folio.closing === null) continue;
      const existing = await matchHolding(request.householdId, entry.folio, null);
      if (existing !== null) await stateBalance(existing, entry.folio.closing);
      continue;
    }

    const instrument = await findOrCreateInstrument(request.householdId, entry.folio);
    if (instrument.created) instrumentsCreated += 1;

    const holding = await findOrCreateHolding(request.householdId, entry.folio, instrument.id);
    if (holding.created) holdingsCreated += 1;

    if (entry.purchases.length > 0) {
      const { error } = await client.from('lot').insert(
        entry.purchases.map((row) => ({
          household_id: request.householdId,
          holding_id: holding.id,
          acquired_on: row.acquiredOn,
          quantity: quantityToNumeric(parseQuantity(row.quantity)),
          cost_minor: row.costMinor.toString(),
          currency: entry.folio.currency,
          kind: 'purchase',
          note: row.note,
          source_batch_id: batchId,
          source_hash: row.sourceHash,
        })),
      );

      if (error !== null) throw asRepositoryError(error);
      purchasesWritten += entry.purchases.length;
    }

    if (entry.sales.length > 0) {
      const { error } = await client.from('disposal').insert(
        entry.sales.map((row) => ({
          household_id: request.householdId,
          holding_id: holding.id,
          disposed_on: row.disposedOn,
          quantity: quantityToNumeric(parseQuantity(row.quantity)),
          proceeds_minor: row.proceedsMinor.toString(),
          currency: entry.folio.currency,
          kind: 'redemption',
          note: row.note,
          source_batch_id: batchId,
          source_hash: row.sourceHash,
        })),
      );

      if (error !== null) throw asRepositoryError(error);
      salesWritten += entry.sales.length;
    }

    // Last, so a failure above leaves rows and no balance rather than a
    // balance and no rows; running the import again writes the rest.
    await stateBalance(holding.id, entry.folio.closing);
  }

  return {
    batchId,
    purchasesWritten,
    salesWritten,
    alreadyPresent: present.size,
    instrumentsCreated,
    holdingsCreated,
    balancesRecorded,
    balancesKept,
  };
}

/**
 * The instrument this scheme is, creating it only if the household has none.
 *
 * Matched on ISIN first, which is the identifier that does not vary: a scheme's
 * printed name gains and loses "Regular Plan", "Growth" and the occasional
 * "(erstwhile ...)" between statements, and matching on it would make two
 * instruments out of one fund and split its cost basis.
 */
async function findOrCreateInstrument(
  householdId: Uuid,
  folio: PlannedFolio,
): Promise<{ id: Uuid; created: boolean }> {
  const client = supabase();

  const existing = await findInstrument(householdId, folio);
  if (existing !== null) return { id: existing, created: false };

  // A fund the driver can price, said at the moment the statement supplies the
  // identifier. AMFI's file is keyed by ISIN, which is exactly what an eCAS
  // prints beside every scheme — so an imported fund arrives already able to
  // fetch its own NAV, rather than sitting unvalued until somebody goes and
  // fills that in by hand.
  const priced =
    folio.isin === null
      ? { price_source: null, price_external_id: null }
      : { price_source: 'amfi', price_external_id: folio.isin };

  const created = await client
    .from('instrument')
    .insert({
      household_id: householdId,
      name: folio.scheme,
      kind: 'mutual_fund',
      isin: folio.isin,
      currency: folio.currency,
      // An Indian mutual fund is bought and priced in rupees. Whether it tracks
      // something else — a feeder fund following a US index — is a decision
      // §293 says must never be inferred, so it is left at the safe answer for
      // somebody to change on the holding.
      exposure_currency: folio.currency,
      is_foreign_asset: false,
      ...priced,
    })
    .select('id')
    .single();

  if (created.error !== null) throw asRepositoryError(created.error);
  return { id: String(created.data.id), created: true };
}

/** The instrument this scheme already is, or null. Matched as described above. */
async function findInstrument(householdId: Uuid, folio: PlannedFolio): Promise<Uuid | null> {
  const client = supabase();

  if (folio.isin !== null) {
    const { data, error } = await client
      .from('instrument')
      .select('id')
      .eq('household_id', householdId)
      .eq('isin', folio.isin)
      .limit(1);

    if (error !== null) throw asRepositoryError(error);
    const found = (data ?? [])[0];
    if (found !== undefined) return String(found.id);
  }

  const byName = await client
    .from('instrument')
    .select('id')
    .eq('household_id', householdId)
    .eq('name', folio.scheme)
    .limit(1);

  if (byName.error !== null) throw asRepositoryError(byName.error);
  const named = (byName.data ?? [])[0];
  return named === undefined ? null : String(named.id);
}

/**
 * The position this folio already is, or null.
 *
 * Without an instrument yet — a folio that was quiet in the period, with no
 * rows to justify creating anything — it is found the way an import finds it:
 * by ISIN, then by name.
 */
async function matchHolding(
  householdId: Uuid,
  folio: PlannedFolio,
  instrumentId: Uuid | null,
): Promise<Uuid | null> {
  const resolved = instrumentId ?? (await findInstrument(householdId, folio));
  if (resolved === null) return null;

  const existing = await supabase()
    .from('holding')
    .select('id, folio_last4')
    .eq('household_id', householdId)
    .eq('member_id', folio.memberId)
    .eq('instrument_id', resolved);

  if (existing.error !== null) throw asRepositoryError(existing.error);

  const rows = (existing.data ?? []) as { id: string; folio_last4: string | null }[];

  // The same folio, or — for a household that recorded this fund by hand
  // before importing — the position that never named one.
  const match =
    rows.find((row) => row.folio_last4 === folio.folioLast4) ??
    rows.find((row) => row.folio_last4 === null);

  return match === undefined ? null : String(match.id);
}

/** The position this folio is, creating it only if the member has none. */
async function findOrCreateHolding(
  householdId: Uuid,
  folio: PlannedFolio,
  instrumentId: Uuid,
): Promise<{ id: Uuid; created: boolean }> {
  const client = supabase();

  const found = await matchHolding(householdId, folio, instrumentId);
  if (found !== null) return { id: found, created: false };

  const created = await client
    .from('holding')
    .insert({
      household_id: householdId,
      member_id: folio.memberId,
      instrument_id: instrumentId,
      folio_last4: folio.folioLast4 === '' ? null : folio.folioLast4,
      // Zero, and not the statement's closing balance. What is held is derived
      // from the lots and sales about to be written; a quantity typed in beside
      // them would be a second answer to one question, and the two would drift.
      // The closing balance has columns of its own, written once the rows are in.
      quantity: '0',
    })
    .select('id')
    .single();

  if (created.error !== null) throw asRepositoryError(created.error);
  return { id: String(created.data.id), created: true };
}

/**
 * Record what the registrar says this position held, if that is news.
 *
 * One conditional update rather than a read and a write: "a later statement
 * supersedes it; an earlier one does not" is decided by the database in the
 * statement that writes, so two imports running together cannot leave the older
 * of them winning. Returns whether the balance was written. False means the
 * holding already had one as at that date or later — the outcome an
 * out-of-order import is meant to have, and not a failure.
 */
async function recordStatedBalance(
  holdingId: Uuid,
  closing: StatedClosing,
  batchId: Uuid,
): Promise<boolean> {
  // Interpolated into a filter below, so it is checked rather than trusted.
  if (!isIsoDate(closing.asOf)) {
    throw new Error('A closing balance needs a real date to be recorded against.');
  }

  const { data, error } = await supabase()
    .from('holding')
    .update({
      stated_quantity: quantityToNumeric(parseQuantity(closing.units)),
      stated_as_at: closing.asOf,
      stated_source_batch_id: batchId,
    })
    .eq('id', holdingId)
    .or(`stated_as_at.is.null,stated_as_at.lt.${closing.asOf}`)
    .select('id');

  if (error !== null) throw asRepositoryError(error);
  return (data ?? []).length > 0;
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('Only an owner, partner or contributor can import a statement.');
  }
  if (error.code === '23505') {
    // The index doing its job, on a line the check above did not see — two
    // imports running at once, most likely.
    return new Error(
      'Part of this statement is already recorded. Nothing was doubled; run the import again to write the rest.',
    );
  }
  return new Error(error.message);
}
