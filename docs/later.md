# Parked for later

Ideas the owner wants kept for later development (13 November 2026). **None is designed,
scheduled or built.** Each needs a design document, with its invariants, before it is
built, and a step in `docs/build-plan.md` when the owner schedules it. The rules under
each heading are the owner's conditions and hold for anything designed from this list.

## 1. Getting the app noticed

Depends on selling the app (`docs/design/commercial-launch.md`, whose §12 decisions are
still open), except where marked.

| Idea | What it is | Depends on |
|---|---|---|
| Public demo | "Try the demo" on a landing page: the demo household, read-only, no sign-up | Public sign-up decision; a no-signup demo fixture (blueprint §5, the demo household) |
| Free calculators | FIRE, PPF and deposit maturity as public pages, found by search, each leading into the app. Loan prepayment once §3 builds it | The pure functions in `src/domain` already exist for the first three |
| Privacy-led landing page | "No bank passwords, no SMS reading, statements never leave your phone", each claim linked to the public file that makes it true (blueprint §20) | Nothing; can be written any time |
| Launch posts | Product Hunt, Show HN, Indian personal-finance communities (r/IndiaInvestments, r/FIREIndia), each within the community's self-promotion rules | A working public demo |
| Family referral | "Give another family a free month", on the invitation flow that already exists | Billing (commercial-launch §3) |
| Shareable year in review | Percentages and shapes only, **never an amount**, so it can be posted | Nothing new in the data |
| Google Play listing | The app in an Android wrapper, store text around "family" and "private" | Stage 6 (devices) and commercial-launch §9 |
| Startup programmes | Razorpay Rize (founder community, incorporation help); Startup India (DPIIT) recognition, which needs a Private Limited company, LLP or registered partnership, not a sole proprietorship. Supabase publishes no startup credits; budget for the paid plan | The business entity (commercial-launch §12, item 7) |

## 2. AI features: no cost, no privacy breach

**The owner's conditions:** an AI feature costs nothing to run and nothing about the
household leaves the device. Concretely:

- **No cloud AI service, no API key, no per-use charge.** Anything that sends text, an
  image or a figure to a hosted model is out, whoever the provider is.
- **On the device only:** a model or library running in the browser (or, later, the
  Tauri or Capacitor shell). No network call carries household data.
- **A suggestion, never a fact.** Every AI output is marked as a guess and is saved only
  when a person taps to accept it, as the statement importer's category guesses are
  (build-plan step 7).
- **The app works fully without it.** Where the device cannot run the model, the feature
  is absent, not broken, and nothing else depends on it.
- **No advice.** AI never says what to buy, sell or do.

| Idea | What it does | How it stays free and on the device |
|---|---|---|
| Insights feed | "Electricity is up 18% on last year", "No SIP recorded this month", "A policy renews in 12 days" | **No model at all:** comparisons in a pure function over the household's own rows. Build this first |
| Category from your own history | Suggests a category for a new expense or imported line from what the household filed that payee under before | **No model:** counting over the household's own rows (already the plan for step 7) |
| Read a receipt or a bill | Photograph an FD receipt, a policy schedule or a jewellery bill; the amount, dates and number fields are filled as guesses | An OCR library that runs in the browser (e.g. Tesseract.js, WebAssembly). A new dependency, so the maintainer's decision. The image is never uploaded or stored unless receipt storage is built separately |
| Payee clean-up | Turns `UPI/RAZORPAY/8817` into a readable name | Rules and the household's own renames first; a browser built-in model only where available (below) |
| Ask your money | "How much on school fees this year?" answered from the household's figures | A browser built-in model turns the question into a filter; **the figures are worked out by the app's own code**, never by the model. Absent where no on-device model exists |
| Month in words | Three sentences for the monthly money meeting | Templates filled from the month's figures; a built-in model may only reword them |

**On-device models.** Chrome has begun shipping a built-in model to web pages (the
Prompt API, Gemini Nano). It runs locally and costs nothing, but its availability on
Android phones was not confirmed when this was written (13 November 2026), and Safari and
Firefox do not offer it. Use it only as a progressive enhancement behind a feature check;
recheck availability before designing anything that relies on it.

## 3. Simulators: arithmetic with the assumptions shown

**The owner's conditions:** a simulator is arithmetic, shows every assumption on the
screen, and **never recommends**. Concretely:

- **A pure function in `src/domain`**, tests first against fixtures with known answers
  (`CLAUDE.md`: numeric work is test-first).
- **Every assumption is visible and editable on the same screen**: rate, inflation, years,
  tax rule, start date. A default is labelled as a default.
- **Tax figures come from dated `tax_rule` rows**, never constants.
- **Words describe, never advise:** "prepaying ₹1 lakh shortens the loan by 7 months", never
  "you should prepay". No verdicts, no "best option", no ranking of choices.
- **Results are not saved as figures relied upon**, and they never change a holding, a goal
  or the plan.
- Where the outcome depends on markets, show a **range** (a low, an expected and a high
  return the person can change), not one line.

| Simulator | What it works out | Uses |
|---|---|---|
| Sell now or later | The tax on selling a holding today against after it turns long term, from its actual purchases | Lots, `tax_rule`, the capital-gains engine |
| Prepay the loan or invest | Months and interest saved by prepaying, beside what the same money grows to at a rate the person sets | Liabilities with their balance and rate |
| FIRE with ranges | The independence date under a low, an expected and a high return, with sliders for spending, return and retirement year | The FIRE projection (`src/domain/fire.ts`) |
| Can we afford it | A large expense (a house, a car, a year off) and its effect on the emergency fund and the independence date | Net worth, months of cover, the FIRE projection |
| Loss of income | How many months the household can run on what it has, and what term cover would pay | Spending history, liquid holdings, policies |
| Goal planner | The monthly amount, with a yearly step-up, to reach a target by a date | Goals (`docs/design/goals.md`), once built |
| Old or new tax regime | Both regimes on the person's own income and deductions, side by side | The income-tax engine, the 80C and 80D caps (`docs/drafts/`, after a CA's check) |

A natural home is a **What if** area under Goals, one screen per simulator, each opening
with its assumptions above its answer.
