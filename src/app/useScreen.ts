/**
 * Which screen is showing, and Back meaning what Back means.
 *
 * This was `useState('expenses')` — no history entries at all. On a phone that
 * is not a small problem: Back is the primary navigation gesture on Android,
 * and pressing it from anywhere in the app left the page entirely. Somebody
 * moving from Expenses to Holdings and then going back expects Expenses, not
 * to be thrown out of the app they were using.
 *
 * The fix is the smallest thing that behaves correctly: the screen lives in
 * the URL hash, and switching screens pushes a history entry.
 *
 * ── why the hash and not a path ──────────────────────────────────────────
 *
 * This is a static bundle on GitHub Pages. A path like /holdings is a request
 * Pages answers with a 404, because there is no file there and no server to
 * rewrite it — the usual workaround is a 404.html that re-enters the app,
 * which is a redirect somebody sees. A hash never reaches the server, so a
 * reload or a shared link lands on the right screen with no such trick, and
 * it works identically under the /family-finance-buddy/ base path, at the
 * root in dev, and inside Tauri and Capacitor where there is no server at
 * all.
 *
 * "A router arrives when a URL has to be shareable" — that day is not here.
 * This is not a router: it maps one hash to one of six names and refuses
 * anything else.
 */

import { useCallback, useEffect, useState } from 'react';

export type Screen = 'overview' | 'expenses' | 'holdings' | 'fire' | 'profile' | 'settings';

const SCREEN_NAMES: readonly Screen[] = [
  'overview',
  'expenses',
  'holdings',
  'fire',
  'profile',
  'settings',
];

/** The screen the current URL names, or the default. Never trusts the hash. */
function readHash(): Screen {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return (SCREEN_NAMES as readonly string[]).includes(raw) ? (raw as Screen) : 'expenses';
}

export function useScreen(): {
  screen: Screen;
  setScreen: (next: Screen) => void;
} {
  const [screen, setScreenState] = useState<Screen>(() =>
    typeof window === 'undefined' ? 'expenses' : readHash(),
  );

  // Back and forward. The browser has already changed the URL by the time this
  // fires, so the hash is the truth and the state follows it.
  useEffect(() => {
    const onPop = () => {
      setScreenState(readHash());
    };
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  const setScreen = useCallback((next: Screen) => {
    // Choosing the screen you are already on should not stack a history entry
    // that Back then has to be pressed twice to escape.
    if (readHash() === next) {
      setScreenState(next);
      return;
    }
    window.location.hash = `#/${next}`;
    setScreenState(next);
  }, []);

  return { screen, setScreen };
}
