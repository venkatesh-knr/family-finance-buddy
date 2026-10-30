/**
 * What the full export holds: one sheet for each entity, every one named here. It holds the household’s own records and the
 * setup it changes (its settings, members, categories, budgets, instruments), and its transactions. Reference data the app keeps
 * (prices, rates, tax rules, exchange rates) and the app’s own logs are not in it: they come back with the app.
 *
 * The export is generated from this list and nothing else, so a table that is not on it is not in the file. That is the point and
 * the danger, and `NOT_EXPORTED` is the answer to the danger: every table in `supabase/migrations/` is either an entity below or
 * on that list with the reason it is left out, and a test reads the migrations to hold the two lists to the whole schema. A slice
 * that adds a table adds it here as part of being done (docs/build-plan.md, step 5).
 *
 * The same list is the shape of the upload template (blueprint section 17): the headers of a sheet are the columns below, a row
 * is found again by its `id`, and a column the template does not know is ignored on the way back in. Columns are named here and
 * selected by name by the repository, never `select *`, so a column added to a table later is out of the file until someone
 * decides it belongs.
 *
 * Left out of every sheet on purpose: `created_by` and `voided_by` (the account that did it: an identity, not household data),
 * and everything that is a credential or a hash of one. A statement's raw payload is not a column of any table and so is not in
 * any sheet (docs/design/detail-level.md); a test asserts it on the output, not on this list.
 */

export type ColumnKind = 'id' | 'text' | 'currency' | 'date' | 'timestamp' | 'money' | 'decimal' | 'integer' | 'boolean';

/** Where a money column finds its currency: a column of its own row, or the row it points at. */
export type CurrencySource =
  | { readonly column: string }
  | { readonly via: string; readonly entity: string; readonly column: string };

export interface Column {
  readonly key: string;
  readonly kind: ColumnKind;
  /** The entity an `id` column points at, so a name can be written beside it. */
  readonly ref?: string;
  readonly currency?: CurrencySource;
}

export type Row = Readonly<Record<string, string | null>>;
export type Lookup = (entity: string, id: string | null | undefined) => Row | undefined;

export interface Entity {
  /** The table, and the key the repository and the tests use. */
  readonly key: string;
  readonly sheet: string;
  readonly columns: readonly Column[];
  /** Whose records they are: the household's. (Reference data the app keeps is not exported at all.) */
  readonly scope: 'household';
  /** Whether the upload template accepts rows for it. Reference data and records the app keeps itself are read-only. */
  readonly upload: 'rows' | 'none';
  /** Which columns together find a row again. */
  readonly rowKey: readonly string[];
  /** What a person calls a row, written beside the columns that point at it. */
  readonly label?: (row: Row, lookup: Lookup) => string | null;
  /** Columns written for reading and ignored on the way back in. */
  readonly derived?: readonly { readonly header: string; readonly after: string; readonly value: (row: Row, lookup: Lookup) => string | null }[];
}

const id = (key = 'id', ref?: string): Column => (ref === undefined ? { key, kind: 'id' } : { key, kind: 'id', ref });
const text = (key: string): Column => ({ key, kind: 'text' });
const currency = (key = 'currency'): Column => ({ key, kind: 'currency' });
const date = (key: string): Column => ({ key, kind: 'date' });
const ts = (key: string): Column => ({ key, kind: 'timestamp' });
const money = (key: string, source: CurrencySource = { column: 'currency' }): Column => ({ key, kind: 'money', currency: source });
const decimal = (key: string): Column => ({ key, kind: 'decimal' });
const integer = (key: string): Column => ({ key, kind: 'integer' });
const bool = (key: string): Column => ({ key, kind: 'boolean' });

const named = (column: string) => (row: Row): string | null => row[column] ?? null;

const household = (...columns: Column[]): Column[] => [id(), id('household_id', 'household'), ...columns];

export const ENTITIES: readonly Entity[] = [
  {
    key: 'household',
    sheet: 'Household',
    scope: 'household',
    upload: 'none',
    rowKey: ['id'],
    label: named('name'),
    columns: [
      id(),
      text('name'),
      text('kind'),
      currency('base_currency'),
      currency('display_currency'),
      integer('fy_start_month'),
      decimal('fire_multiplier'),
      decimal('fire_inflation_pct'),
      integer('fire_years_ahead'),
      decimal('fire_return_pct'),
      decimal('fire_step_up_pct'),
      money('fire_monthly_contribution_minor', { column: 'base_currency' }),
      integer('cover_dependency_years'),
      integer('property_valuation_stale_months'),
      ts('created_at'),
      ts('updated_at'),
    ],
  },
  {
    key: 'member',
    sheet: 'Members',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('display_name'),
    columns: [
      ...household(text('display_name'), text('relation'), bool('is_dependent'), text('colour'), text('status'), ts('archived_at'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'expense_category',
    sheet: 'Categories',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('name'),
    columns: [
      ...household(text('name'), id('parent_id', 'expense_category'), text('nature'), bool('is_essential'), integer('sort_order'), text('status'), ts('archived_at'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'expense_txn',
    sheet: 'Expenses',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(
        id('member_id', 'member'),
        id('category_id', 'expense_category'),
        date('txn_date'),
        money('amount_minor'),
        currency(),
        text('payee'),
        text('method'),
        text('note'),
        text('visibility'),
        ts('voided_at'),
        ts('created_at'),
        ts('updated_at'),
      ),
    ],
  },
  {
    key: 'budget',
    sheet: 'Budgets',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('category_id', 'expense_category'), integer('fy'), text('cadence'), integer('period'), money('planned_minor'), currency(), id('member_id', 'member'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'instrument',
    sheet: 'Instruments',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('name'),
    columns: [
      ...household(
        text('name'),
        text('kind'),
        text('symbol'),
        text('isin'),
        currency(),
        currency('exposure_currency'),
        bool('is_foreign_asset'),
        text('tax_asset_class'),
        text('price_source'),
        text('price_external_id'),
        text('scheme'),
        text('retirement_type'),
        text('status'),
        ts('archived_at'),
        ts('created_at'),
        ts('updated_at'),
      ),
    ],
  },
  {
    key: 'holding',
    sheet: 'Holdings',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: (row, lookup) => {
      const instrument = lookup('instrument', row['instrument_id']);
      const member = lookup('member', row['member_id']);
      if (instrument === undefined) return null;
      return member === undefined ? (instrument['name'] ?? null) : `${instrument['name'] ?? ''} (${member['display_name'] ?? ''})`;
    },
    derived: [{ header: 'cost_currency', after: 'cost_minor', value: (row, lookup) => lookup('instrument', row['instrument_id'])?.['currency'] ?? null }],
    columns: [
      ...household(
        id('member_id', 'member'),
        id('instrument_id', 'instrument'),
        decimal('quantity'),
        money('cost_minor', { via: 'instrument_id', entity: 'instrument', column: 'currency' }),
        text('visibility'),
        date('opened_on'),
        text('folio_last4'),
        decimal('stated_quantity'),
        date('stated_as_at'),
        id('stated_source_batch_id'),
        text('earmark'),
        text('status'),
        ts('archived_at'),
        ts('created_at'),
        ts('updated_at'),
      ),
    ],
  },
  {
    key: 'valuation_snapshot',
    sheet: 'Readings',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('holding_id', 'holding'), date('as_of_date'), decimal('quantity'), money('value_minor'), currency(), text('source'), text('note'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'lot',
    sheet: 'Lots',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('holding_id', 'holding'), date('acquired_on'), decimal('quantity'), money('cost_minor'), currency(), text('kind'), text('note'), id('source_batch_id'), text('source_hash'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'disposal',
    sheet: 'Disposals',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('holding_id', 'holding'), date('disposed_on'), decimal('quantity'), money('proceeds_minor'), currency(), text('kind'), text('note'), id('source_batch_id'), text('source_hash'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'fixed_income_terms',
    sheet: 'Deposit terms',
    scope: 'household',
    upload: 'rows',
    rowKey: ['holding_id'],
    columns: [
      id('holding_id', 'holding'),
      id('household_id', 'household'),
      text('kind'),
      money('principal_minor'),
      currency(),
      decimal('rate_pct'),
      date('start_date'),
      date('maturity_date'),
      text('compounding'),
      text('coupon_frequency'),
      text('rating'),
      bool('auto_renew'),
      decimal('renewal_rate_pct'),
      text('institution'),
      text('account_last4'),
      text('repay_mode'),
      text('note'),
      ts('created_at'),
      ts('updated_at'),
    ],
  },
  {
    key: 'deposit_renewal',
    sheet: 'Deposit renewals',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('holding_id', 'holding'), date('start_date'), date('maturity_date'), money('principal_minor'), currency(), decimal('rate_pct'), text('compounding'), text('note'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'bond_rating_change',
    sheet: 'Bond ratings',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [...household(id('holding_id', 'holding'), integer('seq'), text('from_rating'), text('to_rating'), date('changed_on'), ts('created_at'))],
  },
  {
    key: 'liability',
    sheet: 'Liabilities',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('name'),
    columns: [
      ...household(
        text('name'),
        text('kind'),
        money('instalment_minor'),
        currency(),
        text('cadence'),
        id('member_id', 'member'),
        money('outstanding_minor'),
        date('outstanding_as_of'),
        text('status'),
        ts('closed_at'),
        text('note'),
        ts('created_at'),
        ts('updated_at'),
      ),
    ],
  },
  {
    key: 'insurance_policy',
    sheet: 'Insurance',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('name'),
    columns: [
      ...household(
        text('name'),
        text('kind'),
        text('insurer'),
        text('policy_last4'),
        money('premium_minor'),
        currency(),
        text('cadence'),
        money('cover_minor'),
        date('started_on'),
        date('renewal_on'),
        date('premiums_end_on'),
        id('linked_holding_id', 'holding'),
        id('member_id', 'member'),
        text('status'),
        ts('lapsed_at'),
        text('note'),
        ts('created_at'),
        ts('updated_at'),
      ),
    ],
  },
  {
    key: 'property',
    sheet: 'Properties',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('label'),
    columns: [
      ...household(
        id('member_id', 'member'),
        text('kind'),
        text('label'),
        currency(),
        date('purchase_date'),
        money('purchase_cost_minor'),
        money('stamp_duty_minor'),
        money('registration_minor'),
        decimal('co_owner_share_pct'),
        bool('is_self_occupied'),
        id('linked_liability_id', 'liability'),
        text('visibility'),
        text('status'),
        ts('archived_at'),
        text('note'),
        ts('created_at'),
        ts('updated_at'),
      ),
    ],
  },
  {
    key: 'property_improvement',
    sheet: 'Property work',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('property_id', 'property'), currency(), date('work_date'), text('description'), money('amount_minor'), bool('is_capital'), ts('voided_at'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'property_valuation',
    sheet: 'Property valuations',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('property_id', 'property'), currency(), date('as_of_date'), money('value_minor'), text('basis'), text('note'), ts('created_at'), ts('updated_at')),
    ],
  },
  {
    key: 'ppf_account',
    sheet: 'PPF accounts',
    scope: 'household',
    upload: 'rows',
    rowKey: ['holding_id'],
    columns: [
      id('holding_id', 'holding'),
      id('household_id', 'household'),
      text('institution'),
      text('account_last4'),
      date('opening_date'),
      money('opening_balance_minor'),
      currency(),
      text('note'),
      ts('created_at'),
      ts('updated_at'),
    ],
  },
  {
    key: 'ppf_entry',
    sheet: 'PPF payments',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      ...household(id('holding_id', 'holding'), date('entry_date'), money('amount_minor'), currency(), text('note'), ts('voided_at'), ts('created_at'), ts('updated_at')),
    ],
  },
];

/** Every table that is left out of the full export, and why. A table is on this list or in `ENTITIES`, and a test holds it to that. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  price: 'Quotes the app fetches for every household’s instruments. Reference data the app keeps, not the household’s own record.',
  scheme_rate: 'The rate the government notified for a small-savings scheme: the same for every household, written by migration, and not the household’s own record.',
  tax_rule: 'Slabs, rates and thresholds: the same for every household and written by migration. Not the household’s own record.',
  fx_rate: 'Exchange rates the app fetches and appends. Reference data the app keeps, not something a household enters.',
  import_batch: 'The log of what was imported, which the app writes itself. The rows it made are in their own sheets.',
  audit_log:
    'Its before and after images carry every figure of every table, including reads of private entries. A person’s own activity is the Profile screen’s export, not this one.',
  user_account: 'Sign-in identities: an email address and an authentication id. Not household data.',
  membership: 'Who may sign in, and with what role. Access, not records, and it is rebuilt by inviting people.',
  invite: 'An invitation’s code is a credential, and a hash of one.',
};

export const ENTITY_BY_KEY: ReadonlyMap<string, Entity> = new Map(ENTITIES.map((entity) => [entity.key, entity]));

/** The header a column is given in a sheet: an amount in minor units is written in major units and is not called minor. */
export function headerOf(column: Column): string {
  return column.kind === 'money' ? column.key.replace(/_minor$/, '') : column.key;
}

/** The version of the sheets' shape. Changed when a column is added, removed or changes meaning; an older file is refused. */
export const TEMPLATE_VERSION = 1;
