import type { AppScreen } from '../domain/access.ts';

/**
 * The URL's hash as a screen and its filters, and back (docs/design/holdings.md, HD-I4).
 *
 * `#/holdings?kind=deposit` is the Holdings screen filtered to deposits. The filter is in the URL so that
 * the back button undoes it, a link can point at it, and an Overview allocation row is an ordinary link.
 * Still not a router: it maps one hash to a known screen name and a handful of string filters, and refuses
 * anything else. The screen name is checked against the list and the filters are only ever read as text
 * by whoever asks for them, so a typed URL is a request and never a grant.
 */

const SCREEN_NAMES: readonly AppScreen[] = [
  'overview',
  'summary',
  'money',
  'holdings',
  'tax',
  'fire',
  'insurance',
  'property',
  'reports',
  'more',
  'holding',
  'profile',
  'settings',
];

export interface Route {
  readonly screen: AppScreen;
  readonly params: URLSearchParams;
}

/** The screen the hash names, or Money, with the filters after its question mark. Never trusts the hash. */
export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  const screen = (SCREEN_NAMES as readonly string[]).includes(path) ? (path as AppScreen) : 'money';
  return { screen, params: new URLSearchParams(query) };
}

/**
 * Where an old link goes (docs/design/ledger-income.md section 3). The screen called Expenses is the Money screen, and a link saved to
 * `#/expenses` or `#/expenses?…` still works: it is replaced, not added to, by the same query on `#/money`, so the back button does not
 * return to the old address and loop. `null` for every other hash, which is left alone.
 */
export function legacyRedirect(hash: string): string | null {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  if (path !== 'expenses') return null;
  return query === '' ? '#/money' : `#/money?${query}`;
}

/** The hash for a screen and its filters; a filter with no value is left out, so All is the bare screen. */
export function hashFor(screen: AppScreen, filters: Readonly<Record<string, string | undefined>> = {}): string {
  const query = Object.entries(filters)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query === '' ? `#/${screen}` : `#/${screen}?${query}`;
}
