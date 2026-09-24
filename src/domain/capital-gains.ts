/**
 * Netting capital gains across asset classes, for one person and one tax year.
 *
 * `docs/blueprint.md`'s pipeline, steps 3 and 4:
 *
 *   Net      short-term losses against any gains; long-term losses against
 *            long-term gains only.
 *   Exempt   apply the ₹1.25 lakh equity allowance to what is left of the
 *            long-term equity gain.
 *
 * ── four buckets, because there are four ways to be taxed ────────────────
 *
 *   equity short   listed shares and equity funds held a year or less — 20%
 *   equity long    the same held longer — 12.5% after the allowance, and this is
 *                  the only bucket that has one
 *   other long     gold and unlisted shares held two years or more — 12.5%, no
 *                  allowance
 *   other short    the same held less — taxed at the taxpayer's SLAB, which needs
 *                  the rest of their income and is not built. So it is an amount
 *                  to add to income here, and never a tax
 *
 * ── what it will not net, and says so by name ────────────────────────────
 *
 *   foreign equity   needs the prescribed exchange rate (the SBI rate on the last
 *                    day of the month before the sale), which is not stored
 *   debt funds       treatment turns on the ACQUISITION date, and `tax_rule` is
 *                    dated by the date of sale
 *   property         carries an election between 12.5% and 20% with indexation,
 *                    and there is no index to apply
 *   gold at maturity a Sovereign Gold Bond redeemed with the RBI is exempt, and
 *                    a matured gold instrument is almost always one
 *   gifts, transfers not sales; a gift recorded with no proceeds would book its
 *                    whole cost as a capital loss and offset a real gain
 *
 * Each is listed with its reason and left out of every bucket. A sale that
 * quietly vanishes from a tax page because the arithmetic cannot handle it yet is
 * the failure this exists to avoid.
 *
 * ── the order losses are used in ─────────────────────────────────────────
 *
 * The Act says which losses may offset which gains, and leaves the choice of
 * order to the taxpayer. The order here is a stated policy, not a law:
 *
 *   1. A long-term loss first. It can only ever go against long-term gains, so
 *      it is used before the loss that can go anywhere — which leaves the
 *      flexible short-term loss as the one that is carried forward.
 *   2. Then a short-term loss, against the gain whose rate is known first:
 *      equity short, then other short, then other long, then equity long. The
 *      slab rate is not known until the slab step; other long comes before equity
 *      long because the allowance may already cover that one.
 *
 * `loss_carry_forward` does not exist, so what is left is reported and not
 * carried anywhere.
 *
 * Pure. No I/O, no `Date.now()` — the tax year is a plain number.
 */

import { taxYearBounds } from './budget.ts';
import type { Parcel } from './lots.ts';
import { classify, longTermRate, type AssetClass, type Term, type TaxRule } from './tax-rules.ts';
import type { IsoDate } from '../lib/dates.ts';
import { money, type Money } from '../lib/money.ts';
import { percentOf, thousandths } from './rate.ts';

/**
 * Everything here is minor units of INR — "the jurisdiction's currency" the
 * `tax_rule` migration's own comment names. A parcel in any other currency is
 * either foreign equity, which is refused by name, or a data problem this
 * refuses rather than guesses past.
 */
const CURRENCY = 'INR';

export type Bucket = 'equity-short' | 'equity-long' | 'other-short' | 'other-long';

/** Why a sale is not in any bucket. Each names something specific, never "unsupported". */
export type ExclusionReason =
  | 'unclassified-asset'
  | 'no-rule-for-date'
  | 'currency-mismatch'
  | 'needs-prescribed-rate'
  | 'debt-fund-not-modelled'
  | 'property-election'
  | 'possibly-exempt'
  | 'not-a-sale';

export type Placement =
  | { readonly placed: true; readonly bucket: Bucket; readonly term: Term }
  | {
      readonly placed: false;
      readonly reason: ExclusionReason;
      /** Still given where the holding period is known, so a listing can say it. */
      readonly term: Term | null;
    };

/**
 * Where one sale goes, or why it goes nowhere.
 *
 * The single place that decides, asked by the netter and by the screen that
 * lists sales — so "netted" on the page means exactly what it means in the
 * arithmetic, and there is no second list of classes to drift from the first.
 */
export function placeParcel(options: {
  readonly parcel: Parcel;
  readonly assetClass: AssetClass | null;
  /** The kind of the disposal the parcel came from. Null is treated as an ordinary sale. */
  readonly disposalKind: string | null;
  readonly rules: readonly TaxRule[];
}): Placement {
  const { parcel, assetClass, disposalKind, rules } = options;

  const classification =
    assetClass === null
      ? null
      : classify(rules, {
          assetClass,
          acquiredOn: parcel.acquiredOn,
          disposedOn: parcel.disposedOn,
        });
  const term: Term | null = classification !== null && classification.known ? classification.term : null;
  const refuse = (reason: ExclusionReason): Placement => ({ placed: false, reason, term });

  // First, because it is about what happened rather than what was held.
  if (disposalKind === 'gift' || disposalKind === 'transfer') return refuse('not-a-sale');

  if (assetClass === null) return refuse('unclassified-asset');

  switch (assetClass) {
    case 'foreign_equity':
      return refuse('needs-prescribed-rate');
    case 'debt_fund':
      return refuse('debt-fund-not-modelled');
    case 'property':
      return refuse('property-election');
    case 'gold':
      // A bond redeemed with the RBI at maturity is exempt. Matured gold is
      // nearly always that, and being wrong would tax something the law does not.
      if (disposalKind === 'maturity') return refuse('possibly-exempt');
      break;
    case 'listed_equity':
    case 'equity_fund':
    case 'unlisted_equity':
      break;
  }

  if (parcel.gain.currency !== CURRENCY) return refuse('currency-mismatch');
  if (classification === null || !classification.known) return refuse('no-rule-for-date');

  const equity = assetClass === 'listed_equity' || assetClass === 'equity_fund';
  const bucket: Bucket = equity
    ? classification.term === 'long'
      ? 'equity-long'
      : 'equity-short'
    : classification.term === 'long'
      ? 'other-long'
      : 'other-short';

  return { placed: true, bucket, term: classification.term };
}

export interface ExcludedParcel {
  readonly lotId: string;
  readonly disposalId: string;
  readonly instrumentId: string;
  readonly reason: ExclusionReason;
}

export interface GainBucket {
  /** Every sale in this bucket, summed. Negative is a loss. */
  readonly net: Money;
  /** How much loss from another bucket was set against it. Never negative. */
  readonly setOff: Money;
  /** What is left after set-off. Never negative — a loss shows in `losses`. */
  readonly taxable: Money;
}

export interface EquityLongBucket {
  readonly net: Money;
  readonly setOff: Money;
  readonly exemption: {
    readonly available: Money;
    /** Never more than `available`, and never more than there was gain left to use it on. */
    readonly used: Money;
    readonly authority: string;
  } | null;
  /**
   * After set-off and the allowance. Null only when `exemption` is null — no
   * rule covers this year, and a taxable figure computed without one would be a
   * number this app is not willing to make up.
   */
  readonly taxable: Money | null;
}

export interface LossSummary {
  /** Every loss of this term, summed, as a positive amount. */
  readonly total: Money;
  /** How much of it was set against gains. */
  readonly setOff: Money;
  /** What is left, or null. Not carried anywhere: there is nowhere yet to remember it. */
  readonly unrelieved: Money | null;
}

export interface CapitalGains {
  readonly fy: number;
  readonly window: { readonly start: IsoDate; readonly end: IsoDate };
  readonly equityShort: GainBucket;
  readonly equityLong: EquityLongBucket;
  readonly otherLong: GainBucket;
  /** Taxed at the slab. `taxable` is an amount to add to income, never a tax. */
  readonly otherShort: GainBucket;
  readonly losses: { readonly short: LossSummary; readonly long: LossSummary };
  /** Sales this could not place, and why. Never silently dropped from the total. */
  readonly excluded: readonly ExcludedParcel[];
}

/** The exemption band for the equity group, as of a date, or null. */
function exemptionOn(rules: readonly TaxRule[], on: IsoDate): TaxRule | null {
  let best: TaxRule | null = null;
  for (const rule of rules) {
    if (
      rule.kind !== 'exemption' ||
      (rule.assetClass !== 'listed_equity' && rule.assetClass !== 'equity_fund')
    ) {
      continue;
    }
    if (rule.effectiveFrom > on) continue;
    if (rule.effectiveTo !== null && rule.effectiveTo < on) continue;
    if (best === null || rule.effectiveFrom > best.effectiveFrom) best = rule;
  }
  return best;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const positive = (a: bigint): bigint => (a > 0n ? a : 0n);
const negated = (a: bigint): bigint => (a < 0n ? -a : 0n);

export function netCapitalGains(options: {
  readonly parcels: readonly Parcel[];
  /** Every instrument's tax asset class by id. Missing means unclassified. */
  readonly assetClassOf: ReadonlyMap<string, AssetClass | null>;
  /** The kind of each disposal, by disposal id. Missing means an ordinary sale. */
  readonly disposalKindOf: ReadonlyMap<string, string>;
  readonly rules: readonly TaxRule[];
  readonly fy: number;
}): CapitalGains {
  const window = taxYearBounds(options.fy);

  const nets: Record<Bucket, bigint> = {
    'equity-short': 0n,
    'equity-long': 0n,
    'other-long': 0n,
    'other-short': 0n,
  };
  const excluded: ExcludedParcel[] = [];

  for (const parcel of options.parcels) {
    if (parcel.disposedOn < window.start || parcel.disposedOn > window.end) continue;

    const placement = placeParcel({
      parcel,
      assetClass: options.assetClassOf.get(parcel.instrumentId) ?? null,
      disposalKind: options.disposalKindOf.get(parcel.disposalId) ?? null,
      rules: options.rules,
    });

    if (!placement.placed) {
      excluded.push({
        lotId: parcel.lotId,
        disposalId: parcel.disposalId,
        instrumentId: parcel.instrumentId,
        reason: placement.reason,
      });
      continue;
    }

    nets[placement.bucket] += parcel.gain.minor;
  }

  // What is left of each gain, and how much loss has been set against it.
  const left: Record<Bucket, bigint> = {
    'equity-short': positive(nets['equity-short']),
    'equity-long': positive(nets['equity-long']),
    'other-long': positive(nets['other-long']),
    'other-short': positive(nets['other-short']),
  };
  const setOff: Record<Bucket, bigint> = {
    'equity-short': 0n,
    'equity-long': 0n,
    'other-long': 0n,
    'other-short': 0n,
  };

  /** Use up to `amount` of a loss against these buckets, in order. Returns how much was used. */
  const apply = (amount: bigint, order: readonly Bucket[]): bigint => {
    let remaining = amount;
    for (const bucket of order) {
      if (remaining === 0n) break;
      const take = min(remaining, left[bucket]);
      left[bucket] -= take;
      setOff[bucket] += take;
      remaining -= take;
    }
    return amount - remaining;
  };

  // The loss that can only go one way is used first, so the one that can go
  // anywhere is what is left to carry forward.
  const longLoss = negated(nets['equity-long']) + negated(nets['other-long']);
  const longUsed = apply(longLoss, ['other-long', 'equity-long']);

  const shortLoss = negated(nets['equity-short']) + negated(nets['other-short']);
  const shortUsed = apply(shortLoss, ['equity-short', 'other-short', 'other-long', 'equity-long']);

  // The allowance applies to what is left of the long-term equity gain, after
  // both kinds of loss have had their say.
  const exemptionRule = exemptionOn(options.rules, window.end);
  const exemption =
    exemptionRule === null
      ? null
      : {
          available: money(exemptionRule.bandToMinor ?? 0n, CURRENCY),
          used: money(min(exemptionRule.bandToMinor ?? 0n, left['equity-long']), CURRENCY),
          authority: exemptionRule.authority,
        };

  const summary = (total: bigint, used: bigint): LossSummary => ({
    total: money(total, CURRENCY),
    setOff: money(used, CURRENCY),
    unrelieved: total - used > 0n ? money(total - used, CURRENCY) : null,
  });

  const bucket = (id: Bucket): GainBucket => ({
    net: money(nets[id], CURRENCY),
    setOff: money(setOff[id], CURRENCY),
    taxable: money(left[id], CURRENCY),
  });

  return {
    fy: options.fy,
    window,
    equityShort: bucket('equity-short'),
    equityLong: {
      net: money(nets['equity-long'], CURRENCY),
      setOff: money(setOff['equity-long'], CURRENCY),
      exemption,
      taxable: exemption === null ? null : money(left['equity-long'] - exemption.used.minor, CURRENCY),
    },
    otherLong: bucket('other-long'),
    otherShort: bucket('other-short'),
    losses: { short: summary(shortLoss, shortUsed), long: summary(longLoss, longUsed) },
    excluded,
  };
}

// ══════════════════════════════════════════════════════════════════ the tax

export interface BucketTax {
  /** What was taxable in this bucket after set-off and any allowance. */
  readonly taxable: Money;
  /** The rate applied, as `tax_rule` holds it. Null when nothing was taxable and none was needed. */
  readonly ratePct: string | null;
  /** Where the rate came from, so a figure can be traced rather than argued about. */
  readonly authority: string | null;
  /**
   * Null when there is a taxable gain and no rate to apply to it — refused, not
   * assumed to be nothing. Zero, with no rate needed, when nothing was taxable.
   */
  readonly tax: Money | null;
}

export interface CapitalGainsTax {
  readonly equityShort: BucketTax;
  /** Null when the exemption is unknown: what is taxable long term cannot be said. */
  readonly equityLong: BucketTax | null;
  readonly otherLong: BucketTax;
  /**
   * Short-term gain on gold and unlisted shares, to be added to income and taxed
   * at the slab. Deliberately not a tax and not in `total`: the slab needs the
   * rest of the income, and a total with this folded in as zero would read as
   * complete.
   */
  readonly otherShortAtSlab: Money;
  /**
   * How much of the basic exemption was used up by these gains — zero unless a
   * shortfall was passed in. The `taxable` figures above are after it.
   */
  readonly adjustedForBasicExemption: Money;
  /**
   * The tax on the three buckets with rates of their own. Null unless every one
   * of them is known — a total short by a refused part would read as complete.
   */
  readonly total: Money | null;
}

/**
 * The rate for a bucket, when every class in it agrees.
 *
 * A bucket is taxed as one, so it needs one rate. Two rates would mean choosing,
 * which is a guess — so disagreement is a refusal, and a class with no rate row is
 * too. They are seeded equal today; this makes that a fact the code checks.
 */
function agreedRate(
  rules: readonly TaxRule[],
  classes: readonly AssetClass[],
  term: 'long' | 'short',
  on: IsoDate,
): TaxRule | null {
  const found = classes.map((assetClass) => longTermRate(rules, assetClass, term, on));
  const first = found[0];
  if (first === undefined || first === null || first.ratePct === null) return null;
  const agree = found.every(
    (rule) => rule !== null && rule.ratePct !== null && thousandths(rule.ratePct) === thousandths(first.ratePct ?? ''),
  );
  return agree ? first : null;
}

/**
 * What the netted gains cost, before surcharge and cess.
 *
 * Three buckets have a rate of their own, and the tax on each is one
 * multiplication. Surcharge and the 4% cess sit on top, in a later step that also
 * needs the taxpayer's other income; nothing here pretends to be that.
 *
 * Rates are read as of the last day of the year, like the allowance. That is
 * sound while earlier regimes are not seeded, because a sale under one is refused
 * by `classify` and never reaches these totals.
 */
export function capitalGainsTax(
  gains: CapitalGains,
  rules: readonly TaxRule[],
  options: {
    /**
     * What is left of the basic exemption after every other kind of income —
     * for a resident individual, set against these gains before they are taxed.
     * Working it out needs the other income, which is not this module's to know.
     */
    readonly basicExemptionShortfall?: Money;
  } = {},
): CapitalGainsTax {
  const on = gains.window.end;

  // Short-term equity first, because it carries the highest rate; then long-term
  // equity; then other long-term. Short-term gold and unlisted is never here — it
  // is income for the slab, and the slab step has already used the exemption on it.
  const initial = options.basicExemptionShortfall?.minor ?? 0n;
  let remaining = initial;
  const useExemptionOn = (taxable: Money): Money => {
    const take = min(remaining, taxable.minor);
    remaining -= take;
    return money(taxable.minor - take, CURRENCY);
  };
  const equityShortTaxable = useExemptionOn(gains.equityShort.taxable);
  const equityLongTaxable =
    gains.equityLong.taxable === null ? null : useExemptionOn(gains.equityLong.taxable);
  const otherLongTaxable = useExemptionOn(gains.otherLong.taxable);
  const EQUITY: readonly AssetClass[] = ['listed_equity', 'equity_fund'];
  const OTHER: readonly AssetClass[] = ['gold', 'unlisted_equity'];

  const bucketTax = (
    taxable: Money,
    classes: readonly AssetClass[],
    term: 'long' | 'short',
  ): BucketTax => {
    if (taxable.minor === 0n) {
      return { taxable, ratePct: null, authority: null, tax: money(0n, CURRENCY) };
    }
    const rule = agreedRate(rules, classes, term, on);
    if (rule === null || rule.ratePct === null) {
      return { taxable, ratePct: null, authority: null, tax: null };
    }
    return {
      taxable,
      ratePct: rule.ratePct,
      authority: rule.authority,
      tax: money(percentOf(taxable.minor, rule.ratePct), CURRENCY),
    };
  };

  const equityShort = bucketTax(equityShortTaxable, EQUITY, 'short');
  const equityLong = equityLongTaxable === null ? null : bucketTax(equityLongTaxable, EQUITY, 'long');
  const otherLong = bucketTax(otherLongTaxable, OTHER, 'long');

  const total =
    equityLong === null || equityShort.tax === null || equityLong.tax === null || otherLong.tax === null
      ? null
      : money(equityShort.tax.minor + equityLong.tax.minor + otherLong.tax.minor, CURRENCY);

  return {
    equityShort,
    equityLong,
    otherLong,
    otherShortAtSlab: gains.otherShort.taxable,
    adjustedForBasicExemption: money(initial - remaining, CURRENCY),
    total,
  };
}
