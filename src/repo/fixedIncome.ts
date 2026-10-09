/**
 * Deposits and bonds: their terms, and the renewals the bank has made.
 *
 * A deposit or a bond is a holding, so it keeps its member, its privacy, its archive and
 * everything else that reads holdings; these rows hang off it exactly as a lot does. The
 * policies on the two tables defer to the holding's own, so what is returned here is only
 * what the caller may already read.
 *
 * No value is stored. The terms go in and the screen works the value out on a day
 * (`domain/fixed-income.ts`), so a rate corrected tomorrow corrects every figure.
 */

import { supabase } from './client.ts';
import { archiveHolding } from './holdings.ts';
import { toDepositRenewal, toFixedIncomeTerms } from './mapping.ts';
import type { FixedIncomeListing, NewDepositRenewal, NewFixedIncome } from './types.ts';

const TERMS_COLUMNS =
  'holding_id, household_id, kind, principal_minor::text, currency, rate_pct::text, start_date, maturity_date, compounding, coupon_frequency, rating, auto_renew, renewal_rate_pct::text, institution, account_last4, note';

const RENEWAL_COLUMNS =
  'id, holding_id, start_date, maturity_date, principal_minor::text, currency, rate_pct::text, compounding, note';

export async function listFixedIncome(householdId: string): Promise<FixedIncomeListing> {
  const client = supabase();

  const terms = await client.from('fixed_income_terms').select(TERMS_COLUMNS).eq('household_id', householdId);
  if (terms.error !== null) throw asRepositoryError(terms.error);

  const renewals = await client
    .from('deposit_renewal')
    .select(RENEWAL_COLUMNS)
    .eq('household_id', householdId)
    .order('start_date', { ascending: true });
  if (renewals.error !== null) throw asRepositoryError(renewals.error);

  return {
    terms: terms.data.map(toFixedIncomeTerms),
    renewals: renewals.data.map(toDepositRenewal),
  };
}

/**
 * A new deposit or bond: the instrument, the holding, then the terms.
 *
 * Three inserts, because the client library has no transaction and a function to do it in
 * one would be a migration of its own. If the terms are refused after the holding exists,
 * the holding is archived rather than left as a deposit with nothing to say what it is: a
 * soft delete, as everywhere, and it leaves no value on any screen. The instrument is left,
 * as `addHolding` leaves one, since it values nothing and the next attempt can use it.
 */
export async function addFixedIncome(input: NewFixedIncome): Promise<void> {
  const client = supabase();

  if (input.maturity <= input.start) throw new Error('It has to mature after it starts.');
  if (input.principal.minor <= 0n) throw new Error('The amount has to be more than nothing.');
  if (input.kind === 'deposit' && input.compounding === undefined) {
    throw new Error('Say how a deposit compounds. It is a property of each deposit, never assumed.');
  }
  if (input.kind === 'bond' && input.couponFrequency === undefined) {
    throw new Error('Say how often a bond pays its coupon.');
  }

  const instrument = await client
    .from('instrument')
    .insert({
      household_id: input.householdId,
      name: input.name,
      kind: input.kind,
      currency: input.principal.currency,
      exposure_currency: input.principal.currency,
      is_foreign_asset: false,
    })
    .select('id')
    .single();
  if (instrument.error !== null) throw asRepositoryError(instrument.error);

  // One unit, and the money is in the terms. The cost is what was put in, so the
  // gain on the Holdings screen is the interest earned and nothing is invented.
  const holding = await client
    .from('holding')
    .insert({
      household_id: input.householdId,
      member_id: input.memberId,
      instrument_id: String(instrument.data.id),
      quantity: '1',
      cost_minor: input.principal.minor.toString(),
      opened_on: input.start,
    })
    .select('id')
    .single();
  if (holding.error !== null) throw asRepositoryError(holding.error);

  const holdingId = String(holding.data.id);
  const terms = await client.from('fixed_income_terms').insert({
    holding_id: holdingId,
    household_id: input.householdId,
    kind: input.kind,
    principal_minor: input.principal.minor.toString(),
    currency: input.principal.currency,
    rate_pct: input.ratePct,
    start_date: input.start,
    maturity_date: input.maturity,
    compounding: input.kind === 'deposit' ? (input.compounding ?? null) : null,
    coupon_frequency: input.kind === 'bond' ? (input.couponFrequency ?? null) : null,
    rating: input.kind === 'bond' ? emptyToNull(input.rating) : null,
    auto_renew: input.kind === 'deposit' ? (input.autoRenew ?? false) : false,
    renewal_rate_pct:
      input.kind === 'deposit' && input.autoRenew === true ? emptyToNull(input.renewalRatePct) : null,
    institution: emptyToNull(input.institution),
    account_last4: emptyToNull(input.accountLast4),
  });

  if (terms.error !== null) {
    await archiveHolding(holdingId).catch(() => undefined);
    throw asRepositoryError(terms.error);
  }
}

/** A renewal the bank has made, as its advice states it. */
export async function addDepositRenewal(input: NewDepositRenewal): Promise<void> {
  if (input.maturity <= input.start) throw new Error('It has to mature after it starts.');
  if (input.principal.minor <= 0n) throw new Error('The amount has to be more than nothing.');

  const result = await supabase().from('deposit_renewal').insert({
    household_id: input.householdId,
    holding_id: input.holdingId,
    start_date: input.start,
    maturity_date: input.maturity,
    principal_minor: input.principal.minor.toString(),
    currency: input.principal.currency,
    rate_pct: input.ratePct,
    compounding: input.compounding,
    note: emptyToNull(input.note),
  });
  if (result.error !== null) throw asRepositoryError(result.error);
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface ProviderError {
  readonly message: string;
  readonly code?: string | undefined;
}

function asRepositoryError(error: ProviderError): Error {
  if (error.code === '42501') {
    return new Error('You do not have permission to do that in this household.');
  }
  if (error.code === '23505') {
    return new Error('A renewal starting on that date is already recorded for this deposit.');
  }
  if (error.code === '23514') {
    return new Error('Those terms are not valid: check the dates, the rate and the fields for this kind.');
  }
  return new Error(error.message);
}
