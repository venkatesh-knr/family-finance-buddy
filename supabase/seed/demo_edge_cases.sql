-- Family Finance Buddy — the demo household, built to break things.
--
-- "Seed script producing a full fabricated household — and built to exercise
-- edge cases" (docs/build-plan.md, stage 3). The cases themselves — and why
-- each one is awkward — live in app.seed_demo_household(), in
-- supabase/migrations/20260916120000_demo_reset.sql. They moved there so the
-- Reset control in Settings can run the same seed this file does; one copy,
-- two callers.
--
-- WHAT THIS IS NOT
--
-- It is not demo_household.sql. That file creates an auth account with a
-- password committed to a public repository, and is local-only for that reason.
-- This one creates no account at all: it fills a household you already own,
-- which is why it can be run from the SQL editor against the hosted project
-- where the app is actually being used.
--
-- HOW TO RUN
--
--   Supabase dashboard -> SQL Editor -> paste -> Run.
--
-- Or, from the app: Settings -> Reset the demo household, which empties it
-- first. This file only ever adds.
--
-- Safe twice: the seed stops if it has already run. It refuses outright on
-- anything but a household marked `demo`, because every figure is invented and
-- a real household must never contain one.

do $seed$
declare
  -- ─── edit this ───────────────────────────────────────────────────────────
  --
  -- Overridable without editing the file, which is how CI points it at a
  -- throwaway household to prove the SQL still matches the schema:
  --
  --   set seed.email = 'someone@example.test';
  --
  v_email text := coalesce(
    nullif(current_setting('seed.email', true), ''),
    'venkatesh.knr@gmail.com'
  );
  -- ─────────────────────────────────────────────────────────────────────────

  v_account   uuid;
  v_household uuid;
begin
  select ua.id into v_account
    from public.user_account ua
    join auth.users u on u.id = ua.auth_user_id
   where lower(u.email) = lower(btrim(v_email));

  if v_account is null then
    raise exception 'No account for %. Check the email at the top of this file.', v_email;
  end if;

  select h.id into v_household
    from public.membership ms
    join public.household h on h.id = ms.household_id
   where ms.user_account_id = v_account
     and ms.revoked_at is null
     and h.kind = 'demo'
   order by h.created_at
   limit 1;

  if v_household is null then
    raise exception 'No demo household for %. This seed never touches a real one.', v_email;
  end if;

  -- The function checks the kind again, and refuses anything not marked demo.
  if app.seed_demo_household(v_household, v_account) then
    raise notice 'Seeded household %.', v_household;
    raise notice 'Members: Meera (no login, has private entries), Priya (archived, has history).';
    raise notice 'Sign in and look for: a Personal line in Budget vs actual, a lower-bound peak with named missing months, an archived category on an old row, a voided expense excluded from totals.';
  else
    raise notice 'This household has already been seeded. Nothing to do — use Reset in Settings to start again.';
  end if;
end;
$seed$;
