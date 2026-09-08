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
| 2 — Schema, policies, tests | done | 21 migrations, 116 assertions across 7 pgTAP files gating the deploy, audit triggers on every table |
| 3 — The demo household | **partial** | Switcher, demo badge and the edge-case seed (`supabase/seed/demo_edge_cases.sql`) done. Reset-and-reseed is still to design: it is now a household-scoped operation rather than `db reset`. Four listed cases — a loss-making sale, a carried-forward loss, lots either side of twenty-four months, a foreign dividend — wait on `lot`, `disposal`, `dividend` and `tax_rule`, which do not exist. |
| 4 — Screens you use daily | **in progress** | Expenses with its editor, the spending plan, holdings, and Overview with net worth and allocation by kind. The month-end close job is built (`supabase/migrations/20260908120000_month_end_close.sql`), the four missing primitives exist, and `fx_rate` plus `liability.outstanding_minor` (`20260908130000`) are what let the headline be net worth rather than assets. Outstanding: the donut, the since-inception chart, member attribution, and automatic valuation — which waits on the `price` table and its driver, the close job carrying readings that were taken and valuing nothing it was not told. |
| 5 — The rest of the surface | not started | Property, global, tax, calendar, reports, read-auditing |
| 6 — Onto the devices | not started | — |
| 7 — Real data | not started | — |

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
| CAS parser | Lots and transaction history are entered by hand or from broker CSVs | None — the fallback is already the phase-1 behaviour | Phase 4, when it matters |
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

- Property with its cost basis, bonds and deposits, retirement, protection, liabilities, the calendar.

- Export in both formats, and the template upload with its preview-before-commit flow.

- FIRE with the live projection.

- Read-auditing on the tables carrying personal detail. `audit_log` already accepts a `'read'` action and nothing writes it: Postgres triggers do not fire on `select`, so this means routing those reads through security-definer functions. Deferred from stage 2 deliberately — it is a change to how reading works, not another trigger, and it should be designed alongside the §20 totals surface it shares.

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
