/**
 * The one thing worth knowing about each place behind More, before opening it
 * (docs/design/vibrant-canvas.html, More).
 *
 * Pure: what the line says is worked out from facts the screens already have, and written out here so it can be
 * tested. The screen does the formatting of money, because privacy mode removes an amount from the page and only
 * the display edge knows whether it is on.
 */

import { renewalsDue } from '../domain/protection.ts';
import type { IsoDate } from '../lib/dates.ts';

export interface PolicyForGlance {
  readonly id: string;
  readonly name: string;
  readonly isLapsed: boolean;
  readonly renewalOn: IsoDate | null;
}

export interface InsuranceGlance {
  /** Policies in force. A lapsed one is not in force and is not counted. */
  readonly inForce: number;
  /** What is due to renew within thirty days, or already past: how many, and the soonest. */
  readonly due: { readonly count: number; readonly overdue: number; readonly soonestDays: number } | null;
}

export function insuranceGlance(policies: readonly PolicyForGlance[], today: IsoDate): InsuranceGlance {
  const inForce = policies.filter((policy) => !policy.isLapsed).length;
  const due = renewalsDue(policies, today);
  if (due.length === 0) return { inForce, due: null };
  const overdue = due.filter((renewal) => renewal.overdue).length;
  // Soonest first, so the first is the one to say; an overdue one has a negative number of days.
  const soonest = due[0]?.daysLeft ?? 0;
  return { inForce, due: { count: due.length, overdue, soonestDays: soonest } };
}

/** "4 policies", "1 policy", or what to do when there are none. */
export function policiesPhrase(count: number): string {
  if (count === 0) return 'No policies yet';
  return count === 1 ? '1 policy' : `${String(count)} policies`;
}

/** The pill under Insurance, or null when nothing is due. */
export function renewalPill(due: InsuranceGlance['due']): string | null {
  if (due === null) return null;
  if (due.overdue > 0) {
    return due.overdue === 1 ? '1 renewal overdue' : `${String(due.overdue)} renewals overdue`;
  }
  if (due.count === 1) {
    return due.soonestDays === 0 ? '1 renews today' : `1 renews in ${String(due.soonestDays)} ${due.soonestDays === 1 ? 'day' : 'days'}`;
  }
  return `${String(due.count)} renew within 30 days`;
}

/**
 * What the line under Tax may say. The Tax screen states the tax on gains only with the sales it could not place
 * listed beside it and the slab-taxed gains named as left out, so a bare figure on a menu would read as more
 * complete than it is. It is stated only when nothing was left out; otherwise the line says how many sales were
 * not counted, or sends the reader to the screen that has the working.
 */
export type TaxLine =
  | { readonly kind: 'figure' }
  | { readonly kind: 'unplaced'; readonly sales: number }
  | { readonly kind: 'see-the-working' };

export function taxLine(options: {
  /** Whether the tax could be worked out at all: a missing rule leaves it null. */
  readonly hasTotal: boolean;
  /** Sales the netting could not place, each with its reason on the Tax screen. */
  readonly unplacedSales: number;
  /** Short-term gold and unlisted gains, which are taxed at the slab and are not in the total. */
  readonly atSlabMinor: bigint;
}): TaxLine {
  if (options.unplacedSales > 0) return { kind: 'unplaced', sales: options.unplacedSales };
  if (!options.hasTotal || options.atSlabMinor !== 0n) return { kind: 'see-the-working' };
  return { kind: 'figure' };
}

/** The tax year as it is written on a return: 2026 is 2026–27. */
export function taxYearLabel(fy: number): string {
  return `${String(fy)}–${String((fy + 1) % 100).padStart(2, '0')}`;
}

const ROLE_WORDS: Record<string, string> = {
  owner: 'Owner',
  partner: 'Partner',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

/** What sits under Profile. Signing in needs the second factor, so "on" is a fact and not a guess. */
export function profileLine(role: string | null): string {
  const word = role === null ? null : (ROLE_WORDS[role] ?? null);
  return word === null ? 'Two-step sign-in on' : `${word} · two-step sign-in on`;
}
