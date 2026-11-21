/**
 * The months an owner or a partner closed without a statement-date card's statement (docs/design/card-cycles.md 2.4; the schema is `supabase/migrations/20261120120000_card_cycles.sql`).
 *
 * Only an owner or a partner reads or writes them: the policies return nothing to anybody else and refuse a write by anybody else. A choice is made once for a card and a month, and is
 * undone by voiding it, never deleted. Nothing here works out a month's figures: the card adds nothing to that month until its statement arrives, when the month corrects itself and the
 * choice is simply no longer needed (`src/features/money/closeMonth.ts`, `cardCycles`).
 */

import { currentAccountId } from './account.ts';
import { supabase } from './client.ts';
import { requireRecord, requireString } from '../lib/guards.ts';
import { requireIsoDate } from './mapping.ts';
import type { Uuid } from './types.ts';

const COLUMNS = 'id, household_id, account_id, month';

/** A month closed without a card: which card, which month (`YYYY-MM`). */
export interface CloseWithoutCard {
  readonly id: Uuid;
  readonly accountId: Uuid;
  readonly month: string;
}

export function toCloseWithoutCard(raw: unknown): CloseWithoutCard {
  const row = requireRecord(raw, 'close_without_card');
  const month = requireIsoDate(row['month'], 'close_without_card.month');
  return { id: requireString(row['id'], 'close_without_card.id'), accountId: requireString(row['account_id'], 'close_without_card.account_id'), month: month.slice(0, 7) };
}

/** What a failed write means to a person, from the table's own refusals. */
function asCloseError(error: { readonly code?: string; readonly message: string }): Error {
  switch (error.code) {
    case '42501':
      return new Error('Your role here does not allow that. Only an owner or a partner closes a month without a card.');
    case '23505':
      return new Error('That month is already closed without this card.');
    case '23514':
      return new Error(error.message.includes('has ended') ? 'A month can be closed only once it has ended.' : 'Only a card whose bill closes on its statement date can be left out of a close.');
    default:
      return new Error(error.message);
  }
}

/** The live choices, for every month: a voided one is not a choice. For anybody but an owner or a partner this is none, which is the policy's answer and not an error. */
export async function listClosesWithoutCard(householdId: Uuid): Promise<readonly CloseWithoutCard[]> {
  const { data, error } = await supabase().from('close_without_card').select(COLUMNS).eq('household_id', householdId).is('voided_at', null);
  if (error !== null) throw asCloseError(error);
  return (data ?? []).map(toCloseWithoutCard);
}

/** Close a month without a card. The month is `YYYY-MM`; the table stores its first day. */
export async function closeWithoutCard(input: { readonly householdId: Uuid; readonly accountId: Uuid; readonly month: string }): Promise<void> {
  const { error } = await supabase().from('close_without_card').insert({ household_id: input.householdId, account_id: input.accountId, month: `${input.month}-01` });
  if (error !== null) throw asCloseError(error);
}

/** Undo a choice: it stops counting and stays, where the audit log shows it. */
export async function voidCloseWithoutCard(id: Uuid): Promise<void> {
  const account = await currentAccountId();
  const { data, error } = await supabase().from('close_without_card').update({ voided_at: new Date().toISOString(), voided_by: account }).eq('id', id).is('voided_at', null).select('id');
  if (error !== null) throw asCloseError(error);
  if ((data ?? []).length === 0) throw new Error('That choice is not yours to undo, or it was undone already.');
}
