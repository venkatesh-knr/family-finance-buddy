/**
 * The Tax screen's typed gross figures (docs/design/ledger-income.md section 8; the schema is
 * `supabase/migrations/20261114120000_ledger_income.sql`).
 *
 * Tax does not read the credits, which are take-home: a gross salary, a business net profit or other income is typed per member and tax
 * year, from the payslip and later corrected from Form 16, and stored here so the Tax card stops forgetting what was typed. A figure is
 * read only by the member's own login and by whoever typed it (LI-I21), so a partner does not read the other's gross salary unless they
 * typed it. Which figure is in force, and what the estimate does with it, is `src/domain/income.ts` and the tax engine.
 */

import { supabase } from './client.ts';
import { checkTaxInput } from './ledgerChecks.ts';
import { asLedgerError } from './ledgerErrors.ts';
import { toTaxInput } from './ledgerMapping.ts';
import type { NewTaxInput, TaxInputRecord, Uuid } from './types.ts';

const COLUMNS = 'id, household_id, member_id, tax_year, head, amount_minor::text, currency, tds_minor::text, source, created_by';

/** The figures the caller may read, for a tax year if one is given. */
export async function listTaxInputs(householdId: Uuid, options: { taxYear?: string } = {}): Promise<readonly TaxInputRecord[]> {
  let query = supabase().from('income_entry').select(COLUMNS).eq('household_id', householdId);
  if (options.taxYear !== undefined) query = query.eq('tax_year', options.taxYear);
  const { data, error } = await query.order('tax_year', { ascending: false });
  if (error !== null) throw asLedgerError(error);
  return (data ?? []).map(toTaxInput);
}

/**
 * Type a figure. One per member, tax year, head and source: typing it again corrects it. A Form 16 figure is its own row beside the
 * payslip one, so correcting from Form 16 keeps what the payslip said.
 */
export async function saveTaxInput(input: NewTaxInput): Promise<void> {
  checkTaxInput({ taxYear: input.taxYear, head: input.head, amount: input.amount, tds: input.tds ?? null, source: input.source });
  const { error } = await supabase()
    .from('income_entry')
    .upsert(
      {
        household_id: input.householdId,
        member_id: input.memberId,
        tax_year: input.taxYear,
        head: input.head,
        amount_minor: input.amount.minor.toString(),
        currency: input.amount.currency,
        tds_minor: input.tds === undefined || input.tds === null ? null : input.tds.minor.toString(),
        source: input.source,
      },
      { onConflict: 'household_id,member_id,tax_year,head,source' },
    );
  if (error !== null) throw asLedgerError(error);
}
