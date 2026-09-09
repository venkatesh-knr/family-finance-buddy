/**
 * The tax rules, as the app reads them.
 *
 * Read-only, and there is no write function here because there is no write
 * grant on the table: "a Budget change is a data edit" means a migration, not
 * a form. A household able to edit its own rates could compute the figure it
 * wanted, and the app's whole claim is that the numbers can be checked.
 *
 * Not scoped to a household, because the Act is not. Every member of every
 * household reads the same rows.
 */

import { supabase } from './client.ts';
import { MalformedRowError, optionalString, requireRecord, requireString } from '../lib/guards.ts';
import type { AssetClass, TaxRule, Term } from '../domain/tax-rules.ts';
import type { IsoDate } from '../lib/dates.ts';

const COLUMNS =
  'jurisdiction, kind, asset_class, months, rate_pct::text, term, effective_from, effective_to, authority';

export async function listTaxRules(): Promise<readonly TaxRule[]> {
  const client = supabase();

  const { data, error } = await client
    .from('tax_rule')
    .select(COLUMNS)
    .order('effective_from', { ascending: false });

  if (error !== null) throw new Error(error.message);

  return (data ?? []).map((row: unknown) => {
    const record = requireRecord(row, 'tax_rule');
    const months = record['months'];
    if (months !== null && typeof months !== 'number') {
      throw new MalformedRowError('tax_rule.months', 'is not a number');
    }
    const term = optionalString(record['term'], 'tax_rule.term');
    if (term !== null && term !== 'long' && term !== 'short') {
      throw new MalformedRowError('tax_rule.term', `is ${term}, not long or short`);
    }
    return {
      jurisdiction: requireString(record['jurisdiction'], 'tax_rule.jurisdiction'),
      kind: requireString(record['kind'], 'tax_rule.kind'),
      assetClass: optionalString(record['asset_class'], 'tax_rule.asset_class') as AssetClass | null,
      months,
      // ::text on the numeric, for the reason every exact number here is cast:
      // 12.5 arriving as a JSON double is a rate that has already lost what
      // the column was chosen to keep.
      ratePct: optionalString(record['rate_pct'], 'tax_rule.rate_pct'),
      term: term as Term | null,
      effectiveFrom: requireString(record['effective_from'], 'tax_rule.effective_from') as IsoDate,
      effectiveTo: optionalString(record['effective_to'], 'tax_rule.effective_to') as IsoDate | null,
      authority: requireString(record['authority'], 'tax_rule.authority'),
    };
  });
}
