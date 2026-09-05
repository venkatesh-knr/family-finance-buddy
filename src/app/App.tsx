/**
 * The shell.
 *
 * No router: the skeleton has one screen and a sign-in gate, and a router for
 * that is a dependency plus a Pages base-path plus a 404 fallback bought with
 * nothing. It arrives with the second screen.
 *
 * Note what the gate is not doing. It decides what to *render*; it is not what
 * keeps household A's data away from household B, nor what makes the second
 * factor mandatory. Both of those are policies in the database, tested in
 * supabase/tests, and they hold whether or not this file is running.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExpensesScreen } from '../features/expenses/ExpensesScreen.tsx';
import { HoldingsScreen } from '../features/holdings/HoldingsScreen.tsx';
import { SignInScreen } from '../features/auth/SignInScreen.tsx';
import { currentAuthState, signOut, subscribeToAuth, type AuthState } from '../repo/auth.ts';
import { isConfigured } from '../repo/client.ts';
import { Card, Problem } from '../ui/primitives.tsx';
import { ThemeToggle, useTheme } from './theme.tsx';

type Screen = 'expenses' | 'holdings';

/**
 * Still no router. Two screens and a gate does not justify the dependency, the
 * Pages base-path handling and a 404 fallback; a segmented control is the whole
 * of what is needed. A router arrives when a URL has to be shareable.
 */
const SCREENS: readonly (readonly [Screen, string])[] = [
  ['expenses', 'Expenses'],
  ['holdings', 'Holdings'],
];

export function App() {
  const { choice, setChoice } = useTheme();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const [screen, setScreen] = useState<Screen>('expenses');

  const refreshAuth = useCallback(async () => {
    try {
      setAuth(await currentAuthState());
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not read the session.');
    }
  }, []);

  useEffect(() => {
    if (!isConfigured()) {
      setProblem(
        'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set. Copy .env.example to .env and fill both in.',
      );
      return;
    }
    void refreshAuth();
    return subscribeToAuth(() => {
      void refreshAuth();
    });
  }, [refreshAuth]);

  if (problem !== null && auth === null) {
    return (
      <main className="mx-auto max-w-app px-4.5 py-11">
        <Card title="Not configured">
          <Problem>{problem}</Problem>
        </Card>
      </main>
    );
  }

  if (auth === null) {
    return <p className="note px-4.5 py-11">Starting…</p>;
  }

  if (auth.stage !== 'signed-in') {
    return <SignInScreen stage={auth.stage} email={auth.email} />;
  }

  return (
    <div className="min-h-screen">
      <header
        className="mb-4.5 flex flex-wrap items-center justify-between gap-3 px-4.5 py-3.5"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}
      >
        <h1 className="text-title">Finance Buddy</h1>

        <div className="flex flex-wrap items-center gap-3">
          <div className="segmented" role="group" aria-label="Privacy mode">
            <button
              type="button"
              aria-pressed={privacy}
              onClick={() => {
                setPrivacy((on) => !on);
              }}
            >
              {privacy ? 'Amounts hidden' : 'Amounts shown'}
            </button>
          </div>

          <ThemeToggle choice={choice} onChange={setChoice} />

          <button
            type="button"
            className="note underline"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="mx-auto mb-4.5 flex max-w-app px-4.5">
        <div className="segmented" role="group" aria-label="Screen">
          {SCREENS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={screen === id}
              onClick={() => {
                setScreen(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-app px-4.5 pb-11">
        {screen === 'expenses' ? (
          <ExpensesScreen privacy={privacy} />
        ) : (
          <HoldingsScreen privacy={privacy} />
        )}
      </main>
    </div>
  );
}
