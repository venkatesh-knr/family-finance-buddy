/**
 * A thing the page says about its figures that nobody can act on: one muted line with the info mark, and the
 * reasons behind it when there are any.
 *
 * docs/tokens.md section 2: a caveat is never coral, and is amber only while the person can do something about
 * it. A figure that cannot be given because the law is not modelled, or because it is another member's, is neither
 * wrong nor mendable, so it is said quietly and in the same place every time.
 */

import type { ReactNode } from 'react';

export function MutedNote({
  children,
  names,
  namesLabel = 'Show them',
}: {
  children: ReactNode;
  /** The reasons, folded away. */
  names?: readonly string[];
  namesLabel?: string;
}) {
  const hasNames = names !== undefined && names.length > 0;
  return (
    <div className="muted-note">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </svg>
      <div className="min-w-0">
        <span>{children}</span>
        {hasNames && (
          <details>
            <summary className="notice-toggle mt-1.5">
              {namesLabel} ({names.length})
            </summary>
            <ul className="notice-names">
              {names.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
