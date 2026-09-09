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
          <EyeIcon crossed={!revealed} />
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
 *
 * `crossed` is the *state*, not the action — a struck eye means the thing is
 * hidden right now. That reading has to be the same everywhere the glyph
 * appears, or the same picture means opposite things two screens apart.
 *
 * Sized in `em` rather than pixels so it grows with the text around it. A
 * 17px icon beside 200%-scaled words is the sort of detail that only shows up
 * on somebody else's device.
 */
export function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="1.15em"
      height="1.15em"
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

/**
 * Five, as docs/tokens.md:179 defines them. `warn` was missing until Settings
 * needed it — brass, for something worth noticing that is not yet wrong.
 * Coral is spent on wrong.
 */
export type PillTone = 'own' | 'ok' | 'warn' | 'due' | 'neutral';

/**
 * Tone classes written out in full, never assembled.
 *
 * Tailwind decides what to keep by scanning the source for literal class
 * names, so a class built as `pill-${tone}` is a class it never sees — and
 * every one of these rules was being dropped from the production stylesheet.
 * Pills shipped with the base style and no colour at all. Nothing in the type
 * system or the tests could catch it: the CSS is correct, the component is
 * correct, and the class simply is not in the built file.
 *
 * A lookup keyed by the same union is the cheapest fix that cannot rot — add a
 * tone and the compiler demands its class here, where the scanner will read it.
 */
const PILL_CLASS: Record<PillTone, string> = {
  own: 'pill-own',
  ok: 'pill-ok',
  warn: 'pill-warn',
  due: 'pill-due',
  neutral: 'pill-neutral',
};

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill ${PILL_CLASS[tone]}`}>{children}</span>;
}

/**
 * A figure with a label over it (docs/tokens.md §5).
 *
 * Three screens hand-rolled this before it was a primitive, and the label
 * ended up three slightly different sizes. `tone` is not decoration: a change
 * that matters is signed as well as coloured, because "never encode meaning in
 * colour alone" and a green number is nothing to somebody who cannot see green.
 *
 * Renders a dt/dd pair, so it belongs inside a <dl>.
 */
export function Stat({
  label,
  children,
  tone = 'plain',
}: {
  label: string;
  children: ReactNode;
  /** `plain` for a quantity; gain and loss for a figure that moved. */
  tone?: 'plain' | 'gain' | 'loss';
}) {
  // dt/dd inside a wrapping div, which HTML5 allows and which keeps the label
  // and its figure explicitly paired for a screen reader. Belongs inside a
  // <dl>; a bare div would look identical and say less.
  return (
    <div className="stat">
      <dt className="micro-label">{label}</dt>
      <dd className={tone === 'gain' ? 'v pos' : tone === 'loss' ? 'v neg' : 'v'}>{children}</dd>
    </div>
  );
}

/**
 * A bar against a target.
 *
 * Past the target it turns coral and stops growing, because a full bar and an
 * overflowing one must not look the same — the overflow is the whole news.
 * `label` is required and not optional: a bar with no accessible name is a
 * decoration that screen readers announce as nothing.
 */
export function Bar({
  value,
  target,
  label,
  colour,
}: {
  value: number;
  target: number;
  label: string;
  /** A token name for a segment that is not measured against a target. */
  colour?: string;
}) {
  const over = target > 0 && value > target;
  const pct = target <= 0 ? 0 : Math.min(100, (value / target) * 100);

  return (
    <div
      className="track"
      role="img"
      aria-label={
        target > 0
          ? `${label}: ${String(Math.round((value / target) * 100))}% of target${over ? ', over' : ''}`
          : label
      }
    >
      <i
        style={{
          width: `${String(pct)}%`,
          background: colour ?? (over ? 'var(--coral)' : 'var(--teal)'),
        }}
      />
    </div>
  );
}

/**
 * A change against a previous figure.
 *
 * The arrow carries the direction and the colour agrees with it. `flat` is a
 * real state and looks like neither: no change is not a small gain.
 */
type DeltaDirection = 'up' | 'down' | 'flat';

/**
 * Written out, for the reason PILL_CLASS is. I assembled this one as
 * `delta-${direction}` and the class guard failed the build on the same day —
 * which is the whole argument for the guard existing.
 */
const DELTA_CLASS: Record<DeltaDirection, string> = {
  up: 'delta-up',
  down: 'delta-down',
  flat: 'delta-flat',
};

export function Delta({
  direction,
  children,
}: {
  direction: DeltaDirection;
  children: ReactNode;
}) {
  const glyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—';
  return (
    <span className={`delta ${DELTA_CLASS[direction]}`}>
      <span aria-hidden="true">{glyph}</span>
      <span>{children}</span>
    </span>
  );
}

/**
 * A table that scrolls inside itself.
 *
 * Two screens repeat their own header cell and their own wrapper; this is
 * those, once. The wrapper is the point as much as the styling — wide content
 * scrolls in its own container so the page body never scrolls sideways.
 */
export function Table({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

/**
 * A caveat on a figure, with its reasons folded away.
 *
 * Two of these existed already and both had the same fault: the sentence that
 * qualifies the number was buried under the list of reasons for it. Thirty-five
 * category names, set in the mono face and coloured like a failure, pushed the
 * figure they were about off the screen — so the caveat was least readable
 * exactly when it applied to most things.
 *
 * The split is by what each part is for. The sentence changes what you believe
 * about the number and is always shown. The names are what you go looking for
 * once you have decided to act, and are one click away.
 *
 * A native <details> rather than a hand-rolled toggle: it is keyboard
 * reachable, it announces its own state, and it survives find-in-page, which a
 * div listening for clicks does not.
 */
type NoticeTone = 'gap' | 'due';

/** Written out for the same reason as PILL_CLASS above: the scanner reads source, not intent. */
const NOTICE_CLASS: Record<NoticeTone, string> = {
  gap: 'notice-gap',
  due: 'notice-due',
};

export function Notice({
  tone = 'gap',
  children,
  names,
  namesLabel = 'Show them',
}: {
  /** `gap` for something unplanned, `due` for a figure that is actually wrong. */
  tone?: NoticeTone;
  /** The sentence. Always visible, because it is the part that qualifies the number. */
  children: ReactNode;
  /** The reasons, folded away. Omit for a caveat that has nothing to enumerate. */
  names?: readonly string[];
  namesLabel?: string;
}) {
  const hasNames = names !== undefined && names.length > 0;

  return (
    <div className={`notice ${NOTICE_CLASS[tone]} text-caption`}>
      {/* The glyph is what stops this meaning anything by colour alone. */}
      <span aria-hidden="true">▲</span>
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

/**
 * A caveat that travels with the number it qualifies.
 *
 * The screens had grown a block of prose under every figure. Each sentence
 * earned its place once and none of them earn it fifteen times on one screen:
 * a wall of coloured paragraphs is read as decoration, and the one that
 * actually mattered goes down with the rest.
 *
 * So the sentence folds behind a marker sitting immediately after the figure.
 * Three things that has to get right, and they are the reason this is a
 * primitive rather than a `title` attribute:
 *
 *   It opens on tap. A hover tooltip does not exist on a phone, and this app
 *   is used on one.
 *
 *   The trigger says what it is. An icon alone announces nothing, so the
 *   button carries a real label and `aria-expanded`, and the panel is
 *   associated with it.
 *
 *   The marker is visible before it is opened. That is the whole point of
 *   attaching it to the figure: a number wearing one is visibly not a plain
 *   number, so somebody who never taps still knows not to read it as clean.
 *   Hiding a caveat behind an icon nobody notices would leave a false figure
 *   looking tidy, which is worse than the clutter it replaced.
 *
 * `warn` is a figure that is actually wrong — a peak below the true one.
 * `info` is something worth knowing about a figure that is right. The shapes
 * differ, not only the hue: "never encode meaning in colour alone".
 */
export function Caveat({
  tone = 'info',
  label,
  children,
}: {
  tone?: 'warn' | 'info';
  /** What the marker means, for anybody who cannot see the shape. */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <span className="caveat-wrap">
      <button
        type="button"
        className={`caveat-mark ${tone === 'warn' ? 'caveat-warn' : 'caveat-info'}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? `${label} — hide` : label}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <span aria-hidden="true">{tone === 'warn' ? '▲' : 'i'}</span>
      </button>

      {/*
        Hidden rather than unmounted, so the panel the button points at exists
        for assistive technology whether or not it is on screen.
      */}
      <span id={panelId} className="caveat-panel text-caption" hidden={!open}>
        {children}
      </span>
    </span>
  );
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
