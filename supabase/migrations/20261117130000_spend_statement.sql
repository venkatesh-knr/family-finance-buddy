-- Family Finance Buddy — a stated spend
-- (docs/design/spending-capture.md section 11, SC-I14 to SC-I19; the owner's request of 17 November 2026).
--
-- FOR REVIEW. Not applied to the live database. CI's policy suite applies it to a fresh database and runs supabase/tests/spend_statement.test.sql against
-- it; Docker is blocked on the maintainer's machine, so CI is the only place it runs. This file is the schema and its access rules and nothing else: no
-- screen, no repository code and no calculation. Which source a month's spent comes from is a pure domain function (the next slice), and nothing here
-- derives or stores a month's spent.
--
--   spend_statement   one person's stated total of what the household spent on living in a month that has ended, in one currency. A person's word, not a
--                     balance and not a derived figure. Voided and stated again, never edited.
--
-- ── what it holds ────────────────────────────────────────────────────────────
--
--   month          the first day of the month it is about (checked); the month is IST.
--   currency       the currency spent in; one live statement per household, month and currency.
--   amount_minor   integer minor units, more than nothing. A month with no spend is not stated.
--   note           optional, up to 500 characters.
--   voided_at/by   as a pair. A voided statement stays, and a new one can be made for the month.
--
-- ── access ────────────────────────────────────────────────────────────────────
--
-- An owner or a partner reads and writes it. A contributor and a viewer read nothing and write nothing: a household total is not theirs to read, as the
-- month close is not (spending-capture.md section 9, decision 5). Another household reads nothing. There is no delete grant. `detail_level` is not in
-- this: it is a rendering preference, and this is access.
--
-- ── what the table refuses, beyond access ─────────────────────────────────────
--
--   a month that is not a first of a month; an amount that is not more than nothing; a currency that is not three capitals;
--   a second live statement for the same household, month and currency (partial unique index);
--   a statement for a month that has not ended in India (a before-insert trigger, against the time of the write: the one place the database reads a clock,
--     because a write is the moment the month must already be over; the app passes its own date to its own checks);
--   any update that changes more than the note and the void pair, and any update of a statement already voided (a before-update trigger), so a statement
--     is voided and stated again and never edited, and the audit log and the figures that relied on it agree.
--
-- The audit trigger is in this migration, as for every table that holds household data. reset_demo_household is re-created with the table cleared; the
-- export list names it (TypeScript, in the same change as this file).

-- ═══════════════════════════════════════════════ 1. the table

create table public.spend_statement (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,

  -- The first day of the month, in IST. Checked, so a statement is about a whole month and never a day in one.
  month         date        not null check (month = date_trunc('month', month)::date),
  currency      text        not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor  bigint      not null check (amount_minor > 0),

  note          text        check (note is null or length(note) <= 500),
  voided_at     timestamptz,
  voided_by     uuid        references public.user_account (id) on delete restrict,

  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint spend_statement_voided_pair check ((voided_at is null) = (voided_by is null))
);

comment on table public.spend_statement is
  'A person''s stated total of what the household spent on living in one ended month and currency (spending-capture.md section 11). Not derived, not a balance. Voided and stated again, never edited. Owner and partner only.';
comment on column public.spend_statement.month is
  'The first day of the month it is about, in IST.';
comment on column public.spend_statement.amount_minor is
  'Living costs only: not money put into holdings, not loan payments, not moves between the household''s own accounts (SC-I4). Integer minor units of `currency`.';

-- At most one live statement for a household, month and currency (SC-I14). A voided one does not count, so a month can be stated again.
create unique index spend_statement_one_live
  on public.spend_statement (household_id, month, currency)
  where voided_at is null;

create index spend_statement_household_month_idx on public.spend_statement (household_id, month desc);

-- ═══════════════════════════════════════════════ 2. what the table refuses, beyond access

-- A statement is about a month that has ended in India. The check is against the time of the write; it is refused for the month in progress and any later one.
create function app.spend_statement_month_has_ended()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.month >= date_trunc('month', now() at time zone 'Asia/Kolkata')::date then
    raise exception 'A spend can be stated only for a month that has ended.'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

revoke all on function app.spend_statement_month_has_ended() from public;

create trigger spend_statement_month_has_ended
  before insert on public.spend_statement
  for each row execute function app.spend_statement_month_has_ended();

-- A statement is voided and stated again, never edited (SC-I14): only the note and the void pair may change, a void cannot be taken back, and a voided
-- statement changes no more.
create function app.spend_statement_not_edited()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if old.voided_at is not null then
    raise exception 'A voided statement is not changed.' using errcode = '23514';
  end if;
  if new.id is distinct from old.id
     or new.household_id is distinct from old.household_id
     or new.month is distinct from old.month
     or new.currency is distinct from old.currency
     or new.amount_minor is distinct from old.amount_minor
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A stated spend is voided and stated again, not edited.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

revoke all on function app.spend_statement_not_edited() from public;

create trigger spend_statement_not_edited
  before update on public.spend_statement
  for each row execute function app.spend_statement_not_edited();

create trigger spend_statement_touch_updated_at
  before update on public.spend_statement
  for each row execute function app.touch_updated_at();

create trigger spend_statement_audit
  after insert or update or delete on public.spend_statement
  for each row execute function app.write_audit();

-- ═══════════════════════════════════════════════ 3. row-level security, deny by default

alter table public.spend_statement enable row level security;
alter table public.spend_statement force row level security;

revoke all on public.spend_statement from public, anon, authenticated;
grant select, insert, update on public.spend_statement to authenticated;

create policy spend_statement_select
  on public.spend_statement
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and app.household_role(household_id) in ('owner', 'partner')
  );

create policy spend_statement_insert
  on public.spend_statement
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
  );

-- The void. What else an update may change is the before-update trigger's to refuse, not a policy's: a policy does access.
create policy spend_statement_update
  on public.spend_statement
  for update
  to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));

create policy require_second_factor
  on public.spend_statement
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

comment on policy spend_statement_select on public.spend_statement is
  'Owner and partner read the household''s stated spends. A contributor, a viewer and another household read none.';
comment on policy spend_statement_insert on public.spend_statement is
  'Owner and partner state a spend, under their own name.';

-- ═══════════════════════════════════════════════ 4. reset_demo_household

-- Re-created from 20261116120000 with the new table cleared. The function raises at run time if a household table is left uncleared, which CI exercises
-- only where a seeded household holds a row of it, so the table is named here.

create or replace function public.reset_demo_household(target_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_kind    text;
  v_account uuid;
  v_table   text;
  v_left    boolean;
begin
  if not app.has_second_factor() then
    raise exception 'Resetting needs an authenticator code in this session, not only a password.'
      using errcode = '42501';
  end if;

  -- One message whether the household is somebody else's or does not exist,
  -- so a probe learns nothing about ids that are not the caller's.
  if app.household_role(target_household_id) is distinct from 'owner' then
    raise exception 'Only an owner can reset a demo household.' using errcode = '42501';
  end if;

  -- Locked, so two resets at once run one after the other rather than
  -- interleaving deletes and inserts into a state neither of them meant.
  select h.kind into v_kind
    from public.household h
   where h.id = target_household_id
     for update;

  if v_kind is distinct from 'demo' then
    raise exception 'This household is not marked demo, and only a demo household can be reset. Nothing was changed.'
      using errcode = '22023';
  end if;

  v_account := app.current_account_id();

  -- ── the wipe, children before parents ─────────────────────────────────
  --
  -- Every foreign key here is `on delete restrict`, deliberately, so the order
  -- is forced and a mistake in it fails loudly rather than cascading.

    -- Deposits and bonds hang off a holding by a restricting foreign key, so they go first. The earlier
  -- definition of this function predates them, which left a demo household that held a deposit or a
  -- bond unable to be reset at all: the delete of its holdings was refused and the whole reset rolled
  -- back. The rating log is append-only for everybody who can sign in; a reset is not one of them, and
  -- the audit trail of those rows stays where it is.
  -- A PPF's account and entries hang off its holding by a restricting foreign key, so they go with the deposits and
  -- bonds, before the holdings. The rate table has no household and is not touched.
  delete from public.ppf_entry           where household_id = target_household_id;
  delete from public.ppf_account         where household_id = target_household_id;
  delete from public.bond_rating_change  where household_id = target_household_id;
  delete from public.deposit_renewal     where household_id = target_household_id;
  delete from public.fixed_income_terms  where household_id = target_household_id;

  -- A property's valuations and improvements hang off it, and it can cite a loan, so all three go before
  -- the liabilities they point at. Nothing cites a property.
  delete from public.property_valuation   where household_id = target_household_id;
  delete from public.property_improvement where household_id = target_household_id;
  delete from public.property             where household_id = target_household_id;

  -- A policy can cite a holding (a ULIP's surrender value) by a restricting foreign key, so the policies
  -- go before the holdings they point at.
  delete from public.insurance_policy   where household_id = target_household_id;

  delete from public.valuation_snapshot where household_id = target_household_id;
  delete from public.lot                where household_id = target_household_id;
  delete from public.disposal           where household_id = target_household_id;
  delete from public.holding            where household_id = target_household_id;
  delete from public.instrument         where household_id = target_household_id;

  delete from public.expense_txn        where household_id = target_household_id;
  delete from public.credit_entry       where household_id = target_household_id;
  -- A loan payment cites a loan and, when it names one, an account by restricting foreign keys, so it goes before both.
  delete from public.loan_payment       where household_id = target_household_id;
  delete from public.spend_statement    where household_id = target_household_id;
  delete from public.account_transfer   where household_id = target_household_id;
  delete from public.account_balance    where household_id = target_household_id;
  -- A rule's entries cite it by a restricting foreign key, so the rules go once the entries have.
  delete from public.recurring_rule     where household_id = target_household_id;
  delete from public.account            where household_id = target_household_id;
  delete from public.income_entry       where household_id = target_household_id;
  delete from public.budget             where household_id = target_household_id;
  delete from public.expense_category   where household_id = target_household_id;

  delete from public.liability          where household_id = target_household_id;
  delete from public.fx_rate            where household_id = target_household_id;
  delete from public.gold_rate          where household_id = target_household_id;

  -- After the rows that cite it. An import is the record of a file somebody
  -- imported into this household, and a sandbox emptied of everything that
  -- file wrote has no use for the record of having written it.
  -- An upload's ledger and its references point at the batch by a restricting foreign key, so they go before it. The ledger holds
  -- the images of rows this wipe has just removed, and has no use after it.
  delete from public.import_batch_row   where household_id = target_household_id;
  delete from public.import_ref         where household_id = target_household_id;
  delete from public.import_batch       where household_id = target_household_id;

  -- Members nobody signs in as — the seed's Meera and Priya, and anyone added
  -- by hand. A member with a membership, live or revoked, is a person with a
  -- login and stays: the membership's own foreign key would refuse otherwise.
  delete from public.member m
   where m.household_id = target_household_id
     and not exists (select 1 from public.membership ms where ms.member_id = m.id);

  update public.household
     set fire_multiplier                = default,
         fire_inflation_pct             = default,
         fire_years_ahead               = default,
         fire_return_pct                = default,
         fire_step_up_pct               = default,
         fire_monthly_contribution_minor = default,
         cover_dependency_years         = default,
         property_valuation_stale_months = default
   where id = target_household_id;

  -- ── the guard against the next table ──────────────────────────────────
  --
  -- The list above is complete today. The day somebody adds a household table
  -- and forgets this function, a reset would quietly leave that table's rows
  -- behind, and "a known state" would stop being true without anything saying
  -- so. So: every table in public carrying a household_id, other than the ones
  -- kept on purpose, must now be empty for this household — or the whole
  -- reset is rolled back and names the table it does not know about.
  --
  -- It has now done that once, for `import_batch`, which is this migration.
  for v_table in
    select c.relname
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c     on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and a.attname = 'household_id'
       and not a.attisdropped
       and c.relname not in ('member', 'membership', 'invite', 'audit_log')
  loop
    execute format('select exists (select 1 from public.%I where household_id = $1)', v_table)
       into v_left
      using target_household_id;

    if v_left then
      raise exception 'Reset does not know how to clear %. Add it to public.reset_demo_household. Nothing was changed.', v_table;
    end if;
  end loop;

  -- ── and the seed again ────────────────────────────────────────────────
  perform app.seed_demo_household(target_household_id, v_account);
end;
$fn$;

comment on function public.reset_demo_household(uuid) is
  'Owner only, second factor required, demo households only. Hard-deletes the household''s data — imports included, never its members with logins, memberships, invites or audit history — and reseeds it.';

revoke all on function public.reset_demo_household(uuid) from public;
grant execute on function public.reset_demo_household(uuid) to authenticated;
