# Family Finance Buddy — design tokens

Extracted from the prototype. This is the source of truth for colour, type and spacing
across all three shells (web, Tauri desktop, Capacitor mobile). Everything renders from
these tokens — no component may hardcode a colour.

---

## 1. Colour

Three themes states: `light` (bare `:root`), `dark` via `prefers-color-scheme`, and an
explicit `[data-theme]` override so a manual toggle wins in both directions.

```css
:root{
  /* surfaces */
  --bg:#EEF1F5;          /* page ground */
  --surface:#FFFFFF;     /* cards, panels */
  --surface-2:#F6F8FA;   /* table headers, insets, code */
  --surface-3:#EBEFF4;   /* segmented-control track, progress track */

  /* text */
  --ink:#151B24;         /* primary */
  --ink-2:#3D4855;       /* body, secondary */
  --muted:#68758A;       /* captions, labels, axis text */

  /* lines */
  --line:#DCE3EB;        /* hairlines, borders */
  --line-strong:#C3CDD9; /* chip borders, list markers */

  /* brand + semantic */
  --brass:#9A6F14;       --brass-soft:#F4EAD3;   /* accent, targets, "plan" */
  --teal:#0D7466;        --teal-soft:#DDF0EB;    /* gain, positive, "ok" */
  --coral:#B0463A;       --coral-soft:#F9E6E2;   /* loss, overspend, "due" */
  --indigo:#39537F;      --indigo-soft:#E4EBF6;  /* attribution, ownership */

  /* categorical — charts only, in this order */
  --c1:#39537F;  /* indigo   */
  --c2:#0D7466;  /* teal     */
  --c3:#9A6F14;  /* brass    */
  --c4:#7A5A9B;  /* plum     */
  --c5:#B0463A;  /* coral    */
  --c6:#4C7FA6;  /* steel    */
  --c7:#6E7C8C;  /* slate    */

  --shadow:0 1px 2px rgba(21,27,36,.06), 0 10px 26px -18px rgba(21,27,36,.35);
  --radius:10px;
  --radius-pill:100px;
}

@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0B0F14;  --surface:#141B24;  --surface-2:#1A222D;  --surface-3:#212B37;
    --ink:#E7EDF4; --ink-2:#C2CDDA;    --muted:#8D9BAC;
    --line:#26303C; --line-strong:#3A4653;
    --brass:#D9AC4C; --brass-soft:#31270F;
    --teal:#48BBA6;  --teal-soft:#0E2B27;
    --coral:#E08475; --coral-soft:#331815;
    --indigo:#8FAEDC; --indigo-soft:#161E2C;
    --c1:#8FAEDC; --c2:#48BBA6; --c3:#D9AC4C; --c4:#B092CE;
    --c5:#E08475; --c6:#7FB3D0; --c7:#94A3B3;
    --shadow:0 1px 2px rgba(0,0,0,.45), 0 12px 30px -20px rgba(0,0,0,.95);
  }
}

:root[data-theme="dark"]{ /* same block as above, repeated */ }
```

### Rules

- **Never define a colour only inside a media or `[data-theme]` block.** Declare every
  token on bare `:root` first, then redefine. A colour that exists only in one branch is
  the classic unreadable-in-the-other-theme bug.
- **`body` sets an explicit `background` from a token.** A transparent body borrows the
  host's ground.
- Dark is *not* an inversion. Both palettes were tuned separately; keep them that way.

---

## 2. Semantic colour, and the accessibility rule

| Meaning | Token | Also carries |
|---|---|---|
| Gain / positive / on track | `--teal` | `+` sign, ▲ |
| Loss / overspend / due | `--coral` | `−` sign, ▼ |
| Target / plan / attention | `--brass` | text label |
| Ownership / attribution | `--indigo` | the member's name |

**Nothing means anything by colour alone.** Every gain carries a sign or an arrow as well
as a hue — roughly one man in twelve has red-green colour deficiency, and a portfolio
screen that encodes profit and loss only in hue is unreadable to them. This is not
optional polish; it is a correctness requirement.

Contrast meets WCAG AA in both themes: 4.5:1 for body text, 3:1 for large text and for
the boundary of any meaningful shape.

---

## 3. Type

Three faces, three jobs. Load from Google Fonts with real fallback stacks.

```css
--font-display: "Newsreader", Georgia, "Times New Roman", serif;
--font-ui:      "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono:    "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

- **Newsreader** — page and section titles only. Weight 500. Never for UI chrome.
- **Public Sans** — everything interactive and everything read as prose. 400/500/600.
- **IBM Plex Mono** — *every number*, plus uppercase micro-labels. This is the strongest
  single signal that the app is a ledger.

### Scale

| Role | Size | Weight | Face | Notes |
|---|---|---|---|---|
| Hero figure (net worth) | `clamp(32px, 6vw, 48px)` | 600 | mono | `letter-spacing:-.02em` |
| Page title | 22px | 500 | display | `-.01em` |
| Section title (doc) | 25–30px | 500 | display | `text-wrap:balance` |
| Card title | 14.5px | 600 | ui | |
| Body | 15px | 400 | ui | `line-height:1.55` |
| Stat value | 17px | 500 | mono | |
| Table cell | 13.4px | 400 | ui | numbers in mono |
| Caption / note | 11.8–12.5px | 400 | ui | `--muted` |
| Micro-label | 10.5px | 500 | mono | uppercase, `letter-spacing:.13em` |
| Pill / badge | 9.5px | 500 | mono | uppercase, `letter-spacing:.1em` |

### Numerals — non-negotiable

```css
.num, td.n, .mono { font-variant-numeric: tabular-nums; }
```

Every figure in a column must align. Proportional digits in a money table is a bug.

### Text scaling

Respect the OS text size **up to 200%**. No fixed-height container may hold text. Test at
200% before calling any screen done — parents will use this app.

---

## 4. Spacing and shape

An 8px base, with 2px steps where density demands it.

```
4 · 6 · 8 · 10 · 12 · 14 · 18 · 22 · 26 · 34 · 44
```

| Thing | Value |
|---|---|
| Card padding | 18px |
| Card / panel radius | 10px |
| Grid gap between cards | 18px |
| Table cell padding | 9px 10px |
| Pill padding / radius | 3px 9px / 100px |
| Input padding / radius | 7px 10px / 7px |
| Segmented control | 2.5px track pad, 6px inner radius |
| Icon tile radius | 22.6% (iOS squircle approximation) |

**Layout uses flex/grid `gap`, never per-element margins.** Wide content — tables, charts,
code — scrolls inside its own `overflow-x:auto` container so the page body never scrolls
sideways.

**Not everything is a card.** Border, fill, radius and shadow each say "separate object".
Spend them by role. One radius and one shadow stamped on every block flattens the
hierarchy and makes nothing important.

---

## 5. Component tokens

| Component | Spec |
|---|---|
| **Card** | `--surface` on `--line` 1px, radius 10, padding 18. Header row: title 14.5/600 left, muted sub right, 14px margin-bottom. |
| **Stat tile** | Micro-label above, mono value below, gap 3px. Positive `--teal`, negative `--coral`. |
| **Pill** | 9.5px mono uppercase. Variants: `own` (indigo-soft/indigo), `warn` (brass), `due` (coral), `ok` (teal), `neutral` (surface-3/muted). |
| **Table** | Header: `--surface-2`, 10.5px mono uppercase `--muted`, bottom hairline. Rows: hairline separated, last row none. Total row: 1.5px `--line-strong` top border, weight 700. |
| **Segmented control** | `--surface-3` track, active pill `--surface` + weight 600 + 1px shadow. `aria-pressed` drives state. |
| **Bar / progress** | 6–9px height, radius 3, `--surface-3` track. Over-target bars flip to `--coral`. |
| **Quick-add** | Amount input in mono, 110px wide. Primary button `--brass` with light text. |
| **Focus ring** | `2px solid var(--brass)`, `outline-offset:2px`. Visible on every interactive element. |

---

## 6. Charts

- Colours come from `--c1…--c7` **in order**, so the same class gets the same colour on
  every screen.
- Chart text uses `--muted` for axes and `--ink` for value callouts — always tokens, never
  literals, or the chart breaks in one theme.
- Every axis label names a value the chart actually reaches.
- In SVG, leave room in the `viewBox` for outermost labels and give every drawn shape an
  explicit `fill`.
- Donuts: 82px outer / 52px inner on a 208 grid, ~0.018rad gap between arcs.
- Lines: 2.2–2.4px stroke, area fill at 14% opacity, endpoint marked with a 4px dot and a
  mono label.

---

## 7. Motion

Minimal and purposeful. Toast fades at 250ms. State changes are instant — a net worth
figure must never animate while being read.

```css
@media (prefers-reduced-motion: reduce){ *{ animation:none!important; transition:none!important } }
```

---

## 8. Privacy mode

When engaged, every **amount** renders as `₹•••••` while percentages, dates, labels and
chart *shapes* stay visible. Implement as a formatter switch, not a CSS blur — a blur is
recoverable from a screenshot and this needs to survive one.

---

## 9. Tailwind mapping

Map tokens rather than duplicating hex values, so there is exactly one place to change a
colour.

```js
// tailwind.config — theme.extend
colors: {
  bg:'var(--bg)', surface:'var(--surface)', 's2':'var(--surface-2)', 's3':'var(--surface-3)',
  ink:'var(--ink)', 'ink-2':'var(--ink-2)', muted:'var(--muted)',
  line:'var(--line)', 'line-strong':'var(--line-strong)',
  brass:'var(--brass)', 'brass-soft':'var(--brass-soft)',
  teal:'var(--teal)',  'teal-soft':'var(--teal-soft)',
  coral:'var(--coral)','coral-soft':'var(--coral-soft)',
  indigo:'var(--indigo)','indigo-soft':'var(--indigo-soft)',
},
fontFamily: {
  display:['Newsreader','Georgia','serif'],
  sans:['Public Sans','system-ui','sans-serif'],
  mono:['IBM Plex Mono','ui-monospace','monospace'],
},
borderRadius: { DEFAULT:'10px', pill:'100px' },
```
