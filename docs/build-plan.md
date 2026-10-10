# Skeleton first, then breadth

*Family Finance Buddy · build plan*

The instinct is to attack the risky parts first. Here that would be wrong — the three flagged risks all have contained fallbacks and none of them would change the architecture. The one thing that *would* change everything is whether a static page, a database enforcing its own access rules, and a phone can be made to work together at all. That gets proved in week one, on a single expense row.

> Staged order of work for **Family Finance Buddy**. Read alongside `CLAUDE.md`
> (the invariants) and `docs/blueprint.md` (the specification).

---

## 00. Where this stands

Kept current in the repository so this file is worth reading from either side.
`docs/design/conformance.md` is the screen-by-screen version, and CI fails when
it stops describing the code.

| Stage | State | What is outstanding |
|---|---|---|
| 0 — Irreversible choices | done | — |
| 1 — Walking skeleton | done | — |
| 2 — Schema, policies, tests | done | the migrations in `supabase/migrations/` and the pgTAP files in `supabase/tests/` that gate the deploy, audit triggers on every table holding household data. An audit row that names a `holding_id` is readable only by whoever can read that holding (`20260927120000`), so a position's purchases, sales and terms are as private in the log as in the table |
| 3 — The demo household | done | Switcher, demo badge, and reset-and-reseed: `public.reset_demo_household` (`20260916120000`) is the schema's one hard delete — owner only, second factor, households marked demo only — behind a confirmation in Settings → Data. The seed lives in `app.seed_demo_household`; `supabase/seed/demo_edge_cases.sql` calls it. Still to add to the seed, as its own change: a loss-making sale, a carried-forward loss and lots either side of twenty-four months, all recordable now that `lot`, `disposal` and `tax_rule` exist. The foreign dividend waits on a `dividend` table. The live project also holds a second demo household from the local-only fixture, its login banned; removing it is an open decision. |
| 4 — Screens you use daily | **in progress** | Expenses with its editor, the spending plan, holdings, and Overview with net worth and allocation by kind. The month-end close job is built (`supabase/migrations/20260908120000_month_end_close.sql`), the four missing primitives exist, and `fx_rate` plus `liability.outstanding_minor` (`20260908130000`) are what let the headline be net worth rather than assets. Prices now come through a driver: `price` (`20260914120000`) holds dated public reference prices, the `fetch-prices` edge function fetches AMFI and is the only thing that talks to a vendor, and a holding linked to an ISIN shows the quoted value for somebody to record. Deliberately not on a cron — see the note in that function. The since-inception chart draws assets (`src/domain/history.ts`). The allocation has its donut beside the rows. Outstanding: a contributed line on that chart, member attribution, and drivers beyond AMFI (FX, gold). |
| 5 — The rest of the surface | **partial** | `tax_rule` is built and seeded with the regime from 23 July 2024 (`20260912120000`); `src/domain/tax-rules.ts` classifies a parcel long or short term against the rule that covered its sale, and refuses where no rule covers the date. **The tax engine is built for the domestic case**: capital gains netted across asset classes, the ₹1.25 lakh equity allowance, and income tax on the slabs, rebate, surcharge and cess for both regimes (`src/domain/income-tax.ts`, `capital-gains.ts`), with a Tax screen, a folded card showing the rates a year applied, and a year picker that offers only years with a sale in them. Rules are dated `tax_rule` rows (`20260920120000`) and a test proves the bands in force on any date tile, so a Budget cannot leave old bands in force. Refused by name rather than guessed: a surcharge or rebate relief where there are capital gains, debt funds bought after 1 April 2023, property's 12.5% or 20% election, foreign holdings that need the prescribed exchange rate, and any year before 2025-26, which is not seeded. Ahead: the foreign tax credit and Form 67, advance-tax instalments, and a scheduled Budget-day reminder (below). **eCAS import is built and has now met two real files**: `import_batch` with per-line hashes (`20260917120000`), the pure parser (`src/domain/ecas.ts`), the on-device PDF adapter (`src/lib/ecas-pdf.ts`, pdf.js, dynamically imported) and the preview-and-commit screen (`src/features/holdings/ImportStatement.tsx`). Its fixtures are synthetic, written from the published layouts, so the first real statement is the real test — and the first one, a CDSL depository CAS, found four things at once: numeric dates, a folio line carrying "Mode of Holding", a scheme printed above the folio rather than below it, and a column order that puts units fourth. Both layouts are read now, registrar and depository, and two real files parse with nothing unread: a November 2022 depository CAS and a CAMS eCAS whose seven folios, schemes and ISINs all came out right. An imported fund records `price_source` `amfi` and its ISIN, so the driver can quote it the moment it exists. Stamp duty is folded into the cost of the purchase it was charged on, since a lot's cost is all in. Not yet: **what to do when a statement covers only part of the history** — see step 2 of the stage below, and it is the gap that matters most — editing a figure in the preview (leave the row out and correct it on the holding), any undo after commit, dividends and charges that belong to no purchase (no table holds them), the demat half of a depository CAS, bank and card imports. Property, global, calendar, reports and read-auditing not started. **The FIRE read-out is live ahead of step 9**, on the Overview's net worth, which counts everything held. Protection, schemes, earmarks and income are designed in `docs/design/protection-and-flow.md` and ordered into the stage below as 2a, 2b and 6a |
| 6 — Onto the devices | not started | — |
| 7 — Real data | not started | — |

**Tagged `v0.1.0`** at `2df65ab`. The tag message says what is built, what is
not, and the one thing a tag here cannot do: migrations are forward-only, so
checking the tag out works and restoring the database to it does not.

Two things cut across the stages and are worth stating once. Section 20's
private entries are built end to end for expenses — the control, the policies,
the audit rule and the security-definer totals — but the cross-member cases have
only ever run against fixtures, because the live household has one member. And
the generated app icons do not match the recommended concept; that is its own
piece of work and blocks nothing.

## 01. Why not risk-first

A spike is worth doing early when failure would change the design. Measured against that test, the three risks flagged earlier don't qualify — and one unflagged thing does.

| Risk | If it fails | Design impact | Do it |
|---|---|---|---|
| CAS parser | Lots and transaction history are entered by hand or from broker CSVs | None — the fallback is already the phase-1 behaviour | Stage 5, ahead of bank and card import — see the eCAS entry there. The fallback it names is now real rather than hypothetical: `lot` and `disposal` exist and can be entered by hand, which is exactly why parsing them can wait and also why it is worth doing |
| Passkeys in native shells | Password + authenticator only | None — that path is mandatory anyway | Phase 2, before the shells ship |
| Row-policy performance | Add indexes, rewrite a policy predicate | None — a tuning problem | Watch from stage 2 onward |
| The stack itself | Static hosting, database-enforced access, live sync and CI don't hold together | **Total** — everything changes | **Week one** |

So: a **walking skeleton**. One vertical slice through every layer of the architecture, carrying one trivial feature, deployed for real. It is unglamorous and it is the only week where a bad result saves you months.

## 02. The stages

Each stage ends at a gate you can objectively pass or fail. Timings assume evenings and weekends, not full days — halve them if you have clear runs.

### Stage 0 — Irreversible choices — _Half a day · no code_

- Create the Supabase project **in the Mumbai region**. This one cannot be changed later without a migration.

- Create the GitHub repository, public, with branch protection on the default branch.

- Enable Pages, deploying from Actions.

- Write `CLAUDE.md` before any code exists — see section 04.

- Drop the blueprint into `docs/` as markdown so it can be read rather than re-explained.

> **Gate —** an empty page is live on the Pages URL, deployed by a workflow rather than by hand.

### Stage 1 — Walking skeleton — _Week 1 · the only real spike_

One table, one screen, one login, deployed. Resist every temptation to add a second feature.

- Vite + React + TypeScript, Tailwind, the design tokens from the prototype.

- `household`, `member`, `user_account`, `membership`, `expense_txn` — five tables, with row-level security enabled and deny-by-default.

- Email + password + authenticator sign-in. Invite-only. One invite issued to your own second account.

- The repository layer, with exactly two methods: list expenses, add an expense.

- Live updates subscribed to the household channel.

- Deploy workflow to Pages. Installable as a PWA.

> **Gate —** sign in on the laptop, add an expense, and watch it appear on your phone's home-screen app without a refresh. Then sign in as a second account belonging to a different household and confirm you see *nothing*. If either half fails, stop and reconsider the architecture rather than working around it.

### Stage 2 — Schema, policies, and the test that guards them — _Week 2_

- All 35 tables as versioned migrations, with the money columns as integers and every amount carrying a currency.

- Row policies on every table, resolving through membership, deny-by-default with no permissive fallback anywhere.

- **The policy test suite** — authenticate as each role and assert what it cannot see, cannot update, cannot reach across households. Wire it into the deploy workflow as a blocking gate now, while it is cheap.

- The audit-log triggers, since retrofitting them across 35 tables is miserable.

> **Gate —** policy tests green, and the deploy genuinely fails when you deliberately break one.

### Stage 3 — The demo household — _Week 3_

Your development environment and your first deliverable are the same thing.

- Seed script producing a full fabricated household — and built to **exercise edge cases**: a loss-making sale, a carried-forward loss, lots either side of the twenty-four-month line, a matured bond, an unused category, a stale valuation, a foreign dividend with withholding.

- Household and member switchers. The demo badge.

- Reset-and-reseed, so you can break it freely.

> **Gate —** you can switch between two households and nothing leaks between them; reset restores a known state.

### Stage 4 — The screens you will use daily — _Weeks 4–6_

- Expenses: quick-add, category management, budgets, the ledger, recurring rules.

- Net worth and allocation, with the monthly snapshot job running from the start — it is capturing peak values you cannot recover later.

- Investments hub, mutual funds, equity with its India and Abroad blocks.

- Themes, privacy mode and accessibility built in as you go, not bolted on. Retrofitting text scaling is far worse than starting with it.

> **Gate —** a full week of your real spending logged in the demo household without the entry flow annoying you. If it annoys you, fix that before building anything else — it is the whole project's failure mode.

### Stage 5 — The rest of the surface — _Weeks 7–9_

**Do these in the order below.** Stage 5 is the widest stage and the only one
whose items look independent enough to take in any sequence. They are not.
Three of them are prerequisites wearing the costume of features, and the stage
gate is a round trip that needs one half built before the other half can be
tested at all. Work down the list. If something has to move, move it here and say why, so
that there is one order rather than two.

One thing is planned and sits outside the order, for later: **a Budget-day
reminder.** A scheduled GitHub Action that opens an issue around 1 February,
and again after the Finance Act passes, with a checklist of the `tax_rule` kinds
to review (slabs and rebate for both regimes, standard deduction, surcharge,
cess, capital-gains rates, holding periods, the equity exemption) and where the
seeded rows live. It fetches nothing, reads no database and holds no key; it only
opens an issue with the built-in token. Its job is to reach the maintainer at the
moment a Budget can change a rate, where the Tax screen's stale-rate warning
reaches somebody only when they open it. A migration that changes the slab
structure must end-date the rows it replaces; the test in
`supabase/tests/tax_rule_in_force.test.sql` fails if it does not.

Three things are already built and sit outside the order: `tax_rule` and its
classification module, eCAS import, and the `lot`/`disposal` ledger they fill.
What remains of each is noted where it belongs below.

**Protection, schemes, earmarks and flow — where they fit.**
`docs/design/protection-and-flow.md` adds three slices: **B** (earmarks and
schemes), **C** (protection) and **A** (flow: income, accounts, transfers). They
are not a Stage 6. Each is a prerequisite or an input of a step already in this
list, and this list's order was deliberate, so they go in beside the steps they
serve. **The numbers of the existing steps do not change.** They are quoted in
other documents and in people's heads, and a renumbering is exactly what made the
nine-step list of `c6d493b` and today's eleven-step list disagree (`95607c7`
inserted step 2). The new items take the number of the step they follow and a
letter: 2a, 2b, 6a.

| # | Step | Where it is, and why |
|---|---|---|
| 1 | Currency control | **Unchanged and built.** Everything else is downstream of it: Global cannot start without it, the tax engine needs it for every US trade, export has to write a currency column that means something. |
| 2 | Partial history | **Unchanged and built.** Every figure the steps below compute is built on it. |
| **2a** | **Earmarks and schemes (slice B)** | **New, first of the new, and early for a reason that did not exist when this list was written.** The FIRE read-out shipped ahead of step 9 (PR #69) and starts from the Overview's net worth, which counts the emergency fund, SSY and any house deposit. B corrects a live figure. It needs a column and a pure function, no new table and no new policy, so nothing in steps 3 to 8 is a prerequisite. |
| **2b** | **Protection (slice C)** | **Moved in from step 6**, where "protection" was already named. It extends `insurance_policy`, which exists (`20260906130200`) and says in its own comment that cover and renewal arrive with this slice. That makes it much cheaper than the design assumed, it gives Calendar (8) its renewal dates, and the nav slot it needs lands with it. Needs 2a: the cover gap subtracts a liquid corpus that 2a defines. |
| 3 | Tax engine and Tax screen | **Unchanged**, plus a new remaining item, **3b section deductions**, which needs `scheme` (2a) and policy premiums (2b), so it comes after both. B does sit ahead of step 3, but for the earmark correction and not for the Tax screen's sake: the engine applies only the standard deduction today, so there is no section grouping for `scheme` to feed, and that alone would not have moved it. |
| 4 | Global | **Unchanged.** `peak.ts` is already capturing the one thing that cannot be reconstructed. |
| 5 | Reports, export first | **Unchanged in position**, and the reason stands: the gate is a round trip and cannot be tested from the far end. It gets one new rule: the export is generated from a list of entities, and every new entity (2a, 2b, 6a) registers itself in that list as part of being done. |
| 6 | Property and the rest of the balance sheet | **Unchanged**, minus "protection", which is 2b. Gains one rule for PPF, SSY, NSC and KVP (credited interest steps the value at credit) and one question owed to the FIRE corpus (is an owned home in it?). |
| **6a** | **Flow (slice A)** | **New, immediately before step 7.** The design's transfer rule needs an `account` to move money between, and bank import needs the same `account` for its per-bank profiles, so the rule and the registry must exist first. A is also the largest slice and the one most entangled with Reports, import and the Tax card, so it goes last of the three. |
| 7 | Bank and card import | **Unchanged in position, wider in scope**: transfer detection is part of it, not a follow-up (see the note under 7). |
| 8 | Calendar | **Unchanged.** It was already placed after property, protection and the tax engine because it is a view over what they create, and now it has its inputs: deposit maturities (existing), policy renewals (2b), advance tax (3). |
| 9 | FIRE with the live projection | **Unchanged and still last of the computed steps.** What changes is what it starts from (2a) and the fact that part of it is already live. |
| 10 | Narrow what a contributor and a viewer can read | **Built, and now a standing rule** for every new table (see 2b and 6a). |
| 11 | Read-auditing | **Unchanged and still last**: every step above adds tables it would otherwise have to be retrofitted onto, and 2b and 6a add two with personal detail. |

**Why B, then C, then A** and not the design's B, A, C. The design records the
argument for putting C earlier and says that if it wins, C and A swap. It wins,
and for a reason the design did not have: C is an extension of an existing table
with an existing, tested policy shape, so the "largest new security surface" it
was held back for is mostly not there. A is where the new tables, the new
privacy rules and the dependency on import are. B stays first either way, because
it is the only one that fixes something that is wrong today.

**The one change a person will see: the FIRE figure gets smaller.** It is a
correction and not a regression, and it is written down here so that it is not
discovered in a screenshot.

- *When.* Not at deploy. `earmark` defaults to none, so every existing household
  reads exactly what it read before until somebody tags a holding. The figure
  moves the first time an earmark is saved, which is a visible action with the
  reason beside it.
- *What the screen says.* Always, while any holding is excluded: "Reached ₹X: net
  worth ₹Y, less ₹Z set aside (emergency fund, a child's, a house)", with the
  parts named. The first time the figure falls on a device, once: what changed and
  why ("Money you have set aside for something other than retirement is no longer
  counted toward it"). That notice is a device preference and needs no schema.
- *What else has to change with it.* The Overview's net worth does **not** change
  (it counts everything it owns), so FIRE's "Reached" and the Overview's hero stop
  being the same number, on purpose. `FireReadout`'s comment, the Departure that
  says it "starts from the Overview's net worth", and the spec "the projection and
  the Overview start from the same net worth" all say the opposite today and are
  rewritten in the same change.
- *A nudge, to be decided.* Because nothing changes until somebody tags, the
  correction can sit unreached indefinitely. A Needs attention line while holdings
  exist and none is tagged ("FIRE counts everything you hold; tag your emergency
  fund") would make it reachable. It is a new notice, so it is the maintainer's call.

---

**1. The currency control.** Everything else in this stage is downstream of it.

`fx_rate` exists (`20260908130000`), `src/domain/fx.ts` converts, and the
Overview headline already refuses honestly when a rate is missing. What does not
exist is anywhere for a person to say which currency they are reading in.
`docs/design/conformance.md` records it as *"in the avatar menu and Settings" →
"neither, yet"* — dropped from both because two controls for one setting drift
apart. That reasoning still holds; the conclusion has expired. It lands in
Settings, alone, and it lands first.

It is first because Global cannot start without it, the tax engine needs it for
every US trade, and export has to write a currency column that means something.
Building it after any of those three means rebuilding part of them.

**Built.** The control is in Settings, alone, in the device group (`DISPLAY_CURRENCY`; the Departures table says why it is one control and not two), and `fx_rate` and the conversion module it reads were already there.

**2. What the app does when a statement covers only part of the history.**

The first real import made this concrete. A CAMS eCAS requested for April to
September writes a lot per instalment in that window and nothing before it, so
the app holds 280 units of a fund whose closing balance on the same statement is
4,013. Five sixths to nine tenths of three positions are simply absent.

The missing units are not the problem. The problem is that nothing says they are
missing: the quoted value offered for recording is units times NAV, so accepting
one stores ₹29,542 for a holding worth about ₹4.2 lakh — and it stores it as an
ordinary reading, indistinguishable from a complete one, feeding net worth,
allocation, the FIRE multiple and every total downstream.

**The decision: stop asking one number to answer two questions.**

*How much is this worth* and *what did it cost* have different sources, and the
statement supplies both separately. The closing balance is the registrar's own
count of units held on a date. The lots are the purchase history. A partial
statement gives a complete answer to the first and an incomplete one to the
second, and the app has been deriving both from the lots — which is why the
value came out 93% short.

So:

- **Import records the closing balance.** `holding` gains `stated_quantity`,
  `stated_as_at` and `stated_source_batch_id`, written from the per-scheme
  closing units the statement already prints. A later import with a later
  `stated_as_at` supersedes it; an earlier one does not.
- **Units for valuation are the stated balance as at its date, plus the net of
  lots dated after it.** That is right for a partial history and stays right for
  a household still running an SIP after the statement was cut.
- **Cost stays derived from the lots alone, and never borrows the stated units.**
  A cost figure is the sum of what was actually paid; there is nothing to sum
  for units the statement did not itemise.
- **Where the two disagree, the return is refused, not printed.** ₹4.2 lakh of
  value against ₹29,542 of recorded cost is a +1,300% gain that never happened.
  The percentage, the gain figure and the allocation return column all come back
  empty with the reason on them, exactly as an unpriced holding does today.
- **The holding is marked short, and the mark travels.** A caveat on the figure
  names the arithmetic — lots cover 280.479 of the 4,013.730 units reported on
  30 Sep 2026 — and Overview carries a notice counting how many positions are in
  that state. Net worth still includes them, because with stated units the
  valuation is now correct; what is qualified is the cost, the gain and the
  history, not the total.
- **Capital gains need no new guard.** The FIFO matcher already refuses to cost
  units it has no purchase for and reports the shortfall. This step is the same
  refusal applied to valuation, which had none.

**Rejected: writing the opening balance in as a single synthetic lot.** It makes
the units right in one line and is the obvious shortcut. It also invents a
purchase date and a cost for units bought across years, and both feed the tax
engine — a fabricated acquisition date produces a confident long-term
classification out of nothing. A gap the app can see is worth more than a number
it made up.

**The real fix is still a file request, not code.** An eCAS requested from
before the first investment carries the whole history, overlapping rows are
recognised line by line and only the new ones are written, and the shortfall
resolves itself. The work above is what the app does in the meantime — and it is
also what it does forever for a folio whose registrar will not go back far
enough.

Here rather than later because every figure the steps below compute is built on
these.

**Built.** `holding.stated_quantity`, `stated_as_at` and `stated_source_batch_id` (`20260919120000`), valuation from the stated balance plus later lots, cost from the lots alone, the return refused where the two disagree, and the Overview notice counting positions in that state.

**2a. Earmarks and schemes — design slice B.**

*Where it sits, and why it moves in.* See the table above: it corrects a figure
that is live. The original reason step 9 was last still holds for the *projection*
(it needs the balance sheet complete). It does not hold for the *corpus
exclusion*, which needs a column and a function and nothing from step 6.

*One migration, both columns*, because they are one cheap change and splitting
them would put two template-version bumps in front of Reports (5):

- `holding.earmark` — `emergency | retirement | child | house | none`, not null,
  default `none`, at most one. It is on the **holding** because it says what *this
  household's* money is for.
- `instrument.scheme` — `fd | rd | ppf | ssy | nsc | kvp | scss | pomis | po_td |
  other`, nullable, with a check that it is null unless `kind = 'deposit'`. It is
  on the **instrument** because it says what a thing *is*, beside `kind`. (The
  design says `holdings.kind`; the schema's `kind` is on `instrument`.)
- No new table and no new policy: the existing holding policies cover both, and
  the audit trigger already records the change. The migration still redefines
  `reset_demo_household` if the seed tags anything, and the seed does (an
  emergency fund, SSY as `child`, a house deposit), so there is something to see.

*Pure functions, fixtures first* (`CLAUDE.md`: anything numeric):

- `fireCorpus(holdings)` returns the included total and the excluded parts by
  earmark. **One classification, defined once**: FIRE's corpus and the cover gap's
  "liquid corpus" (2b) are different filters over the same holdings (an SSY is
  excluded from both; a locked PPF is in FIRE's corpus and not liquid), and three
  screens defining them three ways is how they disagree. Both are named outputs of
  this one function.
- `monthsOfCover(emergencyTotal, monthlyExpenses)` returns `null` (not 0, not
  infinity) with fewer than three complete months and with a zero denominator;
  trailing twelve months or all there is.
- Every `scheme` and `earmark` value resolves to a label, by iterating the enum.

*Consumers in this slice:* the FIRE read-out's corpus and its standing line (see
"the one change a person will see"); a scheme filter on Holdings; the earmark
control in the holding's edit form (a figure-free control, so nothing for privacy
mode to hide); and the emergency-fund line, which goes where it fits on today's
Overview (between the asset cards and the allocation) and moves to the design's
position when 6a builds the band around it.

*Not in this slice, and why.* What `scheme` is *for* has no consumer yet: a
maturity date for Calendar (8), a lock-in for the FIRE projection (9), a tax
section for the Tax screen (3b), and the accrual rule for PPF and SSY (6). The
column is the label they will read, and it is cheap to have it early. **A
maturity date does not come from the column**: it comes from `fixed_income_terms`
where a holding has them, and an RD, PPF or SSY has no single principal and fixed
rate to put in them, so those maturities are step 6's.

*Done when:* the design's unit tests pass (corpus exclusion by earmark, null
months of cover, `scheme` rejected off `deposit`, enum labels); the FIRE spec no
longer asserts that Reached equals the Overview hero; `privacy-mode.spec.ts`
covers the months-of-cover line and the excluded total; the reset test and
`check-demo-seed` pass with the new columns; and the Departure and the docs
named above are rewritten in the same change.

**2b. Protection — design slice C.**

*Where it sits, and why.* "Protection" was named in step 6's list. It comes out
of there because it is an extension of a table that exists, not a new one: it
adds columns to `insurance_policy` (cover or sum assured, renewal date, a link to
a holding for the hybrid cases, kinds for `ulip` and `money_back`) on top of the
policy shape step 10 already gave it (owner and partner read all; a contributor
reads the ones filed under them; a viewer none; every verb gated). Its premium is
already in the annual expense, which is why FIRE counts a policy and has never
needed its cover.

*What carries over unchanged from the design:* no value column on a policy,
ever; a ULIP is two records (the policy and a linked holding carrying the
surrender value) and its premium is an expense while the surrender value is an
asset; the cumulative-premiums-versus-surrender-value gap is shown; the cover gap
is a stated calculation with every input a visible household setting and no
recommendation; health cover gets no suggested figure.

*What this plan adds, because the repository says so:*

- **The settings are household columns**, like `fire_multiplier` and the
  projection's three (`20260909120000`, `20260929120000`): additive, defaulted,
  audited, with the default on the face of the screen. A household setting is not
  a constant in code.
- **The cover gap's "liquid corpus" is the one 2a defines**, not a second
  definition.
- **A policy number is last four digits only.** The design stores "policy numbers
  and nominee names" as the most sensitive columns in the app. `CLAUDE.md` and
  blueprint §15 say account identifiers keep the last four digits, and a policy
  number is one. `fixed_income_terms.account_last4` is the precedent. Nominee
  names are personal data the rule does not cover and need a decision.
- **Row-level security cannot hide a column from a role.** If nominee stays, it
  lives in its own table with owner and partner policies, and the "its own
  assertion" test the design asks for becomes a plain policy test.
- **Insurance needs a home in the navigation, so the nav change lands here.** The
  bottom bar has five slots and they are full. `Overview · Expenses · Holdings ·
  FIRE · More`, with Tax, Insurance, Profile and Settings in More, is part of this
  slice. The *Money* rename waits for 6a, because it is wrong only once income is
  recorded there.
- **A Departure is reversed.** "Loans and policies | on FIRE, not a screen of
  their own" stays true for loans and stops being true for policies. The row is
  rewritten when the screen exists, and `docs/design/prototype.html` and the
  ledger get the Insurance screen, per `CLAUDE.md`.
- The renewal reminder uses the machinery that already calls out a maturity within
  thirty days on Needs attention.

*Done when:* the design's pgTAP tests pass for every verb across households (the
existing `rls_role_reads.test.sql` already covers select); a policy with no
linked holding contributes exactly 0 to net worth (assert the total); privacy mode
removes cover and premium from the document, **including inside the editable
rows** (an input's value is its digits in the markup; finding 22 is the lesson);
the new rows are editable rows (`.edit-row`, `RowAction`, `--inset`); and the
reset function, the seed and the audit trigger cover anything added.

**3. The tax engine, and the Tax screen on top of it.**

The largest single piece. `tax_rule` holds dated rows and
`src/domain/tax-rules.ts` classifies a parcel long or short term against the rule
that covered its sale, refusing where no rule covers the date. **Built since:**
netting, the ₹1.25 lakh equity allowance, the slabs, rebate, surcharge and cess.
**Still ahead:** the foreign tax credit and its Form 67, and advance-tax
instalments.

Pure functions, per `CLAUDE.md` — no I/O, no `Date.now()`, the date passed in —
and fixtures with known answers written before the implementation.

*First chore of this step:* `docs/design/conformance.md` still carries a
departure saying long and short term go unlabelled "until `tax_rule` exists".
It exists, and has since `20260912120000`. Close that row as part of this work
rather than leaving a known-stale claim in the file CI reads.

*3b. Section deductions, new.* The engine applies the standard deduction and no
other (`src/domain/income-tax.ts`), so the old regime's figure reads high for
anyone who claims 80C or 80D, and the Tax screen has nothing yet that groups by
section. This is the work that gives `scheme` a tax consumer: PPF, SSY and NSC
under 80C, life premiums under 80C and health premiums under 80D, which is why it
comes after 2a and 2b and not before. `deduction_cap` already says "a section
number later" (`20260920120000`). The caveat on the old-regime figure stays until
this is built. It is also where the Tax card's typed-and-forgotten salary meets
the income ledger (6a): the card's own comment says that where salary lives "is a
design of its own that needs a table and its policies reviewed", and 6a is that
design.

**4. Global.**

The abroad half of the portfolio, and the paperwork it creates: the direct US
brokerage holdings kept apart from the feeder funds that only track a US index,
LRS headroom against the USD 250,000 year, TCS above ₹10 lakh, and Schedule FA
on the calendar year with its initial, peak and closing values.

`src/domain/peak.ts` is already capturing peak values monthly, which is the one
part of this that cannot be reconstructed later — it is why the snapshot job was
built in stage 4 rather than here.

**5. Reports — export first, then the template upload.**

Export in both formats, then the template with its preview-before-commit flow on
top of `import_batch` (`20260917120000`).

Export leads because the gate below is a round trip and you cannot test a round
trip from the far end. It is also the cheaper half: a file written from data the
app already holds, against an import path that has to survive whatever a person
did to it in Excel.

The demo household needs the prototype's `sample-bar` by the time anything can
be exported from it — a banner marking illustrative figures. It is a small
component and it is what stops a demo export being mistaken for a real one.

*What 2a, 2b and 6a do to this step.* Blueprint §14 makes the full export "one
sheet per entity" and "deliberately identical in shape to the upload template",
with a template version for when the schema gains a column. Income, policy cover
and the two new holding columns are new entities or columns, so:

- **The export is generated from a list of entities, and registering in that list
  is part of "done" for any slice that adds one.** Otherwise each slice amends
  export, template, round-trip test and deletion cascade by hand. The same list
  drives the account-deletion export phase 1 requires, which has to carry
  everything personal, new tables included.
- **Export still leads, for the reason above, and income does not change that.**
  Income is another sheet, and a round trip has to land a transfer as a transfer:
  the link between its two sides is part of the row, or a re-upload turns it into
  income and expense.
- 2a and 2b land before this step, so the *first* template already has `scheme`,
  `earmark`, cover and renewal. 6a lands after it and costs one template version,
  which §14 designs for.
- A backup workbook is a readable file outside the app's protections. Cover, and
  anything the design calls nominee or policy detail, is a decision about whether
  it is in the file at all, not only about who may read the table.
**6. Property, and the rest of the balance sheet.**

Property with its cost basis, bonds and deposits, retirement, protection and
liabilities. Loans and policies already live on FIRE and stay there — see the
Departures table in `docs/design/conformance.md`; what is missing is the assets
side, not another home for the debts.

**Built so far:** FD and bond accrual as a calculation module (`src/domain/accrual.ts`, fixtures
written first); and the terms schema, `fixed_income_terms` and `deposit_renewal`
(`20260927130000`), reviewed and merged. Compounding is a property of each deposit, because this
household's deposits compound yearly where the blueprint's example is quarterly; a deposit that
auto-renews is a chain of terms (the interest joins the principal and the whole is redeposited for
the same term), where a renewal that has happened is recorded from the bank's advice and one that has
not is projected and shown as a projection (`depositChainValueOn`). **Held by the household, which
decides what is built:** property, fixed deposits, bonds, PPF, EPF, NPS and other.

**Also built:** the Deposits and bonds card on Holdings (`src/features/holdings/FixedIncome.tsx`), its repository functions
(`src/repo/fixedIncome.ts`) and the pure view over the accrual module (`src/domain/fixed-income.ts`), with an end-to-end test. Terms
can be added, corrected in place and renewed, a bond pays out or is cumulative and keeps a rating history with a downgrade called out, and a maturity within thirty days is called out on the card and on the Overview. See `docs/decisions.md` for how a deposit reaches net worth.

**Still to build, in this order:**
`property` and `property_improvement` with a pure cost-basis function (purchase, stamp duty,
registration and capital improvements, not repairs); then PPF (computed from the notified rate on the
lowest balance of the month), EPF (typed from the passbook) and NPS (units x NAV).

*What the design changes here.* Protection is no longer in this step (2b).
Three things are owed before it is built:

- **Interest that is accrued but not credited steps the value at credit** (the
  design's rule, and it is the passbook's). PPF, SSY, NSC and KVP are marked up
  once, when the bank does. PPF's monthly calculation on the lowest balance is
  still needed to *predict* that credit, but it is not a monthly mark-up of the
  holding. This differs from what is built: a bank deposit or a bond is worked
  out from its terms and Close month writes that worked-out value, so it moves
  every month (`docs/decisions.md`). The rule is therefore **per scheme, said so,
  and Close month carries the last credited value for the stepped ones**. Applying
  it to every deposit would reverse a decision the maintainer made on purpose.
  It is recorded in `docs/decisions.md`, which is where the design's "sibling of
  `tokens.md` for data rules" already lives.
- **The scheme list is not the retirement list.** The design's `scheme` has `ppf`
  and no `epf` or `nps`; this step lists all three; `icons.md` §4 draws
  "retirement (PF · PPF · NPS)" as a future *kind* with its own tile. One answer,
  before build: either EPF and NPS are `deposit` schemes, or retirement is a kind
  and PPF is a retirement holding, or `other`. The allocation donut and the tile
  follow from it.
- **Is an owned home in the FIRE corpus?** The earmark `house` means a deposit
  being saved, not a house lived in. Property arrives here, and the corpus
  function (2a) needs to say what it does with it. The conservative answer is
  that a home you live in is excluded.
**6a. Flow — design slice A.**

*Where it sits, and why.* Immediately before bank and card import. The design's
transfer rule ("moving money between the household's own accounts is neither
income nor expense") needs something to move money *between*, and the blueprint's
`account` (§04: institution, type, currency, last four) is not built. Import needs
the same `account` for its per-bank profiles. So the registry and the rule exist
first, and import builds detection on top. This is also the largest slice, and
the one entangled with Reports, import and the Tax card, so it goes last of the
three.

*Decisions owed before it is built* (each is a conflict with something already in
the repository):

- **Which income.** The blueprint's `income_entry` is per member, per tax year, by
  head (salary, house property, other, foreign) with TDS: the Tax screen's input.
  The design's `income` is a dated ledger by category. They should not be two
  stores that disagree. The ledger is the source and the tax-year heads are
  derived from it; it needs a TDS field, or the Tax card cannot use it.
- **`capital_gain` is not an income category.** `CLAUDE.md`: capital gains are
  derived from lots and a gain is never stored. A recorded gain is the same
  mistake. It is shown, derived, beside the ledger, and not in it. Dividends wait
  on the `dividend` table that does not exist yet; interest on a deposit is
  derivable from its terms, which is the design's own open question about auto
  rows and has the same answer.
- **Income is private by default.** Blueprint §20: "your income entries which
  stay yours". It carries `visibility` as expenses and holdings do, with a
  security-definer total (as `personal_holding_totals`) so *Saved this month*
  can include another member's private income as a sum without detail. A
  contributor reads their own and a viewer none (step 10's shape); `access.ts`
  and a household summary function follow.
- **A transfer goes to a holding as well as to an account.** An SIP, an RD
  instalment and a lump sum into a fund all leave a bank account and are neither
  income nor expense. The rule, the representation and the importer's job cover
  "an account or a holding", or the investment purchases are the first things
  import books as spending.
- **The Money rename.** The route and the screen id are `expenses` in `useScreen`,
  `access.ts`, the ledger and a large part of the e2e suite. Rename the label and
  keep the id, or rename both with a redirect. The nav change itself is 2b's.

*Also here:* the stock and flow regions of the Overview, with the one lifted
surface per screen unchanged (`theme.spec.ts` must not be relaxed); the two
savings figures, labelled; the Tax card reading salary from the ledger instead of
a box that forgets it.

*Debts and the balance sheet are two pieces of work, not one.* Debts already
exist: liabilities with `outstanding_minor` (`20260908130000`), shown as stats
under the net worth figure and subtracted from it, with loans on FIRE. Step 6 is
the *assets* side ("what is missing is the assets side, not another home for the
debts"). The design's Overview order does not list debts, though its stock
definition does, so 6a keeps today's presentation of them. What 6a and 6 share is
the Overview's stock region. 6a fixes its structure (names, order, accessible
regions) with today's content, and 6 then puts property into it. Doing both in the
other order reworks the region twice.

*Done when:* the design's tests pass (a transfer is in neither total; privacy mode
removes income by absence from the DOM); every new table has its audit trigger,
its `enable row level security`, its explicit grants, and a denying test per verb
across households and per role; **`reset_demo_household` clears it and the seed
fills it** (see below); and the export list, the deletion cascade and the template
version are updated.

*A guard worth building once, here or earlier.* `reset_demo_household` raises at
run time if a household table is not cleared, which CI does not exercise. The
fixed-income tables went uncleared for two migrations and it was found by reading,
not by a test. Each new table in 2a, 2b and 6a is another chance. A pgTAP test
that reads every public table with a `household_id` and fails if the function body
does not name it costs a few lines and ends the problem.
**7. Bank and card statement import.**

*Sources, as the household has them:* an HDFC savings account (PDF, Excel, delimited and text), an ICICI savings
account (PDF and XLS) and an ICICI credit card (PDF). Formats differ by bank and by file type (columns, a
single signed amount or separate debit and credit, date formats, a preamble and footer), so a column-mapping
step with a remembered profile per bank is the plan, not one parser. Order: the HDFC delimited file first
(plain text, no new dependency), then the ICICI card PDF (the PDF reader is already in the app), then ICICI
savings. **XLS needs a spreadsheet library, which is a new dependency: a decision for the maintainer.** Real
sample statements are collected by the maintainer, redacted, **outside the repository** (it is public); the
fixtures in the repo are synthetic ones with the same structure. Not started.

"Import beats typing" (blueprint §158), and the entry flow is the project's
stated failure mode — a month of card spending typed by hand is where somebody
stops using this.

It comes after export because of the gate, and after eCAS because the blueprint
sequences it that way (§791) and eCAS is already done.

Three things this has to do, all of them from using the app rather than from the
specification:

**Guess the category, and be obviously guessing.** A statement line says
`UPI/RAZORPAY/8817` and not which envelope it belongs in. The importer should
suggest — from the payee text, from what that payee was filed under last time,
from the amount and its regularity — and mark every suggestion as one, because a
wrong category that arrived silently is worse than a blank. Learned from the
household's own history, not from a shipped keyword list that knows nothing
about how this family spends.

**Let every row be changed before anything is written**, and after. That is what
the preview-before-commit flow is for; the category edit that already exists on
an expense is the same control afterwards.

**Never import the same line twice.** A statement re-uploaded, or two statements
overlapping at a month boundary, must not double a month's spending. Needs a
stable identity per line — date, amount, and the raw description, hashed —
recorded against the row so a re-import recognises what it has already seen.
`import_batch` already does this for eCAS lines; the same mechanism carries.

A card statement is the more valuable of the two *for spending*, because it is
where the discretionary money goes. It also settles a question the category
catalogue raised: **a card repayment is never an expense.** The purchases were
recorded when they happened, so filing the repayment too would double every one
of them — which is why there is no "credit card repayment" category and why the
importer must skip the payment line on a bank statement that settles a card.

*Transfer detection is part of this step, and it needs 6a first.* Import sees a
debit and a credit and does not know they are the same rupees. It matches them to
an `account` from 6a, applies the transfer rule, and treats a debit to a fund
house or a deposit as a purchase to link, not an expense. It also gives the
months-of-cover line (2a) honest input: until the log is complete, an average of
what was typed understates spending and overstates the cover, and the three-month
guard only catches too little history, not an incomplete log.
**8. Calendar.**

Due dates, SIP posts, premium renewals, advance-tax instalments. It goes here
because it is a view over things the earlier steps create — there is little to
put on a calendar until property, protection and the tax engine exist.

Its inputs are now named: deposit and bond maturities (built), policy renewals
(2b), advance-tax instalments (3), EMIs and SIPs (6a). **A scheme maturity is
not an input until step 6 has one**: the `scheme` column alone carries no date. It
lands after 2b and 6, and not before either, or it is built twice.
**9. FIRE with the live projection.**

_Partly pulled forward (the FIRE read-out, `docs/design/conformance.md` Departures):_ a corpus
projection from three assumptions the household sets, a monthly contribution, a yearly return and a
yearly raise, started from the Overview's net worth. What is still this step's: the projection from
real contributions rather than a typed one, and goals, coast-FIRE and scenario compare.

Projected against real contributions rather than a flat assumption, and against
goals, neither of which exists today. It needs the balance sheet from step 6 to
be complete, or the projection starts from a number that is missing the property
and the deposits.

*Part of this is already live, and the dependency this paragraph describes is
already crossed.* The FIRE read-out (PR #69) projects from the Overview's net
worth with three typed assumptions, and so from a corpus that counts money set
aside for something else. 2a is the correction. What remains for this step is
the real-contributions projection, goals, coast-FIRE and scenarios, and the
questions 2a deliberately leaves open: a **lock-in** (an SSY or a PPF is not
available before it matures, so it belongs in the projection at its maturity,
which turns the corpus from a number into a dated schedule) and the property
question under step 6. Neither is solved by an exclusion.
**10. Narrow what a contributor and a viewer can read.**

**Built.** Section 11 of the blueprint says a contributor sees their own records plus household
expense totals, and a viewer a household summary with no account identifiers. Until this the database
enforced neither: every role read every household row. Now (`20260925120000`, tests in
`rls_role_reads.test.sql`):

- **Owner and partner** read what they always did.
- **A contributor** reads their own expenses, holdings (and so their valuations, lots, disposals and
  deposit terms, which read through the holding), loans, policies, audit entries and imports, plus the
  categories, budgets and instruments. They can therefore no longer record a purchase or a sale against
  somebody else's holding: that is the intended change, and `lot_disposal.test.sql` says so.
- **A viewer** reads no record at all, only the household and its members, and the exchange rates, which
  an existing test keeps readable on purpose. Invitations are owner and partner only (they carry emails).
- **A summary** replaces rows: `household_expense_totals` (with category names, `20260926120000`) and
  `household_asset_totals` return sums and never a row. `personal_holding_totals` is owner and partner only.
- **The app** gives each role the screens that are true for it (`src/domain/access.ts`): a contributor
  gets Summary, Expenses, Holdings and Tax; a viewer gets Summary alone. Overview and FIRE are household-wide
  figures and are not offered to a role that can read only part of the household.

Not yet: a budget-versus-plan comparison on the Summary for a contributor, and a contributor and a viewer
account on the demo household to look through; the screens for those roles have so far been checked by
unit tests and by the owner's view of the same code, not seen as that role.

**11. Read-auditing on the tables carrying personal detail.**

`audit_log` already accepts a `'read'` action and nothing writes it: Postgres
triggers do not fire on `select`, so this means routing those reads through
security-definer functions. Deferred from stage 2 deliberately — it is a change
to how reading works, not another trigger, and it should be designed alongside
the §20 totals surface it shares. Last in the stage because every step above
adds tables it would otherwise have to be retrofitted onto.

2b and 6a add two tables that carry personal detail (policy identifiers if a
nominee stays, and income), so the list this step covers is longer than when it
was written, which is the reason it is last.

---

**Already built, and what is left of it.**

**eCAS import** (`import_batch` with per-line hashes, `src/domain/ecas.ts`,
`src/lib/ecas-pdf.ts`, `src/features/holdings/ImportStatement.tsx`) parses both
layouts, registrar and depository, and a real November 2022 CAS reads with
nothing unread. Parsed on the device and never uploaded — a consolidated
statement lists every folio, the PAN and the address, and "doing it on the
device means [it] is never uploaded anywhere. That is better than any
server-side design, not a compromise with one" (§894).

Outstanding: editing a figure in the preview (today you leave the row out and
correct it on the holding), any undo after commit, dividends and charges that
belong to no purchase — no table holds them — and the demat half of a depository
CAS.

**XIRR** is not built and has no module. §260: "the moment a holding has a
complete ledger, XIRR and lot-level capital gains turn on for it." That ledger
is `lot` and `disposal`, built in `20260910120000`, and eCAS now fills it in
bulk. The gains half turned on; XIRR did not. It is a pure function with
fixtures, and it belongs after step 2 rather than beside any step: a return
computed from six instalments of a ninety-instalment history is wrong in exactly
the way a partial import makes everything wrong, and more convincingly, because
a percentage carries no units to check it against.

> **Gate —** export everything, edit a hundred rows in Excel, upload it back, and land in the same state. That round trip proves the whole import path.

### Stage 6 — Onto the devices — _Weeks 10–11_

- Capacitor and Tauri shells. Biometric unlock, offline queue, push reminders.

- Verify passkeys inside the shells — and fall back gracefully if they misbehave.

> **Gate —** your family can install it and add an expense without being talked through it.

### Stage 7 — Real data — _When it has earned it_

Create the real household and enter the opening position. The demo stays as a permanent sandbox. Then the roadmap's later phases — currencies and the Global screen, imports, the tax engine — with real figures to test against.

## 03. Working with Claude Code

Six practices that matter more on this project than on a typical one, because it is long-lived, single-maintainer, and carries arithmetic that must be right.

- **Write `CLAUDE.md` first and keep it short.** It is read at the start of every session and is the only thing standing between you and slow architectural drift. Invariants, not tutorials.

- **Put the blueprint in the repo.** A markdown copy under `docs/` means you can say "per the spec, build the expenses screen" instead of re-describing it every time, and the answer will match what you decided months earlier.

- **Work in vertical slices.** "Build the expenses screen end to end, repository through UI" produces something you can judge. "Build all the repository methods" produces a pile you cannot.

- **Demand the test first for anything numeric.** The tax engine, XIRR, currency conversion, the FIRE projection — write fixtures with known answers before the implementation. Plausible-looking arithmetic that is subtly wrong is the single most expensive failure mode in this app, and it is exactly what fluent code generation is prone to.

- **Never accept a row policy without a test that proves it denies.** Same reasoning, higher stakes.

- **One concern per commit, and plan before anything touching more than a few files.** Small reversible steps beat large correct-looking ones.

> **The one habit to hold**

> You are the reviewer, and on a personal finance app the consequences of not reading the code are yours alone. Read every migration, every policy, and every line of the calculation engine. Skim the screens if you like — a misaligned card is visible, a wrong long-term-gains threshold is not.

## 04. The invariants

They live in `CLAUDE.md` at the repository root, which is the live version and is read
automatically at the start of every session. It is deliberately not duplicated here — a
second copy would drift, and a stale set of invariants is worse than none because it is
still trusted.

If an invariant needs to change, change it there and say so in the same commit as the code
that depends on it.

## 05. Which model, for what

Use both, chosen by the cost of being subtly wrong rather than by the size of the task.

**Opus — to decide**

- Schema and migration design

- Row policies and the test suite that guards them

- The tax engine, XIRR, currency conversion

- The statement parser, when you get to it

- Debugging anything that has already resisted one attempt

- Any change touching many files at once

**Sonnet — to build**

- Screens, forms, tables, charts

- Repository methods against a settled schema

- Tests written from a spec you have already fixed

- Styling, theming, accessibility passes

- Refactors with a clear target

- Seed data and fixtures

**The rule of thumb: Opus decides, Sonnet builds.** When the specification is unambiguous and a mistake would be visible immediately, Sonnet is the right tool and the faster loop matters more than the margin. When you are still deciding what the specification should be, or when an error would be silent and expensive — money arithmetic, a security policy, a tax threshold — the deliberation is worth paying for.

Most of this build is the second column. The parts that are not are exactly the parts you would least like to get wrong, which is a convenient alignment: the expensive model is needed rarely, and precisely where it earns its cost.

## 06. The first session

Something to paste once the repository exists and `CLAUDE.md` is in it.

```
Read docs/blueprint.md sections 12 and 13 for the architecture, and
CLAUDE.md for the invariants.

Build the walking skeleton only — one vertical slice, nothing extra:

1. Vite + React + TypeScript + Tailwind, with the design tokens in
   docs/tokens.md.
2. Supabase migrations for household, member, user_account, membership
   and expense_txn. RLS enabled on all five, deny by default, policies
   resolving through membership.
3. A policy test that signs in as a member of household B and asserts
   zero rows from household A. Wire it into CI as a blocking check.
4. Email + password + TOTP auth. Invite-only: no public sign-up route.
5. A repository layer with exactly two methods — listExpenses and
   addExpense. No Supabase types leave that layer.
6. One screen: a list and a quick-add field.
7. A realtime subscription so a second device updates without refresh.
8. A GitHub Actions workflow that typechecks, tests, and deploys to Pages.

Stop there. Do not add a second table, a second screen, or a chart.
Show me the migration and the policies before writing the UI.
```

> **What "done" looks like at the end of week one**

> An app on your phone's home screen where you can type ₹120 for vegetables and see it appear on your laptop a second later — and a second account that provably cannot see it. Nothing else. That single week retires the only risk that could invalidate everything else in the blueprint, and every stage after it is ordinary construction.
