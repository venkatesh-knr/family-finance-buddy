/**
 * The one chevron: it points right, and a disclosure turns it a quarter to point down (docs/design/
 * vibrant-canvas.html, "one arrow, one chevron, one info mark"). Stroked like every other glyph, so it
 * takes its colour and its size from the text beside it. Decorative: the control it sits in is named.
 */
export function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/**
 * Shared primitives, built on docs/tokens.md.
 *
 * Small on purpose. A walking skeleton needs a card, a field, a button and a
 * pill; everything else can wait until a second screen asks for it.
 */

import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { formatMoneyParts, type FormatMoneyOptions, type Money } from '../lib/money.ts';

export function Card({
  title,
  aside,
  collapsible = false,
  defaultOpen = true,
  summary,
  lift = false,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  /**
   * The one lifted surface on this screen: the figure the screen is about. A second on the
   * same screen is two things claiming to be the most important, so a screen passes this
   * once (docs/tokens.md §1, Depth).
   */
  lift?: boolean;
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
    <section className={lift ? 'card card-lift' : 'card'}>
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
                <Chevron />
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

/**
 * A labelled input.
 *
 * The label is a real `<label htmlFor>` and the input has the matching `id`, and
 * the two are siblings rather than the input sitting inside the label. Wrapping
 * worked in a browser and not everywhere that reads the page: a tool that names a
 * control from its label, a screen reader, an end-to-end test, all fell back to
 * the placeholder ("0.00", "Optional") when they did not follow the implicit
 * association. And with the hint inside the label, the hint became part of the
 * name. The hint is now `aria-describedby`, which is what a description is.
 *
 * An `id` passed in is kept; otherwise one is made. Colons are stripped from it
 * because `:r1:` is a valid id and an awkward selector.
 */
export function Field({
  label,
  hint,
  numeric = false,
  id,
  'aria-describedby': describedBy,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; numeric?: boolean }) {
  // Always called, so the order of hooks does not depend on whether an id was passed.
  const generated = useId().replace(/:/g, '');
  const inputId = id ?? `field${generated}`;
  const hintId = `${inputId}-hint`;
  const described = [describedBy, hint === undefined ? undefined : hintId].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label className="label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={numeric ? 'field field-num' : 'field'}
        aria-describedby={described === '' ? undefined : described}
        {...props}
      />
      {hint !== undefined && (
        <span className="note" id={hintId}>
          {hint}
        </span>
      )}
    </div>
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
  id,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; hint?: string }) {
  const [revealed, setRevealed] = useState(false);
  const generated = useId().replace(/:/g, '');
  const inputId = id ?? `field${generated}`;
  const hintId = `${inputId}-hint`;

  return (
    // A div, with the label beside the input and not around it: the reveal button
    // is inside this block, and a button inside a label is announced as part of
    // the field's name ("Password Show password"). See Field.
    <div className="flex flex-col gap-1.5">
      <label className="label" htmlFor={inputId}>
        {label}
      </label>

      <span className="relative flex items-center">
        <input
          id={inputId}
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
    </div>
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
 * A pencil, drawn like the eye: sized in `em` so it grows with the text around it.
 */
export function PencilIcon() {
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
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m14.5 7.5 3 3" />
    </svg>
  );
}

/**
 * The control that opens an editor: a pencil, with the words where they belong,
 * in the accessible name and the tooltip.
 *
 * It replaced an underlined word that said "Correct" on every row. A word
 * repeated down a list is noise, and "Correct" read as though the row were
 * wrong. The name says what will be edited, because thirteen buttons all called
 * "Edit" are unusable with a screen reader. `expanded` is for one that toggles
 * an editor open beside it.
 */
export function EditButton({
  label,
  expanded,
  onClick,
}: {
  /** What it will edit: "Edit Reliance Fresh, 14 Sept". */
  label: string;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="icon-action"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <PencilIcon />
    </button>
  );
}

/**
 * The action on an editable row that should be reversible but not casual: archive, or bring back. An
 * icon, and not an underlined word, so that a screen of rows is not a screen of links; its name is the
 * label, which says what it acts on ("Archive Groceries"), and the same text is the tooltip.
 *
 * A 44px button around a 34px face: the picture is small, the thing to hit is not (`.row-action`).
 */
export function RowAction({
  label,
  icon,
  onClick,
  disabled = false,
  expanded,
}: {
  label: string;
  icon: 'archive' | 'restore' | 'edit';
  onClick: () => void;
  disabled?: boolean;
  /** Set when the action opens something beside it, as editing a holding does. */
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className="row-action"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span className="row-action-face" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon === 'archive' ? (
            <>
              <rect x="3" y="4" width="18" height="5" rx="1.5" />
              <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
              <path d="M10 13h4" />
            </>
          ) : icon === 'restore' ? (
            <>
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </>
          ) : (
            <>
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              <path d="m15 5 4 4" />
            </>
          )}
        </svg>
      </span>
    </button>
  );
}

/**
 * The control that only reveals: what it opens, in words, and a chevron that turns a quarter when it is
 * open. A disclosure and not a link, because it does not go anywhere and changes nothing.
 */
export function Disclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="disclosure" aria-expanded={open} onClick={onToggle}>
      {children}
      <span className="disclosure-chevron" aria-hidden="true">
        <Chevron />
      </span>
    </button>
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
      <dt className="label">{label}</dt>
      <dd className={tone === 'gain' ? 'v pos' : tone === 'loss' ? 'v neg' : 'v'}>{children}</dd>
    </div>
  );
}

/**
 * A figure with its magnitude suffix set as a unit (docs/tokens.md §3).
 *
 * `₹5.3 L` as a single string leaves the L wherever the typeface puts the
 * space, and in a wide face that is a gap between the unit and the figure it
 * belongs to. Here the suffix is a span: smaller, muted, and welded on. The
 * currency symbol stays at the figure's size, and a figure shown whole, or
 * hidden by privacy, has no unit and renders as plain text.
 *
 * For figures in the page. Text that cannot hold a span — an `aria-label`, a
 * `title`, SVG text — still takes the string from `formatMoney`.
 */
export function Amount({
  value,
  ...options
}: { value: Money } & FormatMoneyOptions): React.JSX.Element {
  const { figure, unit } = formatMoneyParts(value, options);
  return (
    <>
      {figure}
      {unit !== null && <span className="amount-unit">{unit}</span>}
    </>
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
      {/*
        The mark is what stops this meaning anything by colour alone — and it is
        not a triangle. A triangle is the gain arrow (docs/tokens.md §2), and a
        panel that says something is wrong must not borrow the shape that says a
        figure is up.
      */}
      <span className="notice-mark" aria-hidden="true">
        !
      </span>
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
 * One item in a list of things that want attention: a line, and the rest behind it.
 *
 * A stack of full-width tinted panels, each carrying a paragraph, is triage
 * that has not been done: every item at the same weight says nothing is more
 * urgent than anything else, and the screen closes on what looks like an
 * incident report. So an item is one line, the count and what follows from it
 * in a clause, and the explanation and the names are behind it.
 *
 * Two weights, and only two. `gap` sits on a quiet surface with a brass mark,
 * for something unplanned. `due` is coral and is reserved for the item that
 * cannot be put right later. A native <details>, for the reasons `Notice` gives.
 */
export function Attention({
  tone = 'gap',
  headline,
  children,
  names,
  namesLabel = 'Show them',
}: {
  tone?: NoticeTone;
  /** The count and the consequence, as a clause. Always visible. */
  headline: ReactNode;
  /** The rest: why it matters and what to do. Behind the line. */
  children?: ReactNode;
  names?: readonly string[];
  namesLabel?: string;
}) {
  const hasNames = names !== undefined && names.length > 0;
  return (
    <details className={`attention text-caption ${tone === 'due' ? 'attention-due' : 'attention-gap'}`}>
      <summary className="attention-line">
        <span className="notice-mark" aria-hidden="true">
          !
        </span>
        <span className="min-w-0">{headline}</span>
        <span className="attention-chevron" aria-hidden="true">
          <Chevron />
        </span>
      </summary>
      <div className="attention-body">
        {children !== undefined && <div>{children}</div>}
        {hasNames && (
          <>
            <div className="mt-1.5">
              {namesLabel} ({names.length})
            </div>
            <ul className="notice-names">
              {names.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
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
 * `warn` is a figure that is actually wrong or incomplete — a peak below the
 * true one, a cost that covers part of the units. `info` is something worth
 * knowing about a figure that is right.
 *
 * Neither borrows the signals that mean direction of money. Coral and teal are
 * a loss and a gain, and ▲ ▼ are their arrows (docs/tokens.md §2): a marker
 * that used them told somebody that a position was down when it was merely
 * incompletely valued, with the shape and the colour agreeing on something
 * false. So the marker is a circle in either case — a quiet `i` in `--muted`,
 * and a `!` in `--brass`, the attention colour, for the one that matters. They
 * differ by glyph as well as by hue.
 */
export function Caveat({
  tone = 'info',
  label,
  children,
}: {
  tone?: 'warn' | 'info';
  /** What the marker means, and the heading of the panel it opens. */
  label: string;
  children: ReactNode;
}) {
  const panelId = useId().replace(/:/g, '');

  return (
    <>
      <button
        type="button"
        className={`caveat-mark ${tone === 'warn' ? 'caveat-warn' : 'caveat-info'}`}
        aria-label={label}
        popoverTarget={panelId}
      >
        <span aria-hidden="true">{tone === 'warn' ? '!' : 'i'}</span>
      </button>

      {/*
        The native popover, which is the whole reason this stopped rendering as
        one word per line in capitals.
        
        It used to be an ordinary span inside the label it belonged to, and it
        inherited everything a label is: uppercase, 0.13em letter spacing, the
        mono face — and, worse, the width of whatever narrow flex column the
        label was sitting in. A 116px column made a sentence into a vertical
        strip of shouted words.
        
        A popover renders in the top layer. It escapes the column, escapes any
        overflow clipping, and brings light dismiss and Escape for nothing. The
        typography is reset explicitly rather than hopefully, because the
        element is still a descendant in the cascade even when it is not one on
        the screen.
      */}
      <div id={panelId} popover="auto" className={`caveat-panel ${tone === 'warn' ? 'caveat-warn' : 'caveat-info'}`}>
        <p className="caveat-panel-title">{label}</p>
        <div className="caveat-panel-body">{children}</div>
        <button type="button" className="caveat-close" popoverTarget={panelId} popoverTargetAction="hide">
          Close
        </button>
      </div>
    </>
  );
}

/**
 * A figure that is deliberately not given, and the reason it is not.
 *
 * The app is careful to refuse a number it cannot stand behind — a gain
 * measured against a cost that covers a tenth of the units, a total that would
 * be short by a currency. It used to say so by printing the words "not shown" in
 * the slot where the figure goes, in the mono face, beside a marker. That read as
 * a failed render rather than as a decision: a sentence fragment in a number's
 * place looks like the number did not load.
 *
 * A dash says "deliberately absent" in a way words in that slot do not, and the
 * marker beside it carries the explanation. It takes the size and weight of the
 * figure it stands for, so the row does not change shape.
 *
 * A dash alone would announce nothing, or "dash", so it is given a name: a
 * screen reader hears "not shown", and then the marker's own label says why.
 * `warn` by default, because a refused figure is a qualified one; `info` where
 * the absence is simply how things are.
 */
export function Absent({
  label,
  tone = 'warn',
  children,
}: {
  /** What the marker means, and the heading of the panel it opens. */
  label: string;
  tone?: 'warn' | 'info';
  /** Why the figure is not given. */
  children: ReactNode;
}) {
  return (
    <>
      <span className="absent" role="img" aria-label="not shown">
        —
      </span>
      <Caveat tone={tone} label={label}>
        {children}
      </Caveat>
    </>
  );
}

/**
 * A word that sits beside a figure — "of", "at", "units", "holdings", "left".
 *
 * docs/tokens.md §3 gives mono to figures in a column and to the table header,
 * and Public Sans to everything read as prose. Mono is the ledger signal
 * precisely because it is reserved for figures; a word set in it spends the
 * signal, and reads as terminal output. But a word placed inside a figure's
 * element inherits the figure's face, so "of ₹1,25,000" came out entirely in
 * mono. This is the word, in the face a word takes, at the size and colour of a
 * note. The figure beside it stays mono and tabular.
 */
export function Unit({ children, inherit = false }: { children: ReactNode; inherit?: boolean }) {
  // `inherit` for a word that must take its surroundings' colour — an overspend
  // is coral, and "over by" is part of what is coral about it.
  return <span className={inherit ? 'unit unit-inherit' : 'unit'}>{children}</span>;
}

/**
 * A figure with its word: "of ₹1,25,000", "at 12.5%".
 *
 * The pattern repeated wherever a figure was qualified, and each copy set the
 * whole thing in mono. The word is in the face a word takes and the figure stays
 * mono and tabular, at the size of a note.
 */
export function Qualifier({ word, children }: { word: string; children: ReactNode }) {
  return (
    <span className="note">
      <Unit>{word}</Unit> <span className="tabular-nums">{children}</span>
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
      <span className="notice-mark" aria-hidden="true">
        !
      </span>
      <span>{children}</span>
    </p>
  );
}
