# From one workbook to *Finance Buddy*

*Product blueprint · revision 5 · FY 2025–26*

MyFinancial_25_26_Template.xlsx already knows what matters — ten sheets covering expenses, nine asset classes, FIRE targets and a net-worth roll-up. This is the plan to turn it into an app that runs on desktop and phone, ships from GitHub Actions on a free database, holds rupees and dollars side by side, works out what you owe in tax, and is built to be attacked.

**Source** 10 sheets · 62 fields · **Ships as** Web · Desktop · iOS & Android · **Hosting** GitHub Pages, free tier backend · **Currencies** INR base, USD supported

---

> Specification for **Family Finance Buddy** (short form: *Finance Buddy*; slug:
> `family-finance-buddy`). Read `CLAUDE.md` for the invariants that
> must not be violated, and `docs/tokens.md` for the design system.
> Generated from the blueprint artifact — edit there, or edit here and keep both in step.

## Contents

1. [What the sheet holds](#01-what-the-sheet-holds)
2. [What breaks today](#02-what-breaks-today)
3. [Design principles](#03-design-principles)
4. [Domain model](#04-domain-model)
5. [Screens](#05-screens)
6. [Calculation engine](#06-calculation-engine)
7. [Two currencies, one truth](#07-two-currencies-one-truth)
8. [Investing abroad, and the paperwork it creates](#08-investing-abroad-and-the-paperwork-it-creates)
9. [The tax engine](#09-the-tax-engine)
10. [Getting data in](#10-getting-data-in)
11. [Family & access](#11-family--access)
12. [One codebase, three shells](#12-one-codebase-three-shells)
13. [Where the work runs](#13-where-the-work-runs)
14. [Picking the free database](#14-picking-the-free-database)
15. [Security](#15-security)
16. [Shipping from Actions](#16-shipping-from-actions)
17. [First run](#17-first-run)
18. [Roadmap](#18-roadmap)
19. [If it ever goes public](#19-if-it-ever-goes-public)

---

## 01. What the sheet holds

Every sheet, what it tracks, and what it currently carries. Rows marked *label-only* have the structure in place but no values yet — the app should treat those as intent, not as zero.

| Sheet | Tracks | Key fields | Live rows | State |
|---|---|---|---|---|
| Expense | Household spend + loans + FIRE targets | Category, Monthly, Yearly, Exp Type (Fixed/Variable) | 33 | Categories named, amounts empty |
| Investment | Recurring contributions | PPF, RD, Gold Savings — Monthly, Yearly | 3 | Label-only |
| MutualFunds | Two blocks: India + a US-tracking feeder | Scheme, Current SIP, Old SIP, Started, Invested, Current | 3 | Populated |
| Stock | Broker-level equity | Account, Invested, Current Value | 1 | Populated (Zerodha) |
| FixedDeposit | Bank FDs | Bank, Deposit, Rate, End Date, Maturity Amount | 2 | Label-only |
| Bonds | NBFC / corporate bonds | Invested, Current, Interest paid, Coupon, Period, Repay, Dates, Rating | 2 | Populated |
| RetirementFunds | PF, PPF, NPS balances | Fund, Current value | 3 | Label-only |
| Insurance | Term + health cover | Holder, Type, Company, Sum, Premium, Plan ID | 2 | Label-only |
| Crypto | Crypto holdings | Invested, Current | 1 | Populated (₹100) |
| NetWorth | Gold, property, debt, allocation, summary | Grams, 22K rate, Invested/Projected, Debt, % | 9 | Formulas present, mostly broken |

The nine asset classes the NetWorth sheet rolls up — Indian MF, Indian equity, retirement funds, bonds, fixed deposits, crypto, foreign equity, gold, cash — become the app's canonical asset taxonomy. Property and liabilities sit outside that roll-up in the sheet; in the app they join it, because net worth without the house and the card balance isn't net worth.

## 02. What breaks today

Thirteen concrete problems, found by reading the formulas rather than the numbers. The first four mean the workbook is currently reporting the wrong net worth.

**01. Every allocation percentage is a `#NAME?`** — _Broken_

`NetWorth!G34:G43` uses `=DIVIDE(F34,F44)*100`. `DIVIDE` is a Google Sheets function; Excel has no such function, so the whole allocation column fails. The percentages you'd actually rebalance against don't exist.

> **In the app —** allocation is derived, never typed: each class's share is computed from live valuations and rendered as a ring plus a drift-vs-target bar.

**02. Gold silently contributes ₹0** — _Broken_

`NetWorth!G6` is `=SUM(F3*G3)` — it reads one row only, and `G3` is 0 while the real 22K rate (₹8,990/g) sits one cell up in `G2`. Add a second gold row and it is ignored entirely.

> **In the app —** gold is holdings in grams × purity-adjusted rate, with the rate refreshed on a schedule and stored per date, so past valuations stay correct.

**03. Totals drift off their ranges** — _Broken_

`MutualFunds!E17` sums `E1:E16` — including the header row. `RetirementFunds!B10` sums `B3:B8` but PF sits in `B2`, outside the range. `Expense!B47` sums `B2:B44` while categories run 3–41.

> **In the app —** totals are aggregate queries over a table. There is no range to get wrong.

**04. Net worth blends five different dates** — _Risk_

Each sheet carries its own "As of": mutual funds and stocks 31-May-2025, FDs, bonds and retirement 01-May-2025, gold 31-Mar-2025, insurance 01-Feb-2025. The summary is a composite of five snapshots up to four months apart.

> **In the app —** one valuation date per snapshot, with a staleness badge on any holding whose price is older than its class's refresh window.

**05. No history exists at all** — _Gap_

Every cell is overwritten when you update it. There is no way to draw net worth over time, split growth from fresh contributions, or answer "how did last year go".

> **In the app —** an append-only `valuation_snapshot` table frozen monthly, plus a full transaction ledger.

**06. Returns can't be measured** — _Gap_

Invested vs current gives absolute gain only. Parag Parikh at ₹2.70L → ₹3.12L is +15.4% absolute — but with SIPs from Dec 2023 stepping ₹10k to ₹20k, the annualised return is a different figure, and it's the one that matters.

> **In the app —** XIRR from the actual cash-flow ledger, next to absolute gain on every holding.

**07. Expenses have no transactions** — _Gap_

Each category holds one number. You can budget with that, but you cannot see what was spent, when, by whom, or why groceries jumped.

> **In the app —** categories stay exactly as named, but each becomes a budget envelope over a real ledger with member attribution.

**08. Duplicate rows with no owner** — _Risk_

`Expense!A7:A9` and `A10:A12` both read Mobile1 / Mobile2 / Data1 — presumably two people's connections, but nothing records whose.

> **In the app —** every expense, asset and policy carries a `member_id`.

**09. Hardcoded cash and card balance** — _Risk_

Cash typed as ₹2,00,000 in `NetWorth!F42`, the credit-card bill as ₹50,000 in `J19`. Both change weekly; neither has a source.

> **In the app —** both become accounts with a balance history.

**10. The FIRE ladder is typed out year by year** — _Risk_

`Expense!I82:R84` hardcodes 2023–2033 with `=I82+(I82*6/100)` across 30 cells. The horizon can't move and the base year is 2023 in an FY 25-26 workbook.

> **In the app —** one FIRE profile driving a live projection, plus coast-FIRE and safe-withdrawal views.

**11. Loans and insurance share a table** — _Gap_

`Expense!A53:C76` is headed "Loan" but holds Home Loan alongside three health policies and a term plan. Premiums are cash outflow; a home loan is a liability with a schedule.

> **In the app —** liabilities carry principal, rate, EMI and amortisation; policies carry cover, premium and renewal. Both feed cash flow, only one reduces net worth.

**12. Nothing has a due date** — _Gap_

Bond2 matures 01-Jul-2025 and pays monthly; Bond1 matures 01-Oct-2025. FDs have end dates, policies have renewals. The sheet stores them and tells you nothing.

> **In the app —** one calendar fed by every dated field, with lead-time alerts pushed to the phone.

**13. Fragile summary arithmetic and stray cells** — _Risk_

`NetWorth!M38` is `=SUM(M33:M34)-SUM(M36)`, so blank spacer rows M35 and M37 are load-bearing. And `Expense!A362` contains "BNNMM".

> **In the app —** net worth is `Σ assets − Σ liabilities` over typed rows. No spacers, no strays.

## 03. Design principles

Eight rules that settle the arguments before they start.

- **Your vocabulary wins.** Categories stay "EB", "DTH", "FastTag", "Rice", "Scooty Maintenance". The app adopts the household's names, not a generic chart of accounts.

- **Record events, derive everything else.** Humans type transactions, holdings and prices. Totals, allocations, XIRR, net worth, FX conversions and FIRE targets are computed.

- **Nothing is ever overwritten.** Valuations and exchange rates append. That single change buys the net-worth chart, the honest returns figure, and the peak-balance number foreign-asset reporting demands.

- **Every amount carries its currency.** There is no bare number in the database. A figure without a currency and a date is not a fact.

- **Entry has to be faster than the sheet.** If logging groceries takes more than five seconds on a phone, the ledger goes stale and the app is worse than the workbook.

- **Import beats typing.** Every number a statement, a CAS PDF or a NAV feed can supply should arrive that way.

- **Assume the client is hostile.** The app ships as public static files with no server of its own. Every rule that matters is enforced in the database, never in the UI.

- **Family-wide by default, per-person on demand.** One household view answers "are we okay". A member filter answers "whose SIP is this".

## 04. Domain model

Thirty-five tables in seven modules. Every sheet column lands in exactly one of them; the additions are history, ledger, currency, dates, ownership, tax rules and the foreign-asset paperwork.

**Module: Household** (Identity)

- `household` — name, kind (real / demo), base_currency (INR), display_currency, fy_start_month (4), created_at

- `member` — household_id, display_name, relation, is_dependent, colour, status (active / archived), archived_at

- `user_account` — auth_user_id, email, mfa_enrolled, last_seen_at — an identity, deliberately holding no household of its own

- `membership` — user_account_id, household_id, member_id, role — the join that lets one person belong to several households

- `invite` — household_id, email, role, token_hash, expires_at, accepted_at

**Module: Accounts & assets** (Holdings)

- `institution` — name, country, kind (bank / broker / AMC / NBFC / insurer)

- `account` — household_id, member_id, institution_id, type, currency, is_foreign, identifier_last4, opened_on

- `instrument` — asset_class, name, currency, exposure_currency, isin, amfi_code, ticker, coupon_rate, coupon_freq, maturity_date, rating, purity, country

- `holding` — account_id, instrument_id, units, avg_cost_minor, invested_minor, currency

- `lot` — holding_id, acquired_on, units, cost_minor, currency — drives FIFO gains and holding period

- `price` — instrument_id, as_of_date, value_minor, currency, source

- `property` — household_id, member_id, kind (land / plot / apartment / house / commercial), label, purchase_date, purchase_cost_minor, stamp_duty_minor, registration_minor, co_owner_share_pct, linked_liability_id, is_self_occupied, rent_minor, tenant_label, annual_property_tax_minor, current_value_minor, valued_on, valuation_basis

- `property_improvement` — property_id, date, description, amount_minor, is_capital — capital work adds to cost basis, repairs do not

**Module: Ledger** (Events)

- `investment_txn` — account_id, instrument_id, date, type (sip / buy / sell / dividend / interest / contribution), units, amount_minor, currency, fx_rate, withholding_minor

- `expense_txn` — household_id, member_id, category_id, date, amount_minor, currency, fx_rate, payee, method, note, receipt_id

- `valuation_snapshot` — household_id, as_of_date, scope, value_minor, currency, base_value_minor — append-only

- `fx_rate` — base_ccy, quote_ccy, as_of_date, rate, source — one row per day, never updated

**Module: Planning** (Budget & goals)

- `expense_category` — name, parent_id, nature (fixed / variable), cadence, is_essential, sort_order, status (active / archived) — a fully user-managed list, seeded with the workbook's 33

- `budget` — category_id, fy, period, planned_minor, currency, member_id

- `recurring_rule` — category_id, amount_minor, currency, cadence, next_due, auto_post, reminder_days

- `goal` — name, target_minor, currency, target_date, priority, linked_account_ids, inflation_rate

- `fire_profile` — annual_expense_basis, multipliers [25,30,50], inflation_pct, swr_pct, expected_return, sip_step_up_pct

**Module: Protection & debt** (Obligations)

- `insurance_policy` — holder_member_id, type, insurer, sum_assured_minor, premium_minor, currency, cadence, plan_id, renewal_date, nominee

- `liability` — member_id, type, principal_minor, currency, rate, emi_minor, tenure, outstanding_minor

- `document` — entity_type, entity_id, storage_key, kind, uploaded_by, sha256

**Module: Tax** (Rules as data)

- `tax_rule` — jurisdiction, kind (slab / surcharge / cess / rebate / deduction_cap / cg_rate / holding_period), regime, asset_class, band_from, band_to, rate, effective_from, effective_to

- `tax_profile` — member_id, tax_year, regime_chosen, residential_status, employer_nps_pct

- `income_entry` — member_id, tax_year, head (salary / house_property / other_sources / foreign), amount_minor, currency, tds_minor, source_ref

- `deduction_claim` — member_id, tax_year, section_code, amount_minor, evidence_document_id, auto_derived_from

- `advance_tax_payment` — member_id, tax_year, instalment, due_date, paid_on, amount_minor, challan_ref

- `loss_carry_forward` — member_id, tax_year_incurred, kind (stcl / ltcl), amount_minor, expires_after

**Module: Cross-border** (Compliance)

- `lrs_remittance` — member_id, date, amount_inr_minor, amount_usd_minor, purpose, tcs_minor, bank, fy — running total against the annual limit

- `rsu_grant` — member_id, employer, grant_date, units, vest_schedule, fmv_at_vest, perquisite_minor, currency

- `foreign_asset_period` — instrument_id, calendar_year, initial_minor, peak_minor, closing_minor, income_minor, currency — the Schedule FA row

- `audit_log` — actor, entity, action, before, after, at, ip_hash — append-only, insert via trigger only

> **Why identity and household are separate tables**

> Splitting `user_account` from `membership` costs nothing today — you have one household — and it is the difference between a weekend and a migration if the app ever serves people beyond this family. A person managing their own household and helping with their parents' is then two membership rows, not two logins. Every policy in section 15 resolves through this join, so writing it now also means the authorisation model never has to be rewritten.

> **The one decision that changes everything**

> Keep `holding` and `investment_txn` both. The holding is the fast path — it is what the sheet already gives you, so migration is instant and the app is useful on day one. The ledger fills in behind it as SIPs post and CAS files import, and the moment a holding has a complete ledger, XIRR and lot-level capital gains turn on for it. You never have to choose between "working now" and "correct later".

## 05. Screens

Fourteen screens. Chips in teal are capabilities the spreadsheet has no equivalent for. A currency toggle sits in the top bar on every one of them.

**Home — net worth** `/`

Opens on the number the workbook exists to produce, with the month's movement split into "you added" versus "it grew" — and, once foreign holdings exist, a third slice: "the rupee moved". Allocation ring across the nine classes, drift bars against target weights, and the alert strip for anything due in 30 days.

_Net worth · Allocation % · Trend since inception · Contribution vs growth vs FX · Member split_

**Expenses** `/expenses`

Your Fixed / Variable split becomes the primary grouping. Monthly and yearly cadences roll into one annual figure the way `M&Y Total` does today, but on top of actual transactions. Quick-add is one field with payee memory; recurring rules auto-post EB, DTH, school fee and premiums on their due day.

**The 33 category names are a starting point, not the list.** Add, rename, reorder and nest them freely — a category can sit under a parent, so Vegetables, Fruits, Grocery and Milk can roll up to Food while still being tracked separately. Two rules keep history intact: renaming changes only the label, because transactions reference a category by identity rather than by name, so past months keep their figures; and a category that has ever been used is **archived rather than deleted**, disappearing from the picker while remaining on every historical row it appears in.

_Fixed / Variable · Monthly & Yearly · Transaction ledger · Budget vs actual · Who paid · Receipt capture_

**Investments hub** `/investments`

One table across all classes — invested, current, absolute gain, XIRR, share of portfolio — drilling into a page per class. Foreign holdings show two return figures side by side: in their own currency, and in rupees.

_Invested vs current · SIP amounts · XIRR per holding · Native vs INR return · NAV auto-refresh_

**Equity — India and abroad** `/investments/equity`

One screen, two blocks, because that is how the holdings actually differ. **India**: direct shares and Indian exchange-traded funds, grouped by broker, in rupees. **Abroad**: US shares and US-listed ETFs, grouped by broker, held and reported in dollars with the rupee view alongside. The workbook's separate "Mutual Fund (US Stock)" block disappears — foreign equity belongs here with the rest of the equity, not in a fund list.

An exchange-traded fund sits with the shares because that is where people look for it, but it is *taxed by what it holds* rather than by the fact it trades on an exchange — an equity ETF, a gold ETF and a debt ETF each map to their own rule row in section 09. Treating the wrapper as the asset class is a classic way to get a tax figure wrong.

_Zerodha · Invested vs current · Indian ETFs · US shares & ETFs · Per-broker grouping · XIRR · Lot-level holding period_

**Mutual funds** `/investments/funds`

Indian funds only — equity, debt, hybrid and index — with current SIP, previous SIP, start date, invested and current value, and NAV refreshing itself daily. No separate foreign block.

**A fund that invests abroad still belongs here.** An Indian feeder or fund-of-funds tracking a US index is bought in rupees, is an Indian asset for tax, uses no remittance allowance and generates no foreign-asset disclosure — so it is a mutual fund with a flag saying its exposure is in dollars, not a foreign holding. A direct US ETF bought through a US broker is the opposite on all four counts and lives on the equity screen. The two look similar on a statement and are treated completely differently, which is why the instrument carries both a currency and an exposure currency.

_Current & old SIP · Started · Invested vs current · Daily NAV · Foreign-exposure flag · SIP step-up history_

**Global** `/global`

Everything outside India in one place: US brokerage holdings, RSUs and their vesting schedule, foreign bank balances, dividends received net of withholding, and the running LRS total for the year against the annual limit. Feeds the Schedule FA export.

_Foreign holdings · RSU vesting · Withholding tracked · LRS & TCS running total · Schedule FA rows_

**Bonds & fixed income** `/investments/fixed-income`

The one place your sheet is already richest — coupon, period, repay mode, rating, start and close dates — becomes a maturity ladder. Accrued-but-unpaid interest is computed rather than typed, and rating changes are logged so a downgrade doesn't pass unnoticed.

_Coupon & period · NBFC rating · Maturity ladder · Accrued interest · Reinvestment prompt_

**FIRE & goals** `/fire`

25×, 30× and 50× on the annual expense figure, exactly as the workbook computes them, plus the inflation ladder — as a live projection you can drag. Change inflation, the target year, the SIP step-up, or exclude a category, and watch the corpus and the reach-date move.

_25× / 30× / 50× · 6% inflation ladder · Live projection · Coast FIRE · Scenario compare_

**Protection** `/protection`

Term and health policies per holder with cover, premium, plan ID and renewal date. A cover-adequacy read against household income and liabilities answers the question the sheet can't.

_Holder · Sum assured · Plan ID · Renewal alerts · Cover gap · Policy documents_

**Property** `/property`

Land1, Land2 and House stop being three labels on the NetWorth sheet and become records with a cost basis. Purchase price, stamp duty and registration all form part of what you actually paid — which is what a future capital-gains figure is measured against, and what nobody can reconstruct fifteen years later. Capital improvements are dated entries that add to the basis; repairs are recorded but don't. A linked home loan shows equity as value minus outstanding, and a let property carries rent, tenant and municipal tax so it can feed the house-property head of the tax computation.

Valuation is treated as the estimate it is: a figure, a date, and how you arrived at it — your own guess, a circle-rate calculation, a broker's view or a registered valuation. The app never pretends a property is worth a precise number, and it flags a valuation that has gone stale rather than quietly carrying a four-year-old figure into your net worth.

_Land1 / Land2 / House · Invested vs projected · Full cost basis · Improvements log · Equity after loan · Rent & property tax · Valuation basis & staleness · Co-ownership share_

**Liabilities** `/liabilities`

Home loan and card balance lifted out of the expense sheet into proper obligations: outstanding principal, amortisation, interest paid this FY, and a prepayment calculator showing tenure saved per lakh.

_Home loan · CC bill · Amortisation · Prepayment impact · EMI calendar_

**Calendar** `/calendar`

Every dated field on one timeline — bond maturities, FD end dates, policy renewals, EMI dates, SIP debits, RSU vests, advance-tax instalments — with push reminders on the lead time you set per type.

_Unified due dates · Push reminders · Cash-flow forecast_

**Tax** `/tax`

**Income is entered here, per member and per tax year** — the one input the workbook never carried and the one that two other features wait on. Salary broken into its components rather than a single figure, because the parts behave differently: basic, house-rent allowance, other allowances, employer's provident-fund and pension contributions, and tax already deducted. Alongside it, rent received, interest, dividends and anything else. A member who would rather not have their salary visible to the household can keep it private to their own login while its tax effect still rolls into the household view.

The year's computation follows from it: income by head, capital gains derived from lots, deductions the regime allows, and the old-versus-new comparison side by side. A live panel shows the unused long-term equity allowance, holdings approaching a holding-period boundary, carried-forward losses and the next advance-tax instalment. Every number links back to the transaction that produced it.

_Old vs new regime · Gains by lot · Unused ₹1.25L allowance · Holding-period clock · Advance tax due · Salary & income input · Foreign tax credit_

**Reports** `/reports`

Two calendars, because India needs both: the April–March tax year for domestic reporting, and the January–December calendar year that foreign-asset disclosure uses. FY spend by category, the year-end pack for your accountant, and an export back to Excel for anyone who still wants the sheet.

_FY 25–26 framing · Calendar-year foreign report · Year-end pack · Excel & PDF export_

### Target allocation — five conventional profiles

Drift needs something to drift from. Rather than inventing weights, the app ships the five profiles the industry conventionally uses, you pick one at setup, and you can adjust any figure afterwards. These are named conventions offered as starting points — the app presents them, it does not recommend one, because telling someone what their asset allocation ought to be is advice rather than arithmetic.

| Profile | Equity | Debt | Gold | Cash | Typically chosen when |
|---|---|---|---|---|---|
| Conservative | 25% | 60% | 10% | 5% | Capital preservation matters more than growth; a short horizon |
| Moderate | 45% | 40% | 10% | 5% | A medium horizon and limited appetite for drawdowns |
| Balanced | 60% | 25% | 10% | 5% | The common default for a long accumulation phase |
| Growth | 70% | 18% | 7% | 5% | A long horizon and tolerance for volatility |
| Aggressive | 80% | 10% | 5% | 5% | A very long horizon; income secure enough not to need the corpus |

- **Equity spans domestic and foreign**, so a target can carry a sub-split — a common convention is holding 10–20% of the equity portion outside India, which is exactly what a feeder fund or a direct US holding provides.

- **Gold at 5–15%** is the Indian convention and the reason it is a first-class class here rather than an afterthought — it is a meaningful allocation in most households, and the workbook already treated it as one.

- **The age rule of thumb** — equity percentage of roughly 100 minus your age — is worth offering as a shortcut to a starting profile, and worth labelling as the crude heuristic it is.

> **The emergency fund is not an allocation**

> Six months of expenses held deliberately in cash is a *reserve*, not a portfolio position — but almost every allocation view lumps it into "cash" and then reports a permanent overweight, nagging you about money you are holding on purpose. So the app carries an emergency-fund target as its own figure, excludes it from the drift calculation, and tracks it separately against a months-of-expenses goal the expense screen already knows how to compute. Only cash above that reserve counts as an allocation decision.

### Across every screen

Five things belong to the shell rather than to any one screen, and they are worth specifying once rather than rediscovering them twelve times.

**Currency** — _₹ / $_

The display toggle from section 07. Native figures stay native; the base currency governs every total.

**Theme** — _Light · dark · system_

Three states, defaulting to whatever the device is set to, remembered per device. Dark is not an inverted stylesheet: it needs its own palette, because the semantic colours carry meaning here — a gain and a loss must stay clearly distinguishable, and stay legible for the substantial minority of men with red-green colour vision deficiency, which is why the design pairs green with teal-blue rather than relying on hue alone. Charts read their colours from the same tokens as everything else, so a screenshot taken in either theme is readable.

**Privacy mode** — _Hide the numbers_

One tap masks every amount on screen. This is the feature that lets you open your net worth on a train, hand your phone to someone to show them a bond's maturity date, or take a screenshot for a question without publishing your finances. Percentages, dates and chart *shapes* stay visible — the information you usually need is the trend, not the figure — while absolute amounts become dots. It should engage automatically in the app switcher, alongside the screenshot suppression in section 15, and stay on until you turn it off rather than resetting each launch.

It is convenience, not security, and the design says so: it defends against the person beside you, not against anyone holding the device. Nothing about the stored data changes.

**Export** — _Excel · PDF_

Three scopes, all generated on the device so nothing is uploaded to be turned into a file. **This view** — whatever table you are looking at, filters applied. **A report** — the year-end pack, the capital-gains statement, the foreign-asset rows. **Everything** — the full dataset as a workbook with one sheet per entity, which doubles as the account-deletion export required in phase 1 and as a backup you can read without the app. Excel where the figures will be worked on, PDF where they will be read or sent.

**The full export is deliberately identical in shape to the upload template** in section 17, so exporting, editing a hundred rows in Excel and uploading again is a supported way to work rather than an accident that happens to succeed.

**Accessibility** — _Non-negotiable_

Parents will use this app, so respecting the operating system's text size — up to double — is a layout requirement, not a preference: nothing may be built at a fixed pixel height that a larger font would break. Contrast meets the standard threshold in both themes. **Nothing means anything by colour alone** — a gain carries a sign and an arrow as well as a hue, which matters for the substantial share of men with red-green colour deficiency. Every figure has a label a screen reader can announce, since a bare number read aloud is noise. Full keyboard navigation with visible focus, touch targets no smaller than a fingertip, and motion honoured off when the system asks for it.

**Correcting mistakes** — _Edit or void_

Typing errors are constant and the rule is graded by consequence. An ordinary transaction is **freely editable**, with the previous values kept in the audit log — it is a household ledger, not a bank's. But once a figure has fed something that has been relied upon — a frozen month-end snapshot, a completed tax year, a generated report — editing it silently would change a number someone has already acted on, so from that point a correction is a **void and re-enter**: the original stays visible, marked void, and the replacement carries a reference to it. Deleting is always soft; voided rows stay behind a filter rather than vanishing.

**Dates and boundaries** — _Always IST_

Every period boundary is computed in Indian Standard Time regardless of where the device is — the month-end snapshot is the last calendar day in IST, and the tax year runs 1 April to 31 March in IST. Timestamps are stored in UTC and converted for display, but no boundary is ever decided by the phone's own zone, otherwise a family member travelling would silently produce a snapshot on a different day from everyone else.

**Offline conflicts** — _Last write wins_

Two devices editing the same row while offline is rare in a household and does not justify merge machinery. The later write wins, and the version it replaced is written to the audit log so nothing is actually lost and a wrong outcome can be seen and undone. New records never conflict — they are separate rows — which covers the case that actually happens: two people logging expenses at once.

**The demo household** — _A real account, fake money_

Not a mode and not a set of static screens — **a genuine household in the real database, seeded with fabricated data, that behaves in every respect like the real thing.** You can add expenses to it, edit holdings, break things, run the tax computation, generate exports, and hand it to someone to poke at. It is where the app gets shaken down and improved before a single real rupee is entered, and it stays afterwards as a permanent place to try a change without touching live figures.

It costs almost nothing to build because the model already allows it: a household is a row, a person can belong to several through their membership, and a switcher in the top bar moves between them. **Its most valuable property is that it makes the security model real.** Two households sharing one database is exactly the condition the row policies exist to handle — so running a demo alongside your own data proves those policies work *before* anything important depends on them, rather than trusting a test suite alone.

Four rules keep it safe and useful. Demo households are marked `kind = demo` and carry a persistent badge, so there is never a moment of wondering which numbers you are looking at. **Nothing crosses between households** — not a transaction, not an aggregate, not an export — which is the same policy boundary that separates any two households and therefore needs no special code. **Reset** wipes and reseeds it to a known state, so you can experiment destructively without care. And there is deliberately **no "promote to real"** — when you are ready, you create your real household and enter your own opening position, because a half-copied fake portfolio is a far worse problem than an afternoon of typing.

The seed should be built to *find bugs*, not to look attractive: a holding sold at a loss, a carried-forward loss, a lot sitting either side of the twenty-four-month boundary, a matured bond, a category with no spending, a deliberately stale valuation, a member with no login, a foreign dividend with withholding. A demo portfolio that only contains happy paths teaches you nothing.

Alongside it, a short guided tour on first arrival at each screen — a few coach marks saying what this screen answers, dismissible and never repeated. If the app is ever offered publicly, *that* is when a bundled client-side fixture earns its place, as a no-signup demo for strangers; for a household app, an invited viewer in the demo household is simpler and consistent with invite-only access.

## 06. Calculation engine

One module of pure functions, shared by web, desktop and mobile because they run the same bundle. Unit-tested against the workbook's own figures. Money is integer minor units — paise and cents — never floats.

**Net worth**

```
Σ holding.units × price(d) × fx(ccy→base, d)
  + Σ account.balance × fx(…)
  − Σ liability.outstanding × fx(…)
```

Replaces `NetWorth!M38` and its load-bearing blank rows. Every term is currency-converted at the same date.

**Allocation share**

```
share(class) =
  base_value(class) / Σ base_value(all) × 100
```

The working version of `=DIVIDE(F34,F44)*100`, computed after conversion so a US holding and an Indian one are comparable.

**Annualised return (XIRR)**

```
solve r:  Σ Cᵢ / (1+r)^(dᵢ−d₀)/365 = 0
Newton–Raphson, bisection fallback
```

Run twice for foreign holdings: once on native-currency flows, once on base-converted flows. The gap between the two is currency return.

**Currency decomposition**

```
total ≈ asset_return + fx_return
       + (asset_return × fx_return)
```

Answers "did the fund do well, or did the rupee just weaken". Shown on every foreign holding and on the home screen's monthly movement.

**FIRE corpus**

```
annual_expense = monthly_total × 12
                 + yearly_total
target(m) = annual_expense × m,  m ∈ {25,30,50}
```

Exactly the workbook's `M&Y Total` → `C80` → `C82:C84` chain, kept intact.

**Inflation ladder**

```
target(m, y) =
  annual_expense × m × (1+i)^(y − base_year)
```

The closed form of the 30 hardcoded cells in `I82:R84`. **Inflation is a setting, not a constant** — 6% is only the default carried over from the workbook, editable at any time, and each goal can carry its own rate, since school fees and healthcare have not historically risen at the same pace as groceries. Changing it recomputes every projection immediately rather than requiring 30 cells to be retyped.

**Corpus projection**

```
cₙ₊₁ = cₙ(1+r) + sipₙ
sipₙ₊₁ = sipₙ(1 + step_up)
```

Crossing point against the inflated target is the FIRE date. A flat SIP and a stepped-up SIP give wildly different answers; the app models the step-up because that's what actually happens.

**Capital gains by lot**

```
FIFO match sale → lots
held ≥ 24 months (foreign) → LTCG
held ≥ 12 months (listed IN eq) → LTCG
```

Gains on foreign shares convert at the rate on each of the buy and sell dates, not today's — which is why lots and daily FX rows both exist.

**Peak balance**

```
peak(instrument, cal_year) =
  max over d ∈ year of units(d) × price(d) × fx(d)
```

Foreign-asset disclosure asks for the peak value during the calendar year, not the closing one. Only obtainable if valuations are snapshotted regularly — a real reason the history table exists.

**FD maturity & bond accrual**

```
M = P × (1 + rate/4)^(4y)
accrued = P × coupon × days/365
```

Quarterly compounding is the Indian bank default. Bond1 at 10.75% yearly and Bond2 at 11.5% monthly accrue differently between payout dates.

**Budget variance**

```
pace = actual /
  (planned × days_elapsed / days_in_period)
```

Pace above 1.0 flags a category mid-month, rather than after the overspend.

**Gold valuation**

```
value = Σ grams × rate_22K(d) × purity_factor
```

Rate stored per date so historical snapshots don't retroactively change when today's rate moves.

## 07. Two currencies, one truth

Multi-currency is where personal finance apps quietly go wrong. The failure is always the same: converting once, storing the converted number, and losing the original. Six rules prevent it.

**Store native, derive base** — _Rule 01_

Every money column is a pair: `amount_minor` plus `currency`. The rupee figure is computed on read, never written in place of the dollar figure. A US holding is stored in USD forever; INR is a view of it.

**Rates are dated facts** — _Rule 02_

`fx_rate` holds one row per currency pair per day, appended by a scheduled job and never updated. A transaction converts at its own date's rate; a valuation at the snapshot date's rate. Yesterday's net worth does not change because the rupee moved today.

**Base is the household's, display is the viewer's** — _Rule 03_

The household has one `base_currency` — INR — in which net worth, FIRE targets and allocation are always computed. A separate display toggle lets anyone read the whole app in USD without changing a stored value or a target.

**Currency ≠ exposure** — _Rule 04_

Your US Nasdaq 100 index fund is bought in rupees but tracks dollars. `currency = INR`, `exposure_currency = USD`. Without that distinction the app either double-counts your dollar exposure or reports none at all. A direct US brokerage holding has both set to USD.

**Round once, at the edge** — _Rule 05_

Integer minor units in storage, decimal arithmetic for conversion, rounding only in the formatter. Indian lakh/crore grouping (₹1,23,456) and Western grouping ($1,234.56) are both formatter concerns — the same stored integer renders either way.

**Show the currency effect, don't bury it** — _Rule 06_

A fund up 8% in dollars while the rupee weakened 3% is up 11.2% in rupees. Both numbers are true and the app shows both, because one tells you about the fund and the other tells you about your net worth.

Rates come from a free daily reference feed refreshed by a scheduled job; a manual override exists for the rate a bank actually gave you on a specific remittance, because that is the rate that matters for cost basis, not the mid-market one.

## 08. Investing abroad, and the paperwork it creates

Holding foreign assets as an Indian resident creates obligations the workbook has no column for. Capturing them at the moment of the transaction is trivial; reconstructing them in July before a filing deadline is miserable. The app should do the former.

| What happens | What the app captures | Why it matters later |
|---|---|---|
| You remit money out | Date, INR amount, USD received, actual bank rate, purpose, TCS collected | Running total against the LRS annual limit of USD 250,000 per person per year; TCS is nil up to ₹10 lakh a year and 20% above it, and is creditable against your tax — it is a prepayment, not a cost, but only if you have the figure |
| You buy a US stock or ETF | Lot: units, trade date, price in USD, rate on that date | Cost basis in rupees is fixed at the buy date. Long-term treatment on foreign shares needs a 24-month holding period, so the lot date decides the tax rate |
| A dividend arrives | Gross USD, US tax withheld, net received, date | US withholding for Indian retail investors who have filed a W-8BEN is 25% — the treaty's 15% rate applies to corporate holders with 10%+ voting stock, not individuals. You declare the gross in India and claim the withheld amount as foreign tax credit via Form 67, filed before the return |
| You sell | FIFO lot match, gain in USD and in INR, holding period | Foreign shares: 12.5% long-term after 24 months, slab rate short-term. The rupee gain differs from the dollar gain — the app computes both and reports the one the return needs |
| RSUs vest | Grant, vest date, units, FMV at vest, perquisite value | Vesting is taxed as salary perquisite at vest; the FMV then becomes the cost basis for the eventual sale. Two different tax events, one dataset |
| The year ends | Per-instrument initial, peak and closing value, plus income, for the calendar year | Foreign asset disclosure runs on the calendar year for US assets, not the Indian financial year, and asks for the peak value during that year. This is the number nobody can reconstruct afterwards |

> **The unforgiving one**

> Foreign-asset disclosure is required whether or not the asset produced income, and whether or not you are below any tax threshold — a holding at a loss still has to be declared, and the penalties for omission sit under the black-money legislation rather than ordinary tax law. This is precisely the kind of obligation an app should make automatic: capture the six fields at transaction time, and the year-end report writes itself. Treat the output as a working paper for your CA, not as filed advice — the app organises facts, it does not give tax opinions.

### The two you hold, side by side

This household holds both shapes at once — a US index tracked through an Indian fund house, and a US brokerage account holding shares and ETFs directly. They look alike in a portfolio list and are treated oppositely on every line that matters.

|  | Indian feeder tracking a US index | Direct US brokerage holding |
|---|---|---|
| Bought in | Rupees, from an Indian AMC | Dollars, through a US broker |
| Uses remittance allowance | No | Yes — counts against the annual LRS limit, and TCS applies above the yearly threshold |
| Foreign-asset disclosure | No | Yes — a Schedule FA row per holding, on the calendar year |
| Long-term after | Per the fund's own category | 24 months |
| Dividends | Taxed in India only | 25% withheld in the US, gross declared in India, credit claimed via Form 67 |
| US estate exposure | None | Applies above roughly $60,000 of US-situs assets |
| Lives on | The mutual funds screen, flagged as dollar exposure | The equity screen's Abroad block, and the Global screen |

> **Peak value is being lost right now**

> Foreign-asset disclosure asks for the *highest* value each holding reached during the calendar year, not its closing value — and that figure cannot be reconstructed from a year-end statement. Every month that passes before the app starts snapshotting is a month of peak data gone. Two things follow: the monthly snapshot job belongs in phase 1 rather than later, and for the current year the gap should be backfilled now from broker statements, whose month-end values give a defensible approximation. It is the one piece of this design where delay actually destroys information.

- **Feeder funds are not foreign assets.** An Indian mutual fund investing in US equities is an Indian asset with dollar exposure — no LRS usage, no Schedule FA row, taxed as an Indian fund. Your US Nasdaq 100 index holding sits on this side of the line; a direct Vested or IBKR account sits on the other. The `country` and `exposure_currency` fields are what tell them apart.

- **Currency of record for foreign brokers is USD.** Statements arrive in dollars; the app imports them in dollars and converts for reporting, so a re-import never disagrees with a broker statement.

- **Rules change.** Rates, thresholds and limits are configuration rows with effective-from dates, not constants in code, so a budget change is a data edit rather than a release.

## 09. The tax engine

The app already holds every input a tax computation needs: dated lots, realised sales, dividends with withholding, premiums, and contributions. What it lacks is the arithmetic on top. Done well this is the single highest-value screen in the product — done carelessly it is the most dangerous, so the framing matters: **it fills the schedules, it does not file the return.**

> **What this module is, and is not**

> It is a working paper: your own numbers, arranged the way a return asks for them, with every assumption visible and every figure traceable to the transaction that produced it. It is not tax advice, not a filing, and not a substitute for your CA — who should be the one to check it. Every output carries that statement, and every computed figure links back to its source rows so a professional can verify rather than trust.

### Rules live in a table, not in code

Slabs, rates, thresholds, holding periods and exemption limits all change with Budgets — and the law itself has just been rewritten, with the Income-tax Act 2025 taking effect for tax year 2026-27, replacing "previous year" and "assessment year" with a single *tax year* and renumbering familiar sections (80D becomes 126, 87A becomes 156, 24(b) becomes 22). Rates and capital-gains principles carry over unchanged, but section labels on any report do not.

So every rule is a dated row in a `tax_rule` table with an effective-from and effective-to: slab bands, surcharge steps, cess, rebate, standard deduction, per-section deduction caps, holding periods and capital-gains rates per asset class. A Budget becomes a data edit; a computation for an earlier year keeps using the rules that applied then, which is what makes recomputing a prior year trustworthy.

### What it computes

| Head | Fed by | Rule at tax year 2026-27 |
|---|---|---|
| Salary | Entered, or from Form 16 figures | Standard deduction ₹75,000 in the new regime, ₹50,000 in the old |
| Capital gains | **Derived from lots** — no stored gain, ever | Per asset class, below |
| Other sources | Interest, Indian dividends, bond coupons, FD accruals | Slab rate; FD interest taxed as it accrues, not at maturity |
| Foreign income | US dividends gross, foreign interest | Slab rate on the gross figure, with credit for tax withheld abroad |
| House property | Rent, home-loan interest | Interest deduction available in the old regime |
| Deductions | PPF, EPF, ELSS, life and health premiums, NPS | Old regime only, apart from employer NPS; the app knows which of your existing rows qualify |

### Capital gains, by asset class

This is where a spreadsheet gives up and where lot-level records pay off. Every rate below is a row in `tax_rule`, not a constant.

| Asset | Long-term after | LTCG | STCG | Notes |
|---|---|---|---|---|
| Listed equity & equity mutual funds | 12 months | 12.5% | 20% | First ₹1.25 lakh of long-term gains a year is exempt — an allowance that expires unused |
| Debt funds bought on or after 1 Apr 2023 | — | — | Slab | Always short-term however long they are held; no indexation |
| Gold, gold funds, physical | 24 months | 12.5% | Slab | Sovereign gold bonds redeemed with the RBI stay exempt; sold on the market they don't |
| Foreign shares and US ETFs | 24 months | 12.5% | Slab | Twice the equity holding period — the reason lot dates matter for your US holdings |
| Unlisted shares | 24 months | 12.5% | Slab | No indexation |
| Property | 24 months | 12.5% | Slab | Bought before 23 Jul 2024, you may instead choose 20% with indexation — a per-asset election the app should model both ways |

Property carries two wrinkles the other classes don't, both worth capturing at the moment of sale rather than reconstructing later. The cost basis is not the purchase price alone — stamp duty, registration and capital improvements all add to it, which is exactly why the property record holds them as separate dated fields. And a sale can be sheltered by reinvestment: into another residential property, or into specified bonds within a defined window. Those are elections with deadlines attached, so the app's job is to surface the clock and the amounts, and leave the choice to you and your accountant. A large sale also attracts tax deducted at source by the buyer, which is a credit to claim rather than a cost.

### The pipeline

```
1  Classify     each sale → FIFO lots → holding period → asset class → rule row
2  Convert       foreign amounts at the prescribed rate, not the market rate (below)
3  Net           short-term losses against any gains; long-term losses against
                 long-term gains only; carry forward what remains, for eight years
4  Exempt        apply the ₹1.25 lakh equity allowance to long-term equity gains
5  Aggregate     add the other heads; apply deductions the chosen regime permits
6  Rate          slabs → rebate → surcharge → 4% cess
7  Credit        subtract foreign tax withheld, capped at the Indian tax on that
                 same income (Form 67, filed before the return)
8  Compare       run the whole thing again under the other regime and show both
9  Schedule      map every figure onto the return's schedules, with source links
```

### Two details most calculators get wrong

**The exchange rate is prescribed** — _Foreign income_

Foreign income is not converted at the rate you actually got, nor at today's. The rule specifies the State Bank's telegraphic-transfer buying rate on **the last day of the month preceding** the month of the event — the sale, for capital gains; receipt or due date, whichever is earlier, for dividends. The app therefore stores two different rates against a foreign transaction: the real one, which is the truth about your money, and the prescribed one, which is the truth for the return. Storing only one makes the other unrecoverable.

**Advance tax has a rhythm** — _Timing_

Liability above the threshold is payable in four instalments across the year — 15%, 45%, 75%, 100% cumulative — and interest accrues on shortfalls. Capital gains are the exception: you cannot be expected to have foreseen them, so tax on a gain is due in the instalment following the sale. The app already knows the sale date, so it can tell you what is due and when, which is the difference between a calculator and something useful.

### The US side of a US trade

- **Selling is not taxed by the US.** A non-resident alien generally pays no US capital gains tax on share sales — the gain is India's to tax, in full, with no credit to claim because nothing was withheld.

- **Dividends are taxed by both, then reconciled.** 25% withheld at source with a W-8BEN on file, the gross declared in India, the withheld amount claimed as credit — limited to the Indian tax on that income, so if the Indian liability is lower the excess is simply lost.

- **Estate exposure is the unadvertised one.** US-situs assets — US-listed shares, US-domiciled ETFs, ADRs — above roughly **$60,000** can attract US estate tax at rates rising toward 40%, and there is no estate-tax treaty with India to soften it. It is not an income-tax matter and no filing surfaces it, which is precisely why an app that knows the size of the holding should show a quiet flag once it crosses the line, and note that Ireland-domiciled equivalents avoid the exposure entirely. Informational, not advice — but nobody should discover this posthumously.

### Where it earns its keep

- **Regime comparison.** Old versus new, computed on your actual figures, with the crossover shown — the one calculation nearly every salaried household redoes badly each year.

- **The expiring allowance.** "₹1.25 lakh of long-term equity exemption, ₹0 used, 47 days left in the year" is worth more than any chart on the home screen.

- **The holding-period clock.** A US holding 23 months old is one month from halving its tax rate. Only the lot table knows that.

- **Loss inventory.** Carried-forward losses expire after eight years and are lost entirely if a return is filed late. Both facts belong on a screen, not in a memory.

- **A year-end pack** your CA can actually use: computation, capital-gains statement by lot, foreign-asset rows, foreign-tax-credit workings, deduction proofs, and a list of what the app could not determine.

## 10. Getting data in

Two views of the same question. First by asset class — what you actually have to type, and how often. Then by source, ranked by effort-to-value.

### By what you hold

| What | How it gets in | How often you touch it |
|---|---|---|
| Daily expenses | Quick-add in five seconds · recurring rules auto-post the predictable ones · monthly card and bank CSV with a payee→category rules engine · receipt photo | Daily for variable spend. EB, DTH, school fee, premiums and SIPs post themselves |
| Indian mutual funds | **NAV automatic** from AMFI's free daily file. Transactions from a CAMS or KFintech consolidated statement | Set up once; import a statement every few months |
| Indian stocks | Broker CSV export or a depository statement. Live quotes are licensed data — a paid broker API only if you want intraday | An import a month; daily closes arrive on their own |
| Bonds | Manual once — coupon, period, repay mode, dates, rating. No feed exists for unlisted NBFC paper. Accrual, next coupon and maturity are **derived** | Once per bond, then never |
| Fixed deposits | Manual once — principal, rate, start, tenure, compounding. Maturity value and accrued interest are **computed**, not typed | Once per deposit |
| EPF | Manual from the passbook — there is no API. Employer and employee contributions can accrue as a flagged estimate between checks | Quarterly, when interest is credited |
| PPF | Contributions via a recurring rule; the balance is **computed** from the notified rate and the lowest-balance-of-the-month convention | Reconcile once a year |
| NPS | Units from your statement of transactions; **NAV automatic** from the CRA's daily publication | Set up once; occasional statement check |
| Gold | Grams entered per purchase; **rate automatic** on a schedule | Once per purchase |
| Global holdings | Broker CSV or an automated broker export. Dividends and withholding arrive in the same file. **FX automatic**; the prescribed rate for tax is twelve values a year | An import a month |
| Property, insurance | Manual — value, cover, premium, renewal date | Once, then when something changes |

> **Type the terms once, not the value every month**

> This is the shift the whole design turns on. The workbook asks you to look up and retype a current value for each row every month, which is why it goes stale. The app asks for the *terms* — principal, rate, tenure, coupon, units, contribution — and computes the value continuously from them. Fixed deposits, bonds and PPF then never need touching again, and the classes that genuinely change every day (funds, equities, gold, currency) update from a feed. What remains manual is small and infrequent: variable spending, a provident-fund balance a few times a year, and a property valuation when you care to revise it.

### By source

Ranked by effort-to-value. Start at the top; the bottom two are worth knowing about but not worth doing.

| Source | Feeds | How | Effort |
|---|---|---|---|
| AMFI NAV feed | Every Indian MF scheme's current value | Daily plain-text file keyed by scheme code; scheduled job updates `price` | Low — do first |
| The app's own template | Anything, in bulk — holdings, transactions, balances, budgets | Download a workbook with the right headers and validation, fill it in offline, upload it. Parsed on the device, previewed before it writes, reversible as a batch, and the same shape as the full export so the round trip works both ways | Low — do first |
| FX reference rates | USD/INR daily | Same job, appends one `fx_rate` row per day | Low |
| CAMS / KFintech eCAS | Full MF transaction history across AMCs | Password-protected PDF emailed on request; parsed into `investment_txn`. Turns XIRR on for every fund at once | Low–medium |
| Broker CSV exports | Zerodha holdings and realised gains; US broker trades and dividends | Per-broker column mapping, run client-side so statements never leave the device unless you want them stored | Low |
| Bank statement import | Expense transactions, salary credits, card bills | CSV/XLS with a rules engine that learns payee → category | Medium — biggest daily win |
| Depository CAS | Demat equity and bond holdings, consolidated | Monthly PDF; same parser pattern as eCAS | Medium |
| Gold rate | 22K / 24K per gram | Scheduled fetch into `price`, with manual override | Low |
| Receipt OCR | Expense entry from a photo | On-device capture, amount/date/merchant prefilled for confirmation | Medium |
| Email alert parsing | Card spends, UPI debits, SIP confirmations | Forward bank alerts to a dedicated address; regex per sender | Medium — brittle, high volume |
| Reading transaction SMS | Card and UPI debits, as many Indian apps do | The SMS permission is restricted to default messaging apps and a short list of approved uses, so a store-distributed app cannot have it. Forwarded email alerts do the same job within the rules | Not available |
| Account Aggregator | Bank, MF, insurance in one consented pull | Right in principle, but requires registering as a financial information user with a licensed provider — not realistic for a household app | Not recommended |
| Scraping net banking | Everything | Breaks constantly, violates bank terms, and puts credentials somewhere they must never be | Don't |

> **Sequencing that keeps the app honest**

> Ship manual entry first and make it genuinely fast — imports are accelerants, not prerequisites. Then the NAV and FX jobs (they remove the biggest recurring chore), then eCAS (unlocks XIRR retroactively), then statement import with the rules engine.

### Prices come through a driver, never a direct call

Nothing in the app fetches a price. A scheduled job asks a `price_source` driver for a quote and writes the result into the dated `price` table; every screen reads from that table. The interface is one function — *give me the value of this instrument on this date* — with a driver per source behind it: the AMFI file, an FX feed, a gold rate, a manual override.

- **It costs nothing to build this way now** — the first two drivers are twenty lines each.

- **Clients never call a data vendor.** One scheduled fetch serves every user and every device. That is a cost decision today and a licensing one later: market-data terms almost universally forbid passing quotes on to other people, and a per-client fetch is exactly the pattern that breaches them.

- **It keeps live pricing an option rather than a rewrite.** Daily NAV is genuinely enough for this portfolio, but if you later want intraday values — or if each user connects their own broker and pulls quotes under their own entitlement — that is a new driver, not a new architecture.

- **Historical correctness comes free.** Because drivers write dated rows and never update them, a snapshot from last March keeps last March's price whatever happens to the feed.

## 11. Family & access

One household, several logins, and a clear answer to "who can see the total".

| Role | Sees | Can change | Typical holder |
|---|---|---|---|
| Owner | Everything, all members | Everything, including members and roles | You |
| Partner | Everything, all members | All financial data; cannot remove the owner | Spouse |
| Contributor | Own records + household expense totals | Own expenses and assets only | Working adult child, parent |
| Viewer | Household summary only, no account identifiers | Nothing | Dependant, advisor |

- **Sign-up is invite-only.** Public registration is disabled. The owner issues an invite; the token is single-use and expires. A finance app with an open sign-up page on a public URL is an invitation to be probed.

- **Roles are enforced in the database.** Every row carries `household_id` and an optional `member_id`, and access is decided by a policy on the table — not by which screen the UI shows.

- **Members without logins still exist.** Parents whose premiums you pay don't need an account for their policy to sit under their name.

- **Members are archived, never deleted.** This is the standard pattern and the reason for it is arithmetic: a member's past expenses and holdings are part of the household's financial history, so removing the person would silently change last year's totals and any tax figure computed from them. Archiving sets a status and a date; their name still renders on historical rows, marked as archived; no new record can be assigned to them; and they can be restored. **Revoking access is a separate action** — sessions killed, invites voided — because someone can stop having a login while their history stays perfectly valid, and someone can leave the household while still needing access to their own past records for a while.

- **Erasing a person is not the same as erasing their money.** When a genuine deletion is required — someone exercising their right to erasure, or an account being closed — personal identifiers are removed while the financial rows are reattributed to a placeholder member. The household's totals do not move. That distinction is what stops a deletion request from quietly corrupting five years of net-worth history, and it is worth building deliberately rather than discovering when the first request arrives.

- **Per-member net worth is a filter** over the same tables, so "my portfolio" and "our portfolio" are the same screen.

- **A household switcher sits beside the member filter**, appearing only when you belong to more than one — the demo household during the build, and later a parents' household if you ever help with theirs. Switching changes everything on screen; nothing is ever aggregated across households.

## 12. One codebase, three shells

Hosting on GitHub Pages means there is no server of your own — Pages serves static files and nothing else. That single constraint decides the architecture, and it happens to be the same architecture that gets you into the app stores.

> **This replaces the earlier recommendation**

> Revision 1 of this blueprint proposed a server-rendered Next.js app with its own Postgres. That cannot run on GitHub Pages. The app becomes a **static single-page bundle** that talks directly to a managed backend, and everything the server used to enforce moves into database policies. Nothing about the domain model changes; the security model changes completely, which is why section 15 is the longest one here.

- **App** — `Vite + React + TypeScript`: A static SPA. No server rendering, no API routes, no build-time secrets. The same bundle is the web app, the desktop app and the mobile app.

- **Desktop** — `Tauri 2`: Wraps the bundle in a native window using the OS webview. Single-digit-megabyte installers for Windows, macOS and Linux, code-signed and auto-updating.

- **Mobile** — `Capacitor`: Same bundle in a native shell with biometric unlock, push notifications, camera for receipts and secure keychain storage. Produces the .aab and .ipa the stores want.

- **Data & auth** — `Managed Postgres + RLS`: The client talks to it directly over HTTPS, authenticated as the logged-in user. Row-level policies are the access-control layer.

- **Server-side bits** — `Scheduled functions`: Only what genuinely cannot happen on a device: NAV, gold and FX fetches, the monthly snapshot, invite issuance, reminder dispatch. Section 13 covers what runs where, and why parsing and exports stay on the device.

- **Offline** — `IndexedDB + sync queue`: Local cache with optimistic writes and a queue that drains on reconnect. On mobile this is the difference between an app that gets used and one that doesn't.

- **Live updates** — `Postgres change streams`: Household-scoped subscriptions over websockets, honouring the same row policies as any query, so an expense logged on one phone appears on the other. Push notifications carry it when the app is backgrounded.

- **Data access** — `One thin repository layer`: Every query goes through it; no component talks to the backend client directly. Swapping to a self-hosted instance, or to a different provider, then touches one folder.

- **UI** — `Tailwind + shadcn/ui`: Owned components rather than a dependency you fight. Charts hand-drawn in SVG for exact control at small sizes.

- **Quality** — `Vitest + Playwright`: Calculation engine unit-tested against workbook figures; Playwright covers entry and import flows; a dedicated suite tests the database policies.

- **Why not Next.js.** Its value is on the server, and there is no server. A static export of Next.js buys you nothing Vite doesn't, at a higher build cost.

- **Why one bundle for three platforms.** The calculation engine, the currency rules and the FIRE projections are written once and behave identically everywhere. A separate native app would mean maintaining two implementations of arithmetic you need to trust.

- **Desktop earns its place** beyond convenience: the annual chores — importing a year of statements, reconciling, generating reports — are keyboard-and-large-screen work.

- **The path to a domain is a DNS change.** Static files move anywhere: a CNAME onto Pages, or a lift to any static host if you outgrow it. No code change, because there is no server to move.

> **Five decisions that cost nothing now and a migration later**

> Each of these is a phase-1 choice, not a future feature. They are here because every one of them is trivial while the app has a single household and genuinely painful once it doesn't — and because together they are what let the same codebase go to an app store without an architectural change.

> - **Create the backend project in the Mumbai region.** Region is fixed at project creation and changing it later is a full migration. Indian financial data should sit in India regardless of who eventually uses the app.

> - **Separate identity from household membership** (section 04), so one person can belong to more than one household.

> - **Build account deletion and full data export in phase 1.** Both are app-store requirements and both are obligations under India's data protection rules. A correct deletion cascade across thirty-five tables is easy to write while the schema is fresh in mind and miserable to retrofit — and an export you can hand someone is also the backup you'd want for yourself.

> - **Put every price behind a driver** (section 10), so the app never calls a data vendor from a client.

> - **Keep all data access in one repository layer**, so self-hosting or changing provider is a folder, not a rewrite.

## 13. Where the work runs

The app has no server, and the plan is that it never needs one. That sounds like a limitation until you notice that the demanding jobs here — parsing a statement, computing a tax year, producing the year-end pack — are *batch* work, not request-and-response. Batch work has places to run that an API doesn't.

### Three tiers, and what belongs in each

| Runs where | Does what | Why there |
|---|---|---|
| The device | Statement parsing, Excel and PDF export, the tax computation, every what-if | Instant, free, and the sensitive files never leave the machine |
| Scheduled jobs | NAV, gold and FX fetches; the monthly valuation snapshot; reminder dispatch | Must happen whether or not anyone opens the app |
| A CI runner | The one-off workbook migration; anything long or memory-hungry; nightly encrypted backups | A full machine for the minutes it is needed, at no cost on a public repository |

### The heavy jobs, specifically

- **Password-protected consolidated statements.** The browser's PDF engine accepts a password and decrypts the file; these statements are digitally generated with real text, so extraction is a layout problem — reading positioned text and rebuilding rows — not character recognition. Doing it on the device means a document listing every folio, your PAN and your address is never uploaded anywhere. That is better than any server-side design, not a compromise with one.

- **Excel export.** Real multi-sheet workbooks with styling and formulas, generated in the page and saved straight to disk.

- **PDF export.** A layout library where tables need precise control; for the year-end pack, a properly styled HTML report printed to PDF gives better typography than any library and costs nothing.

- **Tier by device, not by feature.** A large statement will strain a phone. Imports and the year-end pack belong on the desktop shell, which has real memory and is where that work naturally happens anyway; the phone keeps quick entry and viewing.

- **One honest caveat.** Statement parsers break when an issuer changes their layout. That is true in every language and on every runtime — it is the hardest single component in this app, and choosing a different stack does not make it easier.

> **Why the tax engine is a pure module, not a service**

> Written as pure functions — figures in, computation out, no database calls — it runs in the page for the interactive parts, where a regime comparison or a what-if slider has to feel instant, and the identical module runs in a scheduled function when a stamped, authoritative figure goes into the year-end pack. One implementation, two places, nothing duplicated and nothing to host. Purity is also the only way to test it properly: a year's worth of fixtures in, expected numbers out, no infrastructure involved.

### Adding a server later, if you decide to

A JVM service — or any API — becomes worth its cost when credentials must be held somewhere other than a device (broker integrations), or when the app serves people beyond this household. Neither applies yet, and the design keeps the door open rather than walking through it:

| Concern | What the move actually involves |
|---|---|
| Database | Nothing. It is plain Postgres; a server connects to the same tables with an ordinary driver |
| Authentication | Nothing rebuilt. A standard resource-server configuration validates the tokens already being issued |
| Row policies | Either bypassed by a service role with authorisation enforced in code, or left in force underneath as a second layer — the better choice |
| The client | Some repository methods call an API instead of the database. Components never knew the difference, so they don't change |
| Domain | Site on the domain, API on a subdomain. A CORS setting |
| The tax engine | **The one real cost.** Either keep running the module as-is in a runtime that speaks its language, or reimplement it — using the original as the reference and the same test fixtures on both sides, so you can prove the two agree before you switch |

### Four rules that keep that door open

- **No provider types past the repository layer.** Components see your own domain objects, never a backend library's response shape.

- **Policies do access, not business rules.** A policy answers "may this user see this row". The moment a tax rule or a calculation lives inside one, it cannot move anywhere.

- **The tax engine stays pure.** No I/O, no queries, no clock reads — pass the date in. Portable to any runtime, and testable without one.

- **Prefer standard Postgres** over provider-specific extensions wherever a standard equivalent exists.

Follow those and adding a server is a weekend of additive work rather than a migration — which is the whole point of deciding now not to have one.

## 14. Picking the free database

A static client needs a backend that provides authentication, authorisation and scheduled jobs, not just storage. That narrows the field considerably.

| Option | Free tier | Auth & row security | Catch |
|---|---|---|---|
| Supabase | 500 MB Postgres, 1 GB files, 5 GB egress, 50k monthly active users, 500k function calls, 2 active projects | Built in — Postgres row-level security with the logged-in user's ID, MFA, OAuth | Free projects pause after a week of inactivity; wakes on demand or on a scheduled ping |
| Neon | 0.5 GB storage, 100 compute-hours a month, 100 projects, branching | Postgres RLS available, but you supply the auth service | Compute scales to zero after 5 minutes; you still need auth, storage and functions from somewhere |
| Turso | 5 GB, 100 databases, 500M row reads and 10M writes a month | SQLite-family; auth and policies are yours to build | Excellent for a local-first design with per-household databases; more assembly required |
| Cloudflare D1 | 5 GB total, 5M row reads and 100k writes a day | Access control lives in your Workers code | Needs Workers in front of it — which means you're writing the server you were trying to avoid |

**Recommendation: Supabase.** It is the only one of the four that gives a static client all four things it cannot do for itself — identity, row-level authorisation, file storage and scheduled server-side jobs — without you operating anything. 500 MB is enormous for a household: a decade of daily prices, transactions and snapshots for this portfolio is a few tens of megabytes.

The pause-after-inactivity rule is the one real annoyance, and it is solved by the weekly keep-alive job in section 16. Nothing about the schema is Supabase-specific — it is ordinary Postgres, so moving to Neon or a self-hosted instance later is a dump and restore plus swapping the auth provider.

## 15. Security

Publishing a finance app as public static files inverts the usual model: there is no trusted middle tier, the code is readable by anyone, and the database is directly addressable from the internet. That is workable — it is how a great many production apps run — but only if you take the following as non-negotiable.

### The threat model, honestly

The realistic risks, in order, are: someone gets one family member's credentials; a permissive database policy lets one household read another's rows; a privileged key ends up in the repository; a dependency you didn't audit ships malicious code in a release build. Sophisticated attacks are not the concern. Every measure below targets one of those four.

**Deny by default in the database** — _Layer 01_

Row-level security enabled on every table, with no permissive fallback policy anywhere. A table without an explicit policy returns nothing — that is the desired behaviour, and a new table that someone forgets to write policies for should be inaccessible rather than open. Policies key off the authenticated user's ID resolved to a household membership, so a stolen session can only ever see one household.

**Test the policies like code** — _Layer 02_

A test suite that authenticates as each role and asserts what it cannot see: a contributor reading another member's holdings gets zero rows; a viewer attempting an update fails; a user from household B querying household A's tables gets nothing. This suite runs in CI and blocks the deploy. Policy bugs are the single most likely way this app leaks, so they get the same rigour as the tax arithmetic.

**Two keys, and only one of them ships** — _Layer 03_

The public client key is designed to be public and is harmless on its own, because it grants nothing that policies don't allow. The privileged service key bypasses every policy and must never appear in the repository, the bundle, a build log, or an Actions secret used at build time. It lives only in the backend's own function environment. Add a CI check that greps the build output for anything resembling it, and rotate on the slightest doubt.

**Strong identity** — _Layer 04_

Passkeys where the platform supports them, with password and an authenticator-app code as the fallback. A passkey is bound to the real domain, so a convincing lookalike page cannot use one, and the database holds only a public key — nothing worth stealing. Time-based one-time-password MFA is mandatory on every account, whatever the role — no account on the system is ever protected by a password alone.

**SMS codes are not offered at all.** SIM-swap is a live attack, the method has been formally deprecated as an authenticator, and sending transactional messages in India carries registration overhead — more cost and more friction for less security than an app-generated code. Email one-time codes appear only in recovery, never as a way to sign in, because their strength is exactly the strength of the mailbox behind them.

**Federated sign-in is deliberately declined.** Signing in with a large provider is secure and convenient, but it makes a third party the gatekeeper to the household's financial records, a suspended account becomes a lockout, and offering one provider on iOS obliges you to offer another. Revisit only if adoption genuinely stalls without it.

Sessions are short-lived with rotating refresh tokens, revocable from a device list, and a re-authentication prompt stands before destructive or sensitive actions — deleting a member, exporting the full dataset, changing someone's role.

**No open front door** — _Layer 05_

Public sign-up disabled. Accounts are created only by accepting a single-use, expiring invite. This alone removes most automated abuse: the app has no registration endpoint to attack, and a stranger who finds the URL sees only a login screen and can't get past it.

**Harden the page itself** — _Layer 06_

A strict content-security policy with no inline scripting, restricting connections to your own backend origin; subresource integrity on anything loaded from a CDN — better still, bundle everything and load nothing externally. Referrer policy set to send no cross-origin referrers, frame-ancestors set to none, and no third-party analytics or tag managers, ever. HTTPS is enforced for you on the Pages domain.

**Minimise what you store** — _Layer 07_

Never store bank or broker credentials — no feature may ever require them. Account identifiers keep the last four digits only; nothing in this blueprint's arithmetic needs a full account number. Policy documents and statements go to encrypted object storage behind short-lived signed links, never a public bucket. The data you don't hold cannot be stolen from you.

**Guard the supply chain** — _Layer 08_

Committed lockfile and clean installs only. Automated dependency updates with review. A vulnerability scan and static analysis on every pull request. Workflow actions pinned to commit hashes rather than moving tags, workflow permissions set to read-only by default and widened only where a job genuinely needs it, and deployment authenticated by short-lived tokens rather than stored credentials. Branch protection so nothing reaches the default branch without passing all of it.

**Defend the device** — _Layer 09_

Auto-lock after inactivity with biometric or PIN re-entry on mobile and desktop. Tokens in the OS keychain on native shells, not in browser storage. Nothing sensitive cached in plain local storage beyond what a session needs. Screenshot suppression on the app-switcher view is a small touch that matters for a screen showing your net worth.

**Plan for being locked out** — _Layer 10_

Passkeys make lockout a real risk rather than a theoretical one: lose the phone and the laptop together and there is no forgotten-password path, because there is no password. Three things prevent that becoming permanent. **One-time recovery codes** issued at enrolment and kept physically — on paper, not in a manager sitting on the same device. **A second person holding owner rights**, so a locked-out owner is not a locked-out household. And a defined **lost-device path**: someone else revokes that session from the device list and re-issues an invite, which is why sessions are listed and revocable in the first place. Email one-time codes belong here and only here.

**No superuser account, ever** — _Layer 11_

The owner role administers a household and that is the highest privilege the system has. There is deliberately no account that can read across households — such a thing is the leaked-privileged-key threat given a permanent home and a login page pointing at it, and this household does not need one, because you are already the owner of your own data. No developer backdoor either: debug against your own household, or a test one holding fabricated figures.

If the app is ever opened to other people and support access becomes genuinely necessary, it is a procedure rather than an account: separate credentials with mandatory MFA, **no standing access** but time-boxed elevation with a reason recorded first, every action — reads included — written to the audit log, and, wherever possible, visibility of account state and error context rather than financial values, since most support questions never need the numbers. Emergencies get a documented break-glass path requiring two people.

**Log and back up** — _Layer 12_

An append-only audit log written by database triggers, not by the client, recording who changed what and when — insertable by the system, updatable by nobody. Nightly encrypted database dumps to storage you control, with a restore rehearsed at least once. The workbook's real strength is that it is one file you can copy; don't lose that property.

> **On the repository being public**

> **Repository visibility and site visibility are two different settings.** On the free plan, Pages publishes only from a public repository. A paid personal or organisation plan lets you publish from a private one — but the published site stays public either way. Paying hides your source code, not your app. Genuine access control on the site itself exists only on enterprise plans, and is not worth pursuing here: what protects the data is the login and the row policies, never the obscurity of the URL.

> So plan on a public repository. Treat the source as published from day one — which is fine, because nothing in the ten layers above depends on the code being secret, and it makes the discipline in layers 03 and 08 load-bearing rather than aspirational. Two practical notes: Actions minutes are metered on private repositories and free on public ones, and switching the repository to private later is a settings change plus a plan upgrade, with nothing in the app affected.

## 16. Shipping from Actions

Five workflows. The first is the deploy; the rest are the ones that keep a free-tier app alive and honest.

```
.github/workflows/
  deploy.yml        on push to main → typecheck, unit tests, RLS policy tests,
                     dependency audit, static analysis → build → publish to Pages
  preview.yml       on pull request → build + test only, no deploy
  backup.yml        nightly cron → database dump → encrypt → retain as artifact
  keepalive.yml     weekly cron → one authenticated read, so the free project
                     never hits its inactivity pause
  release.yml       on tag → Tauri desktop installers (three OSes) and,
                     later, signed mobile bundles for the stores
```

- **Configuration, not secrets.** The backend URL and public client key are build-time configuration — they end up in the bundle regardless, so they are repository variables, not secrets. No secret is needed to build this app at all, which is exactly the property you want.

- **The deploy gate is the security gate.** Policy tests, audit and static analysis run before the publish step and fail the workflow. A deploy that skips them is a deploy that could publish an open database.

- **Pages limits are generous for this** — the practical constraints are a site size around a gigabyte, a soft monthly bandwidth allowance, and a cap of a few builds an hour. A finance app for one family is nowhere near any of them.

- **Desktop releases** build on all three runner operating systems in one job matrix and attach installers to the GitHub release. Signing certificates are the one place real secrets appear, and they belong in environment-scoped secrets with required approval.

- **Store submissions come later** and need the paid developer accounts, but nothing about the code changes: the same bundle, wrapped, with a store listing and a privacy declaration. Building the mobile artefacts in CI from the start means that day is a form-filling exercise rather than a porting exercise.

## 17. First run

Nothing is migrated from the existing workbook — it is a **reference for structure, not a source of data**. Every real figure is entered fresh, by one of two routes: a guided setup for entering as you go, or a template workbook you fill in and upload when you would rather do it all at once in Excel. Both produce the same thing: a correct opening position on a single known date.

### What the workbook still gives you

- **The category list.** All 33 expense names and their Fixed/Variable split are seeded as defaults, because that vocabulary is the household's and is worth keeping.

- **The asset taxonomy** — the nine classes the NetWorth sheet rolls up become the app's classes.

- **The FIRE parameters** — 25×, 30×, 50× and 6% inflation as the starting profile.

- **The field lists** for bonds, deposits and policies, which is where the sheet was already more thorough than most apps.

### Guided setup, in the order that makes the first number correct

| Step | What you enter | Why here |
|---|---|---|
| 1 · Household | Base currency, tax year start, members and their relationships | Everything else hangs off a household and a member |
| 2 · The opening date | One date — the position everything is measured from | A single as-of date is the thing the workbook never had. Pick it, then value everything as at that date rather than whenever you get to each screen |
| 3 · Accounts and cash | Bank and card balances, the emergency fund | Quick, and it makes the first net-worth figure feel real |
| 4 · Investments | Funds, equity, bonds, deposits, retirement, gold, crypto — units or amounts, and cost basis where you know it | Cost basis can be filled in later; current value is what the opening position needs |
| 5 · Property and liabilities | Each property with its full cost basis; loans and card balances | Net worth is wrong without both sides |
| 6 · Protection | Policies with cover, premium and renewal dates | Populates the calendar immediately, which is the first thing that will feel useful |
| 7 · Income and budgets | Salary and its structure, other income, and a planned amount per category | Unlocks the tax engine and the cover-adequacy read, and turns the categories into envelopes |
| 8 · Targets | An allocation profile, the FIRE inputs, the SIP step-up assumption | Drift and projection need a target to measure against |

Steps 1 to 5 produce a usable app. Six to eight can wait a week without the headline number being wrong — the setup should say so rather than presenting eight steps as a wall.

### The other route: fill in a sheet and upload it

Entering fifty holdings through a form is miserable, and a spreadsheet is genuinely the better tool for bulk data entry — so the app hands you one. **Download template** produces a workbook with a sheet per entity, the correct headers already in place, dropdown validation on every field that has fixed options, an instructions sheet, and two or three clearly-marked example rows showing the expected shape. You fill it in at your own pace, offline, in the tool you already know, and upload it.

| Stage | What happens |
|---|---|
| Parse | Read on the device — the workbook is never uploaded anywhere. Amounts accept the way people actually type them: ₹ signs, lakh grouping, commas, blanks |
| Match | Names are resolved to existing records where possible — a scheme name to an instrument, a category name to a category, a member's name to a member — and anything ambiguous is raised rather than guessed |
| Preview | **Nothing is written until you have seen it.** A row-by-row summary of what will be created and changed, with problems listed by sheet, row and column, each saying what is wrong rather than just that something is |
| Commit | All of a sheet or none of it, once the preview is clean. The batch is recorded, so an import that turns out to be wrong can be reversed as a unit instead of unpicked row by row |

- **Re-uploading must not duplicate.** Each template row carries a reference key, so uploading a corrected sheet updates the rows it matches instead of creating a second copy of your portfolio. This is the single most important detail in the whole feature, and the one most bulk importers get wrong.

- **The template and the export are the same shape.** "Export everything" produces a workbook in exactly the format the uploader accepts. That symmetry is worth designing in deliberately, because it turns three separate things into one mechanism: a bulk-entry path, a bulk-*edit* path — export, fix a hundred rows in Excel, upload — and a backup you can read and restore without the app existing.

- **Not just for setup.** The same upload handles a year of transactions, a monthly balance refresh, or a batch of new holdings. It is a permanent route into the app, not a migration tool that gets deleted after phase one.

- **The template carries a version.** When the schema gains a column, old templates are either upgraded on read or rejected with a clear message — never parsed by position and silently misread.

> **Definition of done for phase 1**

> The old test was "the app matches the workbook to the rupee". With no import, that test is gone and needs replacing. The new one: **enter the opening position, take a snapshot, and have a second person independently add up the same accounts and arrive at the same net worth.** Then leave it a month and check that the month-end snapshot, the month's transactions and the opening figure reconcile — closing equals opening plus contributions plus change in value minus spending. If that identity doesn't hold, something in the ledger is wrong, and it is far cheaper to find out in month one than in year three.

## 18. Roadmap

Each phase ends with something you would actually use. Phase one alone already beats the workbook.

**Phase 1 — Parity, with history** — _Foundation_

Schema with currency on every amount and identity split from household membership, row-level policies and their test suite, invite-only auth with MFA, backend project created in the Mumbai region. Guided first-run setup that produces a dated opening position. Manual entry for every asset class including property with its full cost basis, all of it through the repository layer. Net worth, allocation, monthly snapshot job, prices behind their driver. Expense categories as budgets over a transaction ledger with quick-add. FIRE screen with the live inflation ladder. Light and dark themes and privacy mode from the first screen, since retrofitting a theme is far worse than starting with one. Account deletion and data export. **The demo household comes first**, seeded before the real one exists — it is where the app is exercised and improved, what you show the family when asking them to join, and the thing that proves the row policies hold with two households in one database before any real figure depends on them. The real household is created once the app has earned it. Deploying to Pages from Actions from the first commit.

**Phase 2 — The phone and the desktop** — _Adoption_

Capacitor and Tauri shells off the same bundle, biometric unlock, offline queue, push reminders, unified calendar, recurring auto-post. Member logins and roles so the household uses it rather than watching you use it, with the guided tour on first run — the demo they were shown and the app they now hold should feel like the same thing. Privacy mode wired to the app switcher. This phase decides whether the ledger stays current.

**Phase 3 — Two currencies and the world** — _Global_

Daily FX job, dual-currency display, native-versus-rupee returns, the Global screen: foreign holdings, RSU vesting, dividends net of withholding, LRS and TCS running totals, and calendar-year foreign-asset rows accumulating quietly in the background. **Not optional in this household** — there is a live US brokerage account alongside the Indian feeder, so the disclosure obligations are real from day one rather than something a future account might trigger. The peak-value capture that feeds them starts in phase 1 with the snapshot job, because that number cannot be recovered afterwards.

**Phase 4 — Stop typing** — _Automation_

NAV and gold jobs, eCAS parser, broker and bank statement import with the payee rules engine. XIRR and lot-level capital gains switch on for every holding with a complete ledger.

**Phase 5 — The tax engine** — _Highest value_

Rules loaded as dated data, the computation pipeline, and the old-versus-new regime comparison. Capital gains derived from the lots that phase 4's imports filled in — which is why this phase follows that one rather than leading. Then the live prompts that make it worth opening: unused equity allowance, holding-period clock, carried-forward losses, advance-tax instalments. Foreign tax credit workings and the year-end pack for your accountant.

**Phase 6 — Decisions and reports** — _Depth_

Goals beyond FIRE, coast-FIRE and scenario compare, rebalancing against target weights, bond maturity ladder, loan prepayment analysis, insurance cover-gap. Then the reporting layer: tax-year and calendar-year, Excel and PDF export.

**Phase 7 — Domain and stores** — _When ready_

Custom domain pointed at the same static build. Paid developer accounts, store listings, privacy declarations, signed builds from the release workflow, and a beta track for the family before anything goes public. No rewrite — the artefacts have been building in CI since phase two.

**Phase 8 — opening it to everyone** — _Optional, and mostly not code_

If the app is ever offered publicly, the architecture holds: multi-tenancy, policy-based authorisation and a static bundle are already in place. What changes is roughly fifteen percent of the front end and a great deal of everything else. Section 19 sets out what that involves — read it before committing, not after.

## 19. If it ever goes public

A family tool and a consumer product are the same code and different undertakings. Nothing here needs deciding now — it is recorded so that the phase-1 choices above make sense, and so the day you consider it you are reading a checklist rather than discovering a problem.

### What actually changes in the code

Invite-only sign-up becomes open registration with email verification and abuse controls — the one deliberate reversal of a security decision, compensated by rate limiting and bot defences. Onboarding and empty states, because new users arrive with nothing. Consent and privacy screens. A crash reporter. Account deletion and export, already built in phase 1. The domain model, the calculation engine and the currency rules are untouched.

### What the stores require

| Requirement | Detail | Watch out for |
|---|---|---|
| Play developer account | One-off fee, then listing, content rating, data safety form and a privacy policy URL | A *personal* account opened after November 2023 must run a closed test with **12 testers opted in continuously for 14 days** before it can even apply for production, and a gap resets the clock. Organisation accounts are exempt. Start this early or register as an organisation — it is a calendar constraint, not a workload one |
| Apple developer account | Annual fee, App Review, privacy labels, in-app account deletion | The genuine rejection risk is the minimum-functionality rule: a wrapped web page gets refused. Biometric unlock, push, camera receipt capture and offline entry are what make it a real app — they are in phase 2 for that reason, so keep them |
| Both | Age rating, encryption export declaration, support contact, update cadence | Target-API deadlines move every year; a published app that stops being updated eventually stops being listed |

### What the law requires

- **India's data protection regime is mid-rollout.** The rules notified in 2025 run an eighteen-month phased implementation: soft enforcement through late 2026, with full adjudication and penalties from May 2027. A public launch lands inside that window, so the obligations are not theoretical — a consent notice, a named grievance officer with published contact details, breach reporting, and automated deletion and retention workflows.

- **Stay out of advice.** Everything the app says should describe what is, not prescribe what to do. Organising someone's own figures is not regulated; telling them what to buy or how much cover to hold moves toward investment-adviser registration. The cover-gap and lever screens need to read as arithmetic with its assumptions on display.

- **Tax outputs are working papers.** Label them as material for a professional to check, never as a filed position.

- **Terms and a privacy policy** that actually describe what the app does with data — which, in this design, is very little, and that is worth saying plainly.

### What it costs and what security becomes

The free tier is a household, not a userbase. A paid backend plan removes the storage and egress ceilings and the inactivity pause, and adds point-in-time recovery — which you want the moment the data is not only yours. Add the two store fees and a domain.

The security posture in section 15 does not change in kind, only in rigour: the policy test suite becomes non-negotiable, a penetration test precedes launch, monitoring and alerting stop being optional, secrets rotate on a schedule, a responsible-disclosure address is published, and an incident-response plan exists because breach notification is now a legal duty rather than good manners.

### Live data at public scale

Sync between users and devices scales without redesign — change streams are already household-scoped and already policy-enforced. Live *market* prices are the constraint, and it is commercial rather than technical: exchange data is licensed, and broker APIs are issued per user with terms that generally forbid passing quotes to anyone else. The two lawful routes are a data vendor with a redistribution licence, or each user connecting their own broker and pulling under their own entitlement. Both are new drivers behind the interface in section 10, which is the entire reason that interface exists.
