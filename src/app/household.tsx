/**
 * Which household is on screen.
 *
 * "A household switcher sits beside the member filter, appearing only when you
 * belong to more than one — the demo household during the build, and later a
 * parents' household if you ever help with theirs. Switching changes everything
 * on screen; nothing is ever aggregated across households." (§783)
 *
 * That last clause is the load-bearing one, and it is why this is a provider
 * rather than a piece of screen state: every read has to be scoped to the same
 * household, and a screen holding its own idea of which one would eventually
 * disagree with its neighbour.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { listHouseholds, type HouseholdMembership } from '../repo/households.ts';
import { NoHouseholdError, type HouseholdKind } from '../repo/types.ts';

interface HouseholdChoice {
  readonly memberships: readonly HouseholdMembership[];
  readonly current: HouseholdMembership | null;
  readonly choose: (householdId: string) => void;
  readonly reload: () => void;
  readonly loading: boolean;
  readonly noHousehold: boolean;
  readonly problem: string | null;
}

const HouseholdContext = createContext<HouseholdChoice | null>(null);

const STORAGE_KEY = 'finance-buddy:household';

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private window, or site data blocked. The first household is a fine answer.
    return null;
  }
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [memberships, setMemberships] = useState<readonly HouseholdMembership[]>([]);
  const [chosenId, setChosenId] = useState<string | null>(remembered);
  const [loading, setLoading] = useState(true);
  const [noHousehold, setNoHousehold] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await listHouseholds();
      setMemberships(next);
      setNoHousehold(false);
      setProblem(null);
    } catch (error) {
      if (error instanceof NoHouseholdError) {
        setMemberships([]);
        setNoHousehold(true);
        setProblem(null);
      } else {
        setProblem(error instanceof Error ? error.message : 'Could not read your households.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = useCallback((householdId: string) => {
    setChosenId(householdId);
    try {
      localStorage.setItem(STORAGE_KEY, householdId);
    } catch {
      // Remembering the choice is a convenience; switching still works without it.
    }
  }, []);

  const current = useMemo(() => {
    if (memberships.length === 0) return null;
    // A remembered choice that no longer applies — access revoked, or a
    // different account signed in on this device — falls back rather than
    // showing nothing.
    return memberships.find((m) => m.household.id === chosenId) ?? memberships[0] ?? null;
  }, [memberships, chosenId]);

  const value = useMemo<HouseholdChoice>(
    () => ({ memberships, current, choose, reload: () => void load(), loading, noHousehold, problem }),
    [memberships, current, choose, load, loading, noHousehold, problem],
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHouseholdChoice(): HouseholdChoice {
  const value = useContext(HouseholdContext);
  if (value === null) {
    throw new Error('useHouseholdChoice must be used inside a HouseholdProvider.');
  }
  return value;
}

/**
 * The badge a demo household carries everywhere.
 *
 * "Demo households are marked kind = demo and carry a persistent badge, so
 * there is never a moment of wondering which numbers you are looking at."
 * (§423) Persistent is the point — it is not a first-run notice, it is a
 * permanent property of the screen.
 */
export function DemoBadge({ kind }: { kind: HouseholdKind }) {
  if (kind !== 'demo') return null;
  return (
    <span
      className="pill"
      style={{ background: 'var(--brass-soft)', color: 'var(--brass)' }}
      title="Fake money. Nothing here is your real position."
    >
      Demo
    </span>
  );
}

/**
 * The switcher, which appears only when there is a choice to make.
 *
 * A control offering one option is noise, and §783 says so: "appearing only
 * when you belong to more than one".
 */
export function HouseholdSwitcher() {
  const { memberships, current, choose } = useHouseholdChoice();

  if (current === null) return null;

  if (memberships.length < 2) {
    return (
      <span className="flex items-center gap-2">
        <span className="note">{current.household.name}</span>
        <DemoBadge kind={current.household.kind} />
      </span>
    );
  }

  return (
    <label className="flex items-center gap-2">
      <span className="micro-label">Household</span>
      <select
        className="field w-auto"
        value={current.household.id}
        onChange={(event) => {
          choose(event.target.value);
        }}
      >
        {memberships.map((membership) => (
          <option key={membership.household.id} value={membership.household.id}>
            {membership.household.name}
            {membership.household.kind === 'demo' ? ' (demo)' : ''}
          </option>
        ))}
      </select>
      <DemoBadge kind={current.household.kind} />
    </label>
  );
}
