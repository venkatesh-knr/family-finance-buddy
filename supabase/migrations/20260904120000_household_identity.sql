-- Family Finance Buddy — identity and household.
--
-- Creates the four tables that answer "who is asking, and which household are
-- they asking about": household, member, user_account, membership.
--
-- Row-level security is enabled here, and NO policy is created in this file.
-- That is deliberate: until the policies migration lands, every one of these
-- tables returns zero rows to every client. Deny by default is the correct
-- state for a table whose policies have not been written yet.
--
-- Privileges are granted explicitly rather than relying on the project's
-- default privileges, so this migration does the right thing on a self-hosted
-- instance or a different provider.

create schema if not exists app;
comment on schema app is
  'Server-side helpers and triggers. Never exposed to the API; no table lives here.';

revoke all on schema app from public;

-- The API roles need the public schema itself, but nothing in it by default.
grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------- utilities

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------- household

create table public.household (
  id                uuid        primary key default gen_random_uuid(),
  name              text        not null check (length(btrim(name)) between 1 and 120),
  kind              text        not null default 'real' check (kind in ('real', 'demo')),
  base_currency     text        not null default 'INR' check (base_currency ~ '^[A-Z]{3}$'),
  display_currency  text        not null default 'INR' check (display_currency ~ '^[A-Z]{3}$'),
  fy_start_month    smallint    not null default 4 check (fy_start_month between 1 and 12),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.household is
  'A household is the unit of ownership. Nothing is ever aggregated across households.';
comment on column public.household.base_currency is
  'Currency figures are normalised to on read. The native currency stays on the row.';
comment on column public.household.fy_start_month is
  'The Indian tax year starts in April. Period boundaries are evaluated in Asia/Kolkata.';

create trigger household_touch_updated_at
  before update on public.household
  for each row execute function app.touch_updated_at();

alter table public.household enable row level security;
alter table public.household force row level security;

revoke all on table public.household from public, anon, authenticated;
grant select on table public.household to authenticated;

-- ------------------------------------------------------------------- member

create table public.member (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,
  display_name  text        not null check (length(btrim(display_name)) between 1 and 80),
  relation      text,
  is_dependent  boolean     not null default false,
  colour        text        not null default 'c1'
                            check (colour in ('c1','c2','c3','c4','c5','c6','c7')),
  status        text        not null default 'active' check (status in ('active', 'archived')),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint member_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null)),
  -- Lets dependent tables carry a composite foreign key and so guarantee that a
  -- row's member and its household agree. See expense_txn.
  constraint member_household_id_id_key unique (household_id, id)
);

comment on table public.member is
  'A person in the household. Archived, never deleted: their history is the household arithmetic.';
comment on column public.member.colour is
  'A categorical token name from docs/tokens.md, never a literal, so charts resolve it per theme.';

create index member_household_id_idx on public.member (household_id) where status = 'active';

create trigger member_touch_updated_at
  before update on public.member
  for each row execute function app.touch_updated_at();

alter table public.member enable row level security;
alter table public.member force row level security;

revoke all on table public.member from public, anon, authenticated;
grant select on table public.member to authenticated;

-- ------------------------------------------------------------- user_account

create table public.user_account (
  id            uuid        primary key default gen_random_uuid(),
  auth_user_id  uuid        not null unique references auth.users (id) on delete restrict,
  email         text        not null check (position('@' in email) > 1),
  mfa_enrolled  boolean     not null default false,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.user_account is
  'An identity. Deliberately holds no household of its own — see membership.';
comment on column public.user_account.auth_user_id is
  'on delete restrict, not cascade: deleting a login must not silently delete financial attribution. '
  'Erasure removes identifiers and reattributes rows, which is a separate deliberate operation.';

create unique index user_account_email_key on public.user_account (lower(email));

create trigger user_account_touch_updated_at
  before update on public.user_account
  for each row execute function app.touch_updated_at();

alter table public.user_account enable row level security;
alter table public.user_account force row level security;

revoke all on table public.user_account from public, anon, authenticated;
grant select on table public.user_account to authenticated;
-- A signed-in person may record their own MFA enrolment and last-seen stamp and
-- nothing else. A column grant makes that structural rather than a policy detail.
grant update (mfa_enrolled, last_seen_at) on table public.user_account to authenticated;

-- Sign-up is invite-only and disabled in auth config. This trigger only mirrors
-- an identity Supabase Auth has already created into our own table; it grants
-- no access on its own, because access comes from a membership row.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.user_account (auth_user_id, email)
  values (new.id, new.email)
  on conflict (auth_user_id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- --------------------------------------------------------------- membership

create table public.membership (
  id               uuid        primary key default gen_random_uuid(),
  user_account_id  uuid        not null references public.user_account (id) on delete restrict,
  household_id     uuid        not null references public.household (id) on delete restrict,
  member_id        uuid        not null,
  role             text        not null
                               check (role in ('owner', 'partner', 'contributor', 'viewer')),
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- The member must belong to the household this membership grants access to.
  constraint membership_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict
);

comment on table public.membership is
  'The join that lets one person belong to several households. Every policy resolves through it.';
comment on column public.membership.revoked_at is
  'Revoking access is separate from archiving a member: a person can lose their login while their history stays valid.';

create unique index membership_one_live_per_household
  on public.membership (user_account_id, household_id)
  where revoked_at is null;

create index membership_household_id_idx
  on public.membership (household_id)
  where revoked_at is null;

create trigger membership_touch_updated_at
  before update on public.membership
  for each row execute function app.touch_updated_at();

alter table public.membership enable row level security;
alter table public.membership force row level security;

revoke all on table public.membership from public, anon, authenticated;
grant select on table public.membership to authenticated;
