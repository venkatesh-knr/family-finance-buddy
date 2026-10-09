# Decisions

What was decided, by whom, and why, in the order it happened, so a later session (or the maintainer, in
a year) does not have to reconstruct it from pull requests. `docs/blueprint.md`, `docs/tokens.md` and
`docs/build-plan.md` are the specification and the plan; `docs/design/conformance.md` is where the code and
the mock disagree on purpose; `docs/handoff.md` is how to pick the work up. This file is the *why*.

An entry is a decision, not a changelog: if it only describes what was built, it belongs in the pull
request. "Maintainer" means the person who owns the household and the repository. Where an entry changes
an authoritative document, it says which and what.

## The UI review (September 2026, PRs #38, #39, #41, #42)

- **Net worth is the one hero figure on Overview.** The per-currency figures are stat tiles beneath it.
  This reverses a row in `conformance.md` that had put Assets above net worth to lead with what was known:
  that answered a red paragraph which has since become a mark on the figure. *Chosen by the maintainer.*
- **A caveat marker is `i` in the muted colour for a figure that is right and `!` in brass for one that may be
  wrong; the `▲` is reserved for a gain.** A warning that borrowed the gain arrow read as a loss.
- **`docs/tokens.md` section 3 changed:** mono is for figures in a table and the table header only; hero and
  stat figures are Public Sans with tabular digits (checked: the digits are the same width, so a column still
  aligns); labels are 12px sentence case; a magnitude suffix (`L`, `Cr`, `K`) is a unit span, 0.6em, welded on
  and never below 11px. Pills are deliberately exempt. The prototype was not redrawn: where it disagrees,
  the tokens win, and it carries a note saying so.
- **A class has one fixed colour on every screen** (`kindColour`), not a colour by rank: coloured by position,
  Bonds is one colour when it is third and another when it is second. A total takes a neutral token. (Section 6 of
  the tokens.)
- **The since-inception chart plots assets, not net worth,** because there is no dated debt to subtract. It starts
  at the first month every holding has a reading and says what stopped it going further back. The contributed
  line and member attribution are deferred, not dropped.
- **Overview alone is a two-column grid from 1024px, at a 1200px measure;** every other screen stays at 880px.
- **Edit is a pencil that takes you to the editor** (caret in the first field, scrolled into view); a member is
  their initials in a ring of their colour, growing to two letters only where two collide.
- **The duplicate privacy control on Overview was removed:** two controls for one state is the fault recorded for
  the currency control.

## Tax (September 2026, PRs #35 to #37, #42, #43)

- **Rates are never fetched.** Tax rules are dated `tax_rule` rows added by a reviewed migration. A household or a
  scraper that could change a rate could compute whatever figure it liked. What protects against a stale rate is
  the "last checked" date on the page and a warning when it is older than the year's Budget. *Chosen by the
  maintainer; a scheduled Budget-day reminder (a GitHub issue around 1 February and again after the Finance Act)
  is planned and deferred, and fetches nothing.*
- **Each year uses the rules in force for it, by date;** a year no rule covers refuses rather than borrowing another
  year's. Years before 2025-26 are not seeded. The year picker offers only this year and years with a sale in them.
- **A Budget migration that changes the slab structure must end-date the rows it replaces,** or both sets stay in
  force and the bands interleave. `tax_rule_in_force.test.sql` fails if it does not.
- **A folded card shows the rates a year applied,** read through the same lookups as the calculation so the two cannot
  disagree.

## How the work is run (September to October 2026)

- **`main` is protected:** the CI check `Typecheck, tests, policy suite, build` is required; force pushes and deletion
  are blocked; there is no required review (the maintainer is the only committer and cannot approve their own PR);
  administrators can bypass. *Chosen by the maintainer.*
- **Merge on green.** When asked to open a PR and watch CI, merge it once the check passes, with no approving review,
  then watch the Pages deploy. Recorded in `docs/handoff.md`. *The maintainer's, 2026-09-25.*
- **The work is done in one place at a time,** the maintainer's Windows machine or a cloud session, handed over through
  git (`docs/handoff.md`, `npm run handoff`). Nothing is shared except what is pushed.
- **Policy tests are written first and shown failing where they can be.** A policy test cannot run locally (Docker is
  blocked by the antivirus), so CI is where it first runs.

## Who can read what (October 2026, PRs #45, #47, #49)

- **A contributor reads their own records; a viewer reads a summary and nothing else.** This is blueprint section 11,
  now enforced in the database and not only promised. *Chosen by the maintainer:* a viewer's summary is totals only
  (no holding names or identifiers), and a contributor reads the household's plan and expense totals but not other
  members' rows.
- **A consequence, intended:** a contributor can no longer record a purchase or a sale against somebody else's holding.
- **Exchange rates stay readable by a viewer** (an existing test says so on purpose: they are part of every figure shown).
  **`instrument` is not narrowed per member:** a contributor adding their own holding inserts an instrument and reads its
  id back in the same statement.
- **Overview and FIRE are not offered to a role that can read only part of the household,** because they would add up what
  that role can see and present it as the household's.
- **An audit row about a position is as private as the position.** The log carries `before` and `after` in full, and its
  policy covered only a row that states its own visibility and, by name, a valuation snapshot; a partner's *personal*
  purchase and sale audit rows (cost and proceeds, which are the gain) were readable by the owner. The fix is a rule about
  the payload, not a longer list: an audit row naming a `holding_id` is readable only by whoever can read that holding.
  Found while designing the next item; the test was written first and CI showed it failing on the leak.

## Deposits, bonds and the rest of the balance sheet (October 2026, PRs #48, #50)

- **A deposit or a bond is entered once, as its terms; its value is computed, never typed.** *The blueprint's rule.*
- **Compounding is a property of each deposit, never a default.** The blueprint's example is quarterly; this
  household's deposits compound yearly. *The maintainer's.*
- **An auto-renewing deposit is a chain of terms:** the interest joins the principal and the whole is redeposited for the
  same term, at the rate the bank then offers. A renewal that has happened is recorded from the bank's advice (the new
  rate is a fact only the advice knows); one that has not is projected on the same term, at an assumed rate or the last
  term's, and shown as a projection. Projections are never stored. *The maintainer's description.*
- **The convention is stated in `src/domain/accrual.ts`:** interest is credited at the end of each period and rounded to
  the paisa then; a part-period accrues simply on the balance, actual over 365; a bond coupon accrues as face x coupon x
  days / 365. A bank's own figure is the authority and may differ by a few rupees. *Open: the maintainer is to check it once
  against a real FD advice.*
- **The household holds property, fixed deposits, bonds, PPF, EPF, NPS and other,** which sets the rest of the order in the
  plan (item 6).

## The sign-in path (October 2026)

- **A failed second-factor check is said as what it was.** One sentence for every cause ("codes expire every 30 seconds")
  sent a person round fetching fresh codes while the session had simply gone stale. Failures are classified first (wrong
  code, late code, stale session, vanished factor, rate limit, network, unknown) and a stale session is checked before a
  mismatch. No raw server text is shown.
- **The authenticator QR is converted to markup in the repository layer, not drawn as an image,** because the
  Content-Security-Policy applies to the built bundle only and a `data:` image would work in development and be blocked on
  Pages. It is checked first, since it is injected as markup; anything that is not a plain SVG falls back to typing the secret.
- **The switcher tells households of the same name apart** (role, then date created, then a short id). Which households
  exist is the maintainer's decision, and a client cannot rename or remove one.

## Honest figures (October 2026, from the first design-conformance review)

- **A cost nobody recorded is not a cost of zero.** `assetTotals` and `allocationByKind` summed a valued holding's
  missing cost as nothing, which turned a gain into a larger gain and a class return into +200%, with an up-arrow beside it.
  The gain and the return are now refused where a valued holding has no cost (`costMissing`, beside `costShort`), on Overview
  and on Holdings, which had the same sum. A cost recorded as nothing (bonus units) is a cost; a holding nobody has read is on
  neither side of the comparison, so it is not a reason to refuse.
- **A failed request is not an empty result.** A rejected loans request was read as "no loans", so net worth showed high by
  the whole debt under a caveat saying nothing was owed; a rejected rates request was read as "a rate is missing, add it". Each
  is now recorded and said on the figure, as the private-holdings failure already was, and the "no debts" note and the add-a-rate
  button are not shown when the request failed.
- **Both were found by running the design-conformance subagent twice** (opus, then sonnet) on the same slice. Each found two real
  high-severity problems the other missed, so the review is not run on one model alone without knowing that.

## Whose membership (October 2026)

- **Every screen reads the caller's own membership, not the oldest one in the household.** The policy on `membership` shows
  everybody's, deliberately, and four lookups trusted a comment saying it did not. They took the owner's role and member id
  for whoever was signed in, and listed a household once per person. Found through a raw UUID in a screenshot, which the
  household-label fallback only reaches when the same id appears twice; the first reading (three households, a data problem) was
  wrong. The fix is filtered lookups (`repo/account.ts`), and the UI-review finding is corrected.

## What the dates on a figure mean (October 2026, from the second design-conformance review)

- **A month is covered only if every holding that existed in it was read in it.** The reading-gap check took the union of months
  in which any holding was read, so one fund read monthly hid another read once; the screen then said the year's peak was a
  figure when it was a lower bound. It is now holding by holding, and names which holdings are missing in which months. A holding
  is owed a reading from the month it was opened (January if nobody said when) to the month before it was archived.
- **Archiving a holding does not rewrite the past.** The history line dropped archived holdings from every month, so tidying up in
  October changed March. An archived holding now counts on the dates before the day it was archived (an IST day, from
  `archived_at`); with no archive date it cannot be placed and is left out.
- **"As at" comes from what is in the figure.** It was the newest reading anywhere, including an archived fund's. It is now the
  newest of the latest reading of each live holding, the figure says it runs from the oldest to the newest, and readings more than
  45 days behind the newest are named under Needs attention. 45 is a judgement: monthly readings should never trip it, and a
  missed month should.
- **Migrations `20260927120000` (audit follows the holding) and `20260927130000` (fixed-income terms, deposit renewal) have been
  applied** by the maintainer.

## Bank and card import (October 2026), not started

- Sources are an HDFC savings account, an ICICI savings account and an ICICI credit card, in the formats listed in the plan
  (item 7). Real statements are redacted by the maintainer and kept **outside the repository**, which is public; fixtures here
  are synthetic. Whether to add a spreadsheet library for XLS is **undecided**.
