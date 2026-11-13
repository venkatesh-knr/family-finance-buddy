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
  for them. **Decided: Close month does it** (see "Close month works deposits out" below).
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
- **Corrected in place** (a follow-up, from the maintainer's screenshot): the terms of a deposit or bond, and a recorded renewal, by the pencil
  on the row. In place because a wrong rate is wrong on every day, and the audit log keeps the version it replaced. The holding's own cost
  and opening date follow the terms only when they still agreed with what is being replaced; a cost set by hand to something else is left.
- **A maturity within thirty days is called out on the card**, naming the decision (where the money goes, or that the bank's advice is
  due for a renewal), thirty being the lead time the design shows for "Bond and deposit maturity". It is a prompt, not a notification: the
  scheduled reminder is the Calendar's.
- **The blueprint's §8 formula is stated for any compounding** (`M = P × (1 + rate/n)^(n × y)`), with this household's yearly deposit as the
  worked example, since the quarterly one read as the rule. It is for deposits only; a bond has a coupon.
- **The forms are on a grid** and not a wrapping row. A row that wraps and aligns to the bottom put the box of any field with a hint
  higher than its neighbours', which is how the first version came out crooked.
- **Not built:** coupons received, and PPF, EPF and NPS.

## A bond's repay mode and its rating log (October 2026), schema proposed

Migration `20260928120000`, for review. It adds no new access rule beyond one new table, and the code that uses it is a separate change
that waits for the migration to be applied.

- **Repay mode** is `payout` (coupons paid on each coupon date) or `cumulative` (interest compounds at the coupon frequency and is paid
  with the face at maturity). Null means payout, which is what every bond recorded so far is, so nothing stored changes meaning and
  nothing is backfilled. It is nullable for a second reason: a NOT NULL would refuse every bond the application inserts between the
  migration being applied and the code that sets it being deployed. Bonds only, because a deposit has its own compounding.
- **The rating log is written by a trigger on the terms and by nothing else.** Nobody inserts, updates or deletes a row: a downgrade
  cannot be edited into something milder, filed as an upgrade, or tidied away. It is the shape of `audit_log`, so RLS is enabled and
  not forced, because the definer trigger writes it as the table's owner. It records each change with the day it was noticed, in IST;
  the first row of a bond is the rating as first recorded, and a removed rating is a change to nothing, not a gap. A save that changes
  nothing writes nothing.
- **It is as private as the holding**, by the holding's own policy, and its audit rows follow the holding by the rule already in place.
- **Tests:** `supabase/tests/bond_repay_mode_and_rating_log.test.sql`, 23 assertions: nobody can write the log, only the trigger does,
  the privacy by role, a password alone reads nothing, and the repay mode's two checks. It runs in CI; it has not been run locally,
  because Docker is blocked on the maintainer's machine.

## Repay mode and ratings, built (October 2026)

On the migration above, once applied.

- **A cumulative bond is a deposit's arithmetic.** Interest is credited at the coupon frequency and paid with the face at maturity, so it is
  valued as interest that keeps compounding, shows no coupon, and says what it pays at the end. A payout bond is exactly as before; an
  unset mode is payout. The label says "Interest credited" and not "Coupon paid" when it is cumulative.
- **A downgrade is a move in grade, read from the grade alone** (`domain/ratings.ts`). The agency prefix, an outlook and a suffix are not
  the grade; a short-term rating (A1+) is on another scale and is not ranked against a long-term one, so a change between two things it
  cannot rank is "unknown" and not "unchanged". A change of agency or outlook at the same grade is not a downgrade.
- **A change is judged against the last rating that was set,** not only its own row. Clearing a rating and entering a lower one is two
  saves, "AA to nothing" and "nothing to BB", and neither alone is a downgrade; judged against the last one set, the second is AA to BB.
  A rating that follows a gap is "rated again", and only a bond's very first is "first recorded". ICRA's own notation, `[ICRA]AA+`, is
  read: brackets are separators, not the start of a suffix.
- **The latest change that says something is the one that stands.** An upgrade back clears a downgrade; a change of agency or outlook at
  the same grade, and a first rating, say nothing and are passed over; a downgrade is called out for 180 days and the rating history on
  the bond keeps it for good.
- **A change the app cannot rank is said, not skipped.** A short-term rating falling from A1+ to A4 is severe and is on a scale the app
  does not read; "unknown" is not "unchanged", so the row and Overview say the rating changed and the app could not tell which way, and
  point to the agency's letter. A rating that was removed and has not come back is said too: it is not good news. 180 is a judgement: long enough to be found, short enough that a bond that stayed down
  for a year is a fact on its history and not an alarm that never stops.
- **A downgrade is not left to be found on Holdings.** It is on the bond's row, and on the Overview's Needs attention in the coral tone,
  with the bond named. So is a maturity within thirty days, which is the reinvestment prompt. Both appear only for what the caller can see,
  and in Mine only their own. If deposits, bonds or the rating history could not be read, Overview says so and does not read it as
  "nothing to report".
- **A deposit that renews itself is told it renews, not that its money comes back.** Overview says so in a separate item, with the same
  words as the row: the bank's advice is what is awaited. "Decide where it goes" to somebody whose deposit renews on its own is how a
  duplicate gets entered and counted twice.
- **Nothing in the app writes the rating log.** A rating is changed by editing it on the terms; the trigger records the change. The form
  says "a change is logged" beside the field when editing.
- **A defect found on the way:** a select inside a label that also holds a help button was given no accessible name, so a screen reader
  announced an unlabelled dropdown. It was in the Compounds field of the first deposits slice and in the older Tracks field. The selects
  are now named outright.

### The review of this slice

Seven findings, all agreed and fixed: `[ICRA]AA+` was never read, so an ICRA downgrade was never called out (1); a downgrade done as a
clear and a re-entry slipped through and its history row said "first recorded" (2); a change the code could not rank was shown like no
change (3); the card's caveat still said a cumulative bond was not valued correctly (4); Overview told a renewing deposit "the money comes
back" (5); the same downgrade was brass on Holdings and coral on Overview (6); "in 1 days" (7). Blueprint §8 now says the deposit formula
covers a cumulative bond. The demo household has no rated, cumulative or soon-maturing bond, so `test:screens` shows none of it; the
e2e spec is what exercises these states, against the demo household, and archives what it makes.

## Close month works deposits out (October 2026)

The maintainer's decision, on the open question above: a deposit reaches net worth without a button on every row.

- **The worked-out value is written when the month is closed.** For each deposit and bond the caller can read, Close month works the
  month-end value out from its terms (`monthEndReadings`, the same `fixedIncomeView` the card uses, so a reading and a row cannot
  disagree) and writes it as a `backfill` reading, which is what the schema calls a month reconstructed afterwards. Nothing is
  overwritten: a day that already has a reading keeps it.
- **It is orchestrated in the client and not done in SQL.** `close_month` is a SQL function that carries a reading forward; a deposit has
  none to carry, and its value is arithmetic, which this project keeps in pure functions and not in the database. So the Close button
  works the values out in TypeScript and writes them (`recordComputedReadings`, insert-if-absent), then runs the function as before.
- **In that order, deliberately.** Run first, `close_month` would carry a mid-month reading into the month-end slot of a deposit, and
  the worked-out figure would have nowhere to go.
- **What it leaves out, and says so.** A position that has paid out is not a holding any more; an assumed renewal is an estimate and is
  never written as a reading, so a renewing deposit whose renewal has not been recorded stays unread and shows as a gap, which is the
  prompt to record it; one that has not started, or cannot be valued, has no value to give. The Close message names the counts.
- **Unread is not failed.** The button waits until deposits and bonds have been read. A first version let a quick click through while they
  were still loading and told the person they "could not be read", which was false; found by the end-to-end test.
- **A position that has paid out is left out from the day it did, worked out from the terms.** Found by the review of this slice: with a
  reading written at every close, every maturity would have left its last month-end value in net worth at the pre-maturity figure until
  somebody archived it by hand, and counted twice once the money was in a bank balance. A zero reading would show a false loss, since
  the cost stays counted; auto-archiving would drop it with no way back from the screen. So it is derived (`paidOutHoldings`) and applied
  where the totals are made, on Overview and on the Holdings portfolio alike so the two cannot disagree: nothing is written or archived,
  its history before the day it paid out is kept, it stops being owed readings, and correcting the terms puts it back. A deposit that
  renews itself is never paid out.
- **Close does not run if deposits and bonds could not be read.** It would carry a stale mid-month reading into the month-end slot for
  good, which is the thing the order above exists to prevent. The button is disabled and says why. A failure to read the rating history
  alone is a separate failure, and does not stop a close.
- **The Close message names what was left out and does not count it twice.** Renewals not recorded, paid out, not started and could not
  be valued are each named; "unread in all" is the SQL function's own count, which includes them.
- **The Holdings note names the Overview only to an owner or a partner**, who alone can close a month.
- **The end-to-end test closes last month for the whole demo household,** which writes readings that cannot be deleted. The first run
  carried three; after that it is idempotent and writes only for each run's own deposit, which is archived.
- **Still true:** the current month is not in net worth until it is closed, or the link on the row is used, and the row's link stores
  source `manual`, since a `computed` source would need a migration.

## Bank and card import (October 2026), not started

- Sources are an HDFC savings account, an ICICI savings account and an ICICI credit card, in the formats listed in the plan
  (item 7). Real statements are redacted by the maintainer and kept **outside the repository**, which is public; fixtures here
  are synthetic. Whether to add a spreadsheet library for XLS is **undecided**.

## From the owner's answers to four open questions (October 2026)

- **A policy's surrender value is not liquid.** The holding that carries it stays in net worth and in the FIRE corpus and is left out of
  the liquid corpus the cover gap subtracts (PF-C17). It applies to every linked policy and not only a ULIP, since an endowment and a
  money-back policy surrender on the same terms; narrowing it to ULIPs is a change to which policies link a holding.
- **The cover figure is said in years from two years.** 305 months is twenty-five years. Below two years it stays months
  (`coverPhrase` in `src/domain/earmark.ts`).
- **An owned home is not in the FIRE corpus.** Not built yet: property is step 6, and the corpus function says so when it arrives.
- **Retirement is a kind (EPF, NPS and PPF).** Not built yet: it is step 6. PPF moving out of the deposit schemes is a migration that
  step makes.

## Property (October 2026, the maintainer took the recommendations on all five questions)

Proposal and reasons: `docs/reviews/2026-10-26-property/proposal.md`. Schema: `supabase/migrations/20261026120000_property.sql`.

- **A property's value is dated rows, not a column.** `property_valuation` is one estimate a day with the basis it was arrived at (own
  estimate, circle rate, broker, registered); net worth reads the latest at or before the day asked, so an earlier day's figure never moves.
  The blueprint's single `current_value_minor` and `valued_on` are replaced. Staleness is computed from the date and never stored.
- **The household's share is what counts.** `co_owner_share_pct` is the share the household holds; net worth and the cost basis use the share and
  never the whole. Co-owners outside the household are not modelled.
- **A property can be personal,** as a holding or an expense can: returned to its member and nobody else, with the same contributor and viewer
  narrowing as every other table. Owed before a screen offers it: a personal property joins `my_private_entry_count`, the Profile's list of
  private entries and the activity names (`src/features/profile/`), and a function returning sums for the household total, as holdings have.
- **A property that is not lived in** is not decided by the schema; a rule of the corpus calculation, to be written with the net-worth slice.
  The recommendation stands: out for now, with the option to include a let property when rent is built.
- **A valuation is stale after twelve months,** a household setting (`household.property_valuation_stale_months`). The figure still counts and
  carries the mark.
- **Not in the first migration:** rent, tenant, annual property tax and the sale (disposal, the indexation election, reinvestment clocks, TDS).
- **Property is in net worth, the allocation and the history, at the household's share (October 2026).** Each property is read as a
  holding of the kind `property` by the existing calculations (`src/features/overview/propertyAssets.ts`): its valuations are its readings,
  its cost basis is its cost, so the Overview shows a return on it. A loan linked to a part-owned property is taken at that share, not
  whole. The reading-gaps card and the staleness of readings leave property out (it is valued when somebody values it, and its age has its
  own rule). The FIRE corpus leaves property out, and a loan linked to a property out with it: the owner's rule that an owned home is not in
  the corpus, applied to its loan too. Whether a property that is not lived in is in the corpus is still not decided, and nothing here says
  it is. Net worth reads a valuation dated at or before the day, as the history does.
  The day a total is as at takes the newest valuation into account, so a property valued after the funds' last reading is not counted in a
  figure labelled with an earlier day, and the history is not withdrawn over it. A valuation older than the household's months is counted and
  marked on the Overview, with the property named and what to do. The share a loan is taken at belongs to the loan: it is the same in a
  personal view as in the household's. The FIRE screen says a property is left out, with the amount, and its own warnings leave out what is
  only about property.
- **The owner's three answers on the net-worth slice (27 October 2026).** (1) Property **is** in the allocation ring. (2) The FIRE corpus leaves
  out only a home the family **lives in** (`property.is_self_occupied`), with the loan linked to it; a property that is not lived in is in the
  corpus at the household's share and its loan is subtracted. (3) Property takes **its own new hue**, `--c8` rose, so it no longer shares Equity's
  emerald: `docs/tokens.md` section 6, `src/styles/tokens.css`.

## Retirement (October 2026, the maintainer took the recommendations on all eight questions)

Proposal and reasons: `docs/reviews/2026-10-27-retirement/proposal.md`. Schema: `supabase/migrations/20261027120000_retirement.sql`.

- **One kind, `retirement`, with a `retirement_type` of epf, nps or ppf.** One Retirement row in the allocation and one chip on Holdings.
- **A PPF is computed** from its entries and the notified rate (`src/domain/ppf.ts`): the lowest balance between the close of the 5th and the
  month end, at the rate notified for the month, rounded once to the rupee and credited on 31 March; the value steps at the credit and is never
  marked up in between (PF-C11). It reaches net worth as a deposit does: the screen works the value out and "Record as today's reading" or Close
  month writes it. It is reconciled against a passbook reading once a year.
- **The notified rate is a public table**, `scheme_rate`, readable by anyone signed in and written by migration only, as `tax_rule` is. Seeded
  with **7.1% from 1 April 2020, which is not verified**: it is from memory of the 2020 notification and has to be checked against a real PPF
  statement. A change is a migration that appends a row.
- **An EPF is a passbook balance typed as a reading, and an NPS is units with a typed NAV**: no table for either. A feed for the pension
  regulator's NAV, and an EPF estimate between checks, are not in this step.
- **A retirement holding is never liquid**: in the FIRE corpus, out of the liquid corpus the cover gap subtracts (code, with the screen).
- **A new hue for retirement** (the shield tile is periwinkle, which is Mutual funds'): a new token, `--c9`, lime, light `#5F8A1E` and dark
  `#A3D65C`, to be measured against the tile contrast test and replaced by the nearest value that passes (code, with the screen).
- **An existing PPF deposit is converted** by the migration: its latest reading becomes the opening balance at that date, its institution and last
  four digits come across, and its terms and renewals are **deleted**, with the audit log keeping each row. The proposal said they would be left
  unused; they are deleted instead, because a deposit's terms are worked out into a payout once past maturity and that takes a holding out of
  every total, which a PPF must not meet.
- **Built (30 October 2026):** the kind, the type and the class with its hue (`--c9`, lime, light `#568019`: the first value measured under the
  tile test's 3:1), the repository layer, the Add form for each type, a holding screen in the shape of each, a PPF worked out from its account,
  payments and the notified rate and recorded as a reading by the person, and Close month writing each PPF's month-end value. A retirement
  holding is in the FIRE corpus and never liquid.

## Export (October 2026, the maintainer took the recommendations on all six questions)

The first half of step 5 is built: Export everything, behind More, for an owner and a partner. The answers, with the reason for each:

1. **Which tables.** What a person adds or changes, and nothing else (the maintainer, 30 October). In the file: expense categories, budgets, expenses; holdings with what each is written beside it (its name, kind, scheme, currency and where it is priced, from its instrument, so there is no sheet of instruments); the records under a holding (readings, lots, disposals, deposit terms and renewals, PPF accounts and payments, bond ratings read-only); liabilities, insurance, and properties with their work and valuations. Not in the file, each in `NOT_EXPORTED` with its reason: the household's settings (the Settings screen edits them), members (people join by invitation; their names are read so a name can be written beside an id), reference data the app keeps (prices, scheme rates, tax rules, FX rates), the import log, the audit log, sign-in identities, memberships and invitations. A holding's kind is a choice from a fixed list, so the upload will give it a dropdown and will add a holding under a kind that exists, never a new kind. No sheet carries the household's id, or when the app created or last changed a row: the file is for the household it was made from, and those are the app's. (The first version of this answer put settings, members, instruments and the reference data in as sheets; they came out on 30 October.)
2. **Sensitive fields.** Insurance cover, insurer, premium and the last four characters of a policy number are in the file; a nominee is not stored and so is not in it; account identifiers are the last four characters the database already holds. The account that created or voided a row (`created_by`, `voided_by`) is out of every sheet. A statement's raw payload is a column of no table.
3. **Library.** ExcelJS 4.4.0, pinned, loaded only when a file is made or read. `npm audit` reports a moderate advisory on `uuid` below 11.1.1, which ExcelJS uses without a caller-supplied buffer, the case the advisory is about.
4. **A fresh authenticator code first**, as before a password change (blueprint section 15, layer 04: "a re-authentication prompt stands before destructive or sensitive actions", exporting the full dataset among them).
5. **Reports** is behind More and holds Export everything only; the rest of its board is drawn and arrives with the thing behind it.
6. **Quantities and rates are numbers in the cell**, written only if the cell reads back to the same digits, and refused with the sheet, row and column where it cannot, never rounded.

Also decided on the way: "Last exported" is remembered by the device alone (the browser's storage), because the audit log can be written only by triggers and a household-wide record would need a table, a migration and a test. Reads are not yet recorded in the audit log anywhere (`src/repo/profile.ts`), the full export included; that is the known gap and becomes more pressing now it ships.

## Upload from the template (October 2026, the maintainer took the recommendations on all six questions)

The database half is `supabase/migrations/20261031120000_template_upload.sql`, tested by `supabase/tests/template_upload.test.sql` (which runs in CI only: Docker does not run on the maintainer's machine). The browser half (the reader, the preview, the screens) follows it.

1. **Reversal.** An upload from a template can be reversed as a unit by the person who made it. Rows it changed go back to what they were; rows it created are **removed**, which is a hard delete and the schema's second one after `reset_demo_household`. It is allowed to be exactly that and no more: only rows listed in the upload's own ledger, in its own household, only if nothing has changed them since (the time the app last touched a row does not count as a change) and nothing refers to them, and all or none. Every delete is in the audit log. A bond with a rating cannot be reversed once the rating log has an entry for it, and a created holding cannot be reversed while a row of any kind points at it; the reversal then stops and says which.
2. **A reference of the person's own.** A new row can carry a `ref` (BB-17, "kitchen loan") in the template's ref column; `import_ref` remembers it against the row it made, so uploading the corrected file again updates that row instead of creating a second copy. A row with an id is found by its id. A new row with neither is flagged in the preview as one that cannot be recognised next time. This needs template version 2.
3. **Scope.** Everything the app lets a person write: categories, budgets, expenses, instruments (written with their holding), holdings, readings, lots, disposals, deposit terms and renewals, liabilities, insurance, properties with their work and valuations, PPF accounts and payments. Not members, bond ratings, the household's settings, the import log, FX rates or reference data.
4. **An upload never deletes.** A row missing from the sheet is ignored; to retire a record, set its status or its archived or voided time.
5. **Frozen figures.** There is no guard yet that stops a row being edited after a snapshot, a tax year or a report relied on it. An upload can edit what the app's own edit can. That guard belongs to the later "void and re-enter" work.
6. **Owner and partner only**, with the second factor. A contributor and a viewer are refused by the function and by the policies behind it. The ledger holds images of rows that may be private, so only the person who made the upload reads it, and it has no audit trigger: an audit row is readable by the household. What it records is audited at the tables it names.

How: one call, `public.apply_template`, as the caller (so row-level security decides every row), all or none. A row that fails stops the call and names its sheet and row. The entity and column lists are fixed inside it and are held to the export's entity list by `src/domain/export/templateEntities.test.ts`.

## Open: spending capture and gold (30 October 2026, designed, none decided)

Written down so they are not lost, and **decided by nobody**: each is the maintainer's to answer. The design documents are `docs/design/spending-capture.md` and `docs/design/gold.md`; neither is built, and `CLAUDE.md` is unchanged.

**Spending capture, `docs/design/spending-capture.md` section 9** (six items):

1. **`CLAUDE.md` says "no SMS parsing".** Share-to-app parses text the person hands over, one message at a time; it never reads the inbox and asks no permission. The document proposes rewording the line to *"No SMS reading: the app requests no SMS, notification or accessibility permission. Text a person shares into the app may be parsed."* Until the maintainer decides, the line stands as written.
2. **Loan EMIs.** The principal reduces a liability and is not spending; the interest is. Proposed: an EMI paid to a recorded liability is excluded from *spent* and shown as its own line until the liability carries the split.
3. **The UPI reference:** its last four and a hash (proposed) or the full number.
4. **A spreadsheet library** for Paytm's Excel file. Step 7 already owes this decision for bank XLS; Paytm's PDF works without it.
5. **Who closes a month.** Proposed: an owner or partner for the household, and a contributor for their own accounts only.
6. **Take-home income.** Section 10 assumes salary is recorded as what reached the account, so payroll deductions sit outside *saved*. Step 6a already owes the "which income" decision (gross with TDS for the Tax card, or take-home); if it is gross, *saved* must subtract tax and payroll deductions, and section 10 changes with it.

**Gold, `docs/design/gold.md`** (answered on 6 November 2026, below): the cost basis of physical gold after a scheme's redemption is moot, because the scheme is withdrawn; the demo's seed values are replaced by those of the physical-gold seed. The listed-gold-ETF tax class was decided against (see *Gold, physical gold and gold ETFs*).


## Open: selling the app (6 November 2026)

Written down so they are not lost, and **decided by nobody**: each is the owner's to answer. The design document is `docs/design/commercial-launch.md` (prefix CL, CL-I1 to CL-I10), **proposed and not scheduled**; its section 12 is the list below. `CLAUDE.md` is unchanged: its "No public sign-up" line stands until the owner decides item 1.

1. **Public sign-up for the first person in a household** (section 2), and the matching edit to `CLAUDE.md`'s "Out of scope". Today an account is made only by accepting a single-use, expiring invite.
2. **Plans and prices** (section 1): what is free and what is paid, the member limit, the trial length, and the monthly and yearly prices.
3. **The household hard delete** (section 5) as a third exception to "deletes are soft everywhere", beside `reset_demo_household` and `reverse_template_batch`, and what happens to a leaving member's private entries.
4. **The retention period** after a subscription expires (section 4; 12 months is proposed).
5. **Support access** (section 7): the two levels (a diagnostics report the person sends, and an owner's time-limited grant) and the 24-hour cap.
6. **The no-commission, no-ads line** (section 10) as a standing rule.
7. **The business entity** and when a paid beta starts (sections 9 and 11).


## Gold, the first slice (November 2026): superseded

**Superseded on 6 November 2026: the owner withdrew the jeweller's savings scheme, and every item below about the scheme, its instalments, its redemption and its bonus is history. What replaces it is the next section.** Built from the first version of `docs/design/gold.md`: `supabase/migrations/20261102120000_gold.sql` with `supabase/tests/gold_scheme.test.sql`. What was chosen where the design left room, and what is still open:

- **Only the jeweller's scheme is made.** `instrument.gold_form` allows `physical`, as the design says, and nothing makes one yet: it arises on redemption (gold.md section 5), whose cost basis (gold.md section 7, item 1) is still open, so redemption waits for that decision.
- **A weight scheme and physical gold are valued from the `price` table, and nothing writes a gold rate into it** until the blueprint's gold job exists (GD-I3 says the value is never typed). Until then a weight scheme is said to be not valued, and why. **New question for the maintainer:** how does a gold rate get in before the job does? Options: build the gold job first; or let an owner or partner record a dated rate for a purity by hand, in a table of their household's own, which GD-I3 would then be read as allowing (a rate typed, never a value). The amount scheme needs no rate and is built first.
- **An amount scheme is valued as the instalments paid, and the bonus is not in it** (GD-I2). Its instalments are lots on the holding (the quantity is rupees), and recording one also records the value as a reading, as a PPF's is, so net worth reads it as it reads any holding.
- **An upload does not add a gold or a retirement holding**, which have more to them than a sheet carries; the preview says so. The scheme is a read-only sheet of the export.
- The demo household has one amount scheme, five of eleven instalments paid, from a fictional jeweller (gold.md section 7, item 2: the seed values are still the maintainer's to confirm).


## Gold, physical gold and gold ETFs (6 November 2026)

**The owner withdrew the jeweller's gold savings scheme on 6 November 2026**: too much to record (terms, bonus, variants, instalment by instalment) for what a household learns from it. `docs/design/gold.md` was rewritten, and `supabase/migrations/20261106120000_gold_physical_etf.sql` takes the scheme out. Decided by the owner (gold.md section 8):

1. **The gold rate is typed**, by an owner or a partner, per purity, from IBJA's published rate, into `gold_rate`, a table of the household's own, appended and never edited (GD-I12). GD-I3 allows a typed *rate*, never a typed *value*. This answers the question left open in the first slice.
2. **Gold ETFs and funds are kind `gold`**, form `etf` or `fund`, so that the allocation and the Gold group are right; they are still priced as funds. Those already recorded with `tax_asset_class = gold` moved to it, with their lots and price untouched.
3. **The gold hue is as built, `--c7`.** The `proposed` Departure is decided (`docs/design/conformance.md`).

**Automatic fetching of the gold rate is held, not forgotten.** No international metals API: it reads below the Indian rate, which includes import duty. No scraping of Indian rate sites: they publish pages, not feeds, and `CLAUDE.md` rules out screen-scraping. If automation is wanted, the route is a licensed feed of IBJA's rates, and a driver that writes `gold_rate`; the typed rate stays as the override.

**Decided, 6 November 2026: no listed-gold-ETF tax class, and no gold-ETF tax rows.** The owner said it need not be added. A gold ETF or fund keeps whatever tax class it has (none for a new one, so the Tax screen asks for one), and GD-I13 is not built. Physical gold stays on the Tax screen under the `gold` class and its 24-month rows (gold.md section 5). What was found when it was looked at, from secondary sources only and the enacted text of section 2(42A) not read, is left here should it be wanted again: listed gold ETF units long term after 12 months, 12.5% with no indexation, short term at slab; a gold fund of funds (unlisted) and physical gold after 24 months, 12.5%; gold funds no longer within section 50AA from 1 April 2025; sources disagreeing on whether the 12-month period applies to units bought on or after 1 April 2025 or to any sold after 31 March 2025. An ETF moved to kind `gold` by the migration that was classed `gold` keeps that class, whose period is 24 months.

Where the build chose, inside what the owner decided:

- **`instrument.gold_purity`** (24K, 22K, 18K) is set exactly when the form is physical: the rate is per purity, so the purity is a fact about the gold. Not in the design, which names purity but no column.
- **A value is recorded as a reading.** Net worth reads the latest reading for every holding (HD-I1), so physical gold's value (grams times the latest rate on or before the day) is worked out by `src/domain/gold.ts` and written as the day's reading whenever a rate is typed or a purchase or sale changes the grams. Where no rate exists no reading is written, and the holding says it is not valued. A private holding of another member is revalued by its owner's next change.
- **Two rates for one day are allowed**; the one typed later wins.
- **The migration refuses** if a household that is not a demo one holds a jeweller's scheme, naming how many; the demo's scheme is kept as an archived holding of kind `other`, and a reset removes it. Recurring rules are archived when their payee or name is a scheme's jeweller, since a rule is not linked to a holding.
- **A gift is a lot of kind `gift` at nil cost.** The Tax screen has no refusal for a lot of unknown cost beyond the ones it already has; whether a gift of unknown cost should refuse a gain is a question for the owner.
- **A gold ETF or fund is added by ISIN**, which is also what the price driver reads it by; there is no search by name in the app to reuse (the price table holds no names), which the board's wording assumes. A `proposed` Departure.
- Physical gold is not offered the emergency fund, and is left out of the liquid sum (GD-I10); a gold ETF or fund is offered it and counts, as any fund does.
- **Physical gold bought is classed `gold`** when it is added, so the Tax screen applies the 24-month rows the class already carries (gold.md section 5). A gold ETF or fund is left unclassed until the owner settles GD-I13. The demo's seeded necklace and coin have no class, because the seed is in an applied migration: a small migration that sets it, shown first, would fix the demo.
- **A gift is a lot of kind `gift` at nil cost, and the gains engine cannot see that nil means unknown.** Fed to it as it is, a classed gift would book its whole sale price as a gain. So, for now: physical gold added as a gift is left unclassed (the Tax screen refuses it, asking for a class), a gift cannot be added to gold that has a class, and the screen shows no gain over the price paid where a gift is among the lots. The proper answer, which gold.md section 2 asks for, is that a lot of unknown cost makes the engine refuse with its own reason; that changes `lots.ts`, `capital-gains.ts` and the Sales card, and is the owner's to ask for.
- **An ETF or fund needs its ISIN**, because the ISIN is what the driver prices it by. It is checked for its shape, not against the AMFI list.
- **Export everything does not carry `gold_form` or `gold_purity`.** They are not columns the upload function writes, and the registry test holds the Holdings sheet's columns to that function's. A backup therefore cannot tell a necklace from an ETF, nor give the purity physical gold is valued at. A read-only sheet for them wants its own entity, or a column list change in `app.record_template_row`, and is left for the owner. `TEMPLATE_VERSION` is unchanged: the only sheet that changed is read-only, and a template made before it is read as it always was.
- The demo household: a 22K necklace with a price paid, a 24K coin received as a gift, Axis Gold ETF (ISIN `INF846K01W80`, read from AMFI's `NAVAll.txt` on 5 November 2026; its units and cost are invented), and typed 22K and 24K rates.


## Recurring rules, the first slice (November 2026)

Built from `docs/design/spending-capture.md` section 3 and SC-I10: `supabase/migrations/20261102130000_recurring_rules.sql` with `supabase/tests/recurring_rules.test.sql`. Where the design left room:

- **What posts them is the app, when an owner or a partner opens it.** There is no server of our own and no scheduler (the month-end close made the same choice), so `public.post_due_recurring` runs on open: for each active rule that posts itself and is due, it posts every due date up to today in India (the database's clock, not the device's), advances the rule, and returns how many entries it made. A rule left for more than two years of due dates finishes catching up the next time. Two devices take turns (a rule is locked while it is posted) and the unique (rule, due date) index makes a second run, or a second device, post nothing (SC-I10).
- **A voided entry is not posted again**, because its row still holds the date. To post that date again, a person enters it.
- **A rule is the household's**: owner and partner make, change, pause and post them; a contributor reads the rules under their own name and writes none; a viewer reads none; a personal rule is its member's alone. A contributor's own recurring spending is therefore a rule an owner or partner makes under their name. Say if that is wrong.
- **A due day is 1 to 28**, so it exists in every month and a rule on the 10th is never moved by a short month. A rule due on the 29th to 31st is not expressible; the nearest is the 28th.
- **`captured_via`** (typed, shared, rule, import) is on every entry from now on, defaulting to typed for what exists, so the other capture paths (share, import) do not need another column.
- **Reminders** (`reminder_days`) are stored and not yet used: they wait for the calendar (step 8).
- The demo household has two rules that are not due yet, so seeding posts nothing.
- **Settings is where the rules live, and the screens (built November 2026) added four rules the design did not state.** (1) Resuming a paused rule, or restoring an archived one, does not enter the period it was stopped for: the next due day becomes the first on or after today (`resumeFrom` in `src/domain/recurring.ts`), because the poster would otherwise enter every due day from the stored one, up to 24, for a bill nobody paid while it was off. This is held on the device and not in the database, so another client that sets a rule back to active without moving its date would still back-post: a trigger that does it in the table is the safe form, and wants a migration shown first. (2) A rule's next due day can be moved later and not earlier, because an earlier day could enter a period already entered; to start over, archive it and add it again. (3) Adding, resuming or moving a rule runs the poster at once, so a day that has already gone by is entered then and the rule shows its next. (4) A rule always posts itself and is always the household's: the `auto_post` switch, the reminder and a personal rule are stored and not offered, because each would promise something nothing does yet. **Say if any of these is wrong**; and whether a viewer should see the rules read-only, as the blueprint says of household settings (the policy gives a viewer none).

## The owner's answers to the open questions (13 November 2026)

Twenty-seven questions were put to the owner at the end of the invested-card slice; these are the answers, in chat, and none is a recommendation of mine.

- **Income (step 6a).** Recorded **gross, before tax and PF deductions**, so the tax calculation can be done properly: the ledger is the source, with TDS, the employee's PF and other deductions, and take-home is worked out. The same answer settles take-home against gross in `spending-capture.md` section 9 item 6. Income is private by default with a sum function for the household total, and a transfer goes to a holding as well as to an account. A realised capital gain is derived from lots and considered in the tax view; the owner's rule is that the sale amount is kept as it is, so a gain is **not added to income again** where it is already part of the sale value. Open: renaming Expenses to "Money" (label only, or label and route), and whether the FIRE screen takes an income figure (it would be a plan assumption, since a second store of income would disagree with the ledger).
- **Spending capture.** No rewording of the SMS line in `CLAUDE.md` and **the share target and Paste are not to be built**; loan EMIs are left out of *spent* and shown on their own line; the UPI reference is the last four and a hash; no Excel library for now; the owner or a partner closes a month for the household and a contributor for their own accounts. Bank and card sample statements are held until the owner has prepared them.
- **The cash reserve.** Money kept in a savings account is a legitimate reserve and **not money that still has to be invested**: the month's money screen says "cash reserve" and not "left in the bank, not yet invested" (`spending-capture.md` section 10).
- **The month control.** The investing card shows **This month and Last month**, a two-option control, in place of Earlier and Later (17).
- **Income: the ledger, decided in outline (13 November 2026).** The money screen is a **ledger of credits and debits**, like a bank account's. **Take-home is the credit marked Salary**, as the bank received it, and deductions are not recorded. **FIRE reads the highest Salary credit among the months entered, times twelve**, never grown by inflation. **The Tax screen takes a gross salary typed by hand once a year, per member, from the payslip**, which the person may correct later from Form 16, and it is stored per member and tax year. **The PF "put away through payroll" line is dropped** (SC-I14 and the matching paragraph of `spending-capture.md` section 10 are to be withdrawn when the design is written). This supersedes the earlier answer that income is recorded gross in the ledger: gross now lives on the Tax screen and the ledger holds credits as received. Income is not grown by inflation and is entered on the money screen, not on FIRE. The full design is to be written (a document and boards) from the prompt in `docs/drafts/ledger-design-prompt.md`; `docs/drafts/income-design.md` has the two options considered. Nothing is built.
- **The invested card.** A holding with a cost and no purchase counts at that cost on its opening date; a bond's start date is its purchase date; a recurring deposit is kept out; private purchases on the Household view are left as they are. The green "+22.9% on cost" chip stays as built.
- **Selects and the Tax income layout.** The household switcher, Tax's year and member, Settings' Read amounts in and a member's role stay native selects, and the Tax income label stays above its value (the four Departures are `decided`). **New work, not yet built:** mark the fields a form requires on every form in the app, because it is not clear which values are required (first asked for the Property forms). The owner chose **a symbol and a colour, not the word "required" beside each field, following current UX standards**: an asterisk after the label in the attention colour, announced as required to screen readers (`aria-required`), with one line of key per form that has required fields, since the asterisk alone must be explained once and the symbol, not the colour, carries the meaning.
- **Tax deductions (step 3b).** Seniors stay unmodelled, so the draft has no senior 80D rows. A policy gets a "covers parents" marker (a migration, when 3b is built). 80CCD(1B) is left out. Where the old regime is chosen the 80C figure is typed by hand. A CA is not required: the owner or a partner finalises the figures against the Act.
- **Gold.** A gift with an unknown cost: `docs/drafts/gold-gift-cost-estimate.md` is accepted as the draft (an estimate from the year's price, marked as one). Not built.
- **Housekeeping.** The updated canvas was sent and is in `vibrant-canvas.html`. The PPF rate check is acknowledged and the screen keeps saying "not yet checked against a statement" until `PPF_RATE_CHECKED` is set.

## Ledger and income, decided (13 November 2026)

`docs/design/ledger-income.md` is the design of Money as a ledger and of how income is captured. **Its section 0 (what is decided) and section 10 (the questions, answered) are the owner's answers, in chat on 13 November 2026**, and the rest of the document works them out; none is a recommendation of mine. In outline:

- **Money is a ledger of credits and debits**, and the screen is renamed Money, **label and route** (`#/money`, with `#/expenses` redirecting to it). A credit carries a category (Salary, interest, rent, refund, dividend, other, and business income). Moves between the household's own accounts, card payments and money into or out of a holding are in neither income nor spent. Money coming back is "Refund or money back": it takes away from spent and is not income.
- **Take-home is the Salary credit** as the bank received it; deductions are not recorded and the payroll line is dropped. **FIRE uses the usual monthly salary**: the amount that recurs most often in the last six months entered, the more recent on a tie, the latest month (said so) when nothing repeats; this amends the earlier answer of the highest month. Never grown by inflation. **Business income** is what reaches home: FIRE takes the total of the last 12 complete months (fewer months: their average times twelve, labelled), and Tax takes a net profit typed once a year. A mixed account is left as it is.
- **Tax takes a gross salary typed once a year per member from the payslip**, corrected later from Form 16, with other income and TDS optional; a member's tax inputs are read by that member's login and by whoever typed them.
- **A salary rule reminds you and posts only when you confirm.** Loan EMIs are a fourth part of the month's split: spent, invested, paid to loans, to the cash reserve.
- **Income is private by default**, with household totals from a sum function; a contributor sees their own and a viewer none. **Audit rows for `credit_entry` and `income_entry` follow the visibility of the row they record** (section 12, LI-I22): the owner's ruling as maintainer, now the second named exception in the audit paragraph of `CLAUDE.md`. Wording only; nothing is built.
- **Design only.** Step 6a is ready to build from it. `docs/drafts/ledger-income-conformance.md` lists the proposed Departures and `docs/drafts/ledger-income-questions.md` keeps the questions that were asked.

## Step 6a: the migration's decisions, confirmed (13 November 2026, the owner)

The migration `supabase/migrations/20261114120000_ledger_income.sql` was put to the owner for review with six decisions; all six were answered in chat on 13 November 2026.

- **The Household FIRE figure is a database function**, `household_yearly_income(household, as_of)`: the owner said to go with it "if household is there and who all earn". It adds each earner's usual salary times twelve and their business income over the last twelve complete months, per currency, to an owner or a partner with a second factor, and returns two sums and no member. **This is a named exception to the rule that calculations are pure functions** (the migration says so): the owner chose a household total and not each person's months, so only the database can compute it without disclosing them. The same rule is written again as a pure domain function for Mine, and both are held to the design's test vectors (LI-I9, LI-I18, LI-I20).
- **A personal credit can be made only by the member it belongs to**, so an owner records a parent's income as the household's.
- **A transfer is readable only by someone who can read both accounts**, and both legs are in one currency (a move between currencies is not modelled yet).
- **A balance, and its audit row, is as private as its account.**
- **Reads are not audited yet** (step 11), as for every other table.
- **No ledger rows in the demo seed**; the reset clears the new tables and the seed is unchanged.

## Simple layout, the boxes come back (8 November 2026, the owner)

After using slices A to E on a phone, the owner sent seven screenshots and eight points. Each is built (slice F) and none is a recommendation of mine:

- **Sections are boxes again, with hairlines between their rows, on every screen.** The one lifted surface per screen stays (SL-I7). `simple-layout.md` section 1 is amended; the Departure is `decided` in `docs/design/conformance.md` and quotes this.
- **Recent expenses is one line an entry**, with a hairline between days.
- **The category chips, Import and Sort are ovals**, filled `--surface-2`, as the older Holdings chips were. The quiet button is that oval everywhere.
- **The unit letter (`L`, `Cr`, `K`) is the figure's own size, weight and colour**, on every screen. `tokens.md` section 3 (Units) says so; it was `0.6em` and muted.
- **The one Add is smaller**: a one-line pill. It had wrapped to two lines because it was fixed at the middle of the screen with half the width.

Not changed: the underline fields, the stepped forms, the Mine | Household switch, the Holdings tabs, the colours.

## Simple layout, soft panels (12 November 2026, the owner)

The owner was shown four ways to separate the sections of one screen (the outlined boxes of slice F, soft panels, full-width bands, and headed sections with no box) and chose soft panels. The boxes of 8 November fixed the sections merging into one another and were heavier than the screen needs: an outline and a shadow on every section competed with the lifted card. Built as slice G; none of it is a recommendation of mine:

- **A section is a soft panel:** `--surface`, no border and no shadow, `--radius-panel` (a new token, 16px, which the lifted card takes too), padding 14px 16px, 10px of page between panels, rows on `--line` hairlines inside. It is told from the page by its tone alone. Measured, not assumed: `--surface` against `--bg` is 1.15:1 in Mist and 1.11:1 in dark. `simple-layout.md` section 1 and SL-I7 are amended; the Departure of 8 November is superseded for its box part and stands for the ovals (`docs/design/conformance.md`).
- **SL-I9 (new): nothing filled or outlined sits inside a panel.** A note or a group inside one is plain text or rows. Made plain: the notice, the error line (`Problem`), the names under a notice, the chart note, a deposit's watch and maturity lines, the raw statement text, the invite code and the authenticator secret. Kept, because each is a layer or a control and not a box in a panel: the caveat popover (a dialog over the page), the menu and the bottom sheet, the QR code (it needs a light ground to be read), and the small controls (pills, chips, the segmented control, switches), which are the owner's ovals.
- **The lifted card is unchanged** except for the radius: it is the only thing on a screen with an outline, a gradient and a shadow, and keeps its 18px padding.

Not changed: the colours and both themes, the underline fields, the stepped forms, the tabs, Mine | Household, the ovals, the unit letter at the figure's size, one-line entries.
