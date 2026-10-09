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

## The second design-conformance review of Overview (October 2026)

Answered finding by finding. Ten findings; the reviewer ran once and did not know the first review's results.

- **Agreed and fixed:** 1 (archived holdings never reached Overview, because `listHoldings` returned only active ones, so the
  archive-aware history and gaps shipped in #58 were fed nothing; it now takes `includeArchived` and Overview asks for them); 2
  (the Assets and Allocation cards leave out other members' private holdings that the hero includes: now a warning on each, naming the
  sums, since a split by class would let a private figure be worked out); 5 (nothing valued is no longer shown as a net worth of
  zero); 7 (the coral peak alarm is for foreign holdings, which are what the peak is for; domestic gaps are said quietly); 8 (the
  rate field no longer suggests a rupee rate for any pair); 9 (the private-totals failure caveat is on the household figure only); 10
  (dates written as the rest of the screen writes them).
- **Agreed, and needs the maintainer** — they are schema decisions, and CLAUDE.md says to discuss invariants before changing them:
  3 (`fx_rate` grants `update` and `addRate` upserts, against "dated rows, appended, never updated") and 4 (`valuation_snapshot`
  likewise, against blueprint §03 "nothing is ever overwritten"). Both migrations chose correction in place on purpose, and the audit
  trigger keeps the old value, but that is the invariant's text being departed from without a Departures row. The choices are to
  revoke `update` and correct by superseding row, or to amend the invariant. **Not changed.**
- **Agreed, and a design of its own:** 6 (allocation by wrapper, not asset class; recorded as a Departure until the mapping is
  designed). The note that the per-currency donut is stale is right in principle, since `fx_rate` exists, but converting shares
  changes what a share means when a rate is missing, so it waits for the same decision.
- **Not reproduced end to end.** 1 and 5 are confirmed by reading the code and by the tests of the domain behind them; the demo household
  has no archived holding and has readings, so neither can be seen on it.

## From the maintainer's screenshots (October 2026)

- **One "i" on the net worth card, and one "!" on the figure.** Five warnings and two notes sat on the number as seven marks, two of them
  identical "i"s with different meanings. The warnings are one list behind one mark; the notes (how old the readings are, nothing
  owed) join the definition on the heading.
- **The screen tabs are the navigation and are sized as such** (15px on a wide screen; the Household/Mine switch stays small).
- **The unit on a figure (L, Cr, K) is in the body ink at 600**, not muted at 500: it is part of the number.
- **Long lists show ten and give the rest** on the button or as the list is scrolled to (expenses, activity). The button is the
  control; the scroll is a convenience.
- **A fund's name is split, not shortened.** The fund is first; the plan and the former name sit beneath in the quiet type. Every
  word stays on screen, and the stored name, which a statement matches on, is untouched.
- **A name in a Needs-attention list is a rectangle, not a pill:** a half-circle border drew through the words once they wrapped.
- **Assets over time was checked:** the last point, ₹50.01 L, is the INR holdings plus the USD holdings at 88.45, and the hero's
  ₹62.58 L less that is the other members' private holdings, which the line says it leaves out. It has two points, 31 Aug and 18 Sep, on an
  axis that starts at zero, so a small move does not show; it starts at 31 Aug because no USD rate exists before then.

## Deposits and bonds (October 2026)

- **A card on Holdings, not a tab.** The design puts the fixed-income ladder on the investments screen, and a deposit is a holding, so it
  lives there (`FixedIncome.tsx`). Adding a sixth tab would have been a departure from the mock with no reason behind it.
- **The terms are typed and the value is worked out, on the day**, by `domain/fixed-income.ts` over `accrual.ts`: a deposit through
  its chain of terms, a bond at par (face plus accrued interest, since an unlisted bond has no market price). Nothing worked out is stored.
- **A renewal the bank has made is recorded from its advice; one it has not is projected and marked as one.** A projection is never
  offered as a reading.
- **A deposit joins net worth through a reading.** "Record as today's reading" writes the day's worked-out value as an ordinary
  `valuation_snapshot` (source `manual`, note "Worked out from the terms"), so net worth, the line over time, the reading gaps and the
  month close treat a deposit like anything else and none of them learn about terms. The alternative, computing a value for every
  fixed-income holding on every screen, would put a new point on the history line each day and make the reading-gap check meaningless
  for them. **Open decision for the maintainer:** whether the reading should be taken automatically (the close-month button already writes
  readings, and could write these), since as built a deposit is absent from net worth until somebody presses the button.
- **Three inserts, not one.** The instrument, the holding and the terms are separate writes because the client has no transaction. If the
  terms are refused after the holding exists, the holding is archived. A function that does all three in one statement is a migration of
  its own, and is the better answer if this ever fails in practice.
- **A matured position has paid out and is not a holding any more.** The card shows what it paid and when, leaves it out of the total,
  offers no reading for it, and says to record where the money went and archive it. Keeping its payout as its value indefinitely, as the
  first version did, counted money the bank had already returned.
- **Interest is counted term by term.** The value less the first principal was wrong whenever a renewal started from a different
  figure: interest paid out and the principal renewed, tax taken at source, a top-up. Each term's interest is its end value less its own
  principal, summed. Three fixtures, one for each of those.
- **An existing deposit or bond is given its terms, not entered again.** The household's deposits and bonds were holdings before there
  were terms, and entering one again makes a second holding, counted twice. "Give its terms" writes the terms against the holding that
  is there.
- **A worked-out reading is stored as `manual`** with a note, which is an accepted shortcut: a `computed` source would be clearer and
  needs a migration. Revisit it with the decision above.
- **The slice was reviewed once** (design-conformance, eight findings). Agreed and fixed: the matured payout counted as a value (1),
  interest per term (3), terms for an existing holding (4), the loading state (7), the tone of the "renews itself" pill (8). Agreed and
  recorded, not built: repay mode, rating changes and a reinvestment prompt (5), and the source label (6). Agreed, and the substance of
  the open decision: that a deposit reaches net worth only by pressing a button (2). Not changed: the specification's quarterly
  compounding formula in blueprint §8, which is the maintainer's document.
- **Not built:** correcting a deposit's terms or a renewal in place (the policies allow it), coupons received, repay mode, rating
  changes, and PPF, EPF and NPS.

## Bank and card import (October 2026), not started

- Sources are an HDFC savings account, an ICICI savings account and an ICICI credit card, in the formats listed in the plan
  (item 7). Real statements are redacted by the maintainer and kept **outside the repository**, which is public; fixtures here
  are synthetic. Whether to add a spreadsheet library for XLS is **undecided**.
