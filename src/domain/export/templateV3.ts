/**
 * The template, version 3 (docs/design/export-redesign.md section 3): the sheets and columns a person can understand and add to, with the household's own lists.
 *
 * What is here is the shape only: the sheets, their columns (needed or not, a list or a check, a comment, a width, a format), the choice lists and the words
 * in them, the example row of each sheet, and `How to fill`. `src/lib/templateFileV3.ts` writes it as an .xlsx, and `templateReadV3.ts` reads a filled one
 * back into the rows `planUpload` takes. A word in a list and the code it stands for live together here, so the writer and the reader cannot disagree.
 *
 * Pure: no I/O. The household's lists and the template's own id are passed in.
 */

import { CADENCE_WORDS, CREDIT_WORDS, DISPOSAL_WORDS, EARMARK_WORDS, INSURANCE_WORDS, LOT_WORDS, METHOD_WORDS, PROPERTY_WORDS } from './reportWords.ts';

export const TEMPLATE_V3_VERSION = 3;
/** Rows of each sheet that carry a key and the sheet's checks and lists: SP-0001 to SP-0300. */
export const TEMPLATE_V3_ROWS = 300;

/** What a household gives the template: the names its dropdowns offer. `Name (Whose)` for an investment, as the app shows it. */
export interface TemplateLists {
  readonly members: readonly string[];
  readonly categories: readonly string[];
  readonly accounts: readonly string[];
  readonly investments: readonly string[];
}

export interface TemplateMeta {
  readonly householdName: string;
  /** The day it was made, written the long way. */
  readonly madeOn: string;
  /** A short code for this download, which prefixes every row key's reference so two downloads never collide. */
  readonly templateId: string;
  readonly demo: boolean;
  /** The financial years a list offers, `2026-27`. */
  readonly financialYears: readonly string[];
}


// ───────────────────────────────────────────────────────────── the household's lists

type Table = Readonly<Record<string, string | null>>;

/** The financial years a template offers: the one that began last April, the one now, and the next, written 2026-27. */
export function financialYearsFor(today: string): readonly string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const current = month >= 4 ? year : year - 1;
  return [current - 1, current, current + 1].map((first) => `${String(first)}-${String((first + 1) % 100).padStart(2, '0')}`);
}

/**
 * The household's names the template's dropdowns offer, from the rows the report reads: the members, the categories in use, the accounts in use (with their
 * last four, so two of one bank can be told apart) and the investments held today, each as `Name (Whose)` as the app shows it.
 */
export function templateListsFrom(tables: Readonly<Record<string, readonly Table[]>>): TemplateLists {
  const rows = (entity: string): readonly Table[] => tables[entity] ?? [];
  const memberName = new Map(rows('member').map((row) => [row['id'] ?? '', row['display_name'] ?? ''] as const));
  const instrumentName = new Map(rows('instrument').map((row) => [row['id'] ?? '', row['name'] ?? ''] as const));
  const sorted = (names: readonly string[]): string[] => [...new Set(names.filter((name) => name !== ''))].sort((a, b) => a.localeCompare(b));
  return {
    members: rows('member').map((row) => row['display_name'] ?? '').filter((name) => name !== ''),
    categories: sorted(rows('expense_category').filter((row) => (row['status'] ?? 'active') === 'active').map((row) => row['name'] ?? '')),
    accounts: sorted(
      rows('account')
        .filter((row) => (row['status'] ?? 'active') === 'active')
        .map((row) => (row['account_last4'] === null || row['account_last4'] === undefined || row['account_last4'] === '' ? (row['name'] ?? '') : `${row['name'] ?? ''} ••${row['account_last4']}`)),
    ),
    investments: sorted(
      rows('holding')
        .filter((row) => (row['status'] ?? 'active') === 'active' && row['archived_at'] === null)
        .map((row) => `${instrumentName.get(row['instrument_id'] ?? '') ?? ''} (${memberName.get(row['member_id'] ?? '') ?? ''})`),
    ),
  };
}

// ───────────────────────────────────────────────────────────── the choice lists

/** A word and what it stands for, in one place. */
export interface Choice<T> {
  readonly word: string;
  readonly code: T;
}

export interface InvestmentCode {
  readonly kind: string;
  readonly scheme: string | null;
  readonly retirement: string | null;
}

const inv = (word: string, kind: string, scheme: string | null = null, retirement: string | null = null): Choice<InvestmentCode> => ({ word, code: { kind, scheme, retirement } });

export const INVESTMENT_TYPES: readonly Choice<InvestmentCode>[] = [
  inv('Mutual fund', 'mutual_fund'),
  inv('Share', 'equity'),
  inv('ETF', 'etf'),
  inv('Bond', 'bond'),
  inv('Gold', 'gold'),
  inv('Fixed deposit (FD)', 'deposit', 'fd'),
  inv('Recurring deposit (RD)', 'deposit', 'rd'),
  inv('Sukanya Samriddhi (SSY)', 'deposit', 'ssy'),
  inv('NSC', 'deposit', 'nsc'),
  inv('KVP', 'deposit', 'kvp'),
  inv('Senior citizens (SCSS)', 'deposit', 'scss'),
  inv('Post office MIS', 'deposit', 'pomis'),
  inv('Post office TD', 'deposit', 'po_td'),
  inv('EPF', 'retirement', null, 'epf'),
  inv('NPS', 'retirement', null, 'nps'),
  inv('PPF', 'retirement', null, 'ppf'),
  inv('Other', 'other'),
];

const fromWords = (words: Readonly<Record<string, string>>): Choice<string>[] => Object.entries(words).map(([code, word]) => ({ word, code }));

export const METHOD_CHOICES: readonly Choice<string>[] = fromWords(METHOD_WORDS);
export const MONEY_IN_CHOICES: readonly Choice<string>[] = fromWords(CREDIT_WORDS);
export const OFTEN_CHOICES: readonly Choice<string>[] = fromWords(CADENCE_WORDS);
/** How often a deposit adds its interest; *At maturity* is simple interest, paid out. */
export const INTEREST_CHOICES: readonly Choice<string>[] = [...fromWords(CADENCE_WORDS), { word: 'At maturity', code: 'simple' }];
export const INSURANCE_CHOICES: readonly Choice<string>[] = fromWords(INSURANCE_WORDS);
export const PROPERTY_CHOICES: readonly Choice<string>[] = fromWords(PROPERTY_WORDS);
export const LOAN_CHOICES: readonly Choice<string>[] = [
  { word: 'Home loan', code: 'home_loan' },
  { word: 'Vehicle loan', code: 'vehicle_loan' },
  { word: 'Personal loan', code: 'personal_loan' },
  { word: 'Education loan', code: 'education_loan' },
  { word: 'Credit card', code: 'credit_card' },
  { word: 'Other loan', code: 'other' },
];
export const KEPT_FOR_CHOICES: readonly Choice<string | null>[] = [{ word: 'Nothing in particular', code: null }, ...Object.entries(EARMARK_WORDS).map(([code, word]) => ({ word, code }))];

/** What happened to an investment: the words, and whether it is a purchase (a lot) or a sale (a disposal) and its kind. */
export interface TradeCode {
  readonly table: 'lot' | 'disposal';
  readonly kind: string;
}
export const TRADE_CHOICES: readonly Choice<TradeCode>[] = [
  { word: LOT_WORDS['purchase'] ?? 'Bought', code: { table: 'lot', kind: 'purchase' } },
  { word: DISPOSAL_WORDS['sale'] ?? 'Sold', code: { table: 'disposal', kind: 'sale' } },
  { word: LOT_WORDS['bonus'] ?? 'Bonus units', code: { table: 'lot', kind: 'bonus' } },
  { word: LOT_WORDS['split'] ?? 'Split', code: { table: 'lot', kind: 'split' } },
  { word: DISPOSAL_WORDS['redemption'] ?? 'Redeemed', code: { table: 'disposal', kind: 'redemption' } },
  { word: DISPOSAL_WORDS['maturity'] ?? 'Matured', code: { table: 'disposal', kind: 'maturity' } },
  { word: LOT_WORDS['gift'] ?? 'Gift received', code: { table: 'lot', kind: 'gift' } },
  { word: DISPOSAL_WORDS['gift'] ?? 'Gift given', code: { table: 'disposal', kind: 'gift' } },
  { word: LOT_WORDS['transfer'] ?? 'Transfer in', code: { table: 'lot', kind: 'transfer' } },
  { word: DISPOSAL_WORDS['transfer'] ?? 'Transfer out', code: { table: 'disposal', kind: 'transfer' } },
  { word: LOT_WORDS['esop'] ?? 'ESOP', code: { table: 'lot', kind: 'esop' } },
];

export const CURRENCIES: readonly string[] = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];
export const YES_NO: readonly string[] = ['Yes', 'No'];

/** The names of the lists on the Lists sheet, in the order of its columns, as the named ranges `L_<name>` point at them. */
export const LIST_NAMES = [
  'members',
  'categories',
  'accounts',
  'investments',
  'currency',
  'how',
  'yesno',
  'moneyin',
  'invtype',
  'keptfor',
  'interest',
  'often',
  'instype',
  'loantype',
  'proptype',
  'fy',
  'trade',
] as const;
export type ListName = (typeof LIST_NAMES)[number];

/** The header the Lists sheet gives each list: the household's four read as words, the fixed ones by their short name. */
export const LIST_HEADERS: Readonly<Record<ListName, string>> = {
  members: 'Members',
  categories: 'Categories',
  accounts: 'Accounts',
  investments: 'Investments',
  currency: 'currency',
  how: 'how',
  yesno: 'yesno',
  moneyin: 'moneyin',
  invtype: 'invtype',
  keptfor: 'keptfor',
  interest: 'interest',
  often: 'often',
  instype: 'instype',
  loantype: 'loantype',
  proptype: 'proptype',
  fy: 'fy',
  trade: 'trade',
};

/** The values of every list, from the household's lists and the fixed ones. */
export function listValues(lists: TemplateLists, meta: Pick<TemplateMeta, 'financialYears'>): Readonly<Record<ListName, readonly string[]>> {
  return {
    members: lists.members,
    categories: lists.categories,
    accounts: lists.accounts,
    investments: lists.investments,
    currency: CURRENCIES,
    how: METHOD_CHOICES.map((choice) => choice.word),
    yesno: YES_NO,
    moneyin: MONEY_IN_CHOICES.map((choice) => choice.word),
    invtype: INVESTMENT_TYPES.map((choice) => choice.word),
    keptfor: KEPT_FOR_CHOICES.map((choice) => choice.word),
    interest: INTEREST_CHOICES.map((choice) => choice.word),
    often: OFTEN_CHOICES.map((choice) => choice.word),
    instype: INSURANCE_CHOICES.map((choice) => choice.word),
    loantype: LOAN_CHOICES.map((choice) => choice.word),
    proptype: PROPERTY_CHOICES.map((choice) => choice.word),
    fy: meta.financialYears,
    trade: TRADE_CHOICES.map((choice) => choice.word),
  };
}

// ───────────────────────────────────────────────────────────── the sheets

export type CheckKind = 'date' | 'amount' | 'number' | 'percent' | 'last4';

export interface TemplateColumn {
  /** The header as a person reads it: `Date *` is needed, `Category ▾` takes a list. */
  readonly header: string;
  readonly needed: boolean;
  readonly list?: ListName;
  /** A list that warns and does not stop (an investment named on the Investments sheet of this file). */
  readonly warnOnly?: boolean;
  readonly check?: CheckKind;
  readonly comment: string;
  readonly width: number;
  /** The number format of an amount or a date in this column. */
  readonly format?: 'amount' | 'date';
}

export interface TemplateSheet {
  readonly name: string;
  /** Two letters before the number of a row key: SP-0001. */
  readonly prefix: string;
  readonly columns: readonly TemplateColumn[];
  /** The values of the example row, by header, as text or numbers; a date is `YYYY-MM-DD`. */
  readonly example: Readonly<Record<string, string | number>>;
}

const col = (header: string, comment: string, width: number, extra: Partial<TemplateColumn> = {}): TemplateColumn => ({
  header,
  needed: header.includes('*'),
  comment,
  width,
  ...extra,
});

const CURRENCY = col('Currency ▾', 'Leave empty for rupees (INR).', 10, { list: 'currency' });

export const TEMPLATE_SHEETS: readonly TemplateSheet[] = [
  {
    name: 'Spending',
    prefix: 'SP',
    example: { 'Date *': '2026-10-31', 'Amount *': 642.5, 'Currency ▾': 'INR', 'Category * ▾': '{category}', 'Who * ▾': '{member}', 'Paid to': 'Big Basket', 'How paid ▾': 'UPI', 'From account ▾': '{account}', Note: 'Weekly shop', 'Private ▾': 'No' },
    columns: [
      col('Date *', 'The day you paid.', 13, { check: 'date', format: 'date' }),
      col('Amount *', 'What you paid, in the currency beside it. 1,234.50 is fine.', 14, { check: 'amount', format: 'amount' }),
      CURRENCY,
      col('Category * ▾', 'One of your categories. Add new categories in the app first.', 24, { list: 'categories' }),
      col('Who * ▾', 'Who paid.', 16, { list: 'members' }),
      col('Paid to', 'The shop or person, as you like to see it.', 24),
      col('How paid ▾', 'Cash, card, UPI and so on.', 12, { list: 'how' }),
      col('From account ▾', 'Optional. Needed only to close months from balances.', 22, { list: 'accounts' }),
      col('Note', 'Anything you want to remember.', 26),
      col('Private ▾', 'Yes: only you see this entry. The household totals still count it.', 9, { list: 'yesno' }),
    ],
  },
  {
    name: 'Money in',
    prefix: 'MI',
    example: { 'Date *': '2026-11-01', 'Amount *': 142000, 'Currency ▾': 'INR', 'What it is * ▾': 'Salary', 'Whose * ▾': '{member}', 'Into account ▾': '{account}', From: 'Acme Technologies', 'Private ▾': 'Yes' },
    columns: [
      col('Date *', 'The day it was credited.', 13, { check: 'date', format: 'date' }),
      col('Amount *', 'What came in, as the bank shows it (take-home for a salary).', 14, { check: 'amount', format: 'amount' }),
      CURRENCY,
      col('What it is * ▾', 'Salary, business income, interest, rent, dividend, other income, or a refund or money back (which reduces spending and is not income).', 20, { list: 'moneyin' }),
      col('Whose * ▾', 'Whose income it is.', 16, { list: 'members' }),
      col('Into account ▾', 'Optional.', 22, { list: 'accounts' }),
      col('From', 'Who paid it, as the bank shows it.', 22),
      col('Private ▾', 'Income is private unless you write No.', 9, { list: 'yesno' }),
    ],
  },
  {
    name: 'Monthly plan',
    prefix: 'PL',
    example: { 'Category * ▾': '{category}', 'Per month': 18000, 'Financial year * ▾': '{fy}' },
    columns: [
      col('Category * ▾', 'One of your categories.', 26, { list: 'categories' }),
      col('Per month', 'What you plan to spend in a month. Fill this or Per year, or both.', 14, { check: 'amount', format: 'amount' }),
      col('Per year', 'For yearly costs such as school fees.', 14, { check: 'amount', format: 'amount' }),
      col('Financial year * ▾', 'April to March.', 14, { list: 'fy' }),
    ],
  },
  {
    name: 'Investments',
    prefix: 'IN',
    example: {
      'Name *': 'Demo Flexi Cap Fund',
      'Type * ▾': 'Mutual fund',
      'Whose * ▾': '{member}',
      Units: 1500.5,
      'Amount invested': 90000,
      'Bought on': '2025-09-27',
      'Latest value': 224000,
      'Value as on': '2026-08-31',
      'Kept for ▾': 'Nothing in particular',
      'Held outside India ▾': 'No',
      'Currency ▾': 'INR',
    },
    columns: [
      col('Name *', 'What you call it: the fund, share, deposit or scheme.', 30),
      col('Type * ▾', 'Pick the nearest. Deposits and schemes have their own entries.', 24, { list: 'invtype' }),
      col('Whose * ▾', 'Whose name it is in.', 16, { list: 'members' }),
      col('Units', 'Units, shares or grams. Leave empty for a deposit or EPF.', 10, { check: 'number' }),
      col('Amount invested', 'What you put in, in total.', 15, { check: 'amount', format: 'amount' }),
      col('Bought on', 'The first purchase or the date opened.', 13, { check: 'date', format: 'date' }),
      col('Latest value', 'Optional. What it is worth now, from a statement.', 14, { check: 'amount', format: 'amount' }),
      col('Value as on', 'The date of that value.', 13, { check: 'date', format: 'date' }),
      col('Kept for ▾', 'Optional: emergency, retirement, child or house.', 18, { list: 'keptfor' }),
      col('Held outside India ▾', 'Yes for a holding abroad.', 12, { list: 'yesno' }),
      CURRENCY,
    ],
  },
  {
    name: 'Purchases and sales',
    prefix: 'PS',
    example: { 'Date *': '2026-04-15', 'Investment * ▾': '{investment}', 'What happened * ▾': 'Bought', 'Units *': 600, Amount: 90000, 'Currency ▾': 'INR', Note: 'SIP top-up' },
    columns: [
      col('Date *', 'The day of the purchase or sale.', 13, { check: 'date', format: 'date' }),
      col('Investment * ▾', 'One of your investments, as Name (Whose). A new one from the Investments sheet of this file also works: write its name and whose the same way.', 34, { list: 'investments', warnOnly: true }),
      col('What happened * ▾', 'Bought, sold, bonus units, a split, a redemption, a maturity, a gift or a transfer.', 15, { list: 'trade' }),
      col('Units *', 'Units, shares or grams.', 10, { check: 'number' }),
      col('Amount', 'What you paid, charges and stamp duty included, or what you received. Leave empty for bonus units or a split.', 14, { check: 'amount', format: 'amount' }),
      col('Currency ▾', 'Leave empty for rupees (INR).', 10, { list: 'currency' }),
      col('Note', 'Anything you want to remember.', 30),
    ],
  },
  {
    name: 'Deposits',
    prefix: 'DP',
    example: { 'Deposit *': 'Term deposit (bank FD)', Bank: 'Demo Bank', 'Principal *': 200000, 'Interest rate % *': 7, 'Start date *': '2026-09-02', 'Maturity date *': '2027-09-02', 'Interest added ▾': 'Yearly', 'Account last 4': '8830' },
    columns: [
      col('Deposit *', 'The same name as on the Investments sheet.', 30),
      col('Bank', 'The bank or post office.', 18),
      col('Principal *', 'The amount deposited.', 14, { check: 'amount', format: 'amount' }),
      col('Interest rate % *', 'For example 7.1.', 12, { check: 'percent' }),
      col('Start date *', 'The day the deposit began.', 13, { check: 'date', format: 'date' }),
      col('Maturity date *', 'The day it matures.', 13, { check: 'date', format: 'date' }),
      col('Interest added ▾', 'How often interest is added.', 14, { list: 'interest' }),
      col('Account last 4', 'Only the last four digits.', 12, { check: 'last4' }),
    ],
  },
  {
    name: 'Insurance',
    prefix: 'IS',
    example: { 'Policy *': 'Family health floater', 'Type * ▾': 'Health', Insurer: 'Demo Health Insurance', 'Policy no. last 4': '7305', 'Cover amount': 1000000, 'Premium *': 32000, 'Paid * ▾': 'Yearly', 'Next renewal': '2027-05-20' },
    columns: [
      col('Policy *', 'What you call it.', 24),
      col('Type * ▾', 'The kind of policy.', 16, { list: 'instype' }),
      col('Insurer', 'The insurance company.', 22),
      col('Policy no. last 4', 'Only the last four characters.', 12, { check: 'last4' }),
      col('Covers ▾', 'Leave empty for the whole family.', 16, { list: 'members' }),
      col('Cover amount', 'The sum insured.', 14, { check: 'amount', format: 'amount' }),
      col('Premium *', 'What you pay each time.', 12, { check: 'amount', format: 'amount' }),
      col('Paid * ▾', 'How often the premium is paid.', 12, { list: 'often' }),
      col('Next renewal', 'The date the next premium or renewal falls due.', 13, { check: 'date', format: 'date' }),
    ],
  },
  {
    name: 'Loans',
    prefix: 'LN',
    example: { 'Loan *': 'Home loan, SBI', 'Type * ▾': 'Home loan', 'Whose ▾': '{member}', 'EMI *': 32000, 'Paid * ▾': 'Monthly', Outstanding: 2450000, 'Outstanding as on': '2026-10-31' },
    columns: [
      col('Loan *', 'What you call it.', 24),
      col('Type * ▾', 'The kind of loan.', 16, { list: 'loantype' }),
      col('Whose ▾', 'Whose loan it is. Leave empty for the household.', 16, { list: 'members' }),
      col('EMI *', 'The instalment.', 12, { check: 'amount', format: 'amount' }),
      col('Paid * ▾', 'How often the instalment is paid.', 12, { list: 'often' }),
      col('Outstanding', 'What is still owed.', 14, { check: 'amount', format: 'amount' }),
      col('Outstanding as on', 'The date of that figure.', 14, { check: 'date', format: 'date' }),
    ],
  },
  {
    name: 'Property',
    prefix: 'PR',
    example: { 'Property *': 'House1', 'Type * ▾': 'Apartment', 'Whose * ▾': '{member}', 'Bought on': '2026-11-09', 'Price paid': 1200000, 'Stamp duty': 100000, Registration: 50000, 'Your share %': 100, 'You live in it ▾': 'No' },
    columns: [
      col('Property *', 'What you call it.', 20),
      col('Type * ▾', 'The kind of property.', 14, { list: 'proptype' }),
      col('Whose * ▾', 'Whose name it is in.', 16, { list: 'members' }),
      col('Bought on', 'The day you bought it.', 13, { check: 'date', format: 'date' }),
      col('Price paid', 'What you paid for it, before stamp duty and registration.', 14, { check: 'amount', format: 'amount' }),
      col('Stamp duty', 'Stamp duty paid.', 12, { check: 'amount', format: 'amount' }),
      col('Registration', 'Registration charges paid.', 13, { check: 'amount', format: 'amount' }),
      col('Your share %', '100 if it is all yours.', 11, { check: 'percent' }),
      col('You live in it ▾', 'Yes if you live there yourself.', 12, { list: 'yesno' }),
    ],
  },
];

/** The header a person sees without the marks: `Category * ▾` is `Category`. */
export function plainHeader(header: string): string {
  return header.replace(/[*▾]/g, '').replace(/\s+/g, ' ').trim();
}

/** The key of a row: `SP-0001`. */
export function rowKey(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** How to fill, as lines of the sheet, from the sample's own words. */
export function howToFill(meta: TemplateMeta): readonly { readonly text: string; readonly style: 'title' | 'sub' | 'plain' | 'head' | 'muted' }[] {
  return [
    { text: 'Family Finance Buddy · add your data', style: 'title' },
    { text: `${meta.householdName} · template made on ${meta.madeOn}`, style: 'sub' },
    { text: '', style: 'plain' },
    { text: '1. Fill the sheets you need and leave the rest empty. Every sheet is optional.', style: 'plain' },
    { text: '2. Columns marked * are needed. Columns marked ▾ have a list: pick from it.', style: 'plain' },
    { text: '3. The grey row in each sheet is an example. Leave it or delete it: it is never uploaded.', style: 'plain' },
    { text: '4. Dates like 31-10-2026 and amounts like 1,42,000 are both fine.', style: 'plain' },
    { text: '5. Upload it on the Reports screen. You see everything it would add before anything is saved, and you can undo the whole upload afterwards.', style: 'plain' },
    { text: '', style: 'plain' },
    { text: 'What each sheet is for', style: 'head' },
    { text: 'Spending: what you paid for.   Money in: salary, business income, interest, rent, refunds.', style: 'plain' },
    { text: 'Monthly plan: what you plan to spend per category.   Investments: funds, shares, gold, deposits, EPF, NPS, PPF.', style: 'plain' },
    { text: 'Purchases and sales: each buy, sell, bonus or redemption.', style: 'plain' },
    { text: 'Deposits: the terms of an FD or RD you listed under Investments.   Insurance, Loans, Property: one row each.', style: 'plain' },
    { text: '', style: 'plain' },
    { text: 'Good to know', style: 'head' },
    { text: '• Uploading the same file again, corrected, updates the rows it added. It never adds them twice.', style: 'plain' },
    { text: '• An upload never deletes anything. To remove or close a record, do it in the app.', style: 'plain' },
    { text: '• Members, categories and accounts come from your household (see Lists). Add new ones in the app before you upload.', style: 'plain' },
    { text: '• Never type a full account, card or policy number: last four only. Never type a password.', style: 'plain' },
    { text: '• Purchases and sales are what make capital gains exact. A statement (eCAS) upload in the app adds them for you; use this sheet for what a statement does not cover.', style: 'plain' },
    { text: '• Past values, PPF payments, deposit renewals and property work are added in the app.', style: 'plain' },
    { text: '', style: 'plain' },
    { text: `Template version ${String(TEMPLATE_V3_VERSION)} · id ${meta.templateId}`, style: 'muted' },
  ];
}

/** The line a reader finds to tell version 3 from version 2 and to learn this download's id: `Template version 3 · id TPL-…`. */
export const TEMPLATE_V3_MARKER = /^Template version (\d+) · id (\S+)$/;
