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

## holdings.md

- HD-I1 — not built: the grouped Holdings list is the Holdings redesign, which this file specifies and which lands on its own branch after the Overview reversals; the row shows the latest recorded value and the test lands with it — 2026-10-11
- HD-I2 — not built: group subtotals arrive with the grouped list, and the test asserts them against the summary total per currency — 2026-10-11
- HD-I3 — not built: a refused gain on a row arrives with the compact row — 2026-10-11
- HD-I4 — not built: the filter in the URL arrives with the chips, and the Overview allocation row is the first link to it — 2026-10-11
- HD-I5 — not built: one Add on the list arrives with the redesign; the per-card actions are the current screen — 2026-10-11
- HD-I6 — not built: the detail view that takes its kind's shape arrives with the redesign — 2026-10-11
