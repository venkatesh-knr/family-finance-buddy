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
| investments | screen | partial | `src/features/holdings` — holdings with an editor and archive, valuations, prices from the AMFI driver, cost and gains per position (purchases, sales, FIFO parcels, realised gain, long/short term against `tax_rule`), and eCAS import (`ImportStatement.tsx`, parsed on the device, preview before anything is written); no fund/equity breakdown, no India/Abroad split |
| property | screen | not-built | Stage 5 |
| global | screen | not-built | Stage 5 — needs FX and the currency work |
| fire | screen | partial | `src/features/plan` — annual expense, the spending plan and the commitments it is built from, target and ladder. No goals, and no projection against real contributions |
| tax | screen | partial | `src/features/tax` — one member's capital gains netted across listed equity, equity funds, gold and unlisted shares, and the tax on the income typed in beside them: slabs, the 87A rebate with its marginal relief, the surcharge with marginal relief, the 4% cess, for either regime, every step shown, with the date the rules were last checked. Not built: salary and other income saved per person and year, deductions beyond the standard one (so no old-against-new verdict), a surcharge on capital gains, TDS and advance tax credited, foreign shares (the prescribed exchange rate), debt funds (acquisition-date rule), property (indexation election), carried-forward losses, the holding-period clock. See Departures |
| protection | screen | partial | `src/features/plan` — loans and policies live on FIRE, not a screen of their own; see Departures |
| calendar | screen | not-built | Stage 5 |
| reports | screen | not-built | Stage 5 — export, template upload |
| profile | screen | built | `src/features/profile` — identity, private-entry count, recent activity |
| settings | screen | built | `src/features/settings` — device and household groups, members absorbed, and the Data group's demo reset (demo households only, owner only). The rest of Data — template, upload, export, where your data lives, delete household — arrives with stage 5 |
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
| Currency control | in the avatar menu *and* Settings | Settings alone | Two controls for one setting drift apart, so it landed in one place — the device group, since §366 files display currency with the theme and §368 keeps base currency with the household. It offers the base currency plus whatever the household has a rate for, rather than every ISO code, because the rest would all answer "no rate for that". Honoured on Overview (net worth), Expenses (the comparison) and FIRE (target and ladder). What stays in the currency it was entered in: the expense ledger, and every editable plan figure — a field converted for display is a field somebody types into in one currency and stores in another. |
| Categories | in Settings, separate from budgets | with their budgets, in the spending plan on FIRE | Naming a category and saying what it should cost is one thought; splitting them means two screens to set one envelope. Both then sit where the annual expense is derived. |
| Loans and policies | a Protection & debt screen | on FIRE | The annual-expense total already counts them, and that total is the FIRE number's first input. Filing them under debt splits one arithmetic across two screens. |
| Category list | thirty-six names from one workbook | a grouped catalogue, nothing pre-ticked | A household without a scooty should not inherit an "Insurance Scooty" envelope. |
| Envelopes with no spending | every category listed | folded behind a count | Twenty-eight rows reading "₹0.00 · behind" buried the rows worth acting on. |
| Refusing a total | one figure, always | the figure, or the per-currency figures with the reason marked on them | *Resolved as a departure* — `20260908130000` added `fx_rate` and `liability.outstanding_minor`, so the headline is net worth as designed. What is kept is the refusal underneath it: a total that cannot be converted honestly comes back as what each currency holds, marked with which rates are missing, rather than a number short by the dollar holdings. The refusal used to be a red paragraph standing where the figure goes; it is now a caveat on the figures that do exist, and Assets sits above net worth so the screen leads with what is known. |
| Allocation donut | an SVG donut with a legend | a row per class: colour, name, share, value, return | Taken from the reference app rather than from the mock. A bar or an arc shows one thing — relative size — where a row of the same height shows four, and on a phone that is the difference between a picture and an answer. The colours are still the chart palette in order, so a class keeps its identity when the donut arrives beside it. |
| A partial statement | a holding has units, a cost and a return | valued units from the statement's closing balance, cost from the lots, and no return where the two disagree | A statement requested for six months itemises six months of purchases and still prints the closing balance of a folio ten years old. Deriving the value from the lots understated one position by 93% and said nothing; deriving the cost from the closing balance would invent money nobody paid. So each comes from the source that knows it, the shortfall is named on the figure, and the gain is refused rather than printed as +1,300%. Net worth still counts the holding — with stated units the valuation is right. See `docs/build-plan.md` Stage 5 step 2. |
| Tax, one person at a time | one household-level computation | a member is chosen, starting with the viewer | Tax is filed per taxpayer, and the ₹1.25 lakh allowance is each person's own. Netting a household once would give two people one allowance between them, or set one person's loss against another's gain. Another member's private holdings are invisible to the viewer, so the screen says its figures can be short rather than presenting them as complete. |
| Capital gains, by lot | a six-column table: sold, holding, lot acquired, held, class, gain, rate, tax | a stacked row per sale: name and gain, then the dates, then the class | At phone width the table gave a fund called "… (formerly …)" one word per line and pushed Class and Gain — the two columns the page is for — out of sight. Rate and tax are not per lot: after netting there is no tax on one lot, only on the year's gains, so they sit in the summary above. |
| Salary and income on Tax | entered per member and per tax year, kept, with a private option | typed on the page, held there, and not saved | Salary is the most private figure in the app, and where it lives — whether a member may keep it from the household, who sees its tax effect — is a design of its own that needs a table and its policies reviewed before a screen is built on it. So the computation exists and the storage does not, and the card says so beside the fields. |
| Tax rules | a table a Budget edits | a table only a reviewed migration edits, with the date each row was last checked shown on the page | A household that could edit its own rates could compute the figure it wanted. Nothing fetches the law: the risk is a Budget changing a rate while the app quietly uses last year's, so the date somebody last looked is shown, and a warning appears when it is older than the tax year's Budget. |
| Explanatory prose | a paragraph under each block | a marker on the figure it qualifies | Fifteen coloured paragraphs on one screen are read as decoration, and the one that mattered goes down with the rest. A sentence that explains what a block IS is said once, on its heading; a sentence that warns a figure is WRONG rides on that figure and appears only when it applies. Figure subtitles carrying live values stay visible — they are data, not prose. |
| Failure states | none — a mock has no loading, empty, offline or denied states | all four, throughout | Not a departure so much as the part a mock cannot show. Do not drop them to match it. |
