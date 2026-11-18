import type { Row } from './entities.ts';

/**
 * A household for the tests of the report: one of most kinds of record, in rupees and dollars, with the rows a report must leave out (a removed expense, an
 * archived holding, a lapsed policy) and a private entry. Not used by the app.
 */

const ID = (n: string): string => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
export const MEMBER_A = ID('a1');
export const MEMBER_B = ID('a2');

export function reportFixture(): Record<string, Row[]> {
  return {
    member: [
      { id: MEMBER_A, display_name: 'Venkatesh' },
      { id: MEMBER_B, display_name: 'Meera' },
    ],
    expense_category: [
      { id: ID('c1'), name: 'Groceries', nature: 'variable' },
      { id: ID('c2'), name: 'Fuel', nature: 'variable' },
    ],
    expense_txn: [
      { id: ID('f1'), member_id: MEMBER_A, category_id: ID('c1'), txn_date: '2026-10-28', amount_minor: '355500', currency: 'INR', payee: 'Reliance Fresh', method: 'card', note: null, visibility: 'household', voided_at: null },
      { id: ID('f2'), member_id: MEMBER_A, category_id: ID('c2'), txn_date: '2026-10-26', amount_minor: '470000', currency: 'INR', payee: 'HP Petrol', method: 'upi', note: null, visibility: 'household', voided_at: null },
      { id: ID('f3'), member_id: MEMBER_A, category_id: ID('c1'), txn_date: '2026-09-25', amount_minor: '180000', currency: 'INR', payee: 'Corner shop', method: 'cash', note: 'private', visibility: 'personal', voided_at: null },
      { id: ID('f4'), member_id: MEMBER_A, category_id: null, txn_date: '2026-09-02', amount_minor: '99900', currency: 'INR', payee: 'Unfiled', method: 'auto_debit', note: null, visibility: 'household', voided_at: null },
      { id: ID('f5'), member_id: MEMBER_A, category_id: ID('c1'), txn_date: '2026-09-03', amount_minor: '777700', currency: 'INR', payee: 'A removed entry', method: 'upi', note: null, visibility: 'household', voided_at: '2026-09-04T00:00:00+00:00' },
      { id: ID('f6'), member_id: MEMBER_A, category_id: ID('c1'), txn_date: '2026-10-03', amount_minor: '4999', currency: 'USD', payee: 'Abroad', method: 'card', note: null, visibility: 'household', voided_at: null },
    ],
    budget: [
      { id: ID('b1'), category_id: ID('c1'), fy: '2026', cadence: 'monthly', period: null, planned_minor: '1800000', currency: 'INR', member_id: null },
      { id: ID('b2'), category_id: ID('c2'), fy: '2026', cadence: 'monthly', period: null, planned_minor: '600000', currency: 'INR', member_id: null },
      { id: ID('b3'), category_id: ID('c2'), fy: '2026', cadence: 'yearly', period: null, planned_minor: '7200000', currency: 'INR', member_id: null },
    ],
    instrument: [
      { id: ID('d1'), name: 'Demo Flexi Cap Fund', kind: 'mutual_fund', currency: 'INR', is_foreign_asset: 'false', scheme: null, retirement_type: null },
      { id: ID('d2'), name: 'Emergency fund (bank FD)', kind: 'deposit', currency: 'INR', is_foreign_asset: 'false', scheme: 'fd', retirement_type: null },
      { id: ID('d3'), name: 'NPS TIER1', kind: 'retirement', currency: 'INR', is_foreign_asset: 'false', scheme: null, retirement_type: 'nps' },
      { id: ID('d4'), name: 'Vanguard Total Stock Market ETF', kind: 'etf', currency: 'USD', is_foreign_asset: 'true', scheme: null, retirement_type: null },
      { id: ID('d5'), name: 'An old fund', kind: 'mutual_fund', currency: 'INR', is_foreign_asset: 'false', scheme: null, retirement_type: null },
    ],
    holding: [
      { id: ID('e1'), member_id: MEMBER_A, instrument_id: ID('d1'), quantity: '600', cost_minor: '9000000', visibility: 'household', earmark: 'none', status: 'active', archived_at: null },
      { id: ID('e2'), member_id: MEMBER_A, instrument_id: ID('d2'), quantity: '1', cost_minor: '30000000', visibility: 'household', earmark: 'emergency', status: 'active', archived_at: null },
      { id: ID('e3'), member_id: MEMBER_B, instrument_id: ID('d3'), quantity: '1', cost_minor: null, visibility: 'household', earmark: 'retirement', status: 'active', archived_at: null },
      { id: ID('e4'), member_id: MEMBER_A, instrument_id: ID('d4'), quantity: '12.5', cost_minor: '3400000', visibility: 'household', earmark: 'none', status: 'active', archived_at: null },
      { id: ID('e5'), member_id: MEMBER_A, instrument_id: ID('d5'), quantity: '5', cost_minor: '100000', visibility: 'household', earmark: 'none', status: 'archived', archived_at: '2026-01-01T00:00:00+00:00' },
    ],
    valuation_snapshot: [
      { id: ID('v1'), holding_id: ID('e1'), as_of_date: '2026-07-31', quantity: '600', value_minor: '21800000', currency: 'INR', source: 'manual', note: null },
      { id: ID('v2'), holding_id: ID('e1'), as_of_date: '2026-08-31', quantity: '600', value_minor: '22400000', currency: 'INR', source: 'driver', note: null },
      { id: ID('v3'), holding_id: ID('e2'), as_of_date: '2026-08-31', quantity: '1', value_minor: '30000000', currency: 'INR', source: 'backfill', note: null },
      { id: ID('v4'), holding_id: ID('e3'), as_of_date: '2026-11-01', quantity: '1', value_minor: '567260', currency: 'INR', source: 'manual', note: null },
      { id: ID('v5'), holding_id: ID('e4'), as_of_date: '2026-08-31', quantity: '12.5', value_minor: '4180000', currency: 'USD', source: 'manual', note: null },
      { id: ID('v6'), holding_id: ID('e5'), as_of_date: '2025-12-31', quantity: '5', value_minor: '90000', currency: 'INR', source: 'manual', note: 'archived holding' },
    ],
    lot: [
      { id: ID('l1'), holding_id: ID('e1'), acquired_on: '2026-04-15', quantity: '600', cost_minor: '9000000', currency: 'INR', kind: 'purchase', note: null },
      { id: ID('l2'), holding_id: ID('e1'), acquired_on: '2026-06-01', quantity: '60', cost_minor: '0', currency: 'INR', kind: 'bonus', note: null },
      { id: ID('l3'), holding_id: ID('e5'), acquired_on: '2025-01-01', quantity: '5', cost_minor: '100000', currency: 'INR', kind: 'purchase', note: 'archived holding' },
    ],
    disposal: [
      { id: ID('s1'), holding_id: ID('e1'), disposed_on: '2026-09-10', quantity: '100', proceeds_minor: '3700000', currency: 'INR', kind: 'sale', note: null },
    ],
    fixed_income_terms: [
      { holding_id: ID('e2'), kind: 'deposit', principal_minor: '30000000', currency: 'INR', rate_pct: '6.5', start_date: '2026-07-04', maturity_date: '2027-07-04', compounding: 'quarterly', institution: 'Demo Bank', account_last4: '4521' },
    ],
    deposit_renewal: [],
    insurance_policy: [
      { id: ID('p1'), name: 'ULIP', kind: 'ulip', insurer: 'Demo Life Insurance', policy_last4: '9012', premium_minor: '5000000', currency: 'INR', cadence: 'yearly', cover_minor: '50000000', renewal_on: '2027-01-30', premiums_end_on: null, member_id: MEMBER_A, status: 'active' },
      { id: ID('p2'), name: 'Family health floater', kind: 'health', insurer: 'Demo Health Insurance', policy_last4: '7305', premium_minor: '320000', currency: 'INR', cadence: 'monthly', cover_minor: '100000000', renewal_on: '2027-05-20', premiums_end_on: null, member_id: null, status: 'active' },
      { id: ID('p3'), name: 'A lapsed policy', kind: 'term_life', insurer: 'Old Co', policy_last4: null, premium_minor: '1000', currency: 'INR', cadence: 'yearly', cover_minor: '1000', renewal_on: null, premiums_end_on: null, member_id: MEMBER_A, status: 'lapsed' },
    ],
    liability: [
      { id: ID('i1'), name: 'Home loan', kind: 'home_loan', instalment_minor: '3200000', currency: 'INR', cadence: 'monthly', member_id: MEMBER_A, outstanding_minor: '400000000', outstanding_as_of: '2026-10-01', status: 'active' },
      { id: ID('i2'), name: 'Closed loan', kind: 'personal_loan', instalment_minor: '100000', currency: 'INR', cadence: 'monthly', member_id: MEMBER_A, outstanding_minor: null, outstanding_as_of: null, status: 'closed' },
    ],
    loan_payment: [
      { id: ID('m1'), liability_id: ID('i1'), paid_on: '2026-10-05', amount_minor: '3200000', currency: 'INR', voided_at: null },
      { id: ID('m2'), liability_id: ID('i1'), paid_on: '2026-10-06', amount_minor: '500000', currency: 'INR', voided_at: '2026-10-07T00:00:00+00:00' },
    ],
    property: [
      { id: ID('r1'), member_id: MEMBER_A, kind: 'apartment', label: 'House1', currency: 'INR', purchase_date: '2026-11-09', purchase_cost_minor: '120000000', stamp_duty_minor: '10000000', registration_minor: '5000000', co_owner_share_pct: '100', is_self_occupied: 'false', status: 'active' },
    ],
    account: [
      { id: ID('k1'), member_id: MEMBER_A, name: 'HDFC savings', type: 'savings', currency: 'INR', account_last4: '4821', status: 'active' },
      { id: ID('k2'), member_id: MEMBER_A, name: 'ICICI card', type: 'card', currency: 'INR', account_last4: '1188', status: 'active' },
    ],
    account_balance: [
      { id: ID('n1'), account_id: ID('k1'), as_at: '2026-09-30', balance_minor: '21000000', currency: 'INR', source: 'typed' },
      { id: ID('n2'), account_id: ID('k1'), as_at: '2026-10-31', balance_minor: '22038000', currency: 'INR', source: 'typed' },
      { id: ID('n3'), account_id: ID('k2'), as_at: '2026-10-31', balance_minor: '1220000', currency: 'INR', source: 'typed' },
    ],
    credit_entry: [
      { id: ID('t1'), member_id: MEMBER_A, account_id: ID('k1'), category: 'salary', amount_minor: '14200000', currency: 'INR', credit_date: '2026-10-01', visibility: 'personal', payer: 'Acme Ltd', voided_at: null },
      { id: ID('t2'), member_id: MEMBER_A, account_id: ID('k1'), category: 'refund', amount_minor: '129900', currency: 'INR', credit_date: '2026-10-07', visibility: 'household', payer: 'Amazon', voided_at: null },
      { id: ID('t3'), member_id: MEMBER_A, account_id: ID('k1'), category: 'other_income', amount_minor: '5000', currency: 'INR', credit_date: '2026-10-08', visibility: 'household', payer: 'A removed credit', voided_at: '2026-10-09T00:00:00+00:00' },
    ],
  };
}

export const REPORT_META = { exportedAt: '2026-11-17T06:30:00.000Z', householdName: 'The Rao household', demo: false } as const;
