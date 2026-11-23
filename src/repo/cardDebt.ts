/**
 * A card's EMI plans as one debt (docs/design/card-cycles.md 4a; CY-I17; the link is `liability.card_account_id` in `supabase/migrations/20261120120000_card_cycles.sql`).
 *
 * Only an owner or a partner records a debt, as they alone record a loan, and the policies refuse anybody else. What it says is owed is worked out from the card's statements
 * (`src/domain/cardEmiDebt.ts`) and written here; nothing in this file adds anything up.
 */

import type { IsoDate } from '../lib/dates.ts';
import { optionalString, requireRecord, requireString, toBigIntExact } from '../lib/guards.ts';
import type { Money } from '../lib/money.ts';
import { supabase } from './client.ts';
import type { Uuid } from './types.ts';

const COLUMNS = 'id, card_account_id, outstanding_minor::text, outstanding_as_of, status';

/** A card's debt as stored: what it says is owed, as at when, and whether it is closed. */
export interface CardDebt {
  readonly id: Uuid;
  readonly cardAccountId: Uuid;
  readonly outstanding: bigint | null;
  readonly asOf: IsoDate | null;
  readonly isClosed: boolean;
}

function toCardDebt(raw: unknown): CardDebt {
  const row = requireRecord(raw, 'liability');
  const outstanding = row['outstanding_minor'];
  return {
    id: requireString(row['id'], 'liability.id'),
    cardAccountId: requireString(row['card_account_id'], 'liability.card_account_id'),
    outstanding: outstanding === null || outstanding === undefined ? null : toBigIntExact(outstanding, 'liability.outstanding_minor'),
    asOf: optionalString(row['outstanding_as_of'], 'liability.outstanding_as_of') as IsoDate | null,
    isClosed: row['status'] === 'closed',
  };
}

function asDebtError(error: { readonly code?: string; readonly message: string }): Error {
  if (error.code === '42501') return new Error('Only an owner or a partner can add a card’s EMI plans to the household’s debts.');
  if (error.code === '23505') return new Error('That card’s EMI plans are already in your debts.');
  return new Error(error.message);
}

/** The debts that are a card's EMI plans, those the caller may read. For anybody who may not read debts this is none, which is the policy's answer and not an error. */
export async function listCardDebts(householdId: Uuid): Promise<readonly CardDebt[]> {
  const { data, error } = await supabase().from('liability').select(COLUMNS).eq('household_id', householdId).not('card_account_id', 'is', null);
  if (error !== null) throw asDebtError(error);
  return (data ?? []).map(toCardDebt);
}

/** What a closed debt is closed at: the statement date that took it to nothing, from midnight in India. */
const closedAt = (asOf: IsoDate): string => `${asOf}T00:00:00+05:30`;

/** Make a card's debt, with what it already owes. One per card: a second is refused by the database. */
export async function addCardDebt(input: {
  readonly householdId: Uuid;
  readonly cardAccountId: Uuid;
  readonly memberId: Uuid;
  readonly name: string;
  readonly outstanding: Money;
  readonly asOf: IsoDate;
  readonly closed: boolean;
}): Promise<void> {
  const { error } = await supabase()
    .from('liability')
    .insert({
      household_id: input.householdId,
      name: input.name,
      kind: 'credit_card',
      currency: input.outstanding.currency,
      member_id: input.memberId,
      card_account_id: input.cardAccountId,
      outstanding_minor: input.outstanding.minor.toString(),
      outstanding_as_of: input.asOf,
      status: input.closed ? 'closed' : 'active',
      closed_at: input.closed ? closedAt(input.asOf) : null,
    });
  if (error !== null) throw asDebtError(error);
}

/** Say what a card's debt now owes, as at a statement date: closed when it is nothing, and open again when it is not. A write that does not change that leaves the closing day as it was. */
export async function setCardDebtState(input: { readonly id: Uuid; readonly outstanding: Money; readonly asOf: IsoDate; readonly closed: boolean; readonly changesStatus: boolean }): Promise<void> {
  // Closed on the statement date that took it to nothing: a later statement that leaves it at nothing does not move the day.
  const status = input.changesStatus ? { status: input.closed ? 'closed' : 'active', closed_at: input.closed ? closedAt(input.asOf) : null } : {};
  const { error } = await supabase()
    .from('liability')
    .update({ outstanding_minor: input.outstanding.minor.toString(), outstanding_as_of: input.asOf, ...status })
    .eq('id', input.id);
  if (error !== null) throw asDebtError(error);
}
