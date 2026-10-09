/**
 * A long list that shows ten and gives the rest as it is scrolled to.
 *
 * Thirty-five expenses, or fifty entries of the activity log, made a card taller
 * than the screen it sat on, and the cards below it unreachable without a long
 * scroll past rows nobody was looking at. Ten is a screenful on a phone.
 *
 * Scrolling reveals more, as asked, but the button is the real control: an
 * observer fires on its own timing, a keyboard user and a screen reader never
 * scroll to it, and a person who has reduced motion does not want a list that
 * grows underneath them. So the button always works, and the scroll is a
 * convenience on top of it.
 */

import { useEffect, useRef, useState } from 'react';

export const REVEAL_STEP = 10;

export function useReveal(total: number, step = REVEAL_STEP) {
  const [count, setCount] = useState(step);
  const shown = Math.min(count, total);
  return {
    shown,
    hidden: total - shown,
    more: () => {
      setCount((current) => current + step);
    },
  };
}

export function ShowMore({
  hidden,
  step = REVEAL_STEP,
  onMore,
  noun,
}: {
  hidden: number;
  step?: number;
  onMore: () => void;
  /** What the rows are, in the plural: "expenses". */
  noun: string;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  // Held in a ref so a re-render does not tear the observer down and put it back,
  // which would fire it again for a sentinel that has not moved.
  const latest = useRef(onMore);
  latest.current = onMore;

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || typeof IntersectionObserver === 'undefined') return undefined;
    // Re-created for each batch: an observer reports changes, and a sentinel
    // that is still on screen after a batch has not changed, so it would never
    // ask for the next one. Starting afresh asks again; the batch is ten rows,
    // which pushes it off the screen on anything but a very tall window.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: '120px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hidden]);

  if (hidden <= 0) return null;

  return (
    <div ref={sentinel} className="mt-3 flex flex-wrap items-center gap-3">
      <button type="button" className="btn btn-quiet" onClick={onMore}>
        Show {Math.min(step, hidden)} more
      </button>
      <span className="note">
        {hidden} more {noun}
      </span>
    </div>
  );
}
