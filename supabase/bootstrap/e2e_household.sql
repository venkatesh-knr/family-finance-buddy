-- Family Finance Buddy — the household the end-to-end tests run in.
--
-- The tests write expenses, deposits, bonds, a policy and readings. Most of that cannot be deleted from the
-- app (deletes are soft, readings and terms are append-only, a policy has no delete grant, the audit trail is
-- permanent), so when the suite ran in the household anybody uses, its rows ended up on Expenses, Insurance and
-- Profile and in the budget figures. The suite now runs in a household of its own, which it resets to the seed
-- before and after every run (`reset_demo_household`, owner only, so the test account is its owner).
--
-- Run ONCE, in the Supabase SQL editor, as the project owner. Not a migration: there is deliberately no
-- client-side policy to create a household (see first_household.sql for why).
--
-- It needs the test account to exist already (it is the one in .env.e2e). It is safe to run twice: if a
-- household of that name already has that account as a live member, it says so and changes nothing.
--
-- Afterwards, add one line to .env.e2e:   E2E_HOUSEHOLD=E2E test household
--
-- Optional, and your call: revoke the test account's membership of the household you actually use (the commented
-- statement at the end), so no run can reach it by accident. The suite switches to its own household either way.

do $$
declare
  -- ─── edit these ──────────────────────────────────────────────────────────
  v_email     text := 'test-account@example.com';   -- the E2E_EMAIL account
  v_household text := 'E2E test household';          -- must match E2E_HOUSEHOLD
  v_display   text := 'E2E';                         -- its name as a member
  -- ─────────────────────────────────────────────────────────────────────────

  v_auth_user    uuid;
  v_account      uuid;
  v_household_id uuid;
  v_member_id    uuid;
begin
  select id into v_auth_user
    from auth.users
   where lower(email) = lower(btrim(v_email));

  if v_auth_user is null then
    raise exception 'No auth user with email %. Edit v_email to the E2E_EMAIL account.', v_email;
  end if;

  select id into v_account
    from public.user_account
   where auth_user_id = v_auth_user;

  if v_account is null then
    raise exception 'No user_account row for %. The on_auth_user_created trigger should have made one.', v_email;
  end if;

  if exists (
    select 1
      from public.membership ms
      join public.household  h on h.id = ms.household_id
     where ms.user_account_id = v_account
       and ms.revoked_at is null
       and h.name = btrim(v_household)
  ) then
    raise notice 'That account is already a member of "%". Nothing to do.', v_household;
    return;
  end if;

  -- Marked demo, because only a demo household can be reset, and the reset is what keeps the suite clean.
  insert into public.household (name, kind, base_currency, display_currency, fy_start_month)
  values (btrim(v_household), 'demo', 'INR', 'INR', 4)
  returning id into v_household_id;

  insert into public.member (household_id, display_name, colour)
  values (v_household_id, btrim(v_display), 'c1')
  returning id into v_member_id;

  -- Owner: the reset is owner only, and a test household has nobody else to be one.
  insert into public.membership (user_account_id, household_id, member_id, role)
  values (v_account, v_household_id, v_member_id, 'owner');

  -- The sample data, so the first run starts from the same place every later run does.
  perform app.seed_demo_household(v_household_id, v_account);

  raise notice 'Household % ("%") created and seeded, with % as owner.', v_household_id, v_household, v_display;
end $$;

-- Proof it worked. Run as the table owner, so this bypasses RLS by design.
select h.name as household, m.display_name as member, ms.role, h.kind
  from public.membership ms
  join public.household  h on h.id = ms.household_id
  join public.member     m on m.id = ms.member_id
 where ms.revoked_at is null
   and h.kind = 'demo'
 order by h.created_at;

-- Optional: take the test account out of the household you use. Edit both names first.
--
-- update public.membership ms
--    set revoked_at = now()
--   from public.household h, public.user_account ua, auth.users u
--  where ms.household_id = h.id
--    and ms.user_account_id = ua.id
--    and ua.auth_user_id = u.id
--    and lower(u.email) = lower('test-account@example.com')
--    and h.name = 'Demo household'
--    and ms.revoked_at is null;
