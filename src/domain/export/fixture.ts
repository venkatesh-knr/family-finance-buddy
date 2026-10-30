import type { Row } from './entities.ts';

/** A small household with one of most kinds of record, for the tests of the export. Not used by the app. */
export const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-0000000000a1';
const CATEGORY = '00000000-0000-4000-8000-0000000000c1';
const INSTRUMENT = '00000000-0000-4000-8000-0000000000d1';
const HOLDING = '00000000-0000-4000-8000-0000000000e1';
const PPF_HOLDING = '00000000-0000-4000-8000-0000000000e2';

export function exportFixture(): Record<string, Row[]> {
  return {
    household: [
      {
        id: HOUSEHOLD, name: 'The Rao household', kind: 'family', base_currency: 'INR', display_currency: 'INR', fy_start_month: '4',
        fire_multiplier: '25.0', fire_inflation_pct: '6.000', fire_years_ahead: '20', fire_return_pct: '9.000', fire_step_up_pct: '5.000',
        fire_monthly_contribution_minor: '5000000', cover_dependency_years: '10', property_valuation_stale_months: '12',
        created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-10-01T00:00:00+00:00',
      },
    ],
    member: [
      { id: MEMBER, household_id: HOUSEHOLD, display_name: 'Venkatesh', relation: 'self', is_dependent: 'false', colour: 'teal', status: 'active', archived_at: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00' },
    ],
    expense_category: [
      { id: CATEGORY, household_id: HOUSEHOLD, name: 'Groceries', parent_id: null, nature: 'variable', is_essential: 'true', sort_order: '1', status: 'active', archived_at: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00' },
    ],
    expense_txn: [
      {
        id: '00000000-0000-4000-8000-0000000000f1', household_id: HOUSEHOLD, member_id: MEMBER, category_id: CATEGORY, txn_date: '2026-10-29',
        amount_minor: '123456789', currency: 'INR', payee: '=SUM(A1:A9)', method: 'upi', note: null, visibility: 'household', voided_at: null,
        created_at: '2026-10-29T10:00:00.123456+00:00', updated_at: '2026-10-29T10:00:00.123456+00:00',
      },
    ],
    instrument: [
      {
        id: INSTRUMENT, household_id: HOUSEHOLD, name: 'Nippon Nifty 50', kind: 'fund', symbol: null, isin: 'INF204K01XX1', currency: 'INR', exposure_currency: 'INR',
        is_foreign_asset: 'false', tax_asset_class: null, price_source: 'amfi', price_external_id: '120503', scheme: null, retirement_type: null, status: 'active',
        archived_at: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00',
      },
      {
        id: '00000000-0000-4000-8000-0000000000d2', household_id: HOUSEHOLD, name: 'PPF', kind: 'retirement', symbol: null, isin: null, currency: 'INR', exposure_currency: 'INR',
        is_foreign_asset: 'false', tax_asset_class: null, price_source: null, price_external_id: null, scheme: null, retirement_type: 'ppf', status: 'active',
        archived_at: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00',
      },
    ],
    holding: [
      {
        id: HOLDING, household_id: HOUSEHOLD, member_id: MEMBER, instrument_id: INSTRUMENT, quantity: '1234.56780000', cost_minor: '15000000', visibility: 'household',
        opened_on: '2024-04-01', folio_last4: '1234', stated_quantity: null, stated_as_at: null, stated_source_batch_id: null, earmark: null, status: 'active',
        archived_at: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00',
      },
      {
        id: PPF_HOLDING, household_id: HOUSEHOLD, member_id: MEMBER, instrument_id: '00000000-0000-4000-8000-0000000000d2', quantity: '1.00000000', cost_minor: null,
        visibility: 'household', opened_on: null, folio_last4: null, stated_quantity: null, stated_as_at: null, stated_source_batch_id: null, earmark: null, status: 'active',
        archived_at: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00',
      },
    ],
    ppf_entry: [
      { id: '00000000-0000-4000-8000-000000000b01', household_id: HOUSEHOLD, holding_id: PPF_HOLDING, entry_date: '2026-04-02', amount_minor: '5000000', currency: 'INR', note: null, voided_at: null, created_at: '2026-04-02T00:00:00+00:00', updated_at: '2026-04-02T00:00:00+00:00' },
      { id: '00000000-0000-4000-8000-000000000b02', household_id: HOUSEHOLD, holding_id: PPF_HOLDING, entry_date: '2026-09-02', amount_minor: '-1000000', currency: 'INR', note: 'withdrawal', voided_at: null, created_at: '2026-09-02T00:00:00+00:00', updated_at: '2026-09-02T00:00:00+00:00' },
    ],
    scheme_rate: [{ id: '00000000-0000-4000-8000-000000000a01', scheme: 'ppf', effective_from: '2020-04-01', rate_pct: '7.100', created_at: '2026-10-27T00:00:00+00:00' }],
  };
}

