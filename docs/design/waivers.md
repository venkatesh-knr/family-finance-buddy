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

- PF-C10 — not built: the transfer rule and the account it moves money between arrive with slice 6a (build-plan step 6a) — 2026-10-10
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
- SC-I4 — not built: needs the transfer rule and account from slice 6a (spending-capture.md §8, S3) — 2026-10-30
- SC-I5 — not built: witnesses arrive with bank and UPI statement import (build-plan step 7; spending-capture.md §8, S4) — 2026-10-30
- SC-I6 — not built: matching arrives with bank and UPI statement import (build-plan step 7; spending-capture.md §8, S4) — 2026-10-30
- SC-I7 — not built: the share target and Paste are slice S2 (spending-capture.md §8) — 2026-10-30
- SC-I8 — not built: the UPI reference columns arrive with slice S2 or S4, whichever lands first (spending-capture.md §8) — 2026-10-30
- SC-I9 — not built: the unclosed-month label arrives with the month close (spending-capture.md §8, S3) — 2026-10-30
- SC-I10 — not built: recurring rules are slice S1 (spending-capture.md §8) — 2026-10-30
- SC-I11 — not built: the month's invested view is slice S5 (spending-capture.md §8) — 2026-10-30
- SC-I12 — not built: needs the month close's balances (spending-capture.md §8, S3 and S5) — 2026-10-30
- SC-I13 — not built: the month's invested view is slice S5 (spending-capture.md §8) — 2026-10-30
- SC-I14 — not built: the payroll line arrives with slice S5 and the income ledger from 6a (spending-capture.md §8) — 2026-10-30

## gold.md

- GD-I1 — not built: the gold kind and its forms (gold.md §6) — 2026-10-30
- GD-I2 — not built: the gold savings scheme (gold.md §3) — 2026-10-30
- GD-I3 — not built: the weight variant and physical gold need the gold kind and a dated gold rate (gold.md §6) — 2026-10-30
- GD-I4 — not built: the gold kind (gold.md §4) — 2026-10-30
- GD-I5 — not built: the gold kind and the month's invested view (gold.md §4; spending-capture.md §10) — 2026-10-30
- GD-I6 — not built: redemption arrives with the gold kind (gold.md §5) — 2026-10-30
- GD-I7 — not built: the scheme terms table (gold.md §6) — 2026-10-30
