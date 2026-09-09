/**
 * Purchases and sales.
 *
 *   addLot()       — record an acquisition
 *   addDisposal()  — record a sale
 *   updateLot()    — correct an acquisition
 *   updateDisposal() — correct a sale
 *
 * Reading is folded into `listHoldings()` rather than living here, because the
 * screen needs lots, sales and valuations together to say anything at all —
 * a parcel is a lot and a sale, and a gain is meaningless without both.
 *
 * There is no wrapper for `holding_cost_source()`. A lot is visible to exactly
 * whoever can see its holding, so a holding in the listing with no lots beside
 * it has none — the listing already answers the question the function answers,
 * and calling it per holding would be a round trip to learn what is in hand.
 * The function stays in the schema as the server-side statement of the rule,
 * for the reporting work that will not have a listing loaded.
 *
 * Nothing in this file computes a gain. That is `src/domain/lots.ts`, which is
 * pure and testable; this layer moves rows.
 */

import { supabase } from './client.ts';
import { quantityToNumeric, parseQuantity } from '../lib/quantity.ts';
import type { NewDisposal, NewLot, Uuid } from './types.ts';

/**
 * Record an acquisition.
 *
 * The quantity is parsed and re-rendered rather than passed through. A caller
 * who typed "1,000" gets a thousand and a caller who typed nine decimal places
 * gets an error here, at the boundary, instead of a `numeric` overflow from
 * Postgres that says nothing about which field was wrong.
 */
export async function addLot(input: NewLot): Promise<void> {
  const client = supabase();

  const quantity = parseQuantity(input.quantity);
  if (quantity <= 0n) {
    throw new Error('A purchase is of some quantity; zero units is not an acquisition.');
  }
  if (input.cost.minor < 0n) {
    throw new Error('A cost cannot be negative. A bonus issue costs nothing — record zero.');
  }

  const { error } = await client.from('lot').insert({
    household_id: input.householdId,
    holding_id: input.holdingId,
    acquired_on: input.acquiredOn,
    quantity: quantityToNumeric(quantity),
    cost_minor: input.cost.minor.toString(),
    currency: input.cost.currency,
    kind: input.kind ?? 'purchase',
    note: input.note ?? null,
  });

  if (error !== null) throw asRepositoryError(error);
}

/** Record a sale. Proceeds are net of the costs of selling. */
export async function addDisposal(input: NewDisposal): Promise<void> {
  const client = supabase();

  const quantity = parseQuantity(input.quantity);
  if (quantity <= 0n) {
    throw new Error('A sale is of some quantity; zero units is not a sale.');
  }
  if (input.proceeds.minor < 0n) {
    throw new Error('Proceeds cannot be negative. A sale that raised nothing is zero.');
  }

  const { error } = await client.from('disposal').insert({
    household_id: input.householdId,
    holding_id: input.holdingId,
    disposed_on: input.disposedOn,
    quantity: quantityToNumeric(quantity),
    proceeds_minor: input.proceeds.minor.toString(),
    currency: input.proceeds.currency,
    kind: input.kind ?? 'sale',
    note: input.note ?? null,
  });

  if (error !== null) throw asRepositoryError(error);
}

/**
 * Correct an acquisition.
 *
 * Not optional, given there is no delete on this table. A mistyped cost that
 * could be neither corrected nor removed would be a wrong gain forever, and
 * the reason deletion is refused — that removing a lot silently re-matches
 * every later sale — is an argument for editing in place, not against it.
 *
 * The returned rows are checked, not just the error. A policy-refused update
 * comes back with no error and no rows, which reads as success and is how a
 * screen ends up showing a change the database did not make.
 */
export async function updateLot(
  id: Uuid,
  patch: { acquiredOn?: string; quantity?: string; costMinor?: bigint; note?: string | null },
): Promise<void> {
  const client = supabase();

  const fields: Record<string, unknown> = {};
  if (patch.acquiredOn !== undefined) fields['acquired_on'] = patch.acquiredOn;
  if (patch.quantity !== undefined) {
    const quantity = parseQuantity(patch.quantity);
    if (quantity <= 0n) throw new Error('A purchase is of some quantity.');
    fields['quantity'] = quantityToNumeric(quantity);
  }
  if (patch.costMinor !== undefined) fields['cost_minor'] = patch.costMinor.toString();
  if (patch.note !== undefined) fields['note'] = patch.note;

  if (Object.keys(fields).length === 0) return;

  const { data, error } = await client.from('lot').update(fields).eq('id', id).select('id');

  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) {
    throw new Error('That purchase could not be changed. It may belong to someone else.');
  }
}

/** Correct a sale. Same reasoning as updateLot: no delete, so no dead ends. */
export async function updateDisposal(
  id: Uuid,
  patch: { disposedOn?: string; quantity?: string; proceedsMinor?: bigint; note?: string | null },
): Promise<void> {
  const client = supabase();

  const fields: Record<string, unknown> = {};
  if (patch.disposedOn !== undefined) fields['disposed_on'] = patch.disposedOn;
  if (patch.quantity !== undefined) {
    const quantity = parseQuantity(patch.quantity);
    if (quantity <= 0n) throw new Error('A sale is of some quantity.');
    fields['quantity'] = quantityToNumeric(quantity);
  }
  if (patch.proceedsMinor !== undefined) fields['proceeds_minor'] = patch.proceedsMinor.toString();
  if (patch.note !== undefined) fields['note'] = patch.note;

  if (Object.keys(fields).length === 0) return;

  const { data, error } = await client.from('disposal').update(fields).eq('id', id).select('id');

  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) {
    throw new Error('That sale could not be changed. It may belong to someone else.');
  }
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('Only an owner, partner or contributor can record a purchase or a sale.');
  }
  if (error.code === '23514') {
    return new Error('A quantity must be above zero and a cost cannot be negative.');
  }
  if (error.code === '23503') {
    return new Error('That holding is not one this household can record against.');
  }
  return new Error(error.message);
}
