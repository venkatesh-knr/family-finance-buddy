/**
 * The words of the report (docs/design/export-redesign.md section 2): every code a person would otherwise read, as the word the app shows for it.
 *
 * One table for each code list, and a test holds each to the database's own list (`rules.generated.ts` is read out of the migrations; the lists
 * of the ledger's tables, which an upload does not write, are held to the types the app reads them with). A code with no word here is a failing test, so
 * a value a migration adds cannot reach a person's file as `half_yearly` or `esop`.
 *
 * Pure: no I/O.
 */

export type Words = Readonly<Record<string, string>>;

/** How an expense was paid (`expense_txn.method`). */
export const METHOD_WORDS: Words = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  netbanking: 'Net banking',
  auto_debit: 'Auto-debit',
  other: 'Other',
};

/** How often a premium, an instalment or a rule recurs (`insurance_policy.cadence`, `liability.cadence`). */
export const CADENCE_WORDS: Words = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

/** When a deposit adds its interest (`fixed_income_terms.compounding`). */
export const COMPOUNDING_WORDS: Words = { ...CADENCE_WORDS, simple: 'Simple (paid out)' };

/** What a plan row is for (`budget.cadence`): its own sheet shows a month and a year side by side, so these are only for a cell that must say. */
export const BUDGET_CADENCE_WORDS: Words = { monthly: 'Per month', yearly: 'Per year' };

/** What Kept for says (`holding.earmark`); *none* is a blank, never a word. */
export const EARMARK_WORDS: Words = {
  emergency: 'Emergency',
  retirement: 'Retirement',
  child: 'Child',
  house: 'House',
};

/** What happened in a purchase (`lot.kind`). */
export const LOT_WORDS: Words = {
  purchase: 'Bought',
  bonus: 'Bonus units',
  split: 'Split',
  transfer: 'Transfer in',
  gift: 'Gift received',
  esop: 'ESOP',
};

/** What happened in a sale (`disposal.kind`). */
export const DISPOSAL_WORDS: Words = {
  sale: 'Sold',
  redemption: 'Redeemed',
  maturity: 'Matured',
  transfer: 'Transfer out',
  gift: 'Gift given',
};

/** How a recorded value got there (`valuation_snapshot.source`). */
export const READING_WORDS: Words = {
  manual: 'Typed',
  backfill: 'From a statement',
  driver: 'Fetched price',
};

/** What kind of policy it is (`insurance_policy.kind`). */
export const INSURANCE_WORDS: Words = {
  health: 'Health',
  term_life: 'Term life',
  endowment: 'Endowment',
  ulip: 'ULIP',
  money_back: 'Money back',
  vehicle: 'Vehicle',
  home: 'Home',
  personal_accident: 'Personal accident',
  other: 'Other',
};

/** What kind of loan it is (`liability.kind`). */
export const LOAN_WORDS: Words = {
  home_loan: 'Home loan',
  vehicle_loan: 'Vehicle loan',
  personal_loan: 'Personal loan',
  education_loan: 'Education loan',
  credit_card: 'Credit card',
  loan: 'Loan',
  other: 'Other',
};

/** What kind of property it is (`property.kind`). */
export const PROPERTY_WORDS: Words = {
  land: 'Land',
  plot: 'Plot',
  apartment: 'Apartment',
  house: 'House',
  commercial: 'Commercial',
};

/** What kind of account it is (`account.type`). */
export const ACCOUNT_WORDS: Words = {
  savings: 'Savings',
  current: 'Current',
  card: 'Card',
};

/** What a credit is (`credit_entry.category`). */
export const CREDIT_WORDS: Words = {
  salary: 'Salary',
  business: 'Business income',
  interest: 'Interest',
  rent: 'Rent',
  dividend: 'Dividend',
  other_income: 'Other income',
  refund: 'Refund or money back',
};

/** A deposit's scheme (`instrument.scheme`), for a holding whose kind is *deposit*. */
export const SCHEME_WORDS: Words = {
  fd: 'Fixed deposit (FD)',
  rd: 'Recurring deposit (RD)',
  ssy: 'Sukanya Samriddhi (SSY)',
  nsc: 'National Savings Certificate (NSC)',
  kvp: 'Kisan Vikas Patra (KVP)',
  scss: 'Senior Citizens’ Savings (SCSS)',
  pomis: 'Post Office Monthly Income (POMIS)',
  po_td: 'Post Office term deposit',
  other: 'Other deposit',
};

/** A retirement holding's type (`instrument.retirement_type`). */
export const RETIREMENT_WORDS: Words = { epf: 'EPF', nps: 'NPS', ppf: 'PPF' };

/** An instrument's kind (`instrument.kind`), for the kinds that are not told by their scheme or retirement type. */
export const KIND_WORDS: Words = {
  equity: 'Shares',
  etf: 'ETF',
  mutual_fund: 'Mutual fund',
  bond: 'Bond',
  deposit: 'Deposit',
  other: 'Other',
  retirement: 'Retirement scheme',
  gold: 'Gold',
};

/** A word for a code, or the code itself tidied when a list gained a value this table has not caught up with (the test says so before a person does). */
export function wordFor(words: Words, code: string | null | undefined): string | null {
  if (code === null || code === undefined || code === '') return null;
  return words[code] ?? null;
}

/**
 * What an investment is, in one word: a deposit by its scheme, a retirement holding by its type, anything else by its kind. This merges
 * `kind`, `scheme` and `retirement_type` as the report's *Type* column does.
 */
export function investmentType(kind: string | null, scheme: string | null, retirementType: string | null): string | null {
  if (kind === 'deposit' && scheme !== null && scheme !== '') return wordFor(SCHEME_WORDS, scheme) ?? wordFor(KIND_WORDS, kind);
  if (kind === 'retirement' && retirementType !== null && retirementType !== '') return wordFor(RETIREMENT_WORDS, retirementType) ?? wordFor(KIND_WORDS, kind);
  return wordFor(KIND_WORDS, kind);
}

/** The code lists behind these tables, for the test that holds every list to the database's own: table name, then the column its codes are held in. */
export const WORD_TABLES: ReadonlyArray<{ readonly name: string; readonly words: Words; readonly entity: string; readonly column: string }> = [
  { name: 'METHOD_WORDS', words: METHOD_WORDS, entity: 'expense_txn', column: 'method' },
  { name: 'CADENCE_WORDS (insurance)', words: CADENCE_WORDS, entity: 'insurance_policy', column: 'cadence' },
  { name: 'CADENCE_WORDS (liability)', words: CADENCE_WORDS, entity: 'liability', column: 'cadence' },
  { name: 'COMPOUNDING_WORDS', words: COMPOUNDING_WORDS, entity: 'deposit_renewal', column: 'compounding' },
  { name: 'BUDGET_CADENCE_WORDS', words: BUDGET_CADENCE_WORDS, entity: 'budget', column: 'cadence' },
  { name: 'LOT_WORDS', words: LOT_WORDS, entity: 'lot', column: 'kind' },
  { name: 'DISPOSAL_WORDS', words: DISPOSAL_WORDS, entity: 'disposal', column: 'kind' },
  { name: 'READING_WORDS', words: READING_WORDS, entity: 'valuation_snapshot', column: 'source' },
  { name: 'INSURANCE_WORDS', words: INSURANCE_WORDS, entity: 'insurance_policy', column: 'kind' },
  { name: 'LOAN_WORDS', words: LOAN_WORDS, entity: 'liability', column: 'kind' },
  { name: 'PROPERTY_WORDS', words: PROPERTY_WORDS, entity: 'property', column: 'kind' },
  { name: 'SCHEME_WORDS', words: SCHEME_WORDS, entity: 'instrument', column: 'scheme' },
  { name: 'RETIREMENT_WORDS', words: RETIREMENT_WORDS, entity: 'instrument', column: 'retirement_type' },
  { name: 'KIND_WORDS', words: KIND_WORDS, entity: 'instrument', column: 'kind' },
];
