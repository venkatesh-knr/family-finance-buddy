-- Family Finance Buddy — the audit log, and the trigger every table wears.
--
-- First migration in the chain, deliberately. "Every table holding household
-- data gets its audit trigger in the same migration that creates the table —
-- never in a later one" (CLAUDE.md), which is only possible if the log and its
-- trigger already exist when the first table is created.
--
-- It depends on nothing but `auth`. The actor is auth.uid() rather than a
-- user_account id, because user_account is created in the migration after this
-- one and a trigger that needed it could not be attached to it. Resolving an
-- actor to a name is a read-time join, which is the right place for it.
--
-- Two things this table is not:
--
--   It is not a change feed. It records what a row was and became, so a
--   mistaken edit can be seen and undone — "the losing version goes to the
--   audit log" is an invariant this schema could not honour until now.
--
--   It is not a way around the visibility rules. A personal entry's before and
--   after would otherwise sit here in plain sight, and the household owner
--   would read in the log exactly what the policy stopped them reading in the
--   table. So every audit row carries the member and visibility of the row it
--   describes, and its own policy applies the same test. An audit log that
--   leaks is worse than none, because it leaks while looking like accountability.

create table public.audit_log (
  id            bigint      generated always as identity primary key,

  -- Which household the change belongs to. Null only for rows that belong to
  -- no household — an identity row, say — which are still worth recording.
  household_id  uuid,

  -- The authenticated identity that made the change, as auth.uid(). Null for a
  -- scheduled job or a migration, which is a meaningful value rather than a
  -- missing one: "nobody did this, the system did".
  actor         uuid,

  entity        text        not null,
  entity_id     uuid,

  -- 'read' is in the check constraint and nothing writes it yet. Postgres
  -- triggers do not fire on select, so recording reads needs every read to go
  -- through a definer function — the same change section 20 forces for
  -- household totals, and a decision to take with that one rather than before.
  action        text        not null check (action in ('insert', 'update', 'delete', 'read')),

  before        jsonb,
  after         jsonb,

  -- Copied from the row being changed, so this table can apply the same
  -- visibility test as the table it shadows. Null member means the row was not
  -- attributed to one.
  member_id     uuid,
  visibility    text        not null default 'household'
                            check (visibility in ('household', 'personal')),

  at            timestamptz not null default now(),
  ip_hash       text
);

comment on table public.audit_log is
  'Append-only. Written by trigger, readable under the same visibility rule as the row it describes, updatable and deletable by nobody.';

create index audit_log_household_at_idx on public.audit_log (household_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor, at desc);

alter table public.audit_log enable row level security;

-- Enabled, but deliberately NOT forced, and this is the one table where that
-- is right. Every other table forces it so that even the owner reads through
-- policies. Here the owner is the only writer: app.write_audit() runs as its
-- definer, and with FORCE and no insert policy that insert would be refused —
-- taking every write in the application down with it, on any instance whose
-- migration role lacks BYPASSRLS. Relying on that attribute would make these
-- migrations true on Supabase and false on a self-hosted Postgres.
--
-- Nothing is loosened by it. No client ever connects as the owner, and the
-- grants below leave every client role with no privilege at all until the
-- select policy arrives with the membership helpers it needs.

-- Deny by default and stay that way. No insert grant: the trigger writes as
-- its definer. No update or delete grant to anyone, ever — that is the whole
-- meaning of append-only, and a policy would be a weaker statement than an
-- absent privilege.
revoke all on public.audit_log from public, anon, authenticated;

-- ============================================================ the trigger

create schema if not exists app;

/**
 * Record one change.
 *
 * Written once, attached everywhere. It reads the row as jsonb rather than by
 * column, so one function serves every table whatever its shape — a per-table
 * function would be thirteen places to forget something.
 *
 * It records the visibility a row states about itself and nothing more. A
 * table whose privacy is inherited rather than stated — valuation_snapshot is
 * as private as the holding it values — is handled by the audit_log select
 * policy, which resolves the parent as the caller and so gets the answer the
 * caller's own policies would give. Resolving it here instead would mean
 * reading a forced-RLS table as its owner, which returns nothing.
 */
create or replace function app.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_before     jsonb;
  v_after      jsonb;
  v_row        jsonb;
  v_household  uuid;
  v_entity_id  uuid;
  v_member     uuid;
  v_visibility text;
begin
  v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after  := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row    := coalesce(v_after, v_before);

  -- The household table is its own household; everything else names one.
  v_household := nullif(
    coalesce(v_row ->> 'household_id',
             case when tg_table_name = 'household' then v_row ->> 'id' end),
    ''
  )::uuid;

  v_entity_id := nullif(v_row ->> 'id', '')::uuid;
  v_member := nullif(v_row ->> 'member_id', '')::uuid;

  -- The stricter of the two sides. Flipping an entry from personal to
  -- household would otherwise leave an audit row carrying the old, private
  -- values under the new, shared visibility.
  v_visibility := case
    when coalesce(v_before ->> 'visibility', 'household') = 'personal'
      or coalesce(v_after  ->> 'visibility', 'household') = 'personal'
    then 'personal'
    else 'household'
  end;

  insert into public.audit_log
    (household_id, actor, entity, entity_id, action, before, after, member_id, visibility)
  values
    (v_household, auth.uid(), tg_table_name, v_entity_id, lower(tg_op),
     v_before, v_after, v_member, v_visibility);

  -- After-triggers ignore the return value; returning the row keeps this
  -- function usable as a before-trigger too, should that ever be wanted.
  return coalesce(new, old);
end;
$fn$;

comment on function app.write_audit() is
  'Attached after insert, update and delete on every table holding household data. Reads the row as jsonb so one function serves them all.';

revoke all on function app.write_audit() from public;
