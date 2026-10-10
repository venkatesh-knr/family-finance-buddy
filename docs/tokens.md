# Family Finance Buddy — design tokens

Extracted from the prototype. This is the source of truth for colour, type and spacing
across all three shells (web, Tauri desktop, Capacitor mobile). Everything renders from
these tokens — no component may hardcode a colour.

---

## 1. Colour

Three theme states: `light` (bare `:root`), `dark` via `prefers-color-scheme`, and an
explicit `[data-theme]` override so a manual toggle wins in both directions.

**The names do not change; the values do.** `--brass` is now a gold, `--teal` an
emerald, `--indigo` a periwinkle. Renaming them would mean touching every component
that spends them, for no gain — the point of a token is that its meaning is stable
while its colour is not. Only genuinely new ideas get new names, and there are five:
`--surface-lift`, `--lift-edge`, `--shadow-lift`, `--gutter` and `--inset`.

```css
:root{
  /* surfaces */
  --bg:#EFF2F7;          /* page ground */
  --surface:#FFFFFF;     /* cards, panels */
  --surface-2:#F5F7FB;   /* table headers, insets, code */
  --surface-3:#E8EDF5;   /* segmented-control track, progress track */
  --inset:#EDF1F7;       /* the ground of an editable row: darker than its card, in both themes */

  /* text */
  --ink:#111722;         /* primary */
  --ink-2:#39424F;       /* body, secondary */
  --muted:#616A78;       /* captions, labels, axis text — NEUTRAL, see rules */

  /* lines */
  --line:#DFE5EE;        /* hairlines, borders */
  --line-strong:#808996; /* control outlines, chip edges — 3:1, see §2 */

  /* brand + semantic */
  --brass:#916500;       --brass-soft:#FFF2D4;   /* accent, targets, "plan" */
  --teal:#077964;        --teal-soft:#D8F5ED;    /* gain, positive, "ok" */
  --coral:#BB3D2D;       --coral-soft:#FFE6E2;   /* loss, overspend, "due" */
  --indigo:#3D5BD9;      --indigo-soft:#E6EBFF;  /* attribution, ownership */

  /* categorical — charts only, in this order */
  --c1:#3D5BD9;  /* periwinkle */
  --c2:#077964;  /* emerald    */
  --c3:#916500;  /* gold       */
  --c4:#7A3FBF;  /* plum       */
  --c5:#BB3D2D;  /* coral      */
  --c6:#0E7490;  /* cyan       */
  --c7:#B45309;  /* amber      */

  /* depth */
  --surface-lift:radial-gradient(120% 140% at 8% 0%, #FFFFFF 0%, #F7F9FD 48%, #FFFFFF 100%);
  --lift-edge:linear-gradient(90deg, rgba(154,107,0,0), rgba(154,107,0,.35), rgba(61,91,217,.22), rgba(154,107,0,0));
  --shadow:0 1px 2px rgba(17,23,34,.06), 0 10px 26px -18px rgba(17,23,34,.35);
  --shadow-lift:0 2px 4px rgba(17,23,34,.05), 0 18px 38px -24px rgba(17,23,34,.45);

  --radius:12px;
  --radius-pill:100px;
  --gutter:12px;         /* page side gutter on a phone */
}

@media (min-width: 480px){ :root{ --gutter:18px } }

@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#080B12;  --surface:#121825;  --surface-2:#1A2234;  --surface-3:#222C41;
    --inset:#0E1522;
    --ink:#EEF3FB; --ink-2:#C3CEDF;    --muted:#9AA3B2;
    --line:#222C41; --line-strong:#6D7683;
    --brass:#F0B429; --brass-soft:#3A2C0C;
    --teal:#2ED3A8;  --teal-soft:#0C2F28;
    --coral:#FF6F61; --coral-soft:#33130F;
    --indigo:#7B9CFF; --indigo-soft:#182448;
    --c1:#7B9CFF; --c2:#2ED3A8; --c3:#F0B429; --c4:#B07CF0;
    --c5:#FF6F61; --c6:#46C5E8; --c7:#FF9D4D;
    --surface-lift:radial-gradient(120% 140% at 8% 0%, #26324C 0%, #141C2B 48%, #121825 100%);
    --lift-edge:linear-gradient(90deg, rgba(240,180,41,0), rgba(240,180,41,.55), rgba(123,156,255,.35), rgba(240,180,41,0));
    --shadow:0 1px 2px rgba(0,0,0,.45), 0 12px 30px -20px rgba(0,0,0,.95);
    --shadow-lift:0 2px 6px rgba(0,0,0,.5), 0 18px 38px -24px rgba(0,0,0,.9);
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
  The dark accents are the saturated ones; their light counterparts are darkened to hold
  4.5:1 on white and are not the same hex.
- **A light accent is tuned against the ground it is drawn on, not only against white.**
  Each passes 4.5:1 on white, and that was never the problem: text is also set on the
  soft fills (a pill, an attention row), on `--bg`, and on `--surface-3` (an unselected
  tab), and those are where the first light values fell to 4.2–4.5. So an accent holds
  4.5:1 on its own `-soft`, and `--muted` on `--bg` and `--surface-3`. The fix for a
  failing pair is to darken the light accent, not to relax the threshold; the threshold
  is `tests/e2e/theme.spec.ts`.
- **`--muted` is a neutral grey, not a blue-grey.** It was `#68758A` and `#8D9BAC`, close
  enough to the link colour that on Settings and Tax nearly every description line read
  as pressable. Prose is grey; blue is for things you can press. Raising the accent's
  saturation makes this worse, not better, so the two moved together.

### Depth — three surfaces, spent by role

| Surface | What it is | Where |
|---|---|---|
| `--surface` | flat, hairline border, `--shadow` | most of the app |
| `--surface-lift` | corner-lit gradient, `--shadow-lift`, 1px `--lift-edge` on top | **one per screen** |
| `--surface-2` | a step off its parent, no shadow | table headers, code, a quiet surface |
| `--inset` | recessed: darker than its card in both themes, no shadow | an editable row, which is a record and the inputs that change it on one line |

The gradient is a **corner light, not a wash**: it never crosses a figure, and tabular
numerals always sit on flat ground. One lifted surface per screen — a second one is two
things claiming to be the most important, which is §4's "not everything is a card" in
another form.

---

## 2. Semantic colour, and the accessibility rule

| Meaning | Token | Also carries |
|---|---|---|
| Gain / positive / on track | `--teal` | `+` sign, ▲ |
| Loss / overspend / due | `--coral` | `−` sign, ▼ |
| Target / plan / attention | `--brass` | text label |
| Ownership / attribution | `--indigo` | the member's name |
| Incomplete, unknown, caveated | `--muted` | the ⓘ mark |

**Nothing means anything by colour alone.** Every gain carries a sign or an arrow as well
as a hue — roughly one man in twelve has red-green colour deficiency, and a portfolio
screen that encodes profit and loss only in hue is unreadable to them. This is not
optional polish; it is a correctness requirement, and it matters *more* at this
saturation, not less: a brighter coral is more tempting to rely on alone.

**A caveat is never coral and never a triangle.** Coral and teal mean direction of money.
A figure that is incomplete rather than falling takes the muted ⓘ — the mistake this
palette inherited was a coral ▲ sitting in the same column as a teal ▲, which made an
incompletely-valued holding read as a losing one.

Contrast meets WCAG AA in both themes: 4.5:1 for body text, 3:1 for large text.

**Borders split in two, and only one of them has a ratio.** A hairline that merely
separates — a card edge, a row rule, a table divider — is decorative: the grouping is
already carried by position and spacing, and holding it to 3:1 would mean drawing the
app in boxes nobody asked for. `--line` is free to be quiet.

A border that is the *only* thing telling you something is there must reach 3:1 against
what sits behind it: an input's outline, a chip's edge, a segmented control's active
pill, and the focus ring above all. `--line-strong` is the token those use, and it is
the one to check. It was `#C6CFDC`, 1.57:1 on white: fine for a divider and not for an
input a person has to find. It is now `#808996` in light and `#6D7683` in dark, each at least 3:1 on
`--surface`, `--surface-2`, `--surface-3`, `--bg` and `--inset` (3.12:1 in light, the smallest margin of
the five, and 3.98:1 in dark): the grounds a field, a quiet button or a
segmented pill sits on. Dark needs the lighter value because its track (`--surface-3`) is
lighter than a card, so a pill edge borders the lighter side, and `#646D7A` was 2.67:1 there.

axe does not test this. It checks text, not boundaries, so this pair has to be measured
by hand or asserted directly.

**Why the rule says a border and not "a visible boundary".** A border survives
forced-colours mode and a shadow ring does not: that mode (Windows high contrast) keeps a
border and recolours it to a system colour, and drops box-shadows altogether. A control whose
edge is a shadow ring has no edge for the people who turned that mode on, and "make it
visible" is satisfied on the designer's screen and not on theirs. This is not a stylistic
preference, and a ring is not a substitute for a border.

**The pressed segment is a border, and every segment carries one.** Each segment has a 1px
transparent border and one pixel less padding than it would otherwise, so the pressed one only
changes the border's colour and the control does not change size. Remove the transparent
borders as tidying and the control resizes when pressed, moving its neighbours: the most
visible thing a toggle can get wrong. The pressed segment's border is `--line-strong`, which
is at least 3:1 against the track it sits in, in both themes.

---

## 3. Type

Three faces, three jobs. Load from Google Fonts with real fallback stacks.

```css
--font-display: "Newsreader", Georgia, "Times New Roman", serif;
--font-ui:      "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
--font-mono:    "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

- **Newsreader** — page and section titles only. Weight 500. Never for UI chrome.
- **Public Sans** — everything interactive and everything read as prose, every label, and
  figures that stand alone (the hero and a stat value), set with `tabular-nums`. 400/500/600.
- **IBM Plex Mono** — figures in a table and wherever figures stack in a column, plus the
  uppercase micro-label on a table column header, and nothing else. Mono is the ledger
  signal because it is reserved: a figure gets "this is money" from size, weight and
  alignment when it stands alone, and from the typeface when it sits in a column and has to
  line up.

### Scale

| Role | Size | Weight | Face | Notes |
|---|---|---|---|---|
| Hero figure (net worth) | `clamp(23px, 5vw, 34px)` | 600 | ui | `tabular-nums`, `letter-spacing:-.02em`. Lowered from `clamp(32px, 6vw, 48px)`: at 32px a lakh figure with a symbol filled a 375px screen edge to edge, and a number that large reads as a headline rather than a fact. |
| Page title | 22px | 500 | display | `-.01em` |
| Section title (doc) | 25–30px | 500 | display | `text-wrap:balance` |
| Card title | 14.5px | 600 | ui | |
| Body | 15px | 400 | ui | `line-height:1.55` |
| Stat value | 17px | 500 | ui | `tabular-nums` |
| Table cell | 13.4px | 400 | ui | figures in mono, so a column aligns |
| Caption / note | 11.8–12.5px | 400 | ui | `--muted` |
| Label (stat tile, figure caption, form field) | 12px | 400 | ui | `--muted`, sentence case, no letter-spacing |
| Table column header | 10.5px | 500 | mono | uppercase, `letter-spacing:.13em`. The only micro-label. |
| Pill / badge | 9.5px | 500 | mono | uppercase, `letter-spacing:.1em`. **Deliberately exempt** from the label and mono rules above: a short status badge is a stamped tag, not a label describing a figure, and the uppercase mono is right for it. A chip that carries a figure and a phrase (the `Delta`, "▲ 22.9% on cost") is not a badge and follows them. |

### Numerals — non-negotiable

```css
.num, td.n, .mono, .figure, .stat > .v { font-variant-numeric: tabular-nums; }
```

Every figure in a column must align. Proportional digits in a money table is a bug. A
figure that stands alone is set in Public Sans and is tabular too, so the alignment
guarantee holds in either face and only the texture differs: Plex Mono at display size is
wide and evenly spaced, and reads as output rather than as a fact.

### Units

A magnitude suffix — `L`, `Cr`, `K` — is a **unit**: a span at `0.6em` in `--muted`,
welded to the figure with no space, so `₹5.3` then `L` rather than `₹5.3 L`. It is never
smaller than 11px (`0.6875rem`), or a stat value's unit would be set below the caption
step. The currency symbol is not a unit and stays at the figure's size. One `Amount`
component in `ui/primitives.tsx` renders it, so every figure does it the same way; a
plain-string formatter remains for the places a span cannot go (an `aria-label`, a `title`,
SVG text).

### Text scaling

Respect the OS text size **up to 200%**. No fixed-height container may hold text. Test at
200% before calling any screen done — parents will use this app.

**The sizes above are stated in px because that is what they measure at the default 16px
root. They are declared in `rem`**, in `tailwind.config.js` and `src/styles/base.css`, and
that is not a detail: a px font-size ignores the browser and OS text setting completely.
This app shipped that way for weeks — doubling the root font size changed nothing on any
screen — and the rule above was satisfied on paper and not in fact. Anything sized in px
is not participating.

The same reasoning applies to a box that holds text. `.avatar` was a fixed 32px circle
around a letter; at 200% the letter outgrew it. It is sized in `em` now, so it follows
whatever the text does.

---

## 4. Spacing and shape

An 8px base, with 2px steps where density demands it.

```
4 · 6 · 8 · 10 · 12 · 14 · 18 · 22 · 26 · 34 · 44
```

| Thing | Value |
|---|---|
| Card padding | 18px |
| Card / panel radius | 12px — `--radius` |
| Grid gap between cards | 18px |
| Table cell padding | 9px 10px |
| Pill padding / radius | 3px 9px / 100px |
| Input padding / radius | 7px 10px / 7px |
| Segmented control | 2.5px track pad, 6px inner radius |
| App icon tile radius | 22.6% (iOS squircle approximation); an asset-class tile uses `--radius` |

**Layout uses flex/grid `gap`, never per-element margins.** Wide content — tables, charts,
code — scrolls inside its own `overflow-x:auto` container so the page body never scrolls
sideways.

**Not everything is a card.** Border, fill, radius and shadow each say "separate object".
Spend them by role. One radius and one shadow stamped on every block flattens the
hierarchy and makes nothing important.

---


### The page gutter is a token

`--gutter` is 12px below 480px and 18px above. A card then spans 366 of a 390px phone
and reads as the screen rather than as something sitting on it, while a tablet or a
laptop keeps the wider measure. It is a token and not a literal because 12px is
comfortable at 390–412px and tight at 360, which plenty of Android still is, and
because `CLAUDE.md`'s 200%-text-size rule bites hardest at the narrow end.

Inner card padding stays 17–18px at every width. The gutter shrinks; the breathing
room inside the card does not.

## 5. Component tokens

| Component | Spec |
|---|---|
| **Card** | `--surface` on `--line` 1px, `--radius`, padding 18. Header row: title 14.5/600 left, muted sub right, 14px margin-bottom. |
| **Asset tile** | 40×40, radius `--radius` (the token, never a pixel value), 1px border. The glyph is 20×20 on a 24-unit viewBox, stroke 1.9, round caps and joins, never filled, in the class colour. The fill is a 16% tint of that colour over `--surface`; the border is a 76% tint of it. Both themes follow without a hex per theme. **Held to 3:1**: the glyph against its fill, and the border against `--surface`, which in light takes the 76% (72% is the least that reaches 3.0). Measured for every kind in both themes by `src/ui/tileContrast.test.ts`, reading the shipped rule. The border is there for the forced-colours reason given in §2, and is held to the same 3:1 as any border that is the sole marker of a shape. Decorative beside its label, hidden from assistive technology. **Which glyph a kind gets, what `other` looks like and why, and which tiles are drawn and unwired: `docs/design/icons.md`.** Colour of `other` is neutral `--muted`, never a hue; coral is reserved to liabilities. |
| **Stat tile** | Label above (12px, sentence case), value below in Public Sans with `tabular-nums`, gap 3px. Positive `--teal`, negative `--coral`. |
| **Pill** | 9.5px mono uppercase. Variants: `own` (indigo-soft/indigo), `warn` (brass), `due` (coral), `ok` (teal), `neutral` (surface-3/muted). |
| **Table** | Header: `--surface-2`, 10.5px mono uppercase `--muted`, bottom hairline — the one place the micro-label survives. Rows: hairline separated, last row none. Total row: 1.5px `--line-strong` top border, weight 700. |
| **Editable row** | A record and the inputs that change it on one line, on `--inset` with a 1px `--line` border and `--radius`. Inputs in the mono face, since figures a person types and compares down a column are the one place outside a table the rule keeps it. Its action is a **row action**: an icon, 34px face and a 44px button around it, the face bordered in `--line-strong`, named for what it acts on ("Archive Groceries"). Where there is not room for name, fields and action on one line (under 40rem) the fields wrap under the name and the action stays on the first line. A form that opens inside a card to change a record takes the same ground (`.inset-form`). |
| **Quiet button / disclosure** | The two controls that replace a run of underlined links on a card. A **quiet button** is for something that acts: a hairline in `--line-strong`, no fill, 34px (44px on a coarse pointer). A **disclosure** is for something that only reveals: its words and a chevron that turns a quarter when open, `aria-expanded` driving it. An underlined word is for one-of-a-kind, a link that goes somewhere, not an action repeated on every row. |
| **Segmented control** | `--surface-3` track, active pill `--surface` + weight 600 + 1px shadow. `aria-pressed` drives state. |
| **Bar / progress** | 6–9px height, radius 3, `--surface-3` track. Over-target bars flip to `--coral`. |
| **Quick-add** | Amount input in mono, 110px wide. Primary button `--brass` with light text. |
| **Focus ring** | `2px solid var(--brass)`, `outline-offset:2px`. Visible on every interactive element. |

---

## 6. Charts

- Colours come from `--c1…--c7`, never literals, and **a class has one colour, fixed, on every
  screen** — chosen by the class and not by its rank or position. Coloured by position,
  Bonds is one colour when it is third largest and another when it is second. The map is
  `kindColour` in `src/ui/labels.ts`, following the prototype's own (funds `c1`, equity
  `c2`, bonds `c3`, ETFs `c4`, deposits `c6`; `other` is the neutral `--muted` and takes no slot, because it is a stored value and not a sixth class); `c5` is the prototype's
  crypto slot and stays unused until a class needs it. A series that is not a class — the
  since-inception total — takes a neutral token (`--ink-2`), never a class's colour.
- Chart text uses `--muted` for axes and `--ink` for value callouts — always tokens, never
  literals, or the chart breaks in one theme.
- Every axis label names a value the chart actually reaches.
- In SVG, leave room in the `viewBox` for outermost labels and give every drawn shape an
  explicit `fill`.
- Donuts: 100px outer / 72px inner on a 208 grid, ~0.018rad gap between arcs. A thin ring beside its rows, which leaves the hole room for its total at 6 to 8rem; the prototype's 82 / 52 was the ring standing alone above them.
- Lines: 2.2–2.4px stroke, area fill at 14% opacity, endpoint marked with a 4px dot and a
  mono label.

---

- The ramp is **stepped in lightness as well as hue**, so neighbouring classes stay
  apart for someone who cannot separate red from green. `--c1`…`--c7` are ordered, and
  an asset class keeps its index across every screen — the donut, the allocation rows
  and the annual-expense bar must agree, or the same class is three colours.
- Saturated accents make an unlabelled chart more tempting, not less. Every series still
  carries its name, and §2's sign-or-arrow rule applies inside charts too.

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
