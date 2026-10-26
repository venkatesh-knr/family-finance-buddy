-- Family Finance Buddy — retirement: EPF, NPS and PPF, as one kind.
--
-- docs/decisions.md: "Retirement is a kind (EPF, NPS and PPF). PPF moving out of the deposit schemes is a migration that
-- step makes." docs/blueprint.md section 10: "EPF: manual from the passbook. PPF: contributions via a recurring rule; the
-- balance is computed from the notified rate and the lowest-balance-of-the-month convention. NPS: units from your
-- statement; NAV automatic."
--
-- Decided by the maintainer (27 October 2026), on the recommendations in docs/reviews/2026-10-27-retirement/proposal.md:
--
--   1  One kind, `retirement`, with a `retirement_type` of epf, nps or ppf, so the allocation has one Retirement row.
--   2  A PPF is computed from its entries and the notified rate (`src/domain/ppf.ts`), reconciled against the passbook.
--   3  The notified rate is a public table, `scheme_rate`, seeded with 7.1% from 1 April 2020 and changed by a migration.
--   4  An existing PPF deposit is converted, below.
--   5  Retirement has a hue of its own (a token, in code, not here).
--   6  An NPS NAV is typed with the units for now, a reading with a quantity. No table.
--   7  An EPF is a passbook balance typed as a reading. No estimate between checks, and no table.
--   8  A retirement holding is never liquid (code, not here).
--
-- So only a PPF needs tables: an account (who, where, and the balance it opened from) and its entries (what was paid in
-- or taken out). An EPF and an NPS are readings on the holding, as a fund is.
--
-- ── what hangs off what ──────────────────────────────────────────────────────────────────────────────────────
--
--   ppf_account   one per PPF holding: the institution, the last four of the account, and the opening balance and the
--                 day it is as at. The opening balance should be as at a 31 March credit, or the day the account opened.
--   ppf_entry     a payment in (positive) or a withdrawal (negative), dated. Voided, never deleted.
--   scheme_rate   the rate the government notified for a scheme, by the day it took effect. Public reference data, appended
--                 and never updated, readable by everyone signed in and written by migration only, as `tax_rule` is.
--
-- The account and its entries are as private as the holding they hang off: the holding's own policy decides, asked as the
-- caller, so an owner does not read a partner's personal PPF and there is no second rule here to drift out of step with it.
-- Their audit rows follow the holding by the `holding_id` rule already in the audit policy.
--
-- ── the conversion ───────────────────────────────────────────────────────────────────────────────────────────
--
-- A deposit whose scheme is `ppf` becomes a retirement holding of type `ppf`. Its latest reading becomes the opening
-- balance at that reading's date, and its institution and last four digits come across. Its terms and renewals are
-- DELETED, not left unused: a deposit's terms are worked out into a value and, once past maturity, into a payout that
-- takes the holding out of every total, and a PPF must not meet either. The audit log keeps the rows as they were
-- (the audit trigger records each delete), and so do the readings, which are untouched. A migration is the only thing that
-- can delete them; no client has a delete grant.
--
-- Must be applied after 20261026120000_property.sql, whose reset function this replaces.

-- ───────────────────────────────────────────── the kind, and what it is

alter table public.instrument
  drop constraint instrument_kind_check,
  add constraint instrument_kind_check
    check (kind in ('equity', 'etf', 'mutual_fund', 'bond', 'deposit', 'other', 'retirement'));

alter table public.instrument
  add column retirement_type text
    check (retirement_type in ('epf', 'nps', 'ppf')),
  add constraint instrument_retirement_type_matches_kind
    check ((kind = 'retirement') = (retirement_type is not null));

comment on column public.instrument.retirement_type is
  'What a retirement holding is: an EPF, an NPS or a PPF. Required when kind is retirement and null otherwise, as a deposit''s scheme is.';

-- ───────────────────────────────────────────── a PPF's account and its entries

create table public.ppf_account (
  holding_id             uuid        primary key,
  household_id           uuid        not null references public.household (id) on delete restrict,

  -- Which bank or post office, for a person; and the last four characters of the account, which is all this app ever keeps
  -- of an identifier.
  institution            text        check (institution is null or length(btrim(institution)) between 1 and 80),
  account_last4          text        check (account_last4 is null or account_last4 ~ '^[0-9A-Za-z]{4}$'),

  -- The balance the account is worked out from, and the day it is as at. As at a 31 March credit, or the day it opened: a
  -- balance on any other day leaves out interest accrued since the last credit, which only the bank knows.
  opening_date           date        not null,
  opening_balance_minor  bigint      not null check (opening_balance_minor >= 0),
  currency               text        not null check (currency ~ '^[A-Z]{3}$'),

  note                   text        check (note is null or length(note) <= 500),
  created_by             uuid        not null default app.current_account_id()
                                     references public.user_account (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint ppf_account_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict
);

comment on table public.ppf_account is
  'The account of a PPF holding: where it is and the balance it opened from. The balance now is worked out from this, the entries and the notified rate by src/domain/ppf.ts, and never stored.';

create table public.ppf_entry (
  id             uuid        primary key default gen_random_uuid(),
  household_id   uuid        not null references public.household (id) on delete restrict,
  holding_id     uuid        not null,

  entry_date     date        not null,
  -- A payment in is positive and a withdrawal is negative. Never nothing.
  amount_minor   bigint      not null check (amount_minor <> 0),
  currency       text        not null check (currency ~ '^[A-Z]{3}$'),

  note           text        check (note is null or length(note) <= 500),
  -- Voided, never deleted: its history is the household's arithmetic.
  voided_at      timestamptz,

  created_by     uuid        not null default app.current_account_id()
                             references public.user_account (id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ppf_entry_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict
);

comment on table public.ppf_entry is
  'A payment into a PPF, or a withdrawal out of it as a negative amount. Hangs off the holding and is as private as it is.';

create index ppf_entry_holding_idx on public.ppf_entry (holding_id, entry_date);

-- An account and its entries belong to a PPF holding and to nothing else. Table integrity and not a policy: a PPF account
-- hung off a fund would be computed into nothing and read by nothing.
create function app.require_ppf_holding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1
      from public.holding h
      join public.instrument i on i.id = h.instrument_id
     where h.id = new.holding_id
       and i.kind = 'retirement'
       and i.retirement_type = 'ppf'
  ) then
    raise exception 'A PPF account and its entries belong to a PPF holding.' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

revoke all on function app.require_ppf_holding() from public;

-- ───────────────────────────────────────────── the notified rate

create table public.scheme_rate (
  id              uuid          primary key default gen_random_uuid(),
  -- Only a PPF's rate is notified quarterly and needed here; SSY, NSC and KVP follow when they are computed.
  scheme          text          not null check (scheme in ('ppf')),
  -- The first day the rate applies. The government notifies by quarter, so this is the first day of one.
  effective_from  date          not null,
  -- A percentage a year to three places, as in tax_rule: it reaches the application as text, "7.100".
  rate_pct        numeric(6, 3) not null check (rate_pct >= 0 and rate_pct <= 100),
  created_at      timestamptz   not null default now(),

  constraint scheme_rate_one_per_day unique (scheme, effective_from)
);

comment on table public.scheme_rate is
  'The rate the government notified for a small-savings scheme, by the day it took effect. The same for every household and belonging to none: readable by anyone signed in, written by migration only. A change is a row appended, never an update.';

-- Seeded with what is believed to be in force: 7.1% from the first quarter of 2020-21, unchanged since. NOT VERIFIED against
-- a current notification or a passbook: check it against a real PPF statement before it is relied on.
insert into public.scheme_rate (scheme, effective_from, rate_pct)
values ('ppf', date '2020-04-01', 7.100);

-- ───────────────────────────────────────────── access

alter table public.ppf_account  enable row level security;
alter table public.ppf_account  force row level security;
alter table public.ppf_entry    enable row level security;
alter table public.ppf_entry    force row level security;
alter table public.scheme_rate  enable row level security;

revoke all on public.ppf_account from public, anon, authenticated;
revoke all on public.ppf_entry   from public, anon, authenticated;
revoke all on public.scheme_rate from public, anon, authenticated;
grant select, insert, update on public.ppf_account to authenticated;
grant select, insert, update on public.ppf_entry   to authenticated;
-- The rates are read and never written by a client: a household that could edit the rate could compute the figure it liked.
grant select on public.scheme_rate to authenticated;

-- As private as the holding, decided by the holding's own policy: the subquery runs as the caller, so an owner does not read
-- a partner's personal PPF and a contributor reads only their own, with no rule here to drift out of step with it.

create policy ppf_account_select
  on public.ppf_account
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.holding h where h.id = ppf_account.holding_id)
  );

create policy ppf_entry_select
  on public.ppf_entry
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.holding h where h.id = ppf_entry.holding_id)
  );

create policy ppf_account_insert
  on public.ppf_account
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = ppf_account.holding_id)
  );

create policy ppf_entry_insert
  on public.ppf_entry
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = ppf_entry.holding_id)
  );

create policy ppf_account_update
  on public.ppf_account
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = ppf_account.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = ppf_account.holding_id)
  );

create policy ppf_entry_update
  on public.ppf_entry
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = ppf_entry.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = ppf_entry.holding_id)
  );

create policy scheme_rate_readable
  on public.scheme_rate
  for select
  to authenticated
  using (true);

comment on policy ppf_account_select on public.ppf_account is
  'Exactly as private as the holding, decided by the holding''s own policy.';
comment on policy ppf_entry_select on public.ppf_entry is
  'Exactly as private as the holding, decided by the holding''s own policy.';
comment on policy scheme_rate_readable on public.scheme_rate is
  'A notified rate is the same for every household. Readable by any member; writable by no client.';

-- A password alone is not enough: the publishable key ships in the bundle.
create policy require_second_factor
  on public.ppf_account
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.ppf_entry
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.scheme_rate
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor());

-- ───────────────────────────────────────────── audit and integrity
--
-- In the same migration that creates the tables, per the invariant. scheme_rate holds no household data and has no audit
-- trigger, as tax_rule has none: its history is the migration history.

create trigger ppf_account_requires_ppf
  before insert or update of holding_id on public.ppf_account
  for each row execute function app.require_ppf_holding();

create trigger ppf_entry_requires_ppf
  before insert or update of holding_id on public.ppf_entry
  for each row execute function app.require_ppf_holding();

create trigger ppf_account_touch_updated_at
  before update on public.ppf_account
  for each row execute function app.touch_updated_at();

create trigger ppf_account_audit
  after insert or update or delete on public.ppf_account
  for each row execute function app.write_audit();

create trigger ppf_entry_touch_updated_at
  before update on public.ppf_entry
  for each row execute function app.touch_updated_at();

create trigger ppf_entry_audit
  after insert or update or delete on public.ppf_entry
  for each row execute function app.write_audit();

-- ───────────────────────────────────────────── the conversion of any PPF deposit

create temporary table ppf_conversion on commit drop as
select h.id                  as holding_id,
       h.household_id        as household_id,
       i.id                  as instrument_id,
       i.currency            as currency,
       t.institution         as institution,
       t.account_last4       as account_last4,
       coalesce(
         t.created_by,
         (select m.user_account_id
            from public.membership m
           where m.household_id = h.household_id and m.role = 'owner' and m.revoked_at is null
           order by m.created_at
           limit 1)
       )                     as created_by,
       v.as_of_date          as opening_date,
       v.value_minor         as opening_balance_minor
  from public.instrument i
  join public.holding h on h.instrument_id = i.id
  left join public.fixed_income_terms t on t.holding_id = h.id
  left join lateral (
    select s.as_of_date, s.value_minor
      from public.valuation_snapshot s
     where s.holding_id = h.id
     order by s.as_of_date desc
     limit 1
  ) v on true
 where i.kind = 'deposit' and i.scheme = 'ppf';

-- The terms and the renewals first: they cite the holding, not the instrument, and the audit trigger keeps each row.
delete from public.deposit_renewal
 where holding_id in (select holding_id from ppf_conversion);
delete from public.fixed_income_terms
 where holding_id in (select holding_id from ppf_conversion);

update public.instrument
   set kind = 'retirement', retirement_type = 'ppf', scheme = null
 where id in (select instrument_id from ppf_conversion);

-- An account only where there was a reading to open it from. A converted PPF with none has no opening balance to give, and is
-- left to be given one: it reads as not valued, which is what it was.
insert into public.ppf_account
  (holding_id, household_id, institution, account_last4, opening_date, opening_balance_minor, currency, created_by)
select holding_id, household_id, institution, account_last4, opening_date, opening_balance_minor, currency, created_by
  from ppf_conversion
 where opening_date is not null and created_by is not null;

-- ...and the scheme list no longer has `ppf`: a PPF is not a deposit.
alter table public.instrument
  drop constraint instrument_scheme_check,
  add constraint instrument_scheme_check
    check (scheme in ('fd', 'rd', 'ssy', 'nsc', 'kvp', 'scss', 'pomis', 'po_td', 'other'));

-- The migration refuses to leave a half-done conversion.
do $check$
begin
  if exists (select 1 from public.instrument where kind = 'deposit' and scheme = 'ppf') then
    raise exception 'A PPF deposit was left unconverted.';
  end if;
  if exists (
    select 1
      from ppf_conversion c
      join public.instrument i on i.id = c.instrument_id
     where i.kind <> 'retirement' or i.retirement_type is distinct from 'ppf'
  ) then
    raise exception 'A converted PPF is not a retirement holding of type ppf.';
  end if;
end
$check$;

-- ───────────────────────────────────────────── a reset puts them back
--
-- reset_demo_household as 20261026120000 left it, with the PPF's entries and account emptied with the deposits and bonds,
-- before the holdings they cite. The guard at its end names any household table it does not know, which is what makes this a
-- requirement and not a courtesy.

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
  delete from public.budget             where household_id = target_household_id;
  delete from public.expense_category   where household_id = target_household_id;

  delete from public.liability          where household_id = target_household_id;
  delete from public.fx_rate            where household_id = target_household_id;

  -- After the rows that cite it. An import is the record of a file somebody
  -- imported into this household, and a sandbox emptied of everything that
  -- file wrote has no use for the record of having written it.
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
