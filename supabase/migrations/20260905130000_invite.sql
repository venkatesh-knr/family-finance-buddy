-- Family Finance Buddy — invites.
--
-- "No public sign-up. Accounts are created only by accepting a single-use,
-- expiring invite." (CLAUDE.md, and docs/blueprint.md §15.)
--
-- An invite here is a short code the owner hands over, not a link in an email.
-- That is a deliberate simplification and not a weaker one: the code is
-- single-use, expires, and only its hash is stored, so a copy of this table
-- yields no working invites. What it avoids is an email round trip and a
-- landing route for a token — machinery worth having when strangers sign up,
-- and not yet worth it for a household whose members are in the same room.
--
-- The functions below are SECURITY DEFINER because acceptance has to write rows
-- the caller could not otherwise write: a member and a membership. Doing that
-- through a policy would mean granting every authenticated user the right to
-- insert a membership and hoping the policy caught the rest, which is exactly
-- the "business rule in a policy" this project refuses. A function is the
-- honest tool — it can check the code, and it is testable.
--
-- They live in `public` rather than `app`, and the split is deliberate:
--
--   app     internals. Called by policies, never by a client. The schema is not
--           exposed through the API, so app.household_role() cannot be invoked
--           over HTTP to enumerate anything.
--   public  the API surface. Anything here is callable by whoever holds the
--           publishable key, so everything here checks its own caller.
--
-- Putting these three in `app` would have been quietly useless: PostgREST
-- exposes `public` and `graphql_public` only, so the client could never have
-- reached them.

-- ================================================================== the table

create table public.invite (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,

  -- The member row acceptance will create. Held here so the owner decides what
  -- the person is called and what colour they get, rather than the invitee
  -- naming themselves into someone else's household.
  display_name  text        not null check (length(btrim(display_name)) between 1 and 80),
  colour        text        not null default 'c1'
                            check (colour in ('c1','c2','c3','c4','c5','c6','c7')),
  role          text        not null
                            check (role in ('owner', 'partner', 'contributor', 'viewer')),

  -- Informational only: who the owner meant it for. Acceptance does not check
  -- it, because the code is the credential and an email column that looked
  -- load-bearing but was not would be worse than one that plainly is not.
  email         text        check (email is null or position('@' in email) > 1),

  -- sha256 of the code, hex. The code itself is returned once, at creation,
  -- and is never stored anywhere.
  code_hash     text        not null check (code_hash ~ '^[0-9a-f]{64}$'),

  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid        references public.user_account (id) on delete restrict,
  revoked_at    timestamptz,

  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint invite_accepted_fields_agree
    check ((accepted_at is null) = (accepted_by is null))
);

comment on table public.invite is
  'Single-use, expiring invitations. Only the hash of the code is stored.';

create unique index invite_code_hash_key on public.invite (code_hash);
create index invite_household_idx on public.invite (household_id, created_at desc);

alter table public.invite enable row level security;
alter table public.invite force row level security;

revoke all on public.invite from public, anon, authenticated;

-- Column-level select: household members may see their invites, but nobody
-- reads code_hash back out. It is a hash rather than a code, so exposing it
-- would not hand over an invite — but there is no reason to publish it either,
-- and a narrower grant costs nothing.
grant select
  (id, household_id, display_name, colour, role, email,
   expires_at, accepted_at, accepted_by, revoked_at, created_by, created_at)
  on public.invite to authenticated;

-- No insert or update grant at all. Both happen inside the functions below,
-- which run as the definer. A client cannot write this table directly.

create trigger invite_touch_updated_at
  before update on public.invite
  for each row execute function app.touch_updated_at();

create policy invite_select_same_household
  on public.invite
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

comment on policy invite_select_same_household on public.invite is
  'Members see their own household''s invites. There is no write policy: the functions do the writing.';

create policy require_second_factor
  on public.invite
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ============================================================ creating one

/**
 * Issue an invite, returning the code exactly once.
 *
 * Owner only. The blueprint puts household administration in the owner role and
 * nothing above it, so the person who can grant access is the person who
 * already has the most of it.
 */
create or replace function public.create_invite(
  target_household_id uuid,
  member_display_name text,
  member_role text,
  member_colour text default 'c1',
  valid_for interval default interval '7 days',
  for_email text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_code text;
  v_account uuid;
begin
  v_account := app.current_account_id();
  if v_account is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if app.household_role(target_household_id) is distinct from 'owner' then
    raise exception 'Only an owner can invite someone to a household.' using errcode = '42501';
  end if;

  if member_role not in ('owner', 'partner', 'contributor', 'viewer') then
    raise exception 'Unknown role: %', member_role using errcode = '22023';
  end if;

  -- Crockford-ish base32 over 10 characters: ~50 bits, which is far beyond
  -- guessing for something that expires in days and dies on first use.
  -- I, L, O and U are absent so nothing can be misread aloud or mistyped.
  select string_agg(
           substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',
                  1 + floor(random() * 32)::int, 1),
           '')
    into v_code
    from generate_series(1, 10);

  insert into public.invite
    (household_id, display_name, colour, role, email, code_hash, expires_at, created_by)
  values
    (target_household_id,
     member_display_name,
     member_colour,
     member_role,
     for_email,
     encode(extensions.digest(v_code, 'sha256'), 'hex'),
     now() + valid_for,
     v_account);

  return v_code;
end;
$fn$;

comment on function public.create_invite(uuid, text, text, text, interval, text) is
  'Owner only. Returns the code once; only its hash is kept.';

revoke all on function public.create_invite(uuid, text, text, text, interval, text) from public;
grant execute on function public.create_invite(uuid, text, text, text, interval, text) to authenticated;

-- ========================================================== accepting one

/**
 * Accept an invite, creating the member and the membership.
 *
 * Everything is checked here rather than trusted from the caller: the code, the
 * expiry, whether it has been used, and whether this account is already in that
 * household. The caller supplies a string and nothing else.
 */
create or replace function public.accept_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_account uuid;
  v_invite  public.invite;
  v_member  uuid;
begin
  v_account := app.current_account_id();
  if v_account is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- Locked, so two devices racing on the same code cannot both win.
  select * into v_invite
    from public.invite
   where code_hash = encode(extensions.digest(upper(btrim(invite_code)), 'sha256'), 'hex')
     for update;

  -- One message for every failure mode below. Distinguishing "no such code"
  -- from "expired" would let someone probe which codes ever existed.
  if v_invite.id is null
     or v_invite.accepted_at is not null
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now() then
    raise exception 'That invite code is not valid. Ask for a new one.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.membership
     where user_account_id = v_account
       and household_id = v_invite.household_id
       and revoked_at is null
  ) then
    raise exception 'You are already a member of that household.' using errcode = '22023';
  end if;

  insert into public.member (household_id, display_name, colour)
  values (v_invite.household_id, v_invite.display_name, v_invite.colour)
  returning id into v_member;

  insert into public.membership (user_account_id, household_id, member_id, role)
  values (v_account, v_invite.household_id, v_member, v_invite.role);

  update public.invite
     set accepted_at = now(),
         accepted_by = v_account
   where id = v_invite.id;

  return v_invite.household_id;
end;
$fn$;

comment on function public.accept_invite(text) is
  'Single use. Creates the member and membership the invite describes, then closes it.';

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;

-- Revoking is an ordinary update the owner should be able to make, but there is
-- no update grant on the table — so it too goes through a function.
create or replace function public.revoke_invite(target_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_household uuid;
begin
  select household_id into v_household from public.invite where id = target_invite_id;

  if v_household is null or app.household_role(v_household) is distinct from 'owner' then
    raise exception 'Only an owner can revoke an invite.' using errcode = '42501';
  end if;

  update public.invite
     set revoked_at = now()
   where id = target_invite_id
     and accepted_at is null
     and revoked_at is null;
end;
$fn$;

revoke all on function public.revoke_invite(uuid) from public;
grant execute on function public.revoke_invite(uuid) to authenticated;
