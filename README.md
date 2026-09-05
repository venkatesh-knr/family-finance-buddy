# Family Finance Buddy

A family finance app for an Indian household — expenses, investments across nine asset
classes, property, insurance, liabilities, FIRE targets, and Indian + US taxes.

This repository currently holds the **walking skeleton**: one vertical slice through every
layer, so the architecture is proven end to end before any of it is built out.

- `docs/blueprint.md` — the full nineteen-section specification
- `docs/tokens.md` — the design system
- `CLAUDE.md` — the invariants, which are not negotiable without a conversation

---

## What the skeleton actually does

Sign in with a password and an authenticator code, see your household's recent expenses,
add one, and watch it appear on a second device without a refresh. That is all — and every
layer it passes through is the real one.

| Layer | Where |
|---|---|
| Five tables, RLS deny-by-default, policies resolving through membership | `supabase/migrations/` |
| A policy suite that gates the deploy | `supabase/tests/` |
| Two repository methods, no provider types past them | `src/repo/` |
| Pure formatters, tested against known answers | `src/lib/` |
| Tokens, light and dark | `src/styles/` |
| One screen | `src/features/expenses/` |
| Typecheck, both suites, secret-key check, deploy | `.github/workflows/deploy.yml` |

---

## Running it locally

```bash
npm ci
cp .env.example .env    # then fill in both values
npm run dev
```

Both environment values are **public by design** — they ship inside the bundle, so they are
configuration, not secrets. A `sb_secret_…` key must never appear in this repository, the
bundle, a build log, or an Actions secret. `scripts/check-no-secret-key.sh` enforces that
and runs before every publish.

### The database

The policy suite and the local stack need Docker running.

```bash
supabase start      # applies every migration, then the demo fixture
npm run test:policies
```

The demo household exists only on your machine:
`owner@finance-buddy.test` / `DemoHousehold!2026`.

### The tests

```bash
npm run typecheck
npm run test:unit       # formatters and the row-to-domain mapping
npm run test:policies   # row-level security — this one gates the deploy
```

---

## Before the first deploy

1. **Create the Supabase project in the Mumbai region.** Region is fixed at creation and
   changing it later is a full migration.
2. **Push the migrations**: `supabase link --project-ref <ref>` then `supabase db push`.
3. **Repository → Settings → Pages → Source: GitHub Actions.**
4. **Repository → Settings → Secrets and variables → Actions → Variables**, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Variables, not secrets.
5. **Create the first household — the demo one.** The blueprint has the demo household come
   first: it is where the app is exercised, and it is what proves the row policies hold with
   two households in one database before any real figure depends on them. Run
   `supabase/bootstrap/first_household.sql` in the SQL editor; the real household is created
   later by changing `v_kind` to `'real'` and running it again.

   The demo household is **not** a demo login — "a real account, fake money". You sign in as
   yourself. The `owner@finance-buddy.test` credentials in `supabase/seed/` belong to the
   local throwaway stack only; that file is in a public repository, so its password is public.
   Never run `supabase db reset --linked`, which would apply seeds to your live project.
6. **Create the first account** from the Supabase dashboard — Authentication → Users →
   Invite. Public sign-up is disabled in `supabase/config.toml`, and there is no
   registration route in the app.

---

## What is deliberately not here yet

A second table, a second screen, a chart, a router, a household-creation flow, the invite
table, offline sync, and the desktop and mobile shells. Each is its own vertical slice.
