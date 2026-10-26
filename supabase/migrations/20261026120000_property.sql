-- Family Finance Buddy — property: what the household owns in land and buildings, what it cost, and what it is
-- thought to be worth.
--
-- docs/blueprint.md, Property: "Land1, Land2 and House stop being three labels on the NetWorth sheet and become
-- records with a cost basis. Purchase price, stamp duty and registration all form part of what you actually paid
-- ... Capital improvements are dated entries that add to the basis; repairs are recorded but don't."
-- "Valuation is treated as the estimate it is: a figure, a date, and how you arrived at it ... it flags a valuation
-- that has gone stale rather than quietly carrying a four-year-old figure into your net worth."
--
-- Decided by the maintainer (October 2026), recorded in docs/decisions.md and
-- docs/reviews/2026-10-26-property/proposal.md:
--
--   1  Valuations are dated rows. The blueprint's `current_value_minor` and `valued_on` overwrite yesterday's figure,
--      and yesterday's net worth must not change. Net worth reads the latest at or before the day asked, the history
--      chart can draw a property, and "stale" is computed (today less the latest as_of_date), never stored.
--   2  The household's share. `co_owner_share_pct` is the share the household holds; net worth and the cost basis
--      use the share and never the whole. Co-owners outside the household are not modelled.
--   3  A property may be personal, as a holding or an expense may: returned to the member it belongs to and to nobody
--      else. The same narrowing as every other table applies (a contributor reads their own, a viewer reads none).
--   4  Whether a property that is not lived in is in the FIRE corpus is a rule of the calculation, not of this
--      schema; a home you live in is out (decided earlier). Nothing here says either.
--   5  A valuation is stale after twelve months, a household setting like the others.
--
-- ── what hangs off what ──────────────────────────────────────────────────────────────────────────────────────
--
--   property               one row per property: what it is, who holds it, what it cost, and what share is the
--                          household's. The cost is the purchase, the stamp duty and the registration, kept as
--                          three figures because the indexation election needs each by its year.
--   property_improvement   dated work. Capital work adds to the cost; a repair is recorded and does not. Voided,
--                          never deleted.
--   property_valuation     a dated estimate and how it was arrived at. One a day; a misread one is corrected.
--
-- Improvements and valuations are as private as the property they belong to: a property's policy decides, asked as
-- the caller, so there is no second rule here to drift out of step with it. Their audit rows follow the property
-- too, by the same payload rule that makes a purchase's audit row follow its holding (below).
--
-- ── what this deliberately leaves out ────────────────────────────────────────────────────────────────────────
--
-- Rent, tenant and annual property tax (the house-property head of the Tax screen) and the sale itself (a
-- disposal, the indexation election, reinvestment clocks and TDS). They arrive with the slice that reads them: a
-- first migration should hold nothing that has no reader, and a tenant's name is personal detail that would need
-- its reads audited.
--
-- A household total that includes a *personal* property needs a function that returns sums, as holdings have
-- (`personal_holding_totals`). It arrives with the net-worth slice that reads it, and is not written here because a
-- sum of share-adjusted valuations is a calculation, and policies and tables do access and not arithmetic.
--
-- No delete grant, as for `lot`: a wrong figure is corrected in place, and the audit log keeps the version it
-- replaced. Must be applied after 20260927120000_audit_follows_holding.sql and 20261012120000_protection.sql.

-- ───────────────────────────────────────────── a household setting

alter table public.household
  add column property_valuation_stale_months smallint not null default 12
    check (property_valuation_stale_months between 1 and 120);

comment on column public.household.property_valuation_stale_months is
  'How old a property''s latest valuation may be before the screen marks it stale. The figure still counts; it carries the mark. A judgement, which is why it is a household setting.';

-- ───────────────────────────────────────────── a key the link to a loan needs

-- A property cites its home loan by (household, id), so that a property cannot point at another household's loan.
alter table public.liability
  add constraint liability_household_id_id_key unique (household_id, id);

-- ───────────────────────────────────────────── property

create table public.property (
  id                 uuid           primary key default gen_random_uuid(),
  household_id       uuid           not null references public.household (id) on delete restrict,
  member_id          uuid           not null,

  kind               text           not null
                                    check (kind in ('land', 'plot', 'apartment', 'house', 'commercial')),
  label              text           not null check (length(btrim(label)) between 1 and 120),

  -- Every amount carries a currency: a property abroad is its own.
  currency           text           not null check (currency ~ '^[A-Z]{3}$'),

  -- What was paid, in three figures, in minor units of `currency`. Stamp duty and registration are nil on a gift
  -- or an inheritance, which is allowed; a cost of nil is too, where the cost is the previous owner's.
  purchase_date      date           not null,
  purchase_cost_minor bigint        not null check (purchase_cost_minor >= 0),
  stamp_duty_minor   bigint         not null default 0 check (stamp_duty_minor >= 0),
  registration_minor bigint         not null default 0 check (registration_minor >= 0),

  -- The household's share, a percentage to two places: 100 when it holds all of it.
  co_owner_share_pct numeric(5, 2)  not null default 100
                                    check (co_owner_share_pct > 0 and co_owner_share_pct <= 100),

  is_self_occupied   boolean        not null default false,

  -- The home loan, if there is one: equity is the value less what is outstanding on it.
  linked_liability_id uuid,

  -- Personal entries (section 20): returned to the member it belongs to and to nobody else.
  visibility         text           not null default 'household'
                                    check (visibility in ('household', 'personal')),

  status             text           not null default 'active' check (status in ('active', 'archived')),
  archived_at        timestamptz,

  note               text           check (note is null or length(note) <= 500),
  created_by         uuid           not null default app.current_account_id()
                                    references public.user_account (id) on delete restrict,
  created_at         timestamptz    not null default now(),
  updated_at         timestamptz    not null default now(),

  constraint property_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null)),

  -- The member and the loan must belong to this property's household. Composite keys rather than triggers, so the
  -- database refuses a mismatch outright.
  constraint property_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict,
  constraint property_liability_in_household_fkey
    foreign key (household_id, linked_liability_id)
    references public.liability (household_id, id) on delete restrict,

  -- What the children cite, so that their currency must be the property's.
  constraint property_household_id_id_currency_key unique (household_id, id, currency)
);

comment on table public.property is
  'Land and buildings the household holds: what it cost, as three figures, and what share is the household''s. Value is in property_valuation, dated; the cost basis is computed from these and the improvements by src/domain/property.ts and never stored.';
comment on column public.property.co_owner_share_pct is
  'The household''s share, a percentage to two decimal places. Net worth and the cost basis use the share, never the whole.';
comment on column public.property.linked_liability_id is
  'The home loan. Equity is the latest valuation less what is outstanding on the loan.';
comment on column public.property.purchase_cost_minor is
  'The price, in minor units of currency. Stamp duty and registration are their own columns because the indexation election needs each by the year it was paid.';

create index property_household_idx on public.property (household_id, status);

-- ───────────────────────────────────────────── property_improvement

create table public.property_improvement (
  id              uuid        primary key default gen_random_uuid(),
  household_id    uuid        not null references public.household (id) on delete restrict,
  property_id     uuid        not null,
  -- The property's own, so that an improvement cannot be in another currency than the property it is for.
  currency        text        not null check (currency ~ '^[A-Z]{3}$'),

  work_date       date        not null,
  description     text        not null check (length(btrim(description)) between 1 and 200),
  amount_minor    bigint      not null check (amount_minor > 0),
  -- Capital work (a new kitchen, a room added) adds to the cost. A repair does not, and is recorded all the same.
  is_capital      boolean     not null,

  -- Voided, never deleted: its history is the household's arithmetic.
  voided_at       timestamptz,

  created_by      uuid        not null default app.current_account_id()
                              references public.user_account (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint property_improvement_property_fkey
    foreign key (household_id, property_id, currency)
    references public.property (household_id, id, currency) on delete restrict
);

comment on table public.property_improvement is
  'Dated work on a property. Capital work adds to the cost basis and a repair does not. Hangs off the property and is as private as it is.';

create index property_improvement_property_idx on public.property_improvement (property_id, work_date);

-- ───────────────────────────────────────────── property_valuation

create table public.property_valuation (
  id              uuid        primary key default gen_random_uuid(),
  household_id    uuid        not null references public.household (id) on delete restrict,
  property_id     uuid        not null,
  currency        text        not null check (currency ~ '^[A-Z]{3}$'),

  as_of_date      date        not null,
  -- The whole property's estimated value, not the household's share: the share is applied on read.
  value_minor     bigint      not null check (value_minor >= 0),
  -- How it was arrived at. The app never pretends a property is worth a precise number.
  basis           text        not null
                              check (basis in ('own_estimate', 'circle_rate', 'broker', 'registered')),

  note            text        check (note is null or length(note) <= 500),
  created_by      uuid        not null default app.current_account_id()
                              references public.user_account (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint property_valuation_property_fkey
    foreign key (household_id, property_id, currency)
    references public.property (household_id, id, currency) on delete restrict,

  -- Two estimates for one day would be two answers to one question; a misread one is corrected in place.
  constraint property_valuation_one_per_day unique (property_id, as_of_date)
);

comment on table public.property_valuation is
  'A dated estimate of the whole property and how it was arrived at. Net worth reads the latest at or before the day asked, so an earlier day''s figure never moves; staleness is computed from the date and never stored.';
comment on column public.property_valuation.value_minor is
  'The value of the whole property. The household''s share is applied when it is read.';

create index property_valuation_property_idx on public.property_valuation (property_id, as_of_date desc);

-- ───────────────────────────────────────────── access

alter table public.property             enable row level security;
alter table public.property             force row level security;
alter table public.property_improvement enable row level security;
alter table public.property_improvement force row level security;
alter table public.property_valuation   enable row level security;
alter table public.property_valuation   force row level security;

revoke all on public.property             from public, anon, authenticated;
revoke all on public.property_improvement from public, anon, authenticated;
revoke all on public.property_valuation   from public, anon, authenticated;
grant select, insert, update on public.property             to authenticated;
grant select, insert, update on public.property_improvement to authenticated;
grant select, insert, update on public.property_valuation   to authenticated;

-- A property: the shared ones and your own private ones; a contributor reads their own; a viewer reads none. The
-- same shape as a holding's, so the one rule is the same everywhere.

create policy property_select_by_role
  on public.property
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

create policy property_insert_own_household
  on public.property
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
    and created_by = (select app.current_account_id())
  );

create policy property_update_own_household
  on public.property
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and (
      app.household_role(household_id) <> 'contributor'
      or member_id = app.current_member_id(household_id)
    )
  );

comment on policy property_select_by_role on public.property is
  'Owner and partner: the shared properties and their own private ones. Contributor: their own. Viewer: none.';
comment on policy property_update_own_household on public.property is
  'A property is corrected in place and archived, never deleted. A contributor changes only their own.';

-- Improvements and valuations: as private as the property, decided by the property's own policy. The subquery runs
-- as the caller, so an owner does not read a partner's personal property's valuations, and there is no rule here to
-- drift out of step with it.

create policy property_improvement_select
  on public.property_improvement
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.property p where p.id = property_improvement.property_id)
  );

create policy property_valuation_select
  on public.property_valuation
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.property p where p.id = property_valuation.property_id)
  );

create policy property_improvement_insert
  on public.property_improvement
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.property p where p.id = property_improvement.property_id)
  );

create policy property_valuation_insert
  on public.property_valuation
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.property p where p.id = property_valuation.property_id)
  );

create policy property_improvement_update
  on public.property_improvement
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.property p where p.id = property_improvement.property_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.property p where p.id = property_improvement.property_id)
  );

create policy property_valuation_update
  on public.property_valuation
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.property p where p.id = property_valuation.property_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.property p where p.id = property_valuation.property_id)
  );

comment on policy property_improvement_select on public.property_improvement is
  'Exactly as private as the property, decided by the property''s own policy.';
comment on policy property_valuation_select on public.property_valuation is
  'Exactly as private as the property, decided by the property''s own policy.';

-- A password alone is not enough: the publishable key ships in the bundle.
create policy require_second_factor
  on public.property
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.property_improvement
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.property_valuation
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ───────────────────────────────────────────── audit
--
-- In the same migration that creates the tables, per the invariant.

create trigger property_touch_updated_at
  before update on public.property
  for each row execute function app.touch_updated_at();

create trigger property_audit
  after insert or update or delete on public.property
  for each row execute function app.write_audit();

create trigger property_improvement_touch_updated_at
  before update on public.property_improvement
  for each row execute function app.touch_updated_at();

create trigger property_improvement_audit
  after insert or update or delete on public.property_improvement
  for each row execute function app.write_audit();

create trigger property_valuation_touch_updated_at
  before update on public.property_valuation
  for each row execute function app.touch_updated_at();

create trigger property_valuation_audit
  after insert or update or delete on public.property_valuation
  for each row execute function app.write_audit();

-- The audit row of an improvement or a valuation carries the cost or the value in full and names no member and no
-- visibility of its own, so it would be read as the household's. It names its `property_id`, and the rule is the one
-- 20260927120000 wrote for a holding, stated about the payload: an audit row whose row names a property is readable
-- only by whoever can read that property, resolved as the caller so the property's own policy decides. The property's
-- own audit row states its visibility and member itself, so this clause is for the two that hang off it.

drop policy if exists audit_log_select_by_role on public.audit_log;

create policy audit_log_select_by_role
  on public.audit_log
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
    and (
      (coalesce(after, before) ->> 'holding_id') is null
      or exists (
        select 1
          from public.holding h
         where h.id = ((coalesce(after, before)) ->> 'holding_id')::uuid
      )
    )
    and (
      (coalesce(after, before) ->> 'property_id') is null
      or exists (
        select 1
          from public.property p
         where p.id = ((coalesce(after, before)) ->> 'property_id')::uuid
      )
    )
    and (
      app.reads_whole_household(household_id)
      or (
        app.household_role(household_id) = 'contributor'
        and member_id = app.current_member_id(household_id)
      )
    )
  );

comment on policy audit_log_select_by_role on public.audit_log is
  'Owner and partner: the household''s log, minus other members'' private rows and minus anything about a position or a property they cannot read, whatever table it hangs off (any audit row whose row names a holding_id or a property_id). Contributor: entries about their own rows only. Viewer: none.';

-- ───────────────────────────────────────────── a reset puts them back
--
-- reset_demo_household as 20261012120000 left it, with two changes: the three property tables are emptied (children
-- first, and before the liabilities a property can cite), and the new setting is returned to its default. The guard
-- at its end names any household table it does not know, which is what makes this a requirement and not a courtesy.

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
