/**
 * What the full export holds, and what each sheet is made of.
 *
 * The file holds what a person adds or changes: their expense categories and budgets, the holdings they own with their details,
 * the records under a holding (readings, lots, disposals, deposit terms, payments), liabilities, insurance, property and their
 * expenses. It does not hold setup that is not theirs to edit here: the household's settings (the Settings screen edits those),
 * the members (people join by invitation), the fixed lists a holding is chosen from (its kind, its scheme, its type: a person
 * picks one, they cannot add one), or reference data the app keeps (prices, rates, tax rules, exchange rates).
 *
 * The export is generated from this list and nothing else, so a table that is not on it is not in the file. That is the point and
 * the danger, and `NOT_EXPORTED` is the answer to the danger: every table in `supabase/migrations/` is either an entity below or
 * on that list with the reason it is left out, and every column of an entity is in its sheet or left out on purpose. A test reads
 * the migrations to hold both to the whole schema. A slice that adds a table adds it here as part of being done (docs/build-plan.md,
 * step 5).
 *
 * The same list is the shape of the upload template (blueprint section 17): the headers of a sheet are the columns below, a row
 * is found again by its `id`, and a column the template does not know is ignored on the way back in. Columns are named here and
 * selected by name by the repository, never `select *`, so a column added to a table later is out of the file until someone
 * decides it belongs.
 *
 * Two kinds of entity have no sheet of their own. A holding's instrument (what it is: its name, its kind, where it is priced) is
 * written in the Holdings sheet beside the holding, because a person adds a holding and not an instrument, and the kind is a
 * choice from a fixed list; `joins` says so. A member is read only so a name can be written beside an id.
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
  /** The sheet it is written in, or null for an entity that is read for its names or written inside another's sheet. */
  readonly sheet: string | null;
  readonly columns: readonly Column[];
  /** Whose records they are: the household's. (Reference data the app keeps is not exported at all.) */
  readonly scope: 'household';
  /** Whether the upload template accepts rows for it. Records the app keeps itself are read-only. */
  readonly upload: 'rows' | 'none';
  /** Which columns together find a row again. */
  readonly rowKey: readonly string[];
  /** What a person calls a row, written beside the columns that point at it. */
  readonly label?: (row: Row, lookup: Lookup) => string | null;
  /** Columns of the table that are in no sheet, on purpose, beyond the ones no sheet carries (`LEFT_OUT_COLUMNS`). */
  readonly leftOut?: readonly string[];
  /** Another entity whose columns are written in this entity's sheet, found through the column `via`. */
  readonly joins?: { readonly entity: string; readonly via: string };
}

/** Columns of every table that no sheet carries: whose it is (the household the file is for), who made it, and when the app did. */
export const LEFT_OUT_COLUMNS: ReadonlySet<string> = new Set(['household_id', 'created_by', 'voided_by', 'accepted_by', 'created_at', 'updated_at']);

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

export const ENTITIES: readonly Entity[] = [
  {
    // Read so a name can be written beside a member's id. People join by invitation: the app does not take members from a file.
    key: 'member',
    sheet: null,
    scope: 'household',
    upload: 'none',
    rowKey: ['id'],
    label: named('display_name'),
    leftOut: ['relation', 'is_dependent', 'colour', 'status', 'archived_at'],
    columns: [id(), text('display_name')],
  },
  {
    key: 'expense_category',
    sheet: 'Categories',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('name'),
    columns: [id(), text('name'), id('parent_id', 'expense_category'), text('nature'), bool('is_essential'), integer('sort_order'), text('status'), ts('archived_at')],
  },
  {
    key: 'expense_txn',
    sheet: 'Expenses',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [
      id(),
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
    ],
  },
  {
    key: 'budget',
    sheet: 'Budgets',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('category_id', 'expense_category'), integer('fy'), text('cadence'), integer('period'), money('planned_minor'), currency(), id('member_id', 'member')],
  },
  {
    // What a holding is. Written in the Holdings sheet, beside the holding: a person adds a holding, and its kind, scheme and type are
    // chosen from fixed lists and are not setup they can add to. Whether it is archived follows the holding.
    key: 'instrument',
    sheet: null,
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('name'),
    leftOut: ['status', 'archived_at'],
    columns: [
      id(),
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
    ],
  },
  {
    key: 'holding',
    sheet: 'Holdings',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    joins: { entity: 'instrument', via: 'instrument_id' },
    label: (row, lookup) => {
      const instrument = lookup('instrument', row['instrument_id']);
      const member = lookup('member', row['member_id']);
      if (instrument === undefined) return null;
      return member === undefined ? (instrument['name'] ?? null) : `${instrument['name'] ?? ''} (${member['display_name'] ?? ''})`;
    },
    columns: [
      id(),
      id('member_id', 'member'),
      id('instrument_id', 'instrument'),
      decimal('quantity'),
      money('cost_minor'),
      text('visibility'),
      date('opened_on'),
      text('folio_last4'),
      decimal('stated_quantity'),
      date('stated_as_at'),
      id('stated_source_batch_id'),
      text('earmark'),
      text('status'),
      ts('archived_at'),
    ],
  },
  {
    key: 'valuation_snapshot',
    sheet: 'Readings',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('holding_id', 'holding'), date('as_of_date'), decimal('quantity'), money('value_minor'), currency(), text('source'), text('note')],
  },
  {
    key: 'lot',
    sheet: 'Lots',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('holding_id', 'holding'), date('acquired_on'), decimal('quantity'), money('cost_minor'), currency(), text('kind'), text('note'), id('source_batch_id'), text('source_hash')],
  },
  {
    key: 'disposal',
    sheet: 'Disposals',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('holding_id', 'holding'), date('disposed_on'), decimal('quantity'), money('proceeds_minor'), currency(), text('kind'), text('note'), id('source_batch_id'), text('source_hash')],
  },
  {
    key: 'fixed_income_terms',
    sheet: 'Deposit terms',
    scope: 'household',
    upload: 'rows',
    rowKey: ['holding_id'],
    columns: [
      id('holding_id', 'holding'),
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
    ],
  },
  {
    key: 'deposit_renewal',
    sheet: 'Deposit renewals',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('holding_id', 'holding'), date('start_date'), date('maturity_date'), money('principal_minor'), currency(), decimal('rate_pct'), text('compounding'), text('note')],
  },
  {
    // Written by the app when a rating changes: read-only here.
    key: 'bond_rating_change',
    sheet: 'Bond ratings',
    scope: 'household',
    upload: 'none',
    rowKey: ['id'],
    columns: [id(), id('holding_id', 'holding'), integer('seq'), text('from_rating'), text('to_rating'), date('changed_on')],
  },
  {
    key: 'liability',
    sheet: 'Liabilities',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    label: named('name'),
    columns: [
      id(),
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
      id(),
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
      id(),
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
    ],
  },
  {
    key: 'property_improvement',
    sheet: 'Property work',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('property_id', 'property'), currency(), date('work_date'), text('description'), money('amount_minor'), bool('is_capital'), ts('voided_at')],
  },
  {
    key: 'property_valuation',
    sheet: 'Property valuations',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('property_id', 'property'), currency(), date('as_of_date'), money('value_minor'), text('basis'), text('note')],
  },
  {
    key: 'ppf_account',
    sheet: 'PPF accounts',
    scope: 'household',
    upload: 'rows',
    rowKey: ['holding_id'],
    columns: [id('holding_id', 'holding'), text('institution'), text('account_last4'), date('opening_date'), money('opening_balance_minor'), currency(), text('note')],
  },
  {
    key: 'ppf_entry',
    sheet: 'PPF payments',
    scope: 'household',
    upload: 'rows',
    rowKey: ['id'],
    columns: [id(), id('holding_id', 'holding'), date('entry_date'), money('amount_minor'), currency(), text('note'), ts('voided_at')],
  },
];

/** Every table that is left out of the full export, and why. A table is on this list or in `ENTITIES`, and a test holds it to that. */
export const NOT_EXPORTED: Readonly<Record<string, string>> = {
  household:
    'The household’s settings (its name, base currency, FIRE assumptions). The Settings screen edits them, and the file is for the records a person adds and changes.',
  price: 'Quotes the app fetches for every household’s instruments. Reference data the app keeps, not the household’s own record.',
  scheme_rate: 'The rate the government notified for a small-savings scheme: the same for every household, written by migration, and not the household’s own record.',
  tax_rule: 'Slabs, rates and thresholds: the same for every household and written by migration. Not the household’s own record.',
  fx_rate: 'Exchange rates the app fetches and appends. Reference data the app keeps, not something a household enters.',
  import_batch: 'The log of what was imported, which the app writes itself. The rows it made are in their own sheets.',
  import_ref: 'A row’s reference in the upload template. It is the ref column of the sheets once the template carries one, and not a sheet of its own.',
  import_batch_row: 'The images an upload keeps so it can be reversed, which include rows that are private to whoever made it. Not something to hand out in a file.',
  audit_log:
    'Its before and after images carry every figure of every table, including reads of private entries. A person’s own activity is the Profile screen’s export, not this one.',
  user_account: 'Sign-in identities: an email address and an authentication id. Not household data.',
  membership: 'Who may sign in, and with what role. Access, not records, and it is rebuilt by inviting people.',
  invite: 'An invitation’s code is a credential, and a hash of one.',
};

export const ENTITY_BY_KEY: ReadonlyMap<string, Entity> = new Map(ENTITIES.map((entity) => [entity.key, entity]));

/** The entities that have a sheet of their own, in the order the sheets are written. */
export const SHEETED: readonly Entity[] = ENTITIES.filter((entity) => entity.sheet !== null);

/**
 * The columns of an entity's sheet: its own, then those of the entity it joins, whose `id` is the join column already among its own.
 * The one place that knows a holding's sheet is made of two tables.
 */
export function sheetColumns(entity: Entity): readonly Column[] {
  const joined = entity.joins === undefined ? undefined : ENTITY_BY_KEY.get(entity.joins.entity);
  return joined === undefined ? entity.columns : [...entity.columns, ...joined.columns.filter((column) => column.key !== 'id')];
}

/** The header a column is given in a sheet: an amount in minor units is written in major units and is not called minor. */
export function headerOf(column: Column): string {
  return column.kind === 'money' ? column.key.replace(/_minor$/, '') : column.key;
}

/** The version of the sheets' shape. Changed when a column is added, removed or changes meaning; an older file is refused. */
export const TEMPLATE_VERSION = 1;
