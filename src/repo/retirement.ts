/**
 * Retirement: an EPF, an NPS and a PPF (docs/decisions.md, Retirement; the schema is
 * `supabase/migrations/20261027120000_retirement.sql`).
 *
 * An EPF is a passbook balance and an NPS is units and a NAV, and each is a holding with readings, which `holdings.ts` already
 * reads and writes: all that is new for them is adding one with its type. A PPF is also an account (where it is and the balance
 * it was opened from) and its entries (what was paid in or taken out), and the notified rate its balance is worked out with.
 * Those are read and written here. Nothing here works out a figure: the balance is `src/domain/ppf.ts` and is never stored.
 *
 * Row-level security decides what comes back, as everywhere: the account and its entries are as private as the holding.
 */

import { parseQuantity } from '../lib/quantity.ts';
import { supabase } from './client.ts';
import { archiveHolding, addHolding } from './holdings.ts';
import { toPpfAccount, toPpfEntry, toSchemeRate } from './mapping.ts';
import type { NewPpfEntry, NewRetirement, PpfListing, Uuid } from './types.ts';

const ACCOUNT_COLUMNS =
  'holding_id, institution, account_last4, opening_date, opening_balance_minor::text, currency, note';
const ENTRY_COLUMNS = 'id, holding_id, entry_date, amount_minor::text, currency, note, voided_at';
const RATE_COLUMNS = 'scheme, effective_from, rate_pct::text';

const LAST4 = /^[0-9A-Za-z]{4}$/;

/**
 * Every PPF account and entry the caller can read in a household, and the notified rates.
 *
 * Read apart from the holdings, as the terms of a deposit are, and its failure is said by whoever asks: a PPF that could not
 * be read is not a PPF with no payments in it.
 */
export async function listPpf(householdId: Uuid): Promise<PpfListing> {
  const client = supabase();
  const [accounts, entries, rates] = await Promise.all([
    client.from('ppf_account').select(ACCOUNT_COLUMNS).eq('household_id', householdId),
    client
      .from('ppf_entry')
      .select(ENTRY_COLUMNS)
      .eq('household_id', householdId)
      .order('entry_date', { ascending: true }),
    client.from('scheme_rate').select(RATE_COLUMNS).eq('scheme', 'ppf').order('effective_from', { ascending: true }),
  ]);
  for (const result of [accounts, entries, rates]) {
    if (result.error !== null) throw asRepositoryError(result.error);
  }
  return {
    accounts: (accounts.data ?? []).map(toPpfAccount),
    entries: (entries.data ?? []).map(toPpfEntry),
    rates: (rates.data ?? []).map(toSchemeRate),
  };
}

function checkAccount(input: { name?: string; accountLast4?: string | null; openingBalance?: { minor: bigint } }): void {
  if (input.name !== undefined && input.name.trim() === '') throw new Error('A retirement account needs a name.');
  if (input.accountLast4 !== undefined && input.accountLast4 !== null && input.accountLast4 !== '' && !LAST4.test(input.accountLast4)) {
    throw new Error('Keep only the last four characters of the account, and nothing more.');
  }
  if (input.openingBalance !== undefined && input.openingBalance.minor < 0n) {
    throw new Error('An opening balance cannot be negative.');
  }
}

/**
 * Add an EPF, an NPS or a PPF.
 *
 * The holding and its instrument are written as any holding's are, with the kind `retirement` and its type. A PPF then has its
 * account written, and if that fails the holding is archived and the failure said, so there is no PPF with no account half made.
 * A value is a reading and is the caller's to record after, as it is for a fund.
 */
export async function addRetirement(input: NewRetirement): Promise<{ readonly holdingId: string }> {
  checkAccount({
    name: input.name,
    ...(input.type === 'ppf' ? { accountLast4: input.accountLast4 ?? null, openingBalance: input.openingBalance } : {}),
  });

  let quantity = '1';
  if (input.type === 'nps') {
    // An NPS is units, and a holding of no units is archived and not added.
    if (parseQuantity(input.units) <= 0n) throw new Error('An NPS holding is of some units. Archive it instead of setting it to zero.');
    quantity = input.units.trim();
  }

  const { holdingId } = await addHolding({
    householdId: input.householdId,
    memberId: input.memberId,
    instrument: {
      name: input.name.trim(),
      kind: 'retirement',
      currency: input.currency,
      exposureCurrency: input.currency,
      isForeignAsset: false,
      retirementType: input.type,
    },
    quantity,
    ...(input.earmark === undefined || input.earmark === 'none' ? {} : { earmark: input.earmark }),
  });

  if (input.type === 'ppf') {
    const { error } = await supabase().from('ppf_account').insert({
      holding_id: holdingId,
      household_id: input.householdId,
      institution: input.institution === undefined || input.institution === null || input.institution.trim() === '' ? null : input.institution.trim(),
      account_last4: input.accountLast4 === undefined || input.accountLast4 === null || input.accountLast4 === '' ? null : input.accountLast4,
      opening_date: input.openingDate,
      opening_balance_minor: input.openingBalance.minor.toString(),
      currency: input.openingBalance.currency,
    });
    if (error !== null) {
      await archiveHolding(holdingId).catch(() => undefined);
      throw asRepositoryError(error);
    }
  }

  return { holdingId };
}

/** Record a payment into a PPF, or a withdrawal out of it as a negative amount. */
export async function addPpfEntry(input: NewPpfEntry): Promise<void> {
  if (input.amount.minor === 0n) throw new Error('A payment of nothing is not recorded.');
  const { error } = await supabase().from('ppf_entry').insert({
    household_id: input.householdId,
    holding_id: input.holdingId,
    entry_date: input.date,
    amount_minor: input.amount.minor.toString(),
    currency: input.amount.currency,
    note: input.note === undefined || input.note === null || input.note.trim() === '' ? null : input.note.trim(),
  });
  if (error !== null) throw asRepositoryError(error);
}

/** Void an entry recorded by mistake. Never deleted: it stays in the list and out of the balance. */
export async function voidPpfEntry(id: Uuid): Promise<void> {
  const { data, error } = await supabase()
    .from('ppf_entry')
    .update({ voided_at: new Date().toISOString() })
    .eq('id', id)
    .is('voided_at', null)
    .select('id');
  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) throw new Error('That entry could not be voided. It may already have been.');
}

/**
 * Give a PPF holding its account: for one the migration converted from a deposit that had no reading to open it from, or one
 * whose account was never made. The holding must be a PPF; the database refuses anything else.
 */
export async function addPpfAccount(input: {
  readonly householdId: Uuid;
  readonly holdingId: Uuid;
  readonly institution?: string | null;
  readonly accountLast4?: string | null;
  readonly openingDate: string;
  readonly openingBalance: { readonly minor: bigint; readonly currency: string };
}): Promise<void> {
  checkAccount({ accountLast4: input.accountLast4 ?? null, openingBalance: input.openingBalance });
  const text = (value: string | null | undefined): string | null => (value === undefined || value === null || value.trim() === '' ? null : value.trim());
  const { error } = await supabase().from('ppf_account').insert({
    holding_id: input.holdingId,
    household_id: input.householdId,
    institution: text(input.institution),
    account_last4: text(input.accountLast4),
    opening_date: input.openingDate,
    opening_balance_minor: input.openingBalance.minor.toString(),
    currency: input.openingBalance.currency,
  });
  if (error !== null) throw asRepositoryError(error);
}

export interface PpfAccountPatch {
  readonly institution?: string | null;
  readonly accountLast4?: string | null;
  readonly openingDate?: string;
  readonly openingBalance?: { readonly minor: bigint };
  readonly note?: string | null;
}

/** Correct a PPF's account in place. The currency is not here: its payments are in it. */
export async function updatePpfAccount(holdingId: Uuid, patch: PpfAccountPatch): Promise<void> {
  checkAccount({
    ...(patch.accountLast4 === undefined ? {} : { accountLast4: patch.accountLast4 }),
    ...(patch.openingBalance === undefined ? {} : { openingBalance: patch.openingBalance }),
  });
  const fields: Record<string, unknown> = {};
  const text = (value: string | null): string | null => (value === null || value.trim() === '' ? null : value.trim());
  if (patch.institution !== undefined) fields['institution'] = text(patch.institution);
  if (patch.accountLast4 !== undefined) fields['account_last4'] = text(patch.accountLast4);
  if (patch.openingDate !== undefined) fields['opening_date'] = patch.openingDate;
  if (patch.openingBalance !== undefined) fields['opening_balance_minor'] = patch.openingBalance.minor.toString();
  if (patch.note !== undefined) fields['note'] = text(patch.note);
  if (Object.keys(fields).length === 0) return;

  const { data, error } = await supabase().from('ppf_account').update(fields).eq('holding_id', holdingId).select('holding_id');
  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) throw new Error('That account could not be changed. It may belong to another member.');
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
