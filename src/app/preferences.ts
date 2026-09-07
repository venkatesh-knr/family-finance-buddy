/**
 * Preferences that belong to this device and nobody else.
 *
 * The split matters and the Settings screen shows it: a device preference
 * needs no permission and affects only the person holding the phone, while a
 * household setting changes the app for everyone and is an owner's to make.
 * Keeping them in different places in the code as well as on screen means the
 * question "who may change this?" is answered by where it lives.
 *
 * localStorage, deliberately. These are conveniences, not records: a private
 * window, cleared site data or a second device simply starts from the default,
 * and that is the correct outcome rather than a bug to work around. Nothing
 * here may ever hold anything that would be wrong to lose.
 */

import { useCallback, useState } from 'react';

const PREFIX = 'finance-buddy:';

function read(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(PREFIX + key);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Blocked or unavailable. The default is a fine answer, and throwing here
    // would take the whole app down for the sake of a checkbox.
  }
  return fallback;
}

/**
 * A boolean that survives a reload on this device.
 *
 * Read once at mount rather than on every render: localStorage is synchronous
 * and touching it in a render path is a jank source nobody goes looking for.
 */
export function useDevicePreference(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback));

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(PREFIX + key, String(next));
      } catch {
        // Remembering it is the convenience; the setting still applies now.
      }
    },
    [key],
  );

  return [value, update];
}

/**
 * Whether the app opens with amounts masked.
 *
 * "Opens with figures masked; one tap reveals." The reason it is a preference
 * rather than a fixed default is that the right answer depends entirely on
 * where somebody uses this — on a shared tablet in a living room it should
 * start hidden, and on a private phone that would be a nuisance every time.
 */
export const HIDE_AMOUNTS_BY_DEFAULT = 'hide-amounts-by-default';
