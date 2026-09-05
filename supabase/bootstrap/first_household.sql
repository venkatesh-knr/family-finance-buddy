-- Family Finance Buddy — the first household, which is the DEMO one.
--
-- "The demo household comes first, seeded before the real one exists — it is
-- where the app is exercised and improved, what you show the family when
-- asking them to join, and the thing that proves the row policies hold with
-- two households in one database before any real figure depends on them. The
-- real household is created once the app has earned it." (blueprint §1057)
--
-- And §417: "A real account, fake money." The demo household is NOT a demo
-- login. You sign in as yourself; only the household is marked demo. The
-- fake owner@finance-buddy.test credentials in supabase/seed/ are for the
-- local throwaway stack and must never reach a live project — that file is in
-- a public repository, so its password is public too.
--
-- Run ONCE, in the Supabase SQL editor, after inviting yourself as a user
-- (Authentication → Users → Invite) and accepting the invite.
--
-- This is not a migration and not a seed. There is deliberately no client-side
-- policy to create a household, so the very first rows have to be inserted by
-- someone with table privileges — which is exactly the bootstrap problem an
-- invite flow solves for every household after this one.
--
-- It is safe to run twice: if the account already has a live membership it
-- reports that and changes nothing.

do $$
declare
  -- ─── edit these three ────────────────────────────────────────────────────
  v_email     text := 'venkatesh.knr@gmail.com';   -- the invited user
  v_household text := 'Demo household';            -- what to call it
  v_display   text := 'Venkatesh';                 -- your name as a member

  -- 'demo' first. Change to 'real' only when creating your actual household,
  -- which the blueprint says happens once the app has earned it. A demo
  -- household carries a persistent badge so there is never a moment of
  -- wondering which numbers you are looking at.
  v_kind      text := 'demo';
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
    raise exception
      'No auth user with email %. Invite them first: Authentication → Users → Invite.', v_email;
  end if;

  -- Created by the on_auth_user_created trigger when the user was invited.
  select id into v_account
    from public.user_account
   where auth_user_id = v_auth_user;

  if v_account is null then
    raise exception
      'No user_account row for %. The on_auth_user_created trigger should have made one — check it exists.', v_email;
  end if;

  -- Scoped to this kind on purpose: belonging to the demo household must not
  -- block creating the real one later, which is the whole intended sequence.
  if exists (
    select 1
      from public.membership ms
      join public.household  h on h.id = ms.household_id
     where ms.user_account_id = v_account
       and ms.revoked_at is null
       and h.kind = v_kind
  ) then
    raise notice 'That account already belongs to a % household. Nothing to do.', v_kind;
    return;
  end if;

  insert into public.household (name, kind, base_currency, display_currency, fy_start_month)
  values (btrim(v_household), v_kind, 'INR', 'INR', 4)
  returning id into v_household_id;

  insert into public.member (household_id, display_name, colour)
  values (v_household_id, btrim(v_display), 'c1')
  returning id into v_member_id;

  -- owner is the highest privilege in the system. There is no superuser above it.
  insert into public.membership (user_account_id, household_id, member_id, role)
  values (v_account, v_household_id, v_member_id, 'owner');

  raise notice 'Household % (%) created, with % as owner.', v_household_id, v_kind, v_display;
end $$;

-- Proof it worked. Run as the table owner, so this bypasses RLS by design —
-- it says the rows exist, not that you can read them through the app.
select h.name        as household,
       m.display_name as member,
       ms.role,
       h.kind,
       h.base_currency,
       h.fy_start_month
  from public.membership ms
  join public.household  h on h.id = ms.household_id
  join public.member     m on m.id = ms.member_id
 where ms.revoked_at is null;
