# Waivers

An invariant (`docs/design/keeping-docs-honest.md`) is either named in the title of a test or waived
here. A waiver is a decision made in the open: without somewhere to put it, a red build gets a fake test
that names the ID and asserts nothing.

One line each: the ID, the reason, and the date it was written.

A waiver with no reason, no date, or an ID no document declares fails the build. One older than ninety
days warns, so a permanent waiver has to be restated by somebody who notices they are restating it. One
for an invariant that has since gained a test warns that it can go.

Every waiver below is for a rule whose feature is not built, so there is nothing yet to assert it
against. Each names the step of `docs/build-plan.md` that builds it, and is removed when the test lands
with it. None is waived because the pgTAP reader could not be trusted: it can, for this repository's
suites (`scripts/lib/sql-tap.mjs`), and counts a file only when its own assertion count equals its
`plan(N)`.

## detail-level.md

- DL-I1 — no second mode to render until detail_level ships, so nothing to compare figures across; the parameterised both-modes test lands with the setting (detail-level.md §5, §6) — 2026-10-10
- DL-I2 — no capture path can read detail_level while the setting does not exist; the import-boundary check lands with it, and it is a different kind of check from the component-class script §6 names — 2026-10-10
- DL-I3 — no mechanism to assert nav equality until the toggle ships — 2026-10-10
- DL-I4 — no essential mode to render a caveated figure in until detail_level ships — 2026-10-10
- DL-I5 — no essential-mode viewer exists to compare a response against; asserted on the repository layer's result (there is no API) when the setting ships — 2026-10-10

## protection-and-flow.md

- PF-C11 — not built: the step-at-credit rule for PPF, SSY, NSC and KVP belongs to the balance sheet (build-plan step 6) — 2026-10-10
- PF-C15 — half built: the cover half is asserted in tests/e2e/insurance.spec.ts, which does not carry the ID because the rule also names income, and the income ledger arrives with slice 6a (build-plan step 6a) — 2026-10-11
- PF-C16 — not built: the Overview's stock and flow regions arrive with slice 6a — 2026-10-10

## goals.md

- GL-I1 — not built: goals (a holding links to at most one goal) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15
- GL-I2 — not built: goals (the independence goal is the FIRE target) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15
- GL-I3 — not built: goals (the emergency goal) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15
- GL-I4 — not built: goals (targets in today's money) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15
- GL-I5 — not built: goals (locked money and a goal) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15
- GL-I6 — not built: goals ("needs a month" as a calculation) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15
- GL-I7 — not built: goals (progress uses the values net worth uses) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15
- GL-I8 — not built: goals (private holdings inside goals) are build-plan step 9, and goals.md replaces the earmark when they land — 2026-10-15

## spending-capture.md

- SC-I1 — not built: the month close needs the account registry and income ledger from slice 6a (spending-capture.md §8, S3) — 2026-10-30
- SC-I2 — not built: the closed-month view arrives with the month close (spending-capture.md §8, S3) — 2026-10-30
- SC-I3 — not built: the closed-month view arrives with the month close (spending-capture.md §8, S3) — 2026-10-30
- SC-I7 — not built: the share target and Paste are slice S2 (spending-capture.md §8) — 2026-10-30
- SC-I12 — not built: needs the month close's balances (spending-capture.md §8, S3 and S5) — 2026-10-30

## gold.md
- GD-I11 — half built: a gold purchase raises invested and its Gold line (`src/domain/invested.test.ts`, 12 November 2026), but "never in spent" waits for the month's spent figure, which is the close (6d) (gold.md §6; spending-capture.md §8, §10) — 2026-11-06
- GD-I13 — not built, and not to be: the owner decided on 6 November 2026 that no listed-gold-ETF tax class is added (docs/decisions.md, Gold); gold.md §5 and this invariant are for the owner to retire — 2026-11-06

## commercial-launch.md

- CL-I1 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I2 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I3 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I4 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I5 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I6 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I7 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I8 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I9 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06
- CL-I10 — not built: proposed, awaiting the owner's decisions in commercial-launch.md §12 — 2026-11-06

## simple-layout.md

## ledger-income.md

- LI-I15 — not built: proposed, step 6a; awaiting the owner's answers in ledger-income.md §10 — 2026-11-13
- LI-I17 — not built: proposed, step 6a; awaiting the owner's answers in ledger-income.md §10 — 2026-11-13

## card-cycles.md

- CY-I11 — not built: the first-cycle state *started from the statement's previous balance* is not said apart from a cycle, since a balance does not record whether it was a statement's printed previous balance; the other states are said in the close and on the month card (card-cycles.md §8.2, slice 5) — 2026-11-20
- CY-I9 — not built: the domain of slice 2 (card-cycles.md §10) — 2026-11-20
- CY-I17 — not built: the debit link and the loan-payment guard are in the migration of slice 1 and its pgTAP file; the debt and its outstanding are slice 7 (card-cycles.md §10) — 2026-11-20
