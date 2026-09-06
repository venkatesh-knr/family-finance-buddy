-- Family Finance Buddy — remove a test account.
--
-- For accounts created while trying the invite flow, and for nothing else.
--
-- Deletes are soft everywhere in this app on purpose: a member is archived, an
-- expense is voided, and history stays. This script is the deliberate exception
-- the design allows for — "Reset wipes and reseeds it to a known state, so you
-- can experiment destructively without care" (docs/blueprint.md §423) — and it
-- is why testing belongs in the demo household rather than a real one.
--
-- It refuses rather than damages. If the account has recorded anything, or
-- belongs to a household that is not marked demo, it stops and tells you.
--
-- Run in the SQL editor, then delete the auth user from
-- Authentication → Users. That last step only succeeds once this has run,
-- because user_account.auth_user_id is `on delete restrict` — deleting a login
-- must never quietly delete financial attribution.

do $$
declare
  -- ─── edit this ───────────────────────────────────────────────────────────
  v_email text := 'test@example.com';
  -- ─────────────────────────────────────────────────────────────────────────

  v_account   uuid;
  v_member    uuid;
  v_household uuid;
  v_kind      text;
begin
  select id into v_account
    from public.user_account
   where lower(email) = lower(btrim(v_email));

  if v_account is null then
    raise notice 'No account with email %. Nothing to do.', v_email;
    return;
  end if;

  select ms.member_id, ms.household_id
    into v_member, v_household
    from public.membership ms
   where ms.user_account_id = v_account
     and ms.revoked_at is null
   limit 1;

  -- Guard one: never touch a real household.
  if v_household is not null then
    select kind into v_kind from public.household where id = v_household;
    if v_kind is distinct from 'demo' then
      raise exception
        'That account belongs to a household marked %, not demo. Refusing.', v_kind;
    end if;
  end if;

  -- Guard two: never delete an account that recorded anything. If it did, it
  -- is not a test account, whatever it was called.
  if exists (select 1 from public.expense_txn where created_by = v_account)
     or exists (select 1 from public.valuation_snapshot where created_by = v_account)
     or exists (select 1 from public.invite where created_by = v_account) then
    raise exception
      'That account has recorded data or issued invites. Refusing — archive it instead.';
  end if;

  -- Guard three: the member row must be empty too. A member with expenses or
  -- holdings is household history and is archived, never removed.
  if v_member is not null then
    if exists (select 1 from public.expense_txn where member_id = v_member)
       or exists (select 1 from public.holding where member_id = v_member) then
      raise exception 'That member has expenses or holdings. Refusing — archive instead.';
    end if;
  end if;

  -- In order, because every one of these is `on delete restrict`.
  delete from public.invite     where accepted_by = v_account;
  delete from public.membership where user_account_id = v_account;
  if v_member is not null then
    delete from public.member where id = v_member;
  end if;
  delete from public.user_account where id = v_account;

  raise notice
    'Removed the account for %. Now delete that user in Authentication → Users.', v_email;
end $$;

-- Proof. Both should come back empty.
select id, email from public.user_account where lower(email) = lower('test@example.com');
select id, display_name from public.member
 where id not in (select member_id from public.membership);
