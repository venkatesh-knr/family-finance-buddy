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
import { OverviewScreen } from '../features/overview/OverviewScreen.tsx';
import { HoldingsScreen } from '../features/holdings/HoldingsScreen.tsx';
import { FireScreen } from '../features/plan/PlanScreen.tsx';
import { ProfileScreen } from '../features/profile/ProfileScreen.tsx';
import { SettingsScreen } from '../features/settings/SettingsScreen.tsx';
import { SignInScreen } from '../features/auth/SignInScreen.tsx';
import { currentAuthState, signOut, subscribeToAuth, type AuthState } from '../repo/auth.ts';
import { isConfigured } from '../repo/client.ts';
import { Card, EyeIcon, Problem } from '../ui/primitives.tsx';
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
type Screen = 'overview' | 'expenses' | 'holdings' | 'fire' | 'profile' | 'settings';

/**
 * Still no router. Two screens and a gate does not justify the dependency, the
 * Pages base-path handling and a 404 fallback; a segmented control is the whole
 * of what is needed. A router arrives when a URL has to be shareable.
 */
/**
 * The glyph is for the bottom bar on a phone, where a label alone is too
 * small to aim at. It never appears without its word: an icon on its own is a
 * guess, and this app is used by people who did not choose it.
 */
const SCREENS: readonly (readonly [Screen, string, string])[] = [
  ['overview', 'Overview', '◉'],
  ['expenses', 'Expenses', '₹'],
  ['holdings', 'Holdings', '◧'],
  ['fire', 'FIRE', '△'],
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
        {/*
          The name in full, never shortened — "if a label is tight, let the
          platform truncate rather than inventing a variant". So it shrinks and
          then ellipses rather than becoming "FFB". min-w-0 is what lets it
          truncate at all inside a flex row.
        */}
        <h1 className="app-title min-w-0 truncate">Family Finance Buddy</h1>

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
            aria-label={privacy ? 'Amounts hidden. Show them.' : 'Amounts shown. Hide them.'}
            onClick={() => {
              setPrivacy((on) => !on);
            }}
          >
            {/*
              A struck eye for hidden, an open one for shown — the same
              reading as the password field, and a picture of the thing the
              switch does. The rupee sign that was here said "money", not
              "hidden", and it sat wrong beside a Latin word at any size.
            */}
            <EyeIcon crossed={privacy} />
            {/*
              The words go on a narrow screen and the icon carries it, with the
              button's own label doing the work a sighted user gets from
              context. Two words here were the difference between one header
              row and two.
            */}
            <span className="hide-narrow">{privacy ? 'Amounts hidden' : 'Amounts shown'}</span>
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

      {/*
        Scrolls sideways rather than wrapping. Five tabs plus a household
        switcher took two rows on a phone, and a second row of chrome costs
        more than a scroll that most people never need — the first tabs are
        the ones they want.
      */}
      <nav className="inset-safe-x mx-auto mb-4.5 flex max-w-app items-center justify-between gap-3 scroll-x">
        {/*
          Hidden on a phone, where the bar at the bottom does this job under
          somebody's thumb. Kept above the breakpoint because a bottom bar on a
          wide screen is a long way from where the eye already is.
        */}
        <div className="segmented shrink-0 hide-narrow-flex" role="group" aria-label="Screen">
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

      <main className="inset-safe-x inset-safe-bottom mx-auto max-w-app pb-nav">
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
        {screen === 'overview' && (
          <OverviewScreen
            privacy={privacy}
            onPrivacy={() => {
              setPrivacy((on) => !on);
            }}
            householdId={householdId}
          />
        )}
        {screen === 'expenses' && <ExpensesScreen privacy={privacy} householdId={householdId} />}
        {screen === 'holdings' && <HoldingsScreen privacy={privacy} householdId={householdId} />}
      </main>

      {/*
        The bottom bar, on phones only.
        
        Every native finance app puts navigation here and they are right to:
        a thumb reaches the bottom of a phone and does not reach the top. It
        also lets the strip above it disappear on narrow screens, which is
        where the two rows of chrome came from in the first place.
        
        role="group" with aria-pressed rather than a tablist, for the same
        reason the top strip is: an incomplete ARIA tab pattern announces a
        promise it does not keep. Profile and Settings stay in the account
        menu; five destinations in a bar is one more than a thumb can aim at.
      */}
      <nav className="bottom-nav hide-wide" role="group" aria-label="Screen">
        {SCREENS.map(([id, label, glyph]) => (
          <button
            key={id}
            type="button"
            aria-pressed={screen === id}
            onClick={() => {
              setScreen(id);
              // Back to the top: arriving halfway down a screen you have not
              // seen before is disorienting, and the bar is most used to
              // start something rather than to resume it.
              window.scrollTo({ top: 0 });
            }}
          >
            <span aria-hidden="true" className="bottom-nav-glyph">
              {glyph}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
