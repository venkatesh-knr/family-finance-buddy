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

- PF-C2 — not built: the policy and net-worth interplay arrives with slice 2b (build-plan step 2b) — 2026-10-10
- PF-C3 — not built: cover arrives with slice 2b, and the assertion needs a cover to keep out of the calculations — 2026-10-10
- PF-C4 — not built: the hybrid policy and its linked holding arrive with slice 2b — 2026-10-10
- PF-C5 — not built: `scheme` arrives with slice 2a (build-plan step 2a), and its check constraint is asserted there — 2026-10-10
- PF-C6 — not built: the `scheme` and `earmark` enums arrive with slice 2a — 2026-10-10
- PF-C7 — not built: the FIRE corpus exclusion is slice 2a's correction of the live read-out — 2026-10-10
- PF-C8 — not built: the standing line stating the exclusion is part of slice 2a — 2026-10-10
- PF-C9 — not built: months of cover is slice 2a's pure function, with its fixtures written first — 2026-10-10
- PF-C10 — not built: the transfer rule and the account it moves money between arrive with slice 6a (build-plan step 6a) — 2026-10-10
- PF-C11 — not built: the step-at-credit rule for PPF, SSY, NSC and KVP belongs to the balance sheet (build-plan step 6) — 2026-10-10
- PF-C12 — not built: the cover gap and its household settings arrive with slice 2b — 2026-10-10
- PF-C13 — not built: the cover columns and their every-verb denial tests arrive with slice 2b; the existing insurance_policy policies are covered by rls_role_reads.test.sql, which does not name this rule — 2026-10-10
- PF-C14 — not built: policy identifiers arrive with slice 2b, and whether they exist beyond the last four digits is an open decision recorded in the build plan — 2026-10-10
- PF-C15 — not built: income arrives with slice 6a and cover with slice 2b, and privacy mode is asserted for each as it lands — 2026-10-10
- PF-C16 — not built: the Overview's stock and flow regions arrive with slice 6a — 2026-10-10
