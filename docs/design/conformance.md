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
| overview | screen | partial | `src/features/overview` — net worth, assets per currency, allocation by kind, rate entry, reading gaps, month close. Not built: the donut, the since-inception chart, member attribution |
| expenses | screen | built | `src/features/expenses` — quick add, budget vs actual, the ledger and its editor. The spending plan moved to FIRE — see Departures |
| investments | screen | partial | `src/features/holdings` — holdings with an editor and archive, valuations, prices from the AMFI driver, cost and gains per position (purchases, sales, FIFO parcels, realised gain, long/short term against `tax_rule`); no fund/equity breakdown, no India/Abroad split |
| property | screen | not-built | Stage 5 |
| global | screen | not-built | Stage 5 — needs FX and the currency work |
| fire | screen | partial | `src/features/plan` — annual expense, the spending plan and the commitments it is built from, target and ladder. No goals, and no projection against real contributions |
| tax | screen | not-built | Stage 5 — needs the tax engine and `tax_rule` rows |
| protection | screen | partial | `src/features/plan` — loans and policies live on FIRE, not a screen of their own; see Departures |
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
| notice | component | built | `src/ui/primitives.tsx` — a caveat that stays visible, with its reasons folded away. Used where a card IS the caveat, or where there is no figure to attach to |
| caveat | component | built | `src/ui/primitives.tsx` — a marker on the figure it qualifies, opening a native popover. No prototype equivalent; see Departures |
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
| Primary navigation | a top tab strip at every width | a bottom bar on phones, the top strip above 640px | Taken from the reference app. A thumb reaches the bottom of a phone and does not reach the top, and moving it there let the top strip go on narrow screens — which is where two rows of chrome came from. A bottom bar on a wide screen is a long way from where the eye already is, so it stops at the breakpoint. |
| Tab semantics | 10 × `role="tab"`, no `tabpanel`, no `aria-controls` | `role="group"` + `aria-pressed` | An incomplete ARIA tab pattern announces a promise it does not keep. Ours is honest about what it is. |
| Household switcher | absent | in the shell, beside the tabs | The demo/real split is core to §1057 and Stage 3; the mock does not model two households. |
| Identity in the top bar | avatar only | avatar only | Adopted. The app previously printed the email on every screen — an address in every screenshot. |
| Currency control | in the avatar menu *and* Settings | neither, yet | Two controls for one setting drift apart. It lands in Settings alone when multi-currency is built. |
| Categories | in Settings, separate from budgets | with their budgets, in the spending plan on FIRE | Naming a category and saying what it should cost is one thought; splitting them means two screens to set one envelope. Both then sit where the annual expense is derived. |
| Loans and policies | a Protection & debt screen | on FIRE | The annual-expense total already counts them, and that total is the FIRE number's first input. Filing them under debt splits one arithmetic across two screens. |
| Category list | thirty-six names from one workbook | a grouped catalogue, nothing pre-ticked | A household without a scooty should not inherit an "Insurance Scooty" envelope. |
| Envelopes with no spending | every category listed | folded behind a count | Twenty-eight rows reading "₹0.00 · behind" buried the rows worth acting on. |
| Refusing a total | one figure, always | the figure, or the rates it is missing | *Resolved as a departure* — `20260908130000` added `fx_rate` and `liability.outstanding_minor`, so the headline is net worth as designed. What is kept is the refusal underneath it: a total that cannot be converted honestly comes back as the missing pairs rather than a number short by the dollar holdings. |
| Allocation donut | an SVG donut with a legend | a row per class: colour, name, share, value, return | Taken from the reference app rather than from the mock. A bar or an arc shows one thing — relative size — where a row of the same height shows four, and on a phone that is the difference between a picture and an answer. The colours are still the chart palette in order, so a class keeps its identity when the donut arrives beside it. |
| Long or short term | a gain labelled long-term or short-term | days held, unlabelled | The threshold is twelve months for listed equity and twenty-four for unlisted, both of which have moved. `tax_rule` will hold them as dated rows so a prior year recomputes on the rule that applied then; until it exists, the app shows the count and declines to classify it. |
| Explanatory prose | a paragraph under each block | a marker on the figure it qualifies | Fifteen coloured paragraphs on one screen are read as decoration, and the one that mattered goes down with the rest. A sentence that explains what a block IS is said once, on its heading; a sentence that warns a figure is WRONG rides on that figure and appears only when it applies. Figure subtitles carrying live values stay visible — they are data, not prose. |
| Failure states | none — a mock has no loading, empty, offline or denied states | all four, throughout | Not a departure so much as the part a mock cannot show. Do not drop them to match it. |
