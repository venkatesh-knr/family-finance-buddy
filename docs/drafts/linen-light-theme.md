# Linen, the light theme in place of Mist

**Decided by the owner, 17 November 2026.** The owner asked for the light version to take
the theme and colours of loophealth.com, "instead of complete white/grey". Four options
were drawn: Linen, Mango, Sunrise and Butter (the LightOptionsHeader board). The owner
chose **A, Linen**, with a coloured app header and bottom menu. `docs/tokens.md` is still
to be changed; that is the build's first step.

The pictures are the LinenTokens board and every *Linen* board in
`docs/design/stated-spend-boards.html`.

## What was taken from the reference, and what was not

Loop Health's site was read in the browser on 17 November 2026. Its page uses:

- a warm off-white ground (`#F9F7F2`) and white cards;
- a deep forest green (`#025F4C`) for its hero and its text accents;
- a lime (`#BCDD33`) for its main button, with green text on it;
- a green-black ink (`#262E26`);
- sunflower, coral and lavender as small decorative fills.

**Taken** is the mood: a linen ground rather than a blue-grey one, an off-white panel, a
deep green that carries the screen's one important surface, and a lime accent used
sparingly on that green.

**Not taken:**

- The brand: no logo, wordmark, type face (Loop uses Work Sans; the app keeps Public Sans,
  Newsreader and IBM Plex Mono) or exact palette. Every value below is the app's own,
  tuned to the contrast rules in `tokens.md`.
- Its decorative colours.
- Lime as text or as a fill on the linen ground. On linen it is well under 3:1, so it
  appears only on the forest surface.

## The tokens, as proposed

```css
:root[data-theme="light"] {               /* Linen */
  --bg:#F1ECE1;          /* page ground: linen */
  --surface:#FFFDF8;     /* soft panels, header, bar: warm off-white, never #FFFFFF */
  --surface-2:#F5F1E8;   /* table headers, a quiet surface */
  --surface-3:#E8E2D5;   /* segmented-control track, progress track */
  --inset:#F5F1E7;       /* an editable row: darker than its card */
  --ink:#1D2823;  --ink-2:#3A4741;  --muted:#5A655F;
  --line:#E2DBCB; --line-strong:#7B857F;
  --brass:#025F4C;  --brass-soft:#DCEDE5;   /* the accent is forest in Linen */
  --teal:#00707A;   --teal-soft:#D3ECEC;    /* gain: blue-teal, so it is not the accent's green */
  --coral:#B03A2E;  --coral-soft:#FBE3DD;
  --indigo:#5A3EC2; --indigo-soft:#ECE6FC;
  --c1 … --c9: Mist's values, unchanged (each is at least 3:1 on #FFFDF8)
  /* dark to light, top to bottom (the owner, 17 November 2026) */
  --surface-lift:linear-gradient(180deg, #013F33 0%, #025F4C 45%, #0B6F58 100%);
  --lift-edge:#013A2F;
  --surface-panel:linear-gradient(180deg, #FFFDF8 0%, #FFFDF8 35%, #F8F3E8 100%);  /* a soft panel's fill */
  /* new: the lifted surface is dark in Linen, so what sits on it has its own tokens */
  --lift-ink:#F6F2E4;  --lift-ink-2:#E6EEE8;  --lift-muted:#D6E5DC;
  --lift-press:#C9E35A; --lift-press-ink:#023F33;
  --lift-track:rgba(0,0,0,0.16); --lift-track-line:rgba(246,242,228,0.28);
  /* new: the primary button, which is ink in Mist */
  --btn:#025F4C; --btn-ink:#FFFDF8;
  /* new: the app header, the desktop top strip and the bottom menu */
  --bar:#025F4C;  --bar-ink:#F6F2E4;  --bar-muted:#D6E5DC;   /* the flat value, for forced colours */
  --bar-top:linear-gradient(180deg, #013A2F 0%, #025F4C 60%, #0B6F58 100%);     /* header: lightens downwards */
  --bar-bottom:linear-gradient(180deg, #0B6F58 0%, #025F4C 40%, #013A2F 100%);  /* menu: lightens upwards */
  --bar-rule:#C9E35A;            /* a 3px lime rule on the edge facing the page */
  --bar-pill:#C9E35A; --bar-pill-ink:#023F33;   /* the current place in the bottom menu */
}
```

The dark theme gains the same new tokens with the values it already draws
(`--lift-ink` = `--ink`, and so on), so no dark screen changes.

## Contrast, measured

| Pair | Ratio | Rule in `tokens.md` |
|---|---|---|
| ink on bg / surface | 13.5 / 15.0 | text, 4.5 |
| ink-2 on bg | 8.3 | text, 4.5 |
| muted on bg / surface | 5.2 / 6.0 | text, 4.5 |
| line-strong on bg | 3.24 | control edge, 3 |
| brass (forest) on bg | 6.8 | text and focus, 4.5 |
| teal on bg | 4.95 | text, 4.5 |
| coral on bg | 5.3 | text, 4.5 |
| indigo on bg | 6.4 | text, 4.5 |
| surface on bg | 1.16 | a panel is told by tone alone (Mist: 1.15) |
| lift-ink on the lift's lightest stop (#0B6F58) | 5.5 | text, 4.5 |
| lift-muted on the lightest stop | 4.7 | text, 4.5 |
| lift-press (lime) on the lightest stop | 4.3 | shape, 3 |
| bar-muted on the bars' lightest stop (#0B6F58) | 4.7 | text, 4.5 |
| muted on a panel's foot (#F8F3E8) | 5.5 | text, 4.5 |
| line-strong on a panel's foot | 3.45 | control edge, 3 |
| lift-press-ink on lift-press | 8.3 | text, 4.5 |
| btn-ink on btn | 7.5 | text, 4.5 |
| bar-ink on bar | 6.8 | text, 4.5 |
| bar-muted on bar (other menu labels) | 5.9 | text, 4.5 |
| bar-pill on bar | 5.3 | shape, 3 |
| bar-pill-ink on bar-pill | 8.3 | icon, 3 |

## What changes on screen

1. The page ground is linen and the panels are warm off-white, in place of blue-grey and
   near-white.
2. **The one lifted surface is deep forest with cream text** (the Mist lift is a pale
   periwinkle with dark ink). It is the biggest change, and the one that makes the screen
   read like the reference.
3. The accent (focus underline, active tab and bar item, pressed oval off the lift, primary
   button) is forest in place of brass-gold.
4. On the lift, the pressed oval and any button are lime with dark-green text.
5. Gain moves to a blue-teal, so it is never the same green as the accent. Meaning is
   still never carried by colour alone.
6. **The app header and the bottom menu are forest**, each with a 3px lime rule on the
   edge facing the page. The header covers every screen's top bar, the back-arrow header
   of forms and the desktop top strip. In the menu, the current place has a lime pill
   behind its icon, cream bold text, and `aria-current`. On desktop, the current place
   has a lime underline. On a phone, `theme-color` is set to the forest, so the status
   bar matches.
7. **Dark to light, top to bottom** (the owner, 17 November 2026, option 3 of the
   LinenShades board):
   - The header is darkest at the top edge and lightens towards the content.
   - The bottom menu lightens upwards from the bottom edge.
   - The lifted card goes from deep forest at the top to a fresher green at its foot.
   - Soft panels warm from off-white to a faint linen at their foot.

   The lightest green is #0B6F58, the lightest that keeps every label at 4.5:1 or more.
   Under forced colours, a gradient is not painted, so each surface also has a flat
   value to fall back to.
8. The dark theme does not change: its bars stay as built.

## What the build does

- `tokens.md`:
  - the Linen block replaces Mist as the light theme. Mist stays on the canvas for
    comparison, as Paper did;
  - it gains the new `--lift-*`, `--btn` and `--bar-*` tokens, with the dark theme's
    values set to what it already draws;
  - the record of the 30 October Mist decision is kept, with this decision beside it.
- `check-design-tokens` learns the new tokens.
- Every light-theme screenshot test is re-baselined in the same change.
- The light `theme-color` meta tag becomes `#025F4C`.

## Charts on the lifted surface: a mint tray

**Decided by the owner, 20 November 2026** (option A of the HoldingsStripLinen board).

The class colours `--c1` to `--c9` are tuned for a light panel. On the forest lift they
measure 1.0 to 1.4:1, under the 3:1 a chart mark needs, so the Holdings strip and its
legend could not be read. Dark's brighter values do not fix it: indigo, plum, coral and
others stay under 3:1 on the forest.

**The fix.** A chart or legend drawn in class colours on the lifted surface sits on a
tray: a band across the foot of the card, edge to edge, with no hairline above it: the forest fades into it (below).

- In Linen the tray is pale mint, `--lift-tray:#E4F1E8`. Inside it, the inks return to
  the page's (`--ink`, `--ink-2`, `--muted`, `--line`), and the class colours are
  unchanged.
- **The forest fades into the mint; there is no hard edge or hairline** (the owner,
  20 November 2026; the HoldingsStripFade board). The fade is
  `--lift-tray-fade:linear-gradient(180deg, #0B6F58 0%, #4E9682 35%, #A9D0BE 70%, #E4F1E8 100%)`
  over 32px (A1; A2 is the same over 64px). **Nothing is drawn inside the fade**: its
  middle is a mid-green where neither cream nor dark ink reaches 4.5:1. The text above
  stays on forest, and the strip and legend start below the fade, on full mint.
- In dark the tray and the fade are transparent, so no dark screen changes.
- Under forced colours the gradient is not painted; the tray falls back to the flat
  `--lift-tray`, and the edge reads as the change of tone.
- The class colours are never changed for the lift, so a class keeps one colour
  everywhere (`tokens.md`, the class colours rule).

| Pair | Ratio | Rule |
|---|---|---|
| each of `--c1` to `--c9` on the tray | 4.7 to 6.1 | shape, 3 |
| ink on the tray | 13.1 | text, 4.5 |
| muted on the tray | 5.2 | text, 4.5 |
| the tray on the lift's lightest stop | 5.3 | a band, told by tone |

Options B (a cream tray, `#F6F2E4`) and C (the strip moved out of the card) were drawn
and not chosen.
