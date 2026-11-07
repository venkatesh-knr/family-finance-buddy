/**
 * Whose figures: Mine first (docs/design/simple-layout.md section 2a; SL-I8).
 *
 * One switch, Mine | Household, in that order, on the Overview's net worth and on Holdings, and one state behind both: choosing one sets
 * both, for as long as the app stays open. Mine is the default every time the app opens, and the choice is not remembered across sessions:
 * a remembered scope is how somebody reads a personal figure believing it is the household's, which is why a figure says whose it is
 * ("Your net worth", "Household net worth"). A household of one member has no switch: Mine and Household are the same figure.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Scope = 'mine' | 'household';

interface ScopeValue {
  readonly scope: Scope;
  readonly setScope: (scope: Scope) => void;
}

const ScopeContext = createContext<ScopeValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  // Not persisted, deliberately: every session opens on Mine.
  const [scope, setScope] = useState<Scope>('mine');
  const value = useMemo(() => ({ scope, setScope }), [scope]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const value = useContext(ScopeContext);
  if (value === null) throw new Error('useScope must be used inside a ScopeProvider.');
  return value;
}

/** The word that says whose a figure is: Your, or Household. */
export function whose(scope: Scope): string {
  return scope === 'mine' ? 'Your' : 'Household';
}

/** The switch: Mine first and pressed by default, then Household. Not drawn for a household of one member, where the two are one figure. */
export function ScopeSwitch({ members }: { members: number }) {
  const { scope, setScope } = useScope();
  if (members <= 1) return null;
  return (
    <span className="segmented" role="group" aria-label="Whose figures">
      {(['mine', 'household'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={scope === option}
          onClick={() => {
            setScope(option);
          }}
        >
          {option === 'mine' ? 'Mine' : 'Household'}
        </button>
      ))}
    </span>
  );
}
