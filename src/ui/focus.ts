/**
 * Taking somebody to a form they just opened.
 *
 * An editor that opens somewhere other than under the finger that opened it is
 * an editor nobody notices: the button they pressed stays focused, nothing on
 * the screen moves, and it looks as though the press did nothing. So a form
 * that appears in answer to a press puts the caret in its first field and
 * scrolls itself into view — which also tells a screen reader where it went.
 *
 * Put the returned ref on the form's outermost element.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export function useFocusFirstField<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const form = ref.current;
    if (form === null) return;
    form.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
    // Nearest, not centre: a form already on screen should not jump, and one
    // above or below should come only as far as it has to.
    form.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);
  return ref;
}
