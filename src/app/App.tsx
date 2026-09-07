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
import { FireScreen } from '../features/plan/PlanScreen.tsx';
import { ProfileScreen } from '../features/profile/ProfileScreen.tsx';
import { SettingsScreen } from '../features/settings/SettingsScreen.tsx';
import { SignInScreen } from '../features/auth/SignInScreen.tsx';
import { currentAuthState, signOut, subscribeToAuth, type AuthState } from '../repo/auth.ts';
import { isConfigured } from '../repo/client.ts';
import { Card, Problem } from '../ui/primitives.tsx';
import { HouseholdProvider, HouseholdSwitcher, useHouseholdChoice } from './household.tsx';
import { useTheme, type ThemeChoice } from './theme.tsx';
import { HIDE_AMOUNTS_BY_DEFAULT, useDevicePreference } from './preferences.ts';
import { AccountMenu } from './AccountMenu.tsx';

/**
 * Household is gone as a destination of its own; administering who belongs to
 * one is a household setting, and having it beside Expenses implied it was
 * somewhere you go often. It is somewhere you go twice a year.
 *
 * Profile and Settings are reachable from the account menu rather than the
 * tabs, because neither is a place you are working — they are places you go
 * to change how the working places behave, and a tab for each would give them
 * the same weight as the ledger.
 */
type Screen = 'expenses' | 'holdings' | 'fire' | 'profile' | 'settings';

/**
 * Still no router. Two screens and a gate does not justify the dependency, the
 * Pages base-path handling and a 404 fallback; a segmented control is the whole
 * of what is needed. A router arrives when a URL has to be shareable.
 */
const SCREENS: readonly (readonly [Screen, string])[] = [
  ['expenses', 'Expenses'],
  ['holdings', 'Holdings'],
  ['fire', 'FIRE'],
];

export function App() {
  const { choice, setChoice } = useTheme();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [hideByDefault, setHideByDefault] = useDevicePreference(HIDE_AMOUNTS_BY_DEFAULT, false);
  // Seeded from the preference, then owned by the session: turning amounts on
  // to read something should not quietly rewrite what the device does next
  // time it opens.
  const [privacy, setPrivacy] = useState(hideByDefault);
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
    <HouseholdProvider>
      <SignedIn
        privacy={privacy}
        setPrivacy={setPrivacy}
        hideAmountsByDefault={hideByDefault}
        onHideAmountsByDefault={setHideByDefault}
        choice={choice}
        setChoice={setChoice}
        email={auth.email}
        screen={screen}
        setScreen={setScreen}
      />
    </HouseholdProvider>
  );
}

/**
 * The signed-in shell.
 *
 * Separate from App because it reads the chosen household, and a component
 * cannot consume a provider it is itself rendering.
 */
function SignedIn({
  privacy,
  setPrivacy,
  choice,
  setChoice,
  email,
  screen,
  setScreen,
  hideAmountsByDefault,
  onHideAmountsByDefault,
}: {
  privacy: boolean;
  setPrivacy: (update: (on: boolean) => boolean) => void;
  choice: ThemeChoice;
  setChoice: (next: ThemeChoice) => void;
  email: string | null;
  screen: Screen;
  setScreen: (next: Screen) => void;
  hideAmountsByDefault: boolean;
  onHideAmountsByDefault: (next: boolean) => void;
}) {
  const { current } = useHouseholdChoice();
  const householdId = current?.household.id ?? null;

  return (
    <div className="min-h-screen">
      <header
        className="inset-safe-top inset-safe-x mb-4.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 pb-3.5"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}
      >
        <h1 className="text-title">Family Finance Buddy</h1>

        <div className="flex flex-wrap items-center gap-3">
          {/*
            A switch, not a choice among options — so a button that is pressed
            or not, rather than a segmented control containing one item, which
            is a control shape that means "pick one of these".
          */}
          <button
            type="button"
            className="iconbtn"
            aria-pressed={privacy}
            onClick={() => {
              setPrivacy((on) => !on);
            }}
          >
            <span aria-hidden="true">{privacy ? '●●●' : '₹'}</span>
            <span>{privacy ? 'Amounts hidden' : 'Amounts shown'}</span>
          </button>

          {/*
            Theme has moved to Settings. It is a preference set once, and the
            top bar is for what you reach for while working — which privacy
            mode genuinely is, on a device somebody else might glance at.
          */}
          <AccountMenu
            email={email}
            role={current?.role ?? null}
            householdName={current?.household.name ?? null}
            onProfile={() => {
              setScreen('profile');
            }}
            onSettings={() => {
              setScreen('settings');
            }}
            onSignOut={() => {
              void signOut();
            }}
          />
        </div>
      </header>

      <nav className="inset-safe-x mx-auto mb-4.5 flex max-w-app flex-wrap items-center justify-between gap-3">
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

        {/*
          Beside the screen tabs, because switching changes what every one of
          them is about (§783). It shows the household name when there is only
          one, so the demo badge has somewhere to live either way.
        */}
        <HouseholdSwitcher />
      </nav>

      <main className="inset-safe-x inset-safe-bottom mx-auto max-w-app">
        {screen === 'fire' && <FireScreen privacy={privacy} householdId={householdId} />}
        {screen === 'profile' && <ProfileScreen email={email} householdId={householdId} />}
        {screen === 'settings' && (
          <SettingsScreen
            householdId={householdId}
            theme={choice}
            onTheme={setChoice}
            hideAmountsByDefault={hideAmountsByDefault}
            onHideAmountsByDefault={onHideAmountsByDefault}
          />
        )}
        {screen === 'expenses' && <ExpensesScreen privacy={privacy} householdId={householdId} />}
        {screen === 'holdings' && <HoldingsScreen privacy={privacy} householdId={householdId} />}
      </main>
    </div>
  );
}
