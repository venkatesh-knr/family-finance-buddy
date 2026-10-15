# Goals

<!-- invariant-prefix: GL -->

What a household is saving for, how far along each goal is, and what it would
take to reach it. The picture is the Goals row of
`docs/design/vibrant-canvas.html` (the Goals tab and a goal's detail); this file
is the authority where the two differ.

## Why now

Goals are in the blueprint's data model — `goal`: name, target, currency, target
date, priority, linked accounts, its own inflation rate — and on its "FIRE &
goals" screen. Build-plan step 9 schedules them. None of it is built.

Something goal-shaped already is: the **earmark** on a holding (`emergency`,
`retirement`, `child`, `house`, `none`; `20261011120000`, `src/domain/earmark.ts`).
An earmark says what money is *for* but has no target and no date. If goals are
built beside earmarks, a household ends up with a holding earmarked "child" and a
goal called "Daughter's education" that know nothing about each other. So goals
**replace** earmarks; they do not join them. The sooner that is decided, the less
data there is to move — 23 files read the earmark today.

## The tab

**FIRE becomes Goals** — same slot in the bar, renamed, flag glyph. "FIRE" is
jargon most members of a family will not recognise; "Goals" needs no
explanation. Financial independence becomes the first goal on it, and the current
FIRE screen becomes that goal's detail view. `/fire` redirects to `/goals`.

The tab: independence as the one lifted surface (target, date, how far along),
then the other goals as rows, then one **Add a goal**. Each row: a tile, the name,
the date and the target in today's money, progress, and what it needs a month.

## The model

```
goal       id, household_id, kind, name, target_today_minor, currency,
           target_date, inflation_rate, expected_return, priority, archived
           kind ∈ independence | emergency | education | house | other

holding    goal_id → goal, nullable        (replaces holding.earmark)
```

`target_today_minor` is in today's money; the target at the date is computed,
never stored.

## Invariants

**GL-I1 — A holding links to at most one goal.** As the earmark was. Splitting
one holding across goals is a later question, not a default.

**GL-I2 — Every household has exactly one independence goal, and it is the FIRE
calculation.** Its target comes from the plan — a year's cost × the multiple, at
the household's inflation — and is never typed. Holdings linked to it, *and
holdings linked to no goal*, count toward it. This is the earmark rule restated:
`retirement` and `none` counted; everything else did not.

**GL-I3 — At most one emergency goal, measured in months of spending, not
rupees.** It keeps protection-and-flow's rules: the trailing twelve-month average
as the denominator, and an empty state — not a number — with fewer than three
months of spending recorded.

**GL-I4 — A target is entered in today's money and inflated at the goal's own
rate to its date.** Both figures are shown. School fees and healthcare do not
rise with groceries, which is why the rate is per goal; a fixed-amount goal (a
house deposit) has a rate of zero.

**GL-I5 — Locked money counts toward a goal only if it is available by the goal's
date.** A deposit or scheme that matures after the date is listed under the goal,
shown as not counted, and says why — with the two ways out: link it to a later
goal, or move the date. A lock-in hidden inside a progress bar is the one way
this screen could tell a household they have money they cannot reach.

**GL-I6 — "Needs ₹X a month" is a calculation, with its assumptions on its
face.** Expected return and inflation are the goal's own, editable, and shown
beside the figure. Same posture as the cover gap and the FIRE projection: a
stated calculation, never advice.

**GL-I7 — Progress uses the same values as net worth.** A holding's latest
recorded reading, as HD-I1 — never a worked-out estimate — so a goal and the
Overview cannot disagree about what something is worth.

**GL-I8 — Private holdings keep their privacy inside goals.** Another member's
private holding linked to a shared goal adds to that goal's progress as part of
one "private" figure; its name and amount are never shown to anyone else. This
needs a per-goal total from the same kind of definer function as
`personal_holding_totals` — sums only, never rows.

## Moving earmarks to goals

Done once, at the start of step 9, in one migration:

| earmark | becomes |
| --- | --- |
| `retirement` | linked to the household's independence goal |
| `none` | no goal (counts toward independence, as before) |
| `emergency` | linked to an Emergency fund goal, created if any holding needs it |
| `child` | linked to a "Child's savings" goal of kind `education`, **no target yet** |
| `house` | linked to a "House deposit" goal of kind `house`, **no target yet** |

A goal with no target shows what is linked to it and asks for a target and date;
it shows no progress bar and no monthly figure — inventing a target to draw a bar
would be worse than drawing none. The FIRE corpus is unchanged by the migration:
the same holdings count toward independence before and after, and a test says
so. The `earmark` column is dropped only after every reader has moved.

**Until then, no new earmark values,** and nothing new is built on top of the
earmark.

## Tests

- GL-I1: a holding cannot be linked to two goals (a schema constraint).
- GL-I2: exactly one independence goal per household; its target equals the
  FIRE calculation; unlinked holdings count toward it.
- GL-I3: the emergency goal with under three months of spending shows the empty
  state, not a figure.
- GL-I4: a goal's target at its date equals the today's-money target compounded
  at its own rate.
- GL-I5: a deposit maturing after the goal date is listed and not counted.
- GL-I7: a goal's progress uses the reading net worth uses.
- GL-I8: another member's private holding contributes to a goal's total and is
  absent, by name and amount, from the response.
- Migration: the FIRE corpus is identical before and after moving earmarks to
  goals, on the demo household.

## Not now

- Contributions toward a goal (SIP tracking) — the real-contributions projection
  of step 9 is where that lands.
- Coast-FIRE and scenario compare — step 9, after goals.
- Splitting one holding across goals.
