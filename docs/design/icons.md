# Icons

<!-- invariant-prefix: IC -->

What an asset-class tile is, which glyph belongs to which kind, and what has to
be measured before a tile ships.

This file is the authority for icon shape and assignment. `docs/tokens.md` stays
the authority for colour and radius — where a hex appears here it is quoted from
the canvas for identification, not prescribed. `docs/design/vibrant-canvas.html`
is the picture these rules were read off; it is a reference and it is drawn
dark-only, so nothing in it settles light theme.

Not to be confused with `docs/design/icon-concepts.html`, which is the app's own
launcher icon and has nothing to do with this.

## 1. The tile

A tile is a rounded square holding one glyph, used wherever a holding, an
account or a class needs to be identified at a glance.

| property | value |
| --- | --- |
| size | 40 × 40 |
| radius | `--radius` — not a literal |
| glyph box | 20 × 20, drawn on a 24-unit viewBox |
| stroke | 1.9, round caps, round joins, `fill="none"` |
| border | 1px, always, in both themes |
| fill | a tint of the glyph colour over `--surface` |

Three things about that list are decisions rather than defaults.

**The glyph is stroked, never filled.** A filled glyph at 20px turns into a blob
the moment the hue is dark, and half of these hues are dark in light theme.

**The border is not optional.** It is what keeps the tile a tile under
forced-colours mode, where background tints are discarded and a fill-only tile
becomes an unlabelled glyph floating in a row. Same reason the pressed segment of
the segmented control takes a border rather than a shadow ring.

**The fill is a tint, not a stored hex.** The canvas painted each class an
explicit opaque triple — fill, border, glyph — because it only ever had to work
on one background. A tint of the glyph colour adapts to both themes for free,
which is worth more than the canvas's precision. The cost is that a single
tint percentage does not give a single contrast ratio across seven hues; see §5.

## 2. The six built kinds

These are the values `holdings.kind` can hold today. Every one has a tile.

| kind | hue | glyph |
| --- | --- | --- |
| `mutual_fund` | periwinkle | a rising line with an arrow tip |
| `equity` | emerald | three ascending bars on a baseline |
| `etf` | violet | a basket — a case with a handle and one divider |
| `bond` | gold | a certificate — a rect with a rule near the top |
| `deposit` | cyan | a passbook with a coin |
| `other` | **neutral grey** | an ellipsis |

Exact geometry as drawn, for anyone reconciling an implementation against the
canvas:

```
mutual_fund  M3 17l5-6 4 4 6-8        M14 7h5v5
equity       M6 20V9   M12 20V4   M18 20v-7   M3 20h18
etf          rect 3,8 18×12 r2       M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2      M3 13h18
bond         rect 3,7 18×12 r2       M3 11h18
deposit      rect 3,6 18×13 r2       M3 10h18      circle 12,14.5 r2
other        circle r1 at 6,12      circle r1 at 12,12      circle r1 at 18,12
```

The three dots are circles of radius 1 and not zero-length strokes. Stroked at 1.9, a
dot is about 3.9 units across and solid (its hole is 0.1 wide), which is wider than
a pixel-and-a-half at 20px. A zero-length stroke is only 1.9 across: at device pixel
ratio 1 it sits on a pixel boundary and smears to a pale block, and measured as
painted it was 2.6:1 in light, under the bar in §5.

**Funds and equity are the pair that gets swapped.** A fund is a line you watch;
a holding is a discrete thing you count. Keep the split in that direction — it is
the only pair in the set where the wrong assignment still looks plausible.

## 3. `other`

`other` is a real stored value. A person can save it, and a holding that has it
renders a tile like any other holding. It is not a placeholder, not a null, and
not an error state — the only thing it means is that the household saved a kind
this app does not model.

Two rules follow, and both have been got wrong once already.

**It sits on the neutral grey ramp, not on a hue.** It is not a sixth asset class
and must not compete for attention with the five that are. "Pick the next colour
in the chart ramp" is the wrong instinct here.

**Its glyph must not read as a warning.** The canvas drew it as a circle
containing an exclamation mark. That was an error, for two reasons: an
exclamation says something is wrong with the holding when nothing is, and at 20px
it is nearly indistinguishable from the caveat marker — a circle containing a
lowercase *i* — which does mean something is off. Two meanings, one shape,
differing only in which end of the stroke carries the dot.

Use an ellipsis: three dots, horizontal, centred. Nothing enclosed in a circle,
nothing that could be mistaken for the caveat marker at 14px.

## 4. Drawn but not wired

Stage 5 kinds. The glyphs exist in the canvas so the set reads as one family when
they land; none of them is a valid `kind` today and none should appear in a
picker, a legend or a filter until its stage ships.

| kind | hue | glyph |
| --- | --- | --- |
| property | emerald | a house |
| gold | gold | a stack of coins seen in section |
| retirement (PF · PPF · NPS) | periwinkle | a shield |
| insurance | violet | an umbrella |
| liabilities | **coral** | a circle containing a minus |

Liabilities is the only tile on coral, and the only one carrying a negative
signal. That is deliberate and it is the reason coral is not available to any
other tile: the moment a second class wears it, a person scanning a list can no
longer read coral as "this one subtracts".

**`foreign` is a marker, not a class.** It appears in the canvas as a globe
beside the others, which is misleading. A foreign holding already has a kind —
it is an equity or a fund that happens to be held abroad. It must never appear
in the class list, take a slot in the ramp, or be selectable where a kind is
selected.

## 5. What has to be measured

The glyph sits beside its own text label everywhere it is used, so it is
redundant rather than load-bearing: **3:1 against the tile fill**, not 4.5:1.
The 1px border is held to the same 3:1 as any other border that is the sole
marker of a shape.

A single tint percentage across seven hues does not produce a single ratio.
Measure every kind in both themes and record the numbers. Gold and coral over a
light surface are where this is expected to fail first, and a tint that works for
five hues and fails for two is a per-hue tint, not a broken rule.

Measured for the shipped 16% fill and 76% border (`src/ui/tileContrast.test.ts`
holds every pair at 3:1; these are the figures it computes), glyph against its own
fill, then border against `--surface`:

| hue | token | light glyph | light border | dark glyph | dark border |
| --- | --- | --- | --- | --- | --- |
| periwinkle | `--c1` | 4.53 | 3.54 | 5.22 | 4.45 |
| emerald | `--c2` | 4.28 | 3.41 | 6.78 | 5.83 |
| gold | `--c3` | 4.15 | 3.26 | 6.94 | 5.98 |
| violet | `--c4` | 5.01 | 3.85 | 4.68 | 3.94 |
| coral | `--c5` | 4.34 | 3.59 | 5.18 | 4.22 |
| cyan | `--c6` | 4.29 | 3.41 | 6.43 | 5.55 |
| neutral | `--muted` | 4.42 | 3.31 | 5.34 | 4.57 |

Gold and neutral over a light surface have the least margin on the border (3.26 and
3.31). Every pair passes, so neither needed its own percentage.

Those are the colours of a solid stroke. A thin stroke is rasterised, not solid, so
`tests/e2e/asset-tile.spec.ts` also renders every kind at device pixel ratio 1, the
case a 100% desktop monitor is, and measures the strongest glyph pixel against the
fill in both themes. A dot of the first `other` glyph passed the table and measured
2.57 painted; this is the check that sees that.

## 6. What has to be tested

- Every value `kind` can hold resolves to a tile. Not a snapshot of the five that
  exist — an assertion that iterates the kind enum, so adding a sixth without a
  glyph fails rather than renders blank.
- `other` resolves to the neutral tile, asserted by name. It is the one that
  breaks silently, because a missing-case fallback and a correct `other` tile look
  identical on screen.
- No tile uses coral except liabilities.

## 7. Invariants

The rules above that a test can enforce, one line each, so that the test names the
rule and a rule cannot be dropped without the test failing
(`docs/design/keeping-docs-honest.md`). The reasoning is in the section cited.

**IC-R1 — A tile's glyph holds 3:1 against its own fill, every kind, both themes.** (§5)

**IC-R2 — A tile's 1px border holds 3:1 against the surface behind it, every kind, both themes.** (§5)

**IC-R3 — Every value `kind` can hold resolves to a tile with a glyph that is drawn.** Asserted by iterating the enum, so a sixth kind without a glyph fails and does not render blank. (§6)

**IC-R4 — `other` is a class of its own, found by name, and resolves to the neutral tile.** It is the one that breaks silently, because a missing-case fallback and a correct tile look identical. (§3, §6)

**IC-R5 — No tile uses coral except liabilities.** (§4, §6)

**IC-R6 — `other`'s glyph is never a ring and has nothing upright in it,** so it cannot be taken for the caveat marker at 14px. (§3)

**IC-R7 — `foreign` is a marker and not a class:** not in the class list, no slot of the ramp, not selectable where a kind is. (§4)

**IC-R8 — The Stage 5 tiles are drawn and wired to nothing:** nothing outside their module and its tests names them. (§4)

**IC-R9 — Each built kind's glyph is drawn to the geometry this file gives.** (§2)

**IC-R10 — A glyph is stroked and never filled:** stroke 1.9, round caps and round joins. (§1)

**IC-R11 — A tile is 40px square on `--radius` and always has a 1px border.** (§1)

**IC-R12 — A tile's glyph, as painted at device pixel ratio 1, holds 3:1 against its fill.** The token table is the colour of a solid stroke and a thin one is rasterised, so this is measured from the pixels. (§5)
