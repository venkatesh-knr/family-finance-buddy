# Family Finance Buddy

**Names.** Product name: *Family Finance Buddy*, and that is what the app calls itself —
the header, the sign-in screen and the browser tab all say it in full. *Finance Buddy* is
the short form, kept for places with no room for the whole thing: the home-screen icon
label, where anything longer is truncated by the launcher. Slug for the repo, package and
Supabase project: `family-finance-buddy`.

Family finance app for an Indian household. Tracks expenses, investments across nine asset
classes, property, insurance, liabilities, FIRE targets, and Indian + US taxes.

**Architecture:** static SPA (Vite + React + TypeScript) deployed to GitHub Pages by
GitHub Actions, talking directly to Supabase (Postgres + Auth + RLS + Storage + scheduled
functions) in the **Mumbai** region. Tauri wraps the same bundle for desktop, Capacitor for
mobile. There is no server of our own and none planned.

**Read `docs/blueprint.md` before proposing any design change.** It is the full 19-section
specification. `docs/tokens.md` is the design system. Both are authoritative — if something
here conflicts with them, ask rather than choosing.

---

## Invariants — never violate without discussing first

**Money and currency**
- Money is **integer minor units** (paise, cents) in `bigint`. Never floats. Format only at
  the display edge.
- Every amount carries a **currency**. Store native, derive base currency on read. Never
  overwrite the original figure with a converted one.
- Exchange rates are **dated rows, appended, never updated**. A transaction converts at the
  rate for its own date. Yesterday's net worth must not change because the rupee moved today.
- `currency` and `exposure_currency` are different things. An Indian feeder fund tracking a
  US index is `INR` / `USD`. A direct US holding is `USD` / `USD`.

**Data access and security**
- All queries go through **the repository layer**. No Supabase types past it, ever — that
  layer is the seam that makes a future server a weekend's work instead of a rewrite.
- Row-level security is the security boundary. **Deny by default.** A table with no policy
  returns nothing, and that is correct.
- Every migration **enables RLS explicitly** (`alter table … enable row level security`) and
  **grants privileges explicitly**, even though the project has an event trigger that enables
  RLS on new tables and does not auto-expose them. The project settings are a safety net, not
  the specification — migrations must be self-contained so they still do the right thing on a
  self-hosted instance or a different provider.
- **No policy without a test that proves it denies.** The policy suite gates the deploy.
- Policies do **access**, not business rules. Never put a calculation or a tax rule in one.
- Two keys, and only one ships. The **publishable key** (`sb_publishable_…`, formerly `anon`)
  goes in the bundle by design — it grants nothing the policies don't allow. The **secret key**
  (`sb_secret_…`, formerly `service_role`) bypasses every policy and must never appear in the
  repo, the bundle, a log, a build output, or an Actions secret used at build time. This repo
  is public. Add a CI check that greps the build output for `sb_secret`.
- Env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Both are repository
  variables, not secrets — they are in the shipped JavaScript either way.
- No bank or broker credentials are ever stored. Account identifiers keep last four digits
  only.

**Calculation**
- The tax engine and every financial calculation are **pure functions**. No I/O, no queries,
  no `Date.now()` — pass the date in. This is the only way to test them and the only way to
  move them later.
- **Capital gains are derived from lots.** Never store a gain.
- Tax rules — slabs, rates, thresholds, holding periods — are **dated rows in `tax_rule`**,
  not constants in code. A Budget change is a data edit. Prior years recompute on the rules
  that applied then.
- Prices are written by a **driver** into the dated `price` table on a schedule. Clients
  never call a data vendor directly.

**Time and lifecycle**
- All period boundaries are **IST** (Asia/Kolkata), whatever the device says. Month-end is
  the last calendar day in IST; the tax year runs 1 April to 31 March. Timestamps are stored
  in UTC and converted for display.
- Members and categories are **archived, never deleted** — their history is the household's
  arithmetic. Deletes are soft everywhere.
- Renaming a category changes the label only; transactions reference it by id.
- Transactions are freely editable until a figure has been relied upon (a frozen snapshot, a
  completed tax year, a generated report) — after that, **void and re-enter**.
- Offline conflicts: last write wins, and the losing version goes to the audit log.

---

## Conventions

- **Vertical slices, not layers.** "Expenses screen, repository through UI" — not "all the
  repository methods".
- **Tests before implementation for anything numeric.** Tax, XIRR, FX conversion, FIRE
  projection, FD and bond accrual. Fixtures with known answers first.
- One concern per commit. Plan before touching more than a few files.
- Show migrations and policies for review before building UI on top of them.
- Respect OS text size to 200%; no fixed-height container holds text.
- **Never encode meaning in colour alone** — a gain carries a sign or arrow as well as a hue.
- Charts read colours from tokens, never literals, or they break in one theme.

## Layout

```
src/
  app/            routes, shell, providers
  features/       one folder per screen — components + hooks together
  domain/         pure calculation modules (tax, xirr, fx, fire, accrual)
  repo/           the ONLY place that talks to Supabase
  ui/             shared primitives built on docs/tokens.md
  lib/            formatters (money, dates), guards
supabase/
  migrations/     versioned SQL
  tests/          policy tests — these gate the deploy
  seed/           demo household fixture
docs/             blueprint.md, tokens.md
```

## Out of scope — do not build

- No bank credential storage, no screen-scraping, no SMS parsing (Play restricts it anyway).
- No global superuser account, and no developer backdoor. The owner role administers a
  household; that is the highest privilege in the system.
- No public sign-up. Accounts are created only by accepting a single-use, expiring invite.
- No third-party analytics or tag managers.
