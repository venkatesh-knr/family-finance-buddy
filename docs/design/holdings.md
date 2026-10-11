# Holdings

<!-- invariant-prefix: HD -->

How the Holdings screen lists, groups, filters and opens a holding. The picture
is the Holdings row of `docs/design/vibrant-canvas.html` (four artboards); this
file is the authority where the two differ.

## Why it changed

Eight holdings took about 6.7 phone screens, because every holding rendered its
full detail inline — ten figures and four controls a card. Tabs per class were
considered and rejected: they hide the whole-portfolio picture that is Holdings'
main job, the class list grows past what a tab strip holds at 375px, and an
earmark (the emergency fund) cuts across classes, which a tab cannot express.

## The list

A summary card (the screen's one lifted surface), a list header with one Add and
one Import, a row of filter chips, then holdings **grouped by class**.

**A group** has a header — class name, count, subtotal, share of its currency's
total — that collapses it. Groups are ordered by subtotal.

**A row** is one glance: the class tile (`icons.md`), the name (one line,
ellipsis), the member and one class-specific fact, the value, and under it either
the gain or the reason there is none. About 64px. Tapping it opens the holding.

**Ended** holdings — no units left, or matured and paid out — sit in a final
group, collapsed by default.

**HD-I1 — A row shows the latest recorded value.** The figure net worth counts,
never the worked-out estimate. A deposit's newer worked-out value lives on its
detail view, beside the action that records it. Two values on a row is two
answers to "what is this worth".

**HD-I2 — Group subtotals add up to the summary total**, per currency. A foreign
holding sits in its class group, carries the abroad marker, and is never summed
into the rupee figure — the same refusal the Overview makes.

**HD-I3 — Caveats survive on rows.** A gain that is refused (a partial statement)
shows the ⓘ and the reason in the row's second line, not a blank. See DL-I4.

## Filters

Chips: **All** first and default, then one per class that has holdings, then a
divider and the earmarks that are in use. A chip is a filter, not a tab:
`role` and markup as links that set the URL.

**HD-I4 — The filter is in the URL** (`#/holdings?kind=deposit`,
`?earmark=emergency`). The back button undoes it, and an Overview allocation row
links straight to Holdings filtered to its class — the whole row is the link, no
underlined word.

Filtered, the summary card describes the filter: its subtotal and share, and
class-specific figures where they exist (for deposits: interest so far, the next
maturity). The list header's Add names the class ("Add a deposit").

## Adding

**HD-I5 — One Add on the screen.** It opens the kind picker, preselected to the
active filter. Per-row "Add a purchase or sale" moves to the detail view. Import
is the list header's second control.

## The detail view

A new screen in the inventory: back to Holdings, the identity (tile, name,
member, kind, earmark), the value card, then sections in the shape of the kind.

**HD-I6 — The detail view takes its kind's shape.** A deposit or bond shows its
terms: principal, rate, start, maturity with a progress bar, what the term pays,
interest so far, and next coupon for a bond. It shows **no units, no purchases or
sales, no realised figure** — "1 units" and "0 purchases, 0 sales" on an FD are
the bug this fixes. A fund or share shows units, cost, return, realised, peak and
its transactions.

Edit is an icon in the top bar. Archive is a visible button on the detail view,
named for the holding — **not** behind an overflow. That keeps it one tap from
the holding and in the accessibility tree, which was the reason given for having
no overflow on the old cards.

## What this retires

These rows in `conformance.md` Departures are superseded and should be removed
when this ships: **Holdings actions** (the per-card buttons), **Deposits and
bonds** (the separate card — deposits are rows in their group now, their terms on
detail), and **Asset tiles not on Holdings**.

## Tests

- HD-I1: a deposit with a worked-out value newer than its reading shows the
  reading on its row.
- HD-I2: group subtotals equal the summary total for each currency; a USD
  holding does not change the rupee total.
- HD-I3: a holding with a refused gain shows a caveat on its row in essential
  mode.
- HD-I4: loading `#/holdings?kind=deposit` renders only deposits with the chip
  pressed; back returns to All.
- HD-I5: exactly one control named Add on the list.
- HD-I6: a deposit's detail view contains no "units", "purchase" or "realised".
