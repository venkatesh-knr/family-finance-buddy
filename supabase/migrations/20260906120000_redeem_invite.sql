-- Family Finance Buddy — redeeming an invite on behalf of a new account.
--
-- public.accept_invite(code) works for somebody who already has an account: it
-- reads the caller from the JWT. The invite endpoint has no caller — it runs
-- server-side, creates the account, and then has to redeem the invite for an
-- account that did not exist a moment ago.
--
-- Rather than write that logic twice, it moves here once and both paths call
-- it. public.redeem_invite is granted to service_role and to nobody else, so
-- the only way to reach it with an arbitrary account id is to already hold the
-- secret key. public.accept_invite becomes a wrapper that can only ever pass
-- the caller's own account.
--
-- It sits in `public` because that is the only place the API serves from, and
-- the endpoint calls it over the API like anything else. Being visible in the
-- schema is not being reachable: without a grant, anon and authenticated get
-- 42501, which the suite asserts. The grant is the control, not the hiding.

-- Takes the auth user id rather than the account id, so the caller never has to
-- look up user_account. That matters: the invite endpoint would otherwise need
-- a table grant, and the only capability it should hold is "create a user, then
-- redeem a code". Resolving the account here keeps its reach to two functions.
create or replace function public.redeem_invite(invite_code text, for_auth_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_invite  public.invite;
  v_member  uuid;
  account_id uuid;
begin
  if for_auth_user is null then
    raise exception 'No account to redeem for.' using errcode = '42501';
  end if;

  select id into account_id
    from public.user_account
   where auth_user_id = for_auth_user;

  if account_id is null then
    raise exception 'No account to redeem for.' using errcode = '42501';
  end if;

  -- Locked, so two devices racing on one code cannot both win.
  select * into v_invite
    from public.invite
   where code_hash = encode(extensions.digest(upper(btrim(invite_code)), 'sha256'), 'hex')
     for update;

  -- One message for every failure below. Distinguishing "no such code" from
  -- "expired" would let someone probe which codes ever existed — and this is
  -- reachable without an account, so that matters more here than elsewhere.
  if v_invite.id is null
     or v_invite.accepted_at is not null
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() then
    raise exception 'That invite code is not valid. Ask for a new one.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.membership
     where user_account_id = account_id
       and household_id = v_invite.household_id
       and revoked_at is null
  ) then
    raise exception 'You are already a member of that household.' using errcode = '22023';
  end if;

  insert into public.member (household_id, display_name, colour)
  values (v_invite.household_id, v_invite.display_name, v_invite.colour)
  returning id into v_member;

  insert into public.membership (user_account_id, household_id, member_id, role)
  values (account_id, v_invite.household_id, v_member, v_invite.role);

  update public.invite
     set accepted_at = now(),
         accepted_by = account_id
   where id = v_invite.id;

  return v_invite.household_id;
end;
$fn$;

comment on function public.redeem_invite(text, uuid) is
  'The redemption itself. service_role only — it takes the account id on trust, so nothing that cannot already bypass every policy may call it.';

revoke all on function public.redeem_invite(text, uuid) from public;
grant execute on function public.redeem_invite(text, uuid) to service_role;

-- The signed-in path: same logic, but the account can only ever be the caller's.
create or replace function public.accept_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_auth_user uuid;
begin
  v_auth_user := auth.uid();
  if v_auth_user is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- The caller's own identity and nothing else: there is no parameter here that
  -- could name somebody else's account.
  return public.redeem_invite(invite_code, v_auth_user);
end;
$fn$;

comment on function public.accept_invite(text) is
  'Single use. Redeems for the caller''s own account and nobody else''s.';

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;

-- ================================================= looking before leaping

/**
 * Is this code usable? No side effects, no rows touched.
 *
 * The invite endpoint has to create an account before it can redeem anything,
 * which means a bad code would otherwise create an account and then need it
 * cleaned up — and cleanup is exactly the step that fails quietly. Asking first
 * turns the ordinary failure (a wrong or expired code) into one that creates
 * nothing at all, and leaves the delete path for the rare race.
 *
 * service_role only. It answers a question the endpoint already answers by
 * other means, so it reveals nothing new — but there is no reason for anyone
 * else to be able to ask it directly.
 */
create or replace function public.invite_is_open(invite_code text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.invite
     where code_hash = encode(extensions.digest(upper(btrim(invite_code)), 'sha256'), 'hex')
       and accepted_at is null
       and revoked_at is null
       and expires_at > now()
  )
$fn$;

revoke all on function public.invite_is_open(text) from public;
grant execute on function public.invite_is_open(text) to service_role;
