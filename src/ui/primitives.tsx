/**
 * Shared primitives, built on docs/tokens.md.
 *
 * Small on purpose. A walking skeleton needs a card, a field, a button and a
 * pill; everything else can wait until a second screen asks for it.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Card({
  title,
  aside,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title !== undefined && (
        <header className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="card-title font-sans">{title}</h2>
          {aside}
        </header>
      )}
      {children}
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
