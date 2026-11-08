# Simple layout: tabs, boxed sections, underline fields

<!-- invariant-prefix: SL -->

A simpler look for the whole app, decided by the owner on 7 November 2026 from a
reference screen he liked: **tabs per asset class on Holdings with All first,
input fields without boxes, in short steps, and sections that were first drawn flat
(§1, which the owner amended on 8 November 2026: the boxes came back).**
Colours do not change: the dark theme and the Mist light theme stay as they are in
`docs/tokens.md`. The pictures are the Simpler layout row of
`docs/design/vibrant-canvas.html` (HoldingsTabsAll, HoldingsTabGold, AddStep1,
AddStep2); this file is the authority where the two differ, and it supersedes the
parts of `holdings.md` and `tokens.md` named in §5.

## 1. Sections, rows and the small controls

*Amended on 8 November 2026 by the owner, after using the flat build on a phone.* The
first version of this section drew every section but one flat on the page. The owner
asked for the boxes back: "section boxes and separation lines applicable to all pages".

- **One lifted surface per screen stays** (`tokens.md` §1): the answer, at the top.
- **Every other section is a box:** a plain card (`--surface`, border, radius, `--shadow`),
  a title, and **rows divided by hairlines** (`--line`) inside it. Key–value facts are
  rows (label left, figure right) or small boxes side by side, as the Overview's currencies are.
- **A list entry is one line** where it fits (Recent expenses: the payee, what it was and
  whose, the amount at the right), and wraps, never clips, at a large text size. A day
  is set off from the one before by a hairline.
- **The small controls are ovals** (`--radius-pill`, filled `--surface-2`, a `--line-strong`
  border): the category chips, Import, Sort. The one Add is a one-line pill; its label does not wrap.
- **A unit letter (`L`, `Cr`, `K`) is the figure's own size**, weight and colour, on every screen.
- **A row that opens something** carries a chevron at its right edge; the whole row is
  the target, at least 44px tall.
- Asset-class tiles (`icons.md`) stay: they are what makes a list readable at a glance.

## 2. Holdings: tabs per class, All first

This reverses one decision in `holdings.md` ("tabs per class were considered and
rejected"). The three reasons given there are each answered:

| The objection | The answer |
|---|---|
| Tabs hide the whole-portfolio picture | **All is the first tab and the default.** It keeps the total, invested, the gain and the allocation bar, then one row per class |
| The class list outgrows a tab strip at 375px | The strip **scrolls sideways**; the active tab is always scrolled into view, and a tab appears only for a class the household holds |
| An earmark (the emergency fund) cuts across classes | Earmarks stay on **All**, in a *Set aside* section, each a row that opens the holdings it covers |

**The screen, top down:**

1. The **Mine | Household** switch (§2a) and **Import** on the right.
2. **The tab strip:** All, then one tab per class held, in the order of their value.
   Text tabs with a 2px accent underline on the active one; no pills, no boxes.
3. **The lifted surface:** on All, the household's total; on a class tab, that class's
   value with the one fact that explains it (for Gold, the rate and its date).
4. **Flat facts** for the class (invested, up since bought, and class-specific ones:
   grams and purity for gold, the next maturity for deposits, interest so far).
5. **The list** of that class's holdings, one row each (HD-I1 to HD-I3 still apply).
6. **One Add**, a floating pill above the bottom bar, named for the tab: *Add a
   holding* on All, *Add gold* on Gold (HD-I5 still applies: one Add on the screen).

## 2a. Whose figures: Mine first

Decided by the owner, 7 November 2026: **Overview's net worth and Holdings open on
Mine; Household is one tap away.** This reverses the built default (Household first,
in `OverviewScreen.tsx`).

- **One switch, Mine | Household,** in that order, on the Overview's net worth card and
  at the top of Holdings. Choosing one sets both, for as long as the app stays open.
- **Mine is the default every time the app opens; the choice is not remembered** across
  sessions. The reason the built code gives for not remembering a choice still holds; what
  changes is which answer comes first.
- **The figure names whose it is:** *Your net worth* / *Household net worth*, *Your
  holdings* / *Household holdings*. A personal figure can never be read as the household's,
  which was the risk of a personal default.
- **Mine counts** the holdings and loans recorded under the signed-in member, the member's
  share of a property, and, as today (conformance.md, "Mine and the household's debts"),
  every debt in nobody's name. Private entries of one's own are included in full.
- **Cards that are only ever the household's** (emergency fund, protection, the FIRE
  read-out) say *Household* in their title and do not change with the switch.
- A household with one member shows no switch: Mine and Household are the same figure.

**A tab is a filter in the URL** (`#/holdings?kind=gold`), so HD-I4 still holds: the
back button undoes it and an Overview allocation row opens the class's tab. In markup
the strip is a navigation of links with `aria-current="page"` on the active one, not
an ARIA `tablist`: each tab is a different address.

## 3. Fields without boxes

Every form in the app (adding and editing holdings, expenses, policies, property,
settings, sign-in) uses one field style:

- **A label above, always visible**: 12px, `--muted`. Never a placeholder standing in
  for a label.
- **The value** at 16px in `--ink` (figures in the mono face, as now), on the page's
  own ground: no fill, no border box.
- **One underline** under the value, 1px `--line-strong` (at least 3:1 against the
  ground, which is why it is that token and not `--line`). **Focused:** 2px in the accent.
  **In error:** 2px amber with the message under it in words, because the person can put
  it right (`tokens.md` §2).
- **A choice** (a select) is the same field with a chevron at the right; it opens a
  bottom sheet of options.
- **A switch between two ways of entering one thing** (price paid or rate per gram) is a
  pair of text tabs under a small label, as on AddStep2.
- **Worked-out help** sits under the field in `--ink-2` ("= ₹5,820 a gram").
- The tap target of a field is at least 44px tall, though only its 1px line is drawn.

**The editable row** (`tokens.md` §5) keeps its layout (a record and the inputs that
change it on one line) and loses its `--inset` ground and border: its inputs take the
underline style. **Quick add** keeps its arrangement (amount and payee side by side,
category chips, the disclosure line) with underline fields.

## 4. Forms in steps

A form with more than five fields is split into steps of five or fewer, on a screen of
its own (no bottom bar):

- A top bar with back and the form's name; under it the step's name, *Step n of m*,
  and a segmented progress line.
- **Next** (and on the last step, the form's verb: *Add gold*) is one full-width button
  at the bottom, enabled when the step's required fields are filled.
- **Back keeps every value typed.** Nothing is written to the database until the last
  step's button, so leaving half-way leaves nothing behind.
- Step one is always *what it is* (type, form, name, whose); the next is the figures.
  The type chosen in step one decides what the next step asks (detail-level.md §4: every
  column still captured, whatever the display setting).
- Short forms (quick add, a rate, a single figure) stay one step, inline.

## 4a. Every screen, and the board it follows

Every screen has a board in the simpler style. **Content and order are unchanged** from
each screen's earlier board; what changes is the boxes, the spacing, the fields and the
bottom bar (Overview, Expenses, Holdings, Goals, More).

| Screen | Board (layout) | Earlier board (content still stands) |
|---|---|---|
| Overview | FlatMain | Main, MonthMoney |
| Expenses | FlatExpenses | Expenses, ExpensesClosed |
| Holdings | HoldingsTabsAll, HoldingsTabGold | Holdings, HoldingsDeposits |
| Add a holding | AddStep1, AddStep2 | AddRetirement, AddGold |
| FIRE (the independence goal) | FlatFire | Fire |
| Insurance | FlatInsurance | Insurance |
| Tax | FlatTax | Tax |
| Property | FlatProperty (the first board it has had) | none |
| Reports | FlatReports | Reports |
| Settings | FlatSettings | Settings |
| Profile | FlatProfile | Profile |
| More | FlatMore (adds the Property row) | More |

Not redrawn, and following §1 and §3 when they are next touched: the holding detail screens
(HoldingDeposit, HoldingFund, the retirement boards, GoldPhysical), Goals and GoalDetail, and
the spending-capture boards (MonthClose, QuickAddShared), none of which is built yet in full.

## 5. What this supersedes

- `holdings.md`: *Why it changed* (the rejection of tabs) and *Filters* (chips become
  tabs; earmarks move to *Set aside* on All). HD-I1 to HD-I6 stand unchanged.
- `tokens.md` §5: the **Editable row**'s `--inset` ground, the **Quick-add** boxed
  amount, and any boxed text input, in favour of §3 here. `--inset` stays defined until
  nothing uses it, then goes.
- `conformance.md`: each screen's Artboard column names its board from §4a first; the earlier
  boards stay listed for content.

## Invariants

**SL-I1 — Holdings opens on All, which shows the whole-household total and one row per class;** a class tab is a filter in the URL. (§2)

**SL-I2 — A class tab appears only for a class the household holds,** and the active tab is always scrolled into view. (§2)

**SL-I3 — Every input has a visible label that is not its placeholder.** (§3)

**SL-I4 — A field's underline holds at least 3:1 against its ground, and focus shows a 2px accent underline.** (§3)

**SL-I5 — A field's tap target is at least 44px tall.** (§3)

**SL-I6 — In a stepped form, going back keeps every value, and nothing is written until the last step's button.** (§4)

**SL-I7 — A screen has at most one lifted surface;** other sections are plain boxes, with hairlines between their rows. (§1)

**SL-I8 — Overview and Holdings open on Mine,** and the lifted figure's label names whose it is (*Your* or *Household*). (§2a)

## Tests

- SL-I1: `#/holdings` renders the All tab current with the total and a row per class;
  `#/holdings?kind=gold` renders the Gold tab current, and back returns to All.
- SL-I2: a household with no bonds has no Bonds tab; at 375px the active last tab is
  within the viewport.
- SL-I3: every `input`, `select` and `textarea` in the app has an associated visible
  label (axe's label rule, plus a check that no label text equals a placeholder only).
- SL-I4: the computed underline colour against the page ground is at least 3:1 in both
  themes; a focused field's underline is 2px.
- SL-I5: every field's box is at least 44px tall at 375px.
- SL-I6: filling step one, going to step two and back, shows step one's values; closing
  the form on step two writes no row (e2e).
- SL-I8: a fresh sign-in opens Overview with Mine pressed and the label "Your net worth";
  pressing Household changes the label and Holdings follows; a reload opens on Mine again.
- SL-I7: each screen has exactly one element with the lifted surface's class (extends the
  existing check in `theme.spec.ts`).
