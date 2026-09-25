# UI review — 24 September 2026

Ten findings from walking the running app, ranked by how much each one costs the
screen it sits on. Every one of them is fixable inside the tokens the project
already has; none of them needs a design tool.

**How this was taken.** `npm run dev` on `localhost:5173`, demo household,
signed in, dark theme. Overview, Holdings, Tax and Expenses, each at the pane's
own width and again at 375 × 812. Screens not yet built were not looked at.

**Standing.** Observations about the built app, not a change to the
specification. Where a finding contradicts `docs/blueprint.md`, the blueprint
wins and the finding is wrong — say so here rather than acting on it. Where it
contradicts `docs/design/conformance.md`, check whether the departure is still
deliberate; two of these are cases where a recorded decision did not survive
into the code.

**What this review is not asking for.** No Figma. No component library. No new
palette, typeface or token. The design system is not the problem — the
application of it on four screens is. Anything below that would be better solved
by changing a token, say so and change the token instead.

---

## Summary

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | Three hero figures compete; net worth loses | high | `features/overview/OverviewScreen.tsx` |
| 2 | The caveat marker reads as a loss | high | `ui/primitives.tsx` — `Caveat` |
| 3 | `not shown` printed where a figure goes | high | `features/overview`, `features/holdings` |
| 4 | No chart anywhere in the app | high | Overview — outstanding from stage 4 |
| 5 | Everything is a card, and every card is identical | medium | `features/holdings/HoldingsScreen.tsx` |
| 6 | Explanatory prose came back | medium | Overview, Expenses |
| 7 | "Needs attention" is a wall of alarm | medium | `features/overview` |
| 8 | Monospace has spread past numerals | medium | `styles/base.css`, Tax |
| 9 | Privacy control wraps at 375px | low | `features/overview` |
| 10 | `max-w-app` caps every screen at 880px | low | `tailwind.config.js` |
| 11 | Three type rules in `tokens.md` §3 are too broad | high | `docs/tokens.md`, then everywhere |

---

## 1. Three hero figures compete, and net worth loses

**What you see.** The Assets card carries ₹5.3 L and $41.8K, both at hero scale.
Net worth — ₹54.85 L — sits in the card *below* them, at the same size. The most
important number in the application is third in reading order and no larger than
its neighbours.

**Why it is wrong.** `docs/tokens.md` gives the hero figure its own step in the
scale, `clamp(32px, 6vw, 48px)`, and nothing else in the scale comes near it.
That step only works if one figure per screen uses it. Three of them means none
of them is the headline, and a person opening the app has to read all three to
find out how they are doing.

`conformance.md` records the reason Assets sits first: the refusal underneath it,
and leading with what is known. That reasoning is sound and should survive. What
should change is the weight, not the order of the arithmetic.

**What to do.** Net worth first, alone, at hero scale. Assets per currency
beneath it as stat tiles at the stat step (17px mono), keeping the per-currency
refusal exactly as it works now. One hero figure per screen, everywhere.

## 2. The caveat marker reads as a loss

**What you see.** A coral ▲ inside a circle, beside ₹5.3 L, beside ₹1,25,000,
beside ₹18,000 on Tax. On Overview's Allocation card it is worse: Mutual funds
carries that red triangle in the same column, at the same size, where Bonds
carries `▲ 7.5%` and ETF carries `▲ 22.9%` in teal. Mutual funds reads as the
one position that is down. It is not — it is the one that is incompletely
valued.

**Why it is wrong.** `docs/tokens.md` §2 assigns coral to loss, overspend and
due, and teal to gain, and says every one of them carries a sign or arrow as
well as a hue. The caveat marker borrows both signals — the hue and the arrow —
for a meaning that is neither. This is the colour-alone rule failing in the
other direction: the shape and the colour agree with each other and both say
something false.

**What to do.** Give `Caveat` a neutral marker: the ⓘ glyph already used at card
level, in `--muted`, never in coral and never a triangle. Coral and teal stay
reserved for direction of money. If a caveat is severe enough to need warning
colour, `--brass` is the token for attention and is not already spoken for.

## 3. `not shown` printed where a figure goes

**What you see.** Unrealised gain renders the literal words `not shown`, in
mono, with a caveat marker beside it — on Overview and again on Holdings.

**Why it is wrong.** It reads as a failed render rather than a decision. The app
is otherwise careful about refusing honestly; this is the one place where the
refusal looks like a defect.

**What to do.** An em-dash at the figure's own size and weight, with the caveat
marker carrying the explanation. The dash says "deliberately absent" in a way a
sentence fragment in a number's slot does not.

## 4. There is no chart anywhere in the app

**What you see.** Four screens, no chart. Allocation carries its class colour on
an 8px dot; the seven-colour ramp in `docs/tokens.md` §6 is otherwise unused.

**Why it matters.** This is the largest single contributor to the app feeling
flat, and it is not a design problem — it is three unbuilt items from stage 4
(the donut, the since-inception chart, member attribution), listed as
outstanding in `docs/build-plan.md` §00.

The departure replacing the donut with a row per class stands: a row shows four
facts where an arc shows one, and on a phone that is the difference between a
picture and an answer. But `conformance.md` says the colours stay the chart
palette in order "so a class keeps its identity when the donut arrives beside
it" — and it has not arrived. The since-inception line is specified in
`tokens.md` §6 down to the 2.2px stroke, the 14% area fill and the endpoint dot.

**What to do.** Build the since-inception chart first — a single well-made line
changes a screen's character more than restyling everything around it. Then the
donut beside the allocation rows, not instead of them. Both read `--c1…--c7` in
order, never literals.

## 5. Everything is a card, and every card is identical

**What you see.** Holdings opens with "Add a holding" and "Import a statement" —
two collapsed cards with the same border, radius, padding and shadow as the
Portfolio card beneath them. At 375px they consume the entire first screen; no
holding is visible until you scroll.

**Why it is wrong.** `docs/tokens.md` §4, verbatim: *"Not everything is a card.
Border, fill, radius and shadow each say 'separate object'. Spend them by role.
One radius and one shadow stamped on every block flattens the hierarchy and
makes nothing important."* Two actions currently outrank the data they act on.

**What to do.** Demote both to a single row of controls above the portfolio — a
button and a link, or one disclosure holding both. The data is what the screen is
for; the actions are how you add to it.

## 6. Explanatory prose came back

**What you see.** The Net worth card is one figure and four lines of prose
explaining what net worth is — six lines at 375px, where the paragraph is
visibly larger than the number it describes. Expenses opens with the quick-add
form and closes with two more paragraphs, one on private entries and one on IST
dates and paise.

**Why it is wrong.** `conformance.md` already decided this: *"Fifteen coloured
paragraphs on one screen are read as decoration, and the one that mattered goes
down with the rest. A sentence that explains what a block IS is said once, on its
heading; a sentence that warns a figure is WRONG rides on that figure."* The
decision is right and the code did not follow it.

**What to do.** The net-worth paragraph is a definition — it belongs on the
heading, or behind the caveat marker, not in the card body. The two on Expenses
are onboarding: say them once to a household with no transactions, then stop.

## 7. "Needs attention" is a wall of alarm

**What you see.** Overview ends with three stacked full-width tinted panels —
coral, brass, coral — each carrying a paragraph. On a demo household with
nothing actually wrong, the screen closes on what looks like an incident report.

**Why it is wrong.** Three panels at equal weight means no triage. Everything is
flagged, so nothing is urgent, and the one that might matter — the two months
with no reading, which cannot be reconstructed later — is buried among peers.

**What to do.** One line per item: the count, the consequence in a clause, and a
disclosure for the rest. Reserve the coral fill for the item that is genuinely
time-critical and let the others sit in `--surface-2` with a brass marker.

## 8. Monospace has spread past numerals

**What you see.** `not shown`, `2 holdings`, `UNREAD`, and on Tax essentially
every label and value on the screen. The Tax working paper reads as terminal
output rather than a document.

**Why it is wrong.** `docs/tokens.md` §3 assigns mono to *every number* plus
uppercase micro-labels, and Public Sans to "everything interactive and everything
read as prose". Mono is the ledger signal precisely because it is reserved; using
it for words spends the signal.

**What to do.** Audit for mono applied to non-numeric strings. On Tax, the
section headings and the qualifying words (`of ₹1,25,000`, `at 12.5%`) are prose
and belong in Public Sans; the figures stay mono and stay tabular.

This finding is the symptom. Finding 11 is the cause, and fixing 11 first makes
most of this fall out — do them together.

## 9. Privacy control wraps at 375px

**What you see.** On the Assets card, the eye button drops to its own line below
the Household / Mine segmented control, left-aligned and alone. First card,
first screen, narrowest width.

**What to do.** Let the control row wrap as a unit, or move the per-card eye out
— the header already carries a privacy switch, and two controls for one state on
the same screen is the problem `conformance.md` flagged for the currency control.

## 10. `max-w-app` caps every screen at 880px

**What you see.** `tailwind.config.js` sets `app: '880px'`, applied to the nav
and both `main` elements. On a laptop or a monitor the app is a single column
with the rest of the screen empty, and Overview is a long scroll whatever the
window size.

**Why it is a low-severity finding and not a bug.** 880px is a sound measure for
reading, and single-column is right for Expenses and for anything with a table.
It is wrong only for the two screens that are grids of independent blocks.

**What to do.** Raise the cap to ~1200px and give Overview and Tax a two-column
grid above 1024px, leaving every other screen single-column at the current
measure. Test at 200% OS text size before calling it done, per `CLAUDE.md`.

## 11. Three type rules in `tokens.md` §3 are too broad

Unlike the ten findings above, this one says the specification is wrong rather
than the code. It came from comparing the app against a shipped Indian personal
finance app (INDmoney), whose type system does four number sizes and three label
sizes and nothing else. The comparison is about scale relationships and casing
only — no palette, no typeface and no layout is being borrowed, and the
merchandising surfaces that app carries are out of scope here by design.

**What the reference does.** Every figure is sans-serif, including the hero; it
gets "this is money" from size, weight and right-alignment rather than from a
typeface. Not one label is uppercase. Units are welded to the figure —
`₹6.3Cr`, `₹12.93K` — with no gap and the unit smaller and muted.

### 11a. Mono for *every* number is too broad

§3 says IBM Plex Mono is for "*every* number, plus uppercase micro-labels", and
calls it "the strongest single signal that the app is a ledger". In a table that
is right: figures stacking in a column must align, and that is what mono is for.
At display size it is wrong. Plex Mono at 48px is wide, evenly spaced and
mechanical, which is why the hero reads as output rather than as a headline —
and it is the direct cause of the gap in `₹5.3  L`, where the unit floats away
from the figure.

**Change §3 to:** mono for figures in tables and anywhere figures stack in a
column; **Public Sans with `font-variant-numeric: tabular-nums`** for hero
figures and single stat values. The alignment guarantee is kept; the terminal
texture is not.

### 11b. Uppercase letterspaced micro-labels everywhere is too much

`INVESTED`, `UNREALISED GAIN`, `TOTAL RETURN`, `CHANGE`, `UNREAD` — five on the
Assets card alone. At that density the treatment stops being a signal and
becomes texture, and it is half of finding 8.

**Change §3 to:** uppercase mono micro-labels for **table column headers only**.
Every other label — stat tiles, figure captions, form fields — becomes 12px
Public Sans in `--muted`, sentence case, no letterspacing.

### 11c. There is no unit style, and there should be

`₹54.85 L`, `₹5.3 L`, `$41.8K` are rendered as one string, so mono spacing pushes
the unit away from the figure it belongs to.

**Add to §3:** a unit span at `0.6em` in `--muted`, no space between figure and
unit. One small component in `ui/primitives.tsx`, used by every money formatter,
fixing the floating unit on every screen at once.

### What is *not* changing

The scale's page-title and card-title steps stay — they are why this app's tab
labels will not truncate to `Mutua...` the way the reference's do. The hero stays
`clamp(32px, 6vw, 48px)` rather than a fixed mobile size. Newsreader stays for
display; it is the one thing that makes this app not look like every other
finance app. And the hero-to-row ratio stays as specified — the problem on
Overview was three heroes competing, not the size of any one of them.

**Order for this finding:** edit `docs/tokens.md` §3 first and show me the diff,
because everything else in this finding is mechanical once the rule is settled.
`scripts/check-design-tokens.mjs` may encode the old rule — check it.

---

## Order

Findings 11, 2, 3 and 8 are the first pass: 11 settles the type rules, then 2, 3
and 8 apply them and fix the caveat marker and the absent-figure rendering. All
four touch shared primitives, so four screens improve at once. Then 1 and 6,
which are Overview's hierarchy. Then 4, which is the real work and the one that
changes how the app looks. Then 5, 7, 9, 10 as they come.

Update `docs/design/conformance.md` in the same commits where a finding closes a
gap it records — the donut and the since-inception chart both have rows there.
Finding 11 changes `docs/tokens.md`, which is authoritative under `CLAUDE.md`,
so that edit lands in its own commit ahead of any code that depends on it.
