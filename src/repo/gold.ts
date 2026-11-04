/**
 * Gold: a jeweller's savings scheme (docs/design/gold.md; the schema is `supabase/migrations/20261102120000_gold.sql`).
 *
 * A scheme is a holding of the kind gold and the form `jeweller_scheme`, the terms it was agreed on (`gold_scheme_terms`), and its
 * instalments, which are lots on the holding. Recording an instalment writes the lot, brings the holding's cost to the total paid,
 * and, on an amount scheme, records the value as a reading, as a PPF's is, so net worth reads a scheme as it reads any holding.
 * A weight scheme is valued from a rate, and no rate is written here (GD-I3): it is not valued until one exists.
 *
 * Nothing here works out a figure. That is `src/domain/gold.ts`.
 */

import { minorToMajorText } from '../domain/export/cells.ts';
import { minorUnitExponent, money } from '../lib/money.ts';
import { supabase } from './client.ts';
import { addHolding, archiveHolding, recordValuation } from './holdings.ts';
import { addLot } from './lots.ts';
import { toGoldInstalment, toGoldTerms } from './mapping.ts';
import type { GoldInstalment, GoldListing, GoldSchemeTerms, NewGoldScheme, NewInstalment, Uuid } from './types.ts';

const TERMS_COLUMNS =
  'holding_id, variant, jeweller, instalment_minor::text, currency, instalments, start_date, due_day, bonus_text, bonus_minor::text, purity, scheme_last4, note';
const LOT_COLUMNS = 'id, holding_id, acquired_on, quantity::text, cost_minor::text, currency, note';

const LAST4 = /^[0-9A-Za-z]{4}$/;

/** Every gold scheme the caller can read in a household, and its instalments. The row-level security of the holding decides which. */
export async function listGold(householdId: Uuid): Promise<GoldListing> {
  const terms = await supabase().from('gold_scheme_terms').select(TERMS_COLUMNS).eq('household_id', householdId);
  // Before the gold migration is applied there is no table, and so no scheme to read: that is an empty listing, not a failure. The provider's
  // codes for it stay in this layer. Anything else is a read that failed.
  if (terms.error !== null && (terms.error.code === '42P01' || terms.error.code === 'PGRST205')) return { schemes: [], instalments: [] };
  if (terms.error !== null) throw asRepositoryError(terms.error);
  const schemes: GoldSchemeTerms[] = (terms.data ?? []).map(toGoldTerms);
  if (schemes.length === 0) return { schemes, instalments: [] };

  const lots = await supabase()
    .from('lot')
    .select(LOT_COLUMNS)
    .in('holding_id', schemes.map((scheme) => scheme.holdingId))
    .order('acquired_on', { ascending: true });
  if (lots.error !== null) throw asRepositoryError(lots.error);

  const variantOf = new Map(schemes.map((scheme) => [scheme.holdingId, scheme.variant] as const));
  const instalments: GoldInstalment[] = (lots.data ?? []).map((row) => {
    const holdingId = (row as unknown as { holding_id: string }).holding_id;
    return toGoldInstalment(row, variantOf.get(holdingId) ?? 'amount');
  });
  return { schemes, instalments };
}

function checkTerms(input: NewGoldScheme): void {
  if (input.name.trim() === '') throw new Error('A gold scheme needs a name.');
  if (input.jeweller.trim() === '') throw new Error('A gold scheme needs the jeweller it is with.');
  if (input.instalment.minor <= 0n) throw new Error('An instalment is some amount of money.');
  if (!Number.isInteger(input.instalments) || input.instalments < 1 || input.instalments > 120) {
    throw new Error('A scheme has between 1 and 120 instalments.');
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28) {
    throw new Error('An instalment falls due on a day from 1 to 28, so that it exists in every month.');
  }
  if (input.variant === 'weight' && (input.purity === undefined || input.purity === null)) {
    throw new Error('A scheme by weight is valued at a rate for its purity, so it needs one.');
  }
  if (input.schemeLast4 !== undefined && input.schemeLast4 !== null && input.schemeLast4 !== '' && !LAST4.test(input.schemeLast4)) {
    throw new Error('Keep only the last four characters of the scheme number, and nothing more.');
  }
}

/**
 * Add a scheme: its holding, then its terms. If the terms are refused the holding is archived and the failure said, so there is no
 * scheme half made. No instalment is recorded: the first is a separate act, and the scheme says what is paid so far as none.
 */
export async function addGoldScheme(input: NewGoldScheme): Promise<{ readonly holdingId: string }> {
  checkTerms(input);
  const currency = input.instalment.currency;

  const { holdingId } = await addHolding({
    householdId: input.householdId,
    memberId: input.memberId,
    instrument: {
      name: input.name.trim(),
      kind: 'gold',
      goldForm: 'jeweller_scheme',
      currency,
      exposureCurrency: currency,
      isForeignAsset: false,
    },
    quantity: '1',
    cost: money(0n, currency),
    openedOn: input.startDate,
    ...(input.earmark === undefined || input.earmark === 'none' ? {} : { earmark: input.earmark }),
  });

  const text = (value: string | null | undefined): string | null => (value === undefined || value === null || value.trim() === '' ? null : value.trim());
  const { error } = await supabase().from('gold_scheme_terms').insert({
    holding_id: holdingId,
    household_id: input.householdId,
    variant: input.variant,
    jeweller: input.jeweller.trim(),
    instalment_minor: input.instalment.minor.toString(),
    currency,
    instalments: input.instalments,
    start_date: input.startDate,
    due_day: input.dueDay,
    bonus_text: text(input.bonusText),
    bonus_minor: input.bonus === undefined || input.bonus === null ? null : input.bonus.minor.toString(),
    purity: input.purity ?? null,
    scheme_last4: text(input.schemeLast4),
  });
  if (error !== null) {
    await archiveHolding(holdingId).catch(() => undefined);
    throw asRepositoryError(error);
  }
  return { holdingId };
}

/**
 * Record an instalment paid. The lot's quantity is the grams on a weight scheme's receipt and the rupees on an amount scheme, as the
 * design says. The holding's cost is brought to the total paid, and an amount scheme's value, which is that total, is recorded as a
 * reading on the day given, so the figure net worth reads is the one the screen shows.
 */
export async function recordInstalment(input: NewInstalment): Promise<void> {
  if (input.amount.minor <= 0n) throw new Error('An instalment is some amount of money.');

  const found = await supabase().from('gold_scheme_terms').select('variant').eq('holding_id', input.holdingId).maybeSingle();
  if (found.error !== null) throw asRepositoryError(found.error);
  const variant = (found.data as { variant?: string } | null)?.variant;
  if (variant !== 'amount' && variant !== 'weight') throw new Error('That holding is not a gold scheme.');

  let quantity: string;
  if (variant === 'weight') {
    if (input.grams === undefined || input.grams === null || input.grams.trim() === '') {
      throw new Error('An instalment of a scheme by weight says how many grams it bought: it is on the receipt.');
    }
    quantity = input.grams.trim();
  } else {
    quantity = minorToMajorText(input.amount.minor, minorUnitExponent(input.amount.currency));
  }

  await addLot({
    householdId: input.householdId,
    holdingId: input.holdingId,
    acquiredOn: input.date,
    quantity,
    cost: input.amount,
    kind: 'purchase',
    note: 'Instalment',
  });

  const lots = await supabase().from('lot').select('cost_minor::text').eq('holding_id', input.holdingId);
  if (lots.error !== null) throw asRepositoryError(lots.error);
  const paid = (lots.data ?? []).reduce((sum, row) => sum + BigInt((row as unknown as { cost_minor: string }).cost_minor), 0n);

  const update = await supabase().from('holding').update({ cost_minor: paid.toString() }).eq('id', input.holdingId).select('id');
  if (update.error !== null) throw asRepositoryError(update.error);

  if (variant === 'amount') {
    await recordValuation({
      householdId: input.householdId,
      holdingId: input.holdingId,
      date: input.valueOn,
      quantity: '1',
      amount: money(paid, input.amount.currency),
      note: 'Worked out from the instalments paid.',
    });
  }
}

export interface GoldTermsPatch {
  readonly jeweller?: string;
  readonly schemeLast4?: string | null;
  readonly bonusText?: string | null;
  readonly bonus?: { readonly minor: bigint } | null;
  readonly note?: string | null;
}

/** Correct a scheme's terms in place. The variant, the instalment, the count and the dates are what the scheme was agreed as: a scheme that changed them is a new one. */
export async function updateGoldTerms(holdingId: Uuid, patch: GoldTermsPatch): Promise<void> {
  if (patch.schemeLast4 !== undefined && patch.schemeLast4 !== null && patch.schemeLast4 !== '' && !LAST4.test(patch.schemeLast4)) {
    throw new Error('Keep only the last four characters of the scheme number, and nothing more.');
  }
  const text = (value: string | null): string | null => (value === null || value.trim() === '' ? null : value.trim());
  const fields: Record<string, unknown> = {};
  if (patch.jeweller !== undefined) {
    if (patch.jeweller.trim() === '') throw new Error('A gold scheme needs the jeweller it is with.');
    fields['jeweller'] = patch.jeweller.trim();
  }
  if (patch.schemeLast4 !== undefined) fields['scheme_last4'] = text(patch.schemeLast4);
  if (patch.bonusText !== undefined) fields['bonus_text'] = text(patch.bonusText);
  if (patch.bonus !== undefined) fields['bonus_minor'] = patch.bonus === null ? null : patch.bonus.minor.toString();
  if (patch.note !== undefined) fields['note'] = text(patch.note);
  if (Object.keys(fields).length === 0) return;

  const { data, error } = await supabase().from('gold_scheme_terms').update(fields).eq('holding_id', holdingId).select('holding_id');
  if (error !== null) throw asRepositoryError(error);
  if ((data ?? []).length === 0) throw new Error('That scheme could not be changed. It may belong to another member.');
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
