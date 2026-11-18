# DRAFT: the month card's actions, redesigned

Proposed on 17 November 2026, at the owner's request. The pictures are the MonthActions
and MonthActionsLinen boards on the canvas. Each board shows a phone at 375px in two
states, a tablet at 768px and the desktop column.

## The problem

The card ends in three outlined pills of equal weight:

- *+ Money in*;
- *Close October / about 2 minutes*;
- *Accounts · 1 · Manage*.

They are three different kinds of thing:

- **Close October** is a task with a time on it. It is the most important, and it is
  there only when a month is waiting to be closed.
- **Money in** is an entry, one of two ways to add (money out is the quick add above the
  card).
- **Accounts** is a place to go.

Drawn alike, they compete with each other. *Close October*'s two-line label makes its
pill taller than the others. *Accounts · 1 · Manage* reads as three words, not a
destination.

## The design

A hairline across the card separates the figures from a footer, which holds three levels:

1. **Close October: primary, and only when it applies.**
   - A status line says why: *October is ready to close*, with *from your balances ·
     about 2 minutes* under it in muted text. The time is no longer inside the button.
   - The button is filled: lime with forest text in Linen, the light pill in dark.
   - When there is nothing to close, the status reads *October is closed · from
     balances, 1 of 1 account · 1 Nov*, and there is no button.
2. **Money in: secondary.** An outlined pill, *+ Money in*.
3. **Accounts: a link.** The word *Accounts*, a count badge (*1*, with the accessible name
   "1 account") and a chevron. It is not a button, because it goes to a place: the
   Accounts tab (`ledger-income.md` §1a).

**By width:**

| Width | Layout |
|---|---|
| Phone (below 640px) | The status line, then *Close October* full width. Below that, *+ Money in* on the left and *Accounts 1 ›* on the right. |
| Tablet (640px to 1023px) and desktop | One row. *+ Money in* and *Accounts 1 ›* sit on the left. The status line and *Close October* sit on the right, the primary at the row's end. The row wraps, right group under left, if the text is enlarged. |

**Rules kept:**

- Every target is at least 44px tall.
- No button has a fixed height, and its text never wraps inside it: the row wraps
  instead.
- Focus is visible on every control.
- The order in the document follows reading order: Money in, Accounts, status, Close.
- No new icon: the *+* is a character and the chevron is the one already used.

## Departures, proposed

| What | The prototype | The app | Why | Status |
|---|---|---|---|---|
| Month card actions | three outlined pills of equal weight in one row: *+ Money in*, *Close October / about 2 minutes*, *Accounts · 1 · Manage* | A footer under a hairline. *Close October* is a filled primary with a status line beside it, shown only when a month is waiting. *+ Money in* is an outlined secondary. *Accounts* is a link with a count badge and a chevron. On a phone, Close is full width above the other two; on a tablet or desktop, everything is on one row. | The three are a task, an entry and a place, and the most timely one should lead. The owner asked for a redesign on 17 November 2026. | proposed |

## Prompt for Claude Code

```
Redesign the three actions at the foot of the Money month card as
docs/drafts/month-actions.md describes; the pictures are the MonthActions and
MonthActionsLinen boards on the canvas.
- A hairline separates the footer from the figures.
- Close <Month>: a filled primary on the lifted surface (--lift-press and
  --lift-press-ink in Linen, the light pill in dark). It appears only when a month is
  waiting to be closed, with the status line "<Month> is ready to close" and "from your
  balances · about 2 minutes" beside it. When the month is closed, show the closed
  status line and no button.
- + Money in: an outlined secondary pill.
- Accounts: a link to #/money?tab=accounts, with a count badge (accessible name
  "N account(s)") and a chevron.
- Layout: below 640px, the status line and a full-width Close, then Money in (left) and
  Accounts (right). From 640px up, one wrapping row: Money in and Accounts on the left,
  the status line and Close on the right.
- At least 44px targets, no fixed heights, visible focus, and DOM order as reading order.
Add the row from docs/drafts/month-actions.md to conformance.md as proposed. Tests:
- Close is absent for a closed month;
- the Accounts link targets the Accounts tab;
- at 375px, Close spans the card's width;
- at 200% text, nothing overflows the card.
```
