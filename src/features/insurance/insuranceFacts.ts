/**
 * What the Insurance screen says, worked out from what is recorded and from nothing else.
 *
 * The arithmetic is `domain/protection.ts`; this gathers its inputs from the household's policies, loans
 * and holdings, converts them into one currency at the dated rates, and refuses, naming the reason, where
 * an input is missing. A gap computed on a guess would be the confident wrong number this app is built
 * not to give, and one that reads as advice is a worse one.
 *
 * Cover is only ever read here, for the cover gap and for the lists. It is not money owned and goes
 * nowhere near net worth, allocation or FIRE (PF-C3).
 */

import type { AnnualExpense } from '../../domain/annual-expense.ts';
import { convert, type Rate } from '../../domain/fx.ts';
import {
  coverGap,
  cumulativePremiums,
  renewalsDue,
  surrenderGap,
  type CoverGap,
  type RenewalDue,
} from '../../domain/protection.ts';
import type { IsoDate } from '../../lib/dates.ts';
import { money, type Money } from '../../lib/money.ts';
import type { InsurancePolicy, Liability } from '../../repo/types.ts';

export interface PolicyFacts {
  /** Premiums due so far, from the start date and the cadence. Null where either is not recorded. */
  readonly paidIn: Money | null;
  /** What the linked holding was last read at. Null for protection with no value. */
  readonly surrenderValue: Money | null;
  /** Paid in less surrender value; positive is the household behind. */
  readonly behind: Money | null;
}

export interface InsuranceFacts {
  /** Term cover in force, in the household's base currency; null where it cannot be added into one figure. */
  readonly termCover: Money | null;
  /** How many term policies are in force, so a screen can say none is recorded rather than show a zero. */
  readonly termCount: number;
  /** Active term policies with no cover recorded: not a cover of nothing, and the figure is short by them. */
  readonly termCoverUnknown: number;
  /** Open loans with no outstanding balance recorded, so the liabilities are short by them. */
  readonly loansWithoutBalance: number;
  readonly gap: CoverGap | null;
  /**
   * What the household spends in a year with the loan instalments taken out, in base: the figure the gap
   * multiplies by the years. A loan's outstanding balance is already a term of the sum, so its instalments
   * are not also a year's expenses; counted in both, the loan is counted twice.
   */
  readonly annualForCover: Money | null;
  /** The instalments left out of it, so the screen can say what the figure does not include. */
  readonly instalmentsLeftOut: Money | null;
  /**
   * What is wrong with the gap and not with a figure in it: cover or balances nobody has recorded, which
   * are not zero. Said wherever the gap is, so one screen cannot drop what another says.
   */
  readonly notes: readonly string[];
  /** Why there is no gap, in words for the screen, when there is not. */
  readonly gapRefusedBecause: string | null;
  /** Health cover is a list and has no suggested figure. */
  readonly health: readonly InsurancePolicy[];
  /** Health cover in force, by whose it is: a list and a sum insured per member, and no suggested figure. */
  readonly healthByMember: readonly { readonly memberId: string | null; readonly policies: readonly InsurancePolicy[] }[];
  readonly byPolicy: ReadonlyMap<string, PolicyFacts>;
  readonly renewals: readonly RenewalDue[];
}

export function insuranceFacts(options: {
  readonly policies: readonly InsurancePolicy[];
  readonly liabilities: readonly Liability[];
  /** The latest reading of each holding that carries a surrender value. */
  readonly surrenderValues: ReadonlyMap<string, Money>;
  /** The annual expense with what it is made of, or null where it has not been set up. */
  readonly annual: AnnualExpense | null;
  readonly years: number;
  /** What could be had in an emergency, in `base`, or null where it could not be added into one figure. */
  readonly liquid: Money | null;
  readonly base: string;
  readonly rates: readonly Rate[];
  readonly today: IsoDate;
}): InsuranceFacts {
  const { policies, liabilities, rates, base, today } = options;
  const active = policies.filter((policy) => !policy.isLapsed);

  const byPolicy = new Map<string, PolicyFacts>();
  for (const policy of policies) {
    const paidIn = cumulativePremiums({
      premium: policy.premium,
      cadence: policy.cadence,
      startedOn: policy.startedOn,
      today,
      lapsedOn: policy.lapsedOn,
      premiumsEndOn: policy.premiumsEndOn,
    });
    const surrenderValue =
      policy.linkedHoldingId === null ? null : (options.surrenderValues.get(policy.linkedHoldingId) ?? null);
    byPolicy.set(policy.id, {
      paidIn,
      surrenderValue,
      behind: surrenderGap({ paidIn, surrenderValue }),
    });
  }

  let missingRate: string | null = null;
  const toBase = (amount: Money, on: IsoDate): Money | null => {
    const converted = convert(amount, base, rates, on);
    if (converted.ok) return converted.amount;
    missingRate ??= `${converted.missing.base} to ${converted.missing.quote}`;
    return null;
  };

  // Term cover in force: the policies that pay a dependant if the insured dies, and only those.
  const term = active.filter((policy) => policy.kind === 'term_life');
  let termMinor = 0n;
  let termConverted = true;
  let termCoverUnknown = 0;
  for (const policy of term) {
    if (policy.cover === null) {
      termCoverUnknown += 1;
      continue;
    }
    const converted = toBase(policy.cover, today);
    if (converted === null) termConverted = false;
    else termMinor += converted.minor;
  }
  const termCover = termConverted ? money(termMinor, base) : null;

  // What is still owed on loans that are still open. A loan with no balance recorded is unknown, not
  // paid off, and the figure is short by it.
  const open = liabilities.filter((loan) => !loan.isClosed);
  const loansWithoutBalance = open.filter((loan) => loan.outstanding === null).length;
  let owedMinor = 0n;
  let owedConverted = true;
  for (const loan of open) {
    if (loan.outstanding === null) continue;
    const converted = toBase(loan.outstanding, loan.outstandingAsOf ?? today);
    if (converted === null) owedConverted = false;
    else owedMinor += converted.minor;
  }

  const notes: string[] = [];
  if (loansWithoutBalance > 0) {
    notes.push(
      `${String(loansWithoutBalance)} ${loansWithoutBalance === 1 ? 'loan has' : 'loans have'} no balance recorded, so what is owed is short by ${loansWithoutBalance === 1 ? 'it' : 'them'}. Record the balance on FIRE.`,
    );
  }
  if (termCoverUnknown > 0) {
    notes.push(
      `${String(termCoverUnknown)} term ${termCoverUnknown === 1 ? 'policy has' : 'policies have'} no cover recorded, which is not a cover of nothing: the cover in force is short by ${termCoverUnknown === 1 ? 'it' : 'them'}.`,
    );
  }

  // A year's expenses without the loans' instalments: their balance is a term of the sum already.
  const annual = options.annual;
  const annualForCover =
    annual === null ? null : money(annual.total.minor - annual.bySource.liability.minor, annual.total.currency);
  const instalmentsLeftOut = annual === null ? null : annual.bySource.liability;

  let gap: CoverGap | null = null;
  let gapRefusedBecause: string | null = null;
  if (annualForCover === null || annualForCover.minor <= 0n) {
    gapRefusedBecause =
      'there are no annual expenses to cover: set the spending plan up on FIRE, and the years of expenses a dependant would need can be worked out.';
  } else if (options.liquid === null) {
    gapRefusedBecause = 'the liquid money could not be added into one figure, so it cannot be subtracted.';
  } else if (!owedConverted || termCover === null) {
    gapRefusedBecause = `a rate from ${missingRate ?? 'one currency to another'} is missing, so the amounts cannot be added into one figure.`;
  } else {
    const yearly = toBase(annualForCover, today);
    gap =
      yearly === null
        ? null
        : coverGap({
            liabilities: money(owedMinor, base),
            annualExpenses: yearly,
            years: options.years,
            liquidCorpus: options.liquid,
            termCover,
          });
    if (gap === null) {
      gapRefusedBecause = 'the amounts are not in one currency, so there is nothing to add.';
    }
  }

  return {
    termCover,
    termCount: term.length,
    termCoverUnknown,
    loansWithoutBalance,
    gap,
    annualForCover,
    instalmentsLeftOut,
    notes,
    gapRefusedBecause,
    health: active.filter((policy) => policy.kind === 'health'),
    healthByMember: groupByMember(active.filter((policy) => policy.kind === 'health')),
    byPolicy,
    renewals: renewalsDue(
      policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        renewalOn: policy.renewalOn,
        isLapsed: policy.isLapsed,
      })),
      today,
    ),
  };
}

/** A floater has no member and is the household's. Members in the order their first policy appears, the household's first. */
function groupByMember(policies: readonly InsurancePolicy[]): InsuranceFacts['healthByMember'] {
  const groups = new Map<string | null, InsurancePolicy[]>();
  for (const policy of policies) {
    const list = groups.get(policy.memberId) ?? [];
    list.push(policy);
    groups.set(policy.memberId, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : 0))
    .map(([memberId, list]) => ({ memberId, policies: list }));
}
