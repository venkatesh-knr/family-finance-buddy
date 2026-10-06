/**
 * Which screens a role is given.
 *
 * The database decides what a role may read (`20260925120000_narrow_reads.sql`);
 * this decides which screens are worth showing for what is left. They answer
 * different questions and neither replaces the other: hiding a tab is not
 * security, and a policy that returns fewer rows does not make Overview true.
 *
 * Overview's net worth and FIRE's plan are household-wide figures. A contributor
 * can read only their own rows, so those screens would add up what they can see
 * and present it as the household's, a partial figure that looks complete,
 * which is the failure this app is built against. So they are not offered.
 * A contributor gets the summary (sums, from the definer functions) in their
 * place, plus the screens that are about their own records.
 *
 * Deny by default: a role that is missing or unrecognised gets the summary, the
 * one screen that is the same for everybody who can see a household at all.
 */

import type { HouseholdRole } from '../repo/types.ts';

export type AppScreen =
  | 'overview'
  | 'summary'
  | 'expenses'
  | 'holdings'
  | 'tax'
  | 'fire'
  | 'profile'
  | 'settings';

/** The screens in the navigation, in order, for a role. */
export function screensFor(role: HouseholdRole | null): readonly AppScreen[] {
  switch (role) {
    case 'owner':
    case 'partner':
      return ['overview', 'expenses', 'holdings', 'tax', 'fire'];
    case 'contributor':
      return ['summary', 'expenses', 'holdings', 'tax'];
    case 'viewer':
    case null:
      return ['summary'];
  }
}

/** Profile and Settings are reached from the account menu, by everybody. */
const FOR_EVERYONE: readonly AppScreen[] = ['profile', 'settings'];

/**
 * The screen to actually show: the one asked for if the role may have it, and
 * otherwise the first the role has. A hash somebody typed or a link somebody
 * followed is a request, not a grant.
 */
export function allowedScreen(role: HouseholdRole | null, wanted: AppScreen): AppScreen {
  if (FOR_EVERYONE.includes(wanted)) return wanted;
  const own = screensFor(role);
  return own.includes(wanted) ? wanted : (own[0] ?? 'summary');
}
