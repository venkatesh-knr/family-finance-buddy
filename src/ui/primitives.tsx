/**
 * Shared primitives, built on docs/tokens.md.
 *
 * Small on purpose. A walking skeleton needs a card, a field, a button and a
 * pill; everything else can wait until a second screen asks for it.
 */

import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Card({
  title,
  aside,
  collapsible = false,
  defaultOpen = true,
  summary,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  /**
   * Whether the card can be folded away.
   *
   * Long lists — three dozen categories, a decade of projections — make a
   * screen that has to be scrolled past rather than read. Folding is not a
   * decoration on those; it is what lets the cards above and below them stay
   * reachable.
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Shown in place of the content when folded, so the card still says something. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;

  return (
    <section className="card">
      {title !== undefined && (
        <header className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
          {collapsible ? (
            <button
              type="button"
              className="card-title flex items-center gap-2 font-sans"
              aria-expanded={open}
              onClick={() => {
                setOpen((was) => !was);
              }}
              style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--ink)' }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  transition: 'transform 120ms',
                  transform: open ? 'rotate(90deg)' : 'none',
                  color: 'var(--muted)',
                }}
              >
                ▸
              </span>
              {title}
            </button>
          ) : (
            <h2 className="card-title font-sans">{title}</h2>
          )}
          {aside}
        </header>
      )}
      {shown ? children : <div className="note">{summary}</div>}
    </section>
  );
}

export function Field({
  label,
  hint,
  numeric = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; numeric?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="micro-label">{label}</span>
      <input className={numeric ? 'field field-num' : 'field'} {...props} />
      {hint !== undefined && <span className="note">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  return (
    <button className={variant === 'primary' ? 'btn btn-primary' : 'btn btn-quiet'} {...props}>
      {children}
    </button>
  );
}

/**
 * A password field with a reveal control.
 *
 * Worth having: this app demands a password and then an authenticator code, and
 * a typo caught only after the second step costs a wasted code and a fresh
 * thirty-second wait. Hidden by default, and it never persists — a reload, or
 * arriving back at this screen, always starts concealed.
 */
export function PasswordField({
  label,
  hint,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; hint?: string }) {
  const [revealed, setRevealed] = useState(false);
  const hintId = useId();

  return (
    <label className="flex flex-col gap-1.5">
      <span className="micro-label">{label}</span>

      <span className="relative flex items-center">
        <input
          className="field pr-11"
          type={revealed ? 'text' : 'password'}
          aria-describedby={hint === undefined ? undefined : hintId}
          {...props}
        />
        <button
          type="button"
          // Not a submit button: inside a form, a bare <button> submits it, and
          // revealing the password would post the form instead.
          className="absolute right-1 flex items-center rounded p-2"
          style={{ color: 'var(--muted)' }}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          title={revealed ? 'Hide password' : 'Show password'}
          onClick={() => {
            setRevealed((on) => !on);
          }}
        >
          <EyeIcon crossed={revealed} />
        </button>
      </span>

      {hint !== undefined && (
        <span className="note" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * Drawn inline rather than pulled from an icon set: two paths do not justify a
 * dependency, and `currentColor` means it follows the token in either theme.
 */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
      {crossed && <path d="M4 20 20 4" />}
    </svg>
  );
}

export type PillTone = 'own' | 'ok' | 'due' | 'neutral';

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/**
 * An error worth reading. Carries a word as well as a hue — nothing in this app
 * means anything by colour alone.
 */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded border px-2.5 py-2 text-caption"
      style={{
        background: 'var(--coral-soft)',
        borderColor: 'var(--coral)',
        color: 'var(--coral)',
      }}
    >
      <span aria-hidden="true">▲</span>
      <span>{children}</span>
    </p>
  );
}
