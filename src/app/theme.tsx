/**
 * Theme — system, light or dark.
 *
 * "System" is the default and stamps nothing on the root element, so the
 * prefers-color-scheme block in tokens.css decides. An explicit choice stamps
 * data-theme, which wins in both directions.
 */

import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'finance-buddy:theme';

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private window, or site data blocked. The system default is a fine answer.
  }
  return 'system';
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

export function useTheme(): { choice: ThemeChoice; setChoice: (next: ThemeChoice) => void } {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);

  useEffect(() => {
    apply(choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience, not a requirement.
    }
  }, []);

  return { choice, setChoice };
}

export function ThemeToggle({
  choice,
  onChange,
}: {
  choice: ThemeChoice;
  onChange: (next: ThemeChoice) => void;
}) {
  const options: readonly ThemeChoice[] = ['system', 'light', 'dark'];
  return (
    <div className="segmented" role="group" aria-label="Colour theme">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={choice === option}
          onClick={() => {
            onChange(option);
          }}
        >
          {option === 'system' ? 'Auto' : option === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  );
}
