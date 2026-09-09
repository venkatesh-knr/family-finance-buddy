/**
 * Domain types — what the rest of the app is allowed to see.
 *
 * Nothing in this file mentions Supabase, PostgREST or a row shape. These are
 * our objects; the repository maps into them and no provider type crosses the
 * boundary. That is what makes adding a server later a weekend of additive
 * work: a component that never knew where its data came from does not change
 * when the answer does.
 */

import type { IsoDate } from '../lib/dates.ts';
import type { Money } from '../lib/money.ts';

export type Uuid = string;

export type HouseholdRole = 'owner' | 'partner' | 'contributor' | 'viewer';

export type MemberColour = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7';

export type PaymentMethod = 'cash' | 'card' | 'upi' | 'netbanking' | 'auto_debit' | 'other';

/**
 * Who may see one entry (§20).
 *
 * `household` is the default and the premise of the app; `personal` means the
 * member who owns it sees the row and everyone else sees only its contribution
 * to a total. Two values, not a scale: anything finer would be a promise the
 * policies cannot keep.
 */
export type Visibility = 'household' | 'personal';

export const VISIBILITIES: readonly Visibility[] = ['household', 'personal'];

export const HOUSEHOLD_ROLES: readonly HouseholdRole[] = [
  'owner',
  'partner',
  'contributor',
  'viewer',
];

export const MEMBER_COLOURS: readonly MemberColour[] = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash',
  'card',
  'upi',
  'netbanking',
  'auto_debit',
  'other',
];

export type HouseholdKind = 'real' | 'demo';

export const HOUSEHOLD_KINDS: readonly HouseholdKind[] = ['real', 'demo'];

export interface Household {
  readonly id: Uuid;
  readonly name: string;
  /**
   * Whether this household is play money.
   *
   * Carried into the domain because it drives a permanent badge, not a
   * first-run notice: "Demo households are marked kind = demo and carry a
   * persistent badge, so there is never a moment of wondering which numbers
   * you are looking at" (§423).
   */
  readonly kind: HouseholdKind;
  /** The currency every figure is normalised to on read. */
  readonly baseCurrency: string;
  readonly displayCurrency: string;
  /** 4 for the Indian tax year. */
  readonly fyStartMonth: number;
  /**
   * The FIRE assumptions, which belong to the household and not to a phone.
   *
   * They were React state until now, so two members of one household saw two
   * different targets and neither survived a refresh. A couple planning to
   * retire together need one number.
   */
  readonly fire: {
    /** How many years of spending the target is. A decimal string: it is a ratio. */
    readonly multiplier: string;
    readonly inflationPct: string;
    readonly yearsAhead: number;
  };
}

export interface Member {
  readonly id: Uuid;
  readonly displayName: string;
  /**
   * What this member may do, when it is known.
   *
   * Null for a member with no login attached — the design allows one ("a
   * member with no login" appears in §425's demo fixture), and a household can
   * track spending for a child who will never sign in.
   */
  readonly role?: HouseholdRole | null;
  /** A categorical token name from docs/tokens.md, resolved per theme at render. */
  readonly colour: MemberColour;
  readonly isArchived: boolean;
}

/** Who is looking, and what they may do in this household. */
export interface Viewer {
  readonly accountId: Uuid;
  readonly memberId: Uuid;
  readonly role: HouseholdRole;
  /** May record anything at all. A viewer may not. */
  readonly canRecord: boolean;
  /**
   * May record under another member's name.
   *
   * A contributor may not: "A contributor writes only under their own name.
   * Attribution cannot be forged." The insert policies enforce it, and the
   * forms have to agree — offering a choice the database will refuse is a
   * worse experience than not offering it, and teaches people the app is
   * unreliable rather than that they lack the permission.
   */
  readonly canFileForOthers: boolean;
}

export interface Expense {
  readonly id: Uuid;
  readonly householdId: Uuid;
  readonly member: Member;
  /** Null means uncategorised — a state to show, not a gap to fill in. */
  readonly categoryId: Uuid | null;
  /** A calendar date in IST. Not an instant. */
  readonly date: IsoDate;
  /** Stored native. Never overwritten with a converted figure. */
  readonly amount: Money;
  readonly payee: string | null;
  readonly method: PaymentMethod | null;
  readonly note: string | null;
  readonly isVoided: boolean;
  /**
   * Always `household` on a row that came from somebody else — a personal one
   * of theirs never arrives here at all. On your own rows it is what you set.
   */
  readonly visibility: Visibility;
}

/**
 * Everything one screen load needs: the household, who is looking, the members
 * they can file a spend against, and the spends themselves.
 */
export interface ExpenseListing {
  readonly household: Household;
  readonly viewer: Viewer;
  readonly members: readonly Member[];
  readonly expenses: readonly Expense[];
  /** Active categories, for filing a spend and for comparing against a plan. */
  readonly categories: readonly ExpenseCategory[];
}

/**
 * What another member spent privately in a period — the sum, and nothing else.
 *
 * There is no category, no date and no payee on this, and none can be asked
 * for: the database function that produces it takes no argument that would
 * return a breakdown. "If a total is visible and only one entry is private,
 * the private amount can be recovered by subtraction. So private amounts roll
 * into a single Personal line per member." (§20)
 *
 * One entry per member per currency, because a sum of two currencies is not a
 * number. Collapsing them here would invent an exchange rate at the seam,
 * which is the one place this app never does arithmetic.
 */
export interface PersonalSpend {
  readonly memberId: Uuid;
  readonly total: Money;
}

/**
 * The private sums for both periods the comparison offers.
 *
 * Fetched as a pair rather than derived from one another, because they cannot
 * be: a month is not a twelfth of a year, and narrowing a year's total to a
 * month would need the dates the function deliberately does not return.
 */
export interface PersonalSpendPeriods {
  readonly month: readonly PersonalSpend[];
  readonly year: readonly PersonalSpend[];
}

export interface NewExpense {
  readonly householdId: Uuid;
  readonly memberId: Uuid;
  readonly categoryId?: Uuid | null;
  readonly date: IsoDate;
  readonly amount: Money;
  readonly payee?: string | null;
  readonly method?: PaymentMethod | null;
  readonly note?: string | null;
  /** Omitted means `household`, matching the column default rather than guessing. */
  readonly visibility?: Visibility;
}

export type InstrumentKind = 'equity' | 'etf' | 'mutual_fund' | 'bond' | 'deposit' | 'other';

export const INSTRUMENT_KINDS: readonly InstrumentKind[] = [
  'equity',
  'etf',
  'mutual_fund',
  'bond',
  'deposit',
  'other',
];

export type ValuationSource = 'manual' | 'backfill' | 'driver';

export const VALUATION_SOURCES: readonly ValuationSource[] = ['manual', 'backfill', 'driver'];

export interface Instrument {
  readonly id: Uuid;
  readonly name: string;
  readonly kind: InstrumentKind;
  readonly symbol: string | null;
  /** What it is priced in. */
  readonly currency: string;
  /** What its value tracks, which is not always the same thing. See §293. */
  readonly exposureCurrency: string;
  /** Schedule FA classification. A recorded decision, never inferred. */
  readonly isForeignAsset: boolean;
  readonly isArchived: boolean;
}

/**
 * Quantity is a decimal string, not a number.
 *
 * Fractional shares are ordinary on US brokers, and a double cannot hold
 * 12.3456789 exactly. It stays a string through the whole layer and is parsed
 * only where arithmetic actually happens.
 */
export type Quantity = string;

export interface Holding {
  readonly id: Uuid;
  readonly householdId: Uuid;
  readonly member: Member;
  readonly instrument: Instrument;
  readonly quantity: Quantity;
  readonly cost: Money | null;
  readonly openedOn: IsoDate | null;
  readonly isArchived: boolean;
  /**
   * §20, on a position rather than a transaction.
   *
   * The column has existed since the table was created and the mapper never
   * read it, so no holding could be private in practice however the policies
   * were written. Always `household` on a row that came from somebody else —
   * a personal one of theirs never arrives here at all.
   */
  readonly visibility: Visibility;
}

export interface Valuation {
  readonly id: Uuid;
  readonly holdingId: Uuid;
  readonly date: IsoDate;
  readonly quantity: Quantity;
  readonly amount: Money;
  readonly source: ValuationSource;
  readonly note: string | null;
}

/** Everything the holdings screen needs in one load. */
export interface HoldingListing {
  readonly household: Household;
  readonly viewer: Viewer;
  readonly members: readonly Member[];
  readonly holdings: readonly Holding[];
  /** Every valuation for the household, newest first. */
  readonly valuations: readonly Valuation[];
  /** Every acquisition, oldest first — the order the FIFO matcher wants. */
  readonly lots: readonly Lot[];
  /** Every sale, oldest first. */
  readonly disposals: readonly Disposal[];
}

export interface NewHolding {
  readonly householdId: Uuid;
  readonly memberId: Uuid;
  readonly instrument: {
    readonly name: string;
    readonly kind: InstrumentKind;
    readonly symbol?: string | null;
    readonly currency: string;
    readonly exposureCurrency: string;
    readonly isForeignAsset: boolean;
  };
  readonly quantity: Quantity;
  readonly cost?: Money | null;
  readonly openedOn?: IsoDate | null;
}

/**
 * One acquisition, as the repository hands it out.
 *
 * `quantity` is a decimal string for the same reason `Holding.quantity` is:
 * a double cannot hold 12.3456789 exactly, and it stays a string until
 * something actually does arithmetic on it.
 */
export interface Lot {
  readonly id: Uuid;
  readonly holdingId: Uuid;
  readonly acquiredOn: IsoDate;
  readonly quantity: Quantity;
  readonly cost: Money;
  readonly kind: LotKind;
  readonly note: string | null;
}

export const LOT_KINDS = ['purchase', 'bonus', 'split', 'transfer', 'gift', 'esop'] as const;
export type LotKind = (typeof LOT_KINDS)[number];

/** One sale. */
export interface Disposal {
  readonly id: Uuid;
  readonly holdingId: Uuid;
  readonly disposedOn: IsoDate;
  readonly quantity: Quantity;
  readonly proceeds: Money;
  readonly kind: DisposalKind;
  readonly note: string | null;
}

export const DISPOSAL_KINDS = ['sale', 'redemption', 'maturity', 'transfer', 'gift'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

/**
 * One member's personal holdings, as a single figure.
 *
 * Never a breakdown, and the shape is the guarantee: there is nowhere to put
 * a holding or an asset class. "If a total is visible and only one entry is
 * private, the private amount can be recovered by subtraction" — a per-class
 * version of this would hand the subtraction back.
 */
export interface PersonalHoldingTotal {
  readonly memberId: Uuid;
  readonly total: Money;
  /** How many of them have never been valued, so a screen can say the sum is short. */
  readonly unvalued: number;
}

export interface NewLot {
  readonly householdId: Uuid;
  readonly holdingId: Uuid;
  readonly acquiredOn: IsoDate;
  readonly quantity: Quantity;
  readonly cost: Money;
  readonly kind?: LotKind;
  readonly note?: string | null;
}

export interface NewDisposal {
  readonly householdId: Uuid;
  readonly holdingId: Uuid;
  readonly disposedOn: IsoDate;
  readonly quantity: Quantity;
  readonly proceeds: Money;
  readonly kind?: DisposalKind;
  readonly note?: string | null;
}

export interface NewValuation {
  readonly householdId: Uuid;
  readonly holdingId: Uuid;
  readonly date: IsoDate;
  readonly quantity: Quantity;
  readonly amount: Money;
  readonly source?: ValuationSource;
  readonly note?: string | null;
}

// ─── planning: categories, budgets, and the commitments beside them ───────

export type CategoryNature = 'fixed' | 'variable';
export const CATEGORY_NATURES: readonly CategoryNature[] = ['fixed', 'variable'];

/** How often a planned figure recurs. On the plan, not on the thing planned. */
export type BudgetCadence = 'monthly' | 'yearly';
export const BUDGET_CADENCES: readonly BudgetCadence[] = ['monthly', 'yearly'];

/** What a loan or a premium is paid at. Wider than a budget's, as they are. */
export type CommitmentCadence = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
export const COMMITMENT_CADENCES: readonly CommitmentCadence[] = [
  'monthly',
  'quarterly',
  'half_yearly',
  'yearly',
];

export interface ExpenseCategory {
  readonly id: Uuid;
  readonly name: string;
  /** Fixed means compulsory; variable means it depends on need. */
  readonly nature: CategoryNature;
  readonly parentId: Uuid | null;
  readonly isEssential: boolean;
  readonly sortOrder: number;
  readonly isArchived: boolean;
}

export interface Budget {
  readonly id: Uuid;
  readonly categoryId: Uuid;
  readonly fy: number;
  readonly cadence: BudgetCadence;
  /** Null is the ordinary case: one occurrence of the cadence. */
  readonly period: number | null;
  readonly planned: Money;
  readonly memberId: Uuid | null;
}

export type LiabilityKind =
  | 'home_loan'
  | 'vehicle_loan'
  | 'personal_loan'
  | 'education_loan'
  | 'credit_card'
  | 'loan'
  | 'other';

export const LIABILITY_KINDS: readonly LiabilityKind[] = [
  'home_loan',
  'vehicle_loan',
  'personal_loan',
  'education_loan',
  'credit_card',
  'loan',
  'other',
];

export interface Liability {
  readonly id: Uuid;
  readonly name: string;
  readonly kind: LiabilityKind;
  readonly instalment: Money | null;
  readonly cadence: CommitmentCadence;
  readonly memberId: Uuid | null;
  readonly isClosed: boolean;
  /**
   * What is still owed. Null means nobody has said — which is not nothing
   * owed, and net worth has to tell those two apart.
   */
  readonly outstanding: Money | null;
  /** The date that balance was true. A balance without one ages into a wrong figure. */
  readonly outstandingAsOf: IsoDate | null;
}

export type PolicyKind =
  | 'health'
  | 'term_life'
  | 'endowment'
  | 'vehicle'
  | 'home'
  | 'personal_accident'
  | 'other';

export const POLICY_KINDS: readonly PolicyKind[] = [
  'health',
  'term_life',
  'endowment',
  'vehicle',
  'home',
  'personal_accident',
  'other',
];

export interface InsurancePolicy {
  readonly id: Uuid;
  readonly name: string;
  readonly kind: PolicyKind;
  readonly premium: Money | null;
  readonly cadence: CommitmentCadence;
  readonly memberId: Uuid | null;
  readonly isLapsed: boolean;
}

/** Everything the planning screen needs in one load. */
export interface PlanListing {
  readonly household: Household;
  readonly viewer: Viewer;
  readonly members: readonly Member[];
  readonly categories: readonly ExpenseCategory[];
  readonly budgets: readonly Budget[];
  readonly liabilities: readonly Liability[];
  readonly policies: readonly InsurancePolicy[];
  /** The tax year these budgets belong to. */
  readonly fy: number;
}

/** Raised when the caller is a member of no household at all. */
export class NoHouseholdError extends Error {
  constructor() {
    super(
      'This account is not a member of any household yet. An owner has to add you to one before there is anything to show.',
    );
    this.name = 'NoHouseholdError';
  }
}
