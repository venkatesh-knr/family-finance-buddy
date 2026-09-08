# Design conformance

What the prototype designs, what the app builds, and where the two deliberately
disagree.

This exists because the design and the code are written in different places and
drift apart quietly. `scripts/check-design-sync.mjs` reads this file on every
build and fails when it goes stale: every screen the prototype defines must have
a row here, and every row claiming something is built must name a path that
exists. It cannot tell you whether a screen *looks* like its mock — that is a
person with both in front of them — but it can stop the ledger quietly becoming
fiction.

**Statuses.** `built` — the thing exists and does its job. `partial` — some of it
exists, and the note says which part is missing. `not-built` — designed, not
started; the note says which stage owns it, per `docs/build-plan.md`.

Adding a screen to the prototype without adding a row here fails the build. That
is the point: the failure is a prompt to decide when it gets built, not busywork.

## Screens

| Item | Kind | Status | Where / why |
|---|---|---|---|
| overview | screen | partial | `src/features/overview` — assets per currency, allocation by kind, reading gaps, month close. Not built: the donut, the since-inception chart, member attribution, and net worth itself — see Departures |
| expenses | screen | built | `src/features/expenses` — quick add, budget vs actual, spending plan, ledger |
| investments | screen | partial | `src/features/holdings` — holdings and valuations; no fund/equity breakdown, no India/Abroad split |
| property | screen | not-built | Stage 5 |
| global | screen | not-built | Stage 5 — needs FX and the currency work |
| fire | screen | partial | `src/features/plan` — target and ladder; no goals, no projection against real contributions |
| tax | screen | not-built | Stage 5 — needs the tax engine and `tax_rule` rows |
| protection | screen | partial | `src/features/plan` — loans and policies live on Expenses, not a screen of their own; see Departures |
| calendar | screen | not-built | Stage 5 |
| reports | screen | not-built | Stage 5 — export, template upload |
| profile | screen | built | `src/features/profile` — identity, private-entry count, recent activity |
| settings | screen | built | `src/features/settings` — device and household groups, members absorbed |
| privacy | screen | not-built | Where-your-data-lives status page; partly served by Profile's activity list |

## Components

| Item | Kind | Status | Where / why |
|---|---|---|---|
| card | component | built | `src/ui/primitives.tsx` — plus collapsible, which the prototype has no equivalent of |
| pill | component | built | `src/ui/primitives.tsx` — five tones, `own` `ok` `warn` `due` `neutral` |
| notice | component | built | `src/ui/primitives.tsx` — caveat with its reasons folded away |
| problem | component | built | `src/ui/primitives.tsx` — `role="alert"`, no prototype equivalent |
| field | component | built | `src/ui/primitives.tsx` |
| button | component | built | `src/ui/primitives.tsx` |
| segmented | component | built | `src/styles/base.css` |
| setting-row | component | built | `src/styles/base.css` — `.setgrp` `.setrow` `.grouphead` |
| account-menu | component | built | `src/app/AccountMenu.tsx` |
| icon-button | component | built | `src/styles/base.css` — `.iconbtn` |
| stat-tile | component | built | `src/ui/primitives.tsx` — `Stat`, a dt/dd pair so the label and figure stay paired |
| progress-bar | component | built | `src/ui/primitives.tsx` — `Bar`; flips to coral past target, requires an accessible label |
| table | component | built | `src/ui/primitives.tsx` — `Table`, with the scroll wrapper the page body must never need |
| delta-chip | component | built | `src/ui/primitives.tsx` — `Delta`; the arrow carries the direction, the hue agrees |
| sample-bar | component | not-built | The prototype's banner marking illustrative figures |

## Departures

Places the app deliberately does not follow the prototype. Each is a decision,
not a gap — if one of these is revisited, change it here first.

| What | The prototype | The app | Why |
|---|---|---|---|
| Pill radius | 3px | 100px | `docs/tokens.md` §158 says 100px and is the source of truth. The mock disagrees with it. |
| Tab semantics | 10 × `role="tab"`, no `tabpanel`, no `aria-controls` | `role="group"` + `aria-pressed` | An incomplete ARIA tab pattern announces a promise it does not keep. Ours is honest about what it is. |
| Household switcher | absent | in the shell, beside the tabs | The demo/real split is core to §1057 and Stage 3; the mock does not model two households. |
| Identity in the top bar | avatar only | avatar only | Adopted. The app previously printed the email on every screen — an address in every screenshot. |
| Currency control | in the avatar menu *and* Settings | neither, yet | Two controls for one setting drift apart. It lands in Settings alone when multi-currency is built. |
| Categories | in Settings, separate from budgets | with their budgets, on Expenses | Naming a category and saying what it should cost is one thought; splitting them means two screens to set one envelope. |
| Loans and policies | a Protection & debt screen | on Expenses | The annual-expense total already counts them. Filing them under debt splits one arithmetic across two screens. |
| Category list | thirty-six names from one workbook | a grouped catalogue, nothing pre-ticked | A household without a scooty should not inherit an "Insurance Scooty" envelope. |
| Envelopes with no spending | every category listed | folded behind a count | Twenty-eight rows reading "₹0.00 · behind" buried the rows worth acting on. |
| "Net worth" headline | assets minus debt, one figure | "Assets", per currency | `liability` records an instalment, not an outstanding balance, and there is no `fx_rate` table. One figure would be wrong by the size of the mortgage and would pick a rate nobody chose. |
| Allocation donut | an SVG donut with a legend | horizontal bars | The bar primitive exists and the donut does not. The donut arrives with the charting work; the shares are the same either way. |
| Failure states | none — a mock has no loading, empty, offline or denied states | all four, throughout | Not a departure so much as the part a mock cannot show. Do not drop them to match it. |
