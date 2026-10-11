/**
 * What a holding's money is for, what a deposit is, and what each does to the FIRE corpus
 * (docs/design/protection-and-flow.md §2, §3).
 *
 * The FIRE corpus is not the net worth. The emergency fund is for spending, the child's savings are
 * locked and hers, and a house deposit is already committed: counting them toward financial
 * independence overstates the number, and an overstated FIRE figure is the one wrong number somebody
 * might act on. So the corpus is worked out here, once, and the screens that need it ask.
 *
 * Per currency and never across, like `assetTotals`: converting is the screen's job, with dated rates
 * and a refusal where there are none. Pure, with no clock.
 */

import { money, type Money } from '../lib/money.ts';
import { latestValuationPerHolding, type ValuationInput } from './networth.ts';

export const EARMARKS = ['emergency', 'retirement', 'child', 'house', 'none'] as const;
export type Earmark = (typeof EARMARKS)[number];

/** PF-C7: the three the corpus leaves out. `retirement` and `none` are in it. */
export const EXCLUDED_FROM_FIRE = ['emergency', 'child', 'house'] as const;
export type ExcludedEarmark = (typeof EXCLUDED_FROM_FIRE)[number];

export const EARMARK_LABELS: Record<Earmark, string> = {
  emergency: 'Emergency fund',
  retirement: 'Retirement',
  child: "Child's savings",
  house: 'House deposit',
  none: 'No earmark',
};

export function isEarmark(value: string): value is Earmark {
  return (EARMARKS as readonly string[]).includes(value);
}

export const SCHEMES = ['fd', 'rd', 'ppf', 'ssy', 'nsc', 'kvp', 'scss', 'pomis', 'po_td', 'other'] as const;
export type Scheme = (typeof SCHEMES)[number];

export const SCHEME_LABELS: Record<Scheme, string> = {
  fd: 'Fixed deposit',
  rd: 'Recurring deposit',
  ppf: 'PPF',
  ssy: 'Sukanya Samriddhi',
  nsc: 'NSC',
  kvp: 'Kisan Vikas Patra',
  scss: 'Senior Citizens Savings Scheme',
  pomis: 'Post Office Monthly Income Scheme',
  po_td: 'Post Office time deposit',
  other: 'Other scheme',
};

export function isScheme(value: string): value is Scheme {
  return (SCHEMES as readonly string[]).includes(value);
}

/** PF-C5: a scheme says what a deposit is, so only a deposit has one. */
export function schemeAllowedFor(kind: string): boolean {
  return kind === 'deposit';
}

export interface CorpusHolding {
  readonly id: string;
  /** The instrument's own currency. Totals are grouped by it. */
  readonly currency: string;
  readonly earmark: Earmark;
  readonly isArchived: boolean;
}

export interface CorpusTotal {
  readonly currency: string;
  /** What counts toward the FIRE corpus: everything valued, less what is left out. */
  readonly included: Money;
  /** What is left out, by earmark, so the screen can say what and how much. */
  readonly excluded: Record<ExcludedEarmark, Money>;
  readonly excludedTotal: Money;
  /** Holdings never read: in neither side, and the screen already says the total is short by them. */
  readonly unvalued: number;
}

export function fireCorpus(options: {
  readonly holdings: readonly CorpusHolding[];
  readonly valuations: readonly ValuationInput[];
}): readonly CorpusTotal[] {
  const latest = latestValuationPerHolding(options.valuations);
  const buckets = new Map<
    string,
    { included: bigint; excluded: Record<ExcludedEarmark, bigint>; unvalued: number }
  >();

  for (const holding of options.holdings) {
    if (holding.isArchived) continue;

    const bucket = buckets.get(holding.currency) ?? {
      included: 0n,
      excluded: { emergency: 0n, child: 0n, house: 0n },
      unvalued: 0,
    };
    buckets.set(holding.currency, bucket);

    const reading = latest.get(holding.id);
    if (reading === undefined) {
      bucket.unvalued += 1;
      continue;
    }

    if ((EXCLUDED_FROM_FIRE as readonly string[]).includes(holding.earmark)) {
      bucket.excluded[holding.earmark as ExcludedEarmark] += reading.amount.minor;
    } else {
      bucket.included += reading.amount.minor;
    }
  }

  return [...buckets.entries()].map(([currency, bucket]) => ({
    currency,
    included: money(bucket.included, currency),
    excluded: {
      emergency: money(bucket.excluded.emergency, currency),
      child: money(bucket.excluded.child, currency),
      house: money(bucket.excluded.house, currency),
    },
    excludedTotal: money(
      bucket.excluded.emergency + bucket.excluded.child + bucket.excluded.house,
      currency,
    ),
    unvalued: bucket.unvalued,
  }));
}

export interface MonthOfExpense {
  /** `YYYY-MM`, an IST calendar month the caller has already checked is complete. */
  readonly month: string;
  readonly spent: Money;
}

/** Fewer complete months than this and the average is one unusual month, not a habit. */
export const MIN_MONTHS_FOR_COVER = 3;
export const COVER_WINDOW_MONTHS = 12;

/**
 * How many months the emergency fund would last at the household's usual spending (PF-C9), or null
 * where that cannot be said honestly: under three complete months of history, a zero average, or an
 * emergency fund and an expense history in different currencies. Never 0 for "unknown" and never
 * infinite. The window is the trailing twelve months, or all there is.
 */
export function monthsOfCover(options: {
  readonly emergency: Money;
  readonly monthlyExpenses: readonly MonthOfExpense[];
}): number | null {
  const window = [...options.monthlyExpenses]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .slice(-COVER_WINDOW_MONTHS);

  if (window.length < MIN_MONTHS_FOR_COVER) return null;
  if (window.some((m) => m.spent.currency !== options.emergency.currency)) return null;

  const total = window.reduce((sum, m) => sum + m.spent.minor, 0n);
  if (total <= 0n) return null;

  // months = emergency / (total / n) = emergency * n / total. A ratio of two minor-unit quantities,
  // not money, so it is formed at the end from the exact integers rather than from a rounded average.
  return Number((options.emergency.minor * BigInt(window.length) * 100n) / total) / 100;
}

/** The `count` complete calendar months before the one `today` is in, oldest first, as `YYYY-MM`. */
export function priorMonths(today: string, count: number): readonly string[] {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    out.push(`${String(year)}-${String(month).padStart(2, '0')}`);
  }
  return out.reverse();
}

/**
 * The months the average is taken over, oldest first, as `YYYY-MM`.
 *
 * Three rules, each there so the figure is never stated on thinner ground than it looks:
 * - the month in progress is never in it, because half a month's spending is not a month's;
 * - the month spending *began* in is not in it, because the first entry may be dated the 31st and a
 *   month that is one day of data is not a month of data;
 * - a month with nothing recorded in it is not in it, because it is a gap in the record more often than
 *   a month of spending nothing, and averaged in as zero it would make the cover look longer.
 *   Leaving it out can only make the average higher and the cover shorter.
 *
 * `spendMonths` is every month among the thirteen before `today` that has any spending in it. The
 * thirteenth, oldest, month is a probe and not part of the window: spending in it means recording began
 * before the window opens, so the window's oldest month is a whole month and stays. Without spending in
 * it, the earliest month with any is where recording began, and it is dropped.
 */
export function coverMonths(options: {
  /** An IST calendar date, passed in. */
  readonly today: string;
  readonly spendMonths: readonly string[];
}): readonly string[] {
  const prior = priorMonths(options.today, COVER_WINDOW_MONTHS + 1);
  const has = new Set(options.spendMonths);
  const [probe, ...window] = prior;
  const earliest = prior.find((month) => has.has(month));
  const beganInside = earliest !== undefined && earliest !== probe;
  return window.filter((month) => has.has(month) && !(beganInside && month === earliest));
}

export interface EarmarkedHoldings {
  /** How many live holdings carry each excluded earmark, valued or not. */
  readonly count: Record<ExcludedEarmark, number>;
  /** Of those, how many have never been read, so the amounts left out are short by them. */
  readonly unvalued: number;
  /** The same, by earmark: the emergency fund's own line must not read a zero from one nobody has valued. */
  readonly unvaluedBy: Record<ExcludedEarmark, number>;
}

/**
 * Which holdings are earmarked at all, separately from how much.
 *
 * An earmarked holding nobody has valued contributes nothing to what is left out, and a screen that
 * read "nothing left out" from a total of zero would be saying nothing is earmarked when something is.
 */
export function earmarkedHoldings(options: {
  readonly holdings: readonly CorpusHolding[];
  readonly valuations: readonly ValuationInput[];
}): EarmarkedHoldings {
  const valued = new Set(options.valuations.map((v) => v.holdingId));
  const count: Record<ExcludedEarmark, number> = { emergency: 0, child: 0, house: 0 };
  const unvaluedBy: Record<ExcludedEarmark, number> = { emergency: 0, child: 0, house: 0 };
  let unvalued = 0;
  for (const holding of options.holdings) {
    if (holding.isArchived) continue;
    if (!(EXCLUDED_FROM_FIRE as readonly string[]).includes(holding.earmark)) continue;
    count[holding.earmark as ExcludedEarmark] += 1;
    if (!valued.has(holding.id)) {
      unvalued += 1;
      unvaluedBy[holding.earmark as ExcludedEarmark] += 1;
    }
  }
  return { count, unvalued, unvaluedBy };
}
