-- Family Finance Buddy — protection: what a policy covers, when it renews, and the cover gap's one input.
--
-- docs/design/protection-and-flow.md §1 and §5; build-plan step 2b. An extension of `insurance_policy`
-- (20260906130200), which already carries the premium, its cadence and whose it is, with owner and
-- partner writing it and a contributor reading the ones filed under them (20260925120000). Nothing is
-- granted or enabled again here: the policies, the table grant and the audit trigger cover a column
-- added to the table, and supabase/tests/insurance_policy.test.sql shows each verb refused across roles
-- and across households.
--
--   cover_minor        what the policy pays out if it is claimed, in `currency`. NOT a value: it is
--                      never an input to net worth, allocation or FIRE (PF-C3), and no column on this
--                      table is named like a value, a worth or a surrender value (PF-C1).
--   renewal_on         when it next falls due, which Needs attention reads.
--   insurer            who it is with.
--   policy_last4       the last four characters of the policy number and no more: an account identifier
--                      keeps its last four digits only (CLAUDE.md), and a policy number is one.
--   started_on         when it began, for the premiums paid so far.
--   linked_holding_id  for a ULIP, an endowment or a money-back policy: the holding that carries its
--                      surrender value (PF-C4). Two records, because the cover and the premium are one
--                      thing and the surrender value is another, and the first is an expense and the
--                      second an asset.
--
-- Every column the form can offer exists now, so a form that never offered one has not made data that
-- cannot be repaired (detail-level.md §5). Nominees are not here: the owner chose to leave them out of
-- this slice, and a table for them can be added without touching a policy row.
--
-- And one household setting, which is a judgement and not a fact, so it is a column with its default on
-- the face of the screen and not a constant in code (build-plan 2b):
--
--   cover_dependency_years  how many years of the household's expenses a dependant would need covered.

-- ───────────────────────────────────────────────────────────────── the table

alter table public.insurance_policy
  drop constraint insurance_policy_kind_check,
  add constraint insurance_policy_kind_check
    check (kind in ('health', 'term_life', 'endowment', 'ulip', 'money_back',
                    'vehicle', 'home', 'personal_accident', 'other'));

alter table public.insurance_policy
  add column insurer           text
    check (insurer is null or length(btrim(insurer)) between 1 and 120),
  add column policy_last4      text
    check (policy_last4 is null or policy_last4 ~ '^[0-9A-Za-z]{4}$'),
  add column cover_minor       bigint
    check (cover_minor is null or cover_minor >= 0),
  add column started_on        date,
  add column renewal_on        date,
  add column linked_holding_id uuid;

alter table public.insurance_policy
  add constraint insurance_policy_linked_holding_fkey
    foreign key (household_id, linked_holding_id)
    references public.holding (household_id, id) on delete restrict,
  -- Only a policy that has a surrender value has a holding to carry it.
  add constraint insurance_policy_link_only_on_hybrid
    check (linked_holding_id is null or kind in ('endowment', 'ulip', 'money_back'));

comment on table public.insurance_policy is
  'A policy has a cover and no value: cover_minor is what it pays if claimed and is never added to money owned. A hybrid policy (ulip, endowment, money_back) cites a holding that carries its surrender value.';
comment on column public.insurance_policy.cover_minor is
  'What the policy pays out if claimed, in currency, in minor units. Not money the household owns: never an input to net worth, allocation or FIRE.';
comment on column public.insurance_policy.policy_last4 is
  'The last four characters of the policy number and no more.';
comment on column public.insurance_policy.linked_holding_id is
  'The holding carrying a hybrid policy''s surrender value. Null for protection with no value.';

create index insurance_policy_renewal_idx on public.insurance_policy (household_id, renewal_on)
  where status = 'active';

-- ───────────────────────────────────────────────────────── the household setting

alter table public.household
  add column cover_dependency_years integer not null default 10
    check (cover_dependency_years >= 0 and cover_dependency_years <= 50);

comment on column public.household.cover_dependency_years is
  'How many years of the household''s annual expenses a dependant would need covered, for the cover gap. A judgement, which is why it is a household setting with its default on the face of the screen; the app states the arithmetic and never recommends a cover.';

-- ───────────────────────────────────────── a reset, and the demo, put them back
--
-- reset_demo_household as 20260929120000 left it, with two changes: the new setting is returned to its
-- default, and the policies are deleted before the holdings, since a policy can now cite one by a
-- restricting foreign key.

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
         cover_dependency_years         = default
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



-- app.seed_demo_household as 20261011120000 left it, plus one block at the end: a term policy, a family
-- health policy and a ULIP with the holding that carries its surrender value.

create or replace function app.seed_demo_household(
  target_household_id uuid,
  seeded_by uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_household uuid := target_household_id;
  v_account   uuid := seeded_by;
  v_kind      text;
  v_owner     uuid;   -- the member the account is
  v_meera     uuid;   -- a member with no login
  v_former    uuid;   -- an archived member

  v_cat_grocery  uuid;
  v_cat_school   uuid;
  v_cat_fuel     uuid;
  v_cat_unused   uuid;
  v_cat_retired  uuid;

  v_inst_us    uuid;
  v_inst_bond  uuid;
  v_inst_gold  uuid;
  v_hold_us    uuid;
  v_hold_bond  uuid;
  v_hold_gold  uuid;
  v_hold_meera uuid;

  -- Today in IST, whatever the server's clock says. "All period boundaries are
  -- IST" — and a seed run at 02:00 IST would otherwise date its entries in the
  -- previous day, and on 1 April in the previous tax year.
  v_today    date := (now() at time zone 'Asia/Kolkata')::date;

  -- The tax year containing today, and the calendar year, which are different
  -- questions and both matter: the ledger runs April to March, foreign-asset
  -- disclosure runs January to December.
  v_fy       integer;
  v_fy_start date;
  v_cy       integer;
begin
  v_fy := case when extract(month from v_today) >= 4
               then extract(year from v_today)::integer
               else extract(year from v_today)::integer - 1 end;
  v_fy_start := make_date(v_fy, 4, 1);
  v_cy := extract(year from v_today)::integer;

  -- ══════════════════════════════════════════════════════════ who and where

  select h.kind into v_kind from public.household h where h.id = v_household;

  if v_kind is distinct from 'demo' then
    raise exception 'Household % is %, not demo. Every figure in this seed is invented.',
      v_household, coalesce(v_kind, 'missing') using errcode = '22023';
  end if;

  select ms.member_id into v_owner
    from public.membership ms
   where ms.user_account_id = v_account
     and ms.household_id = v_household
     and ms.revoked_at is null;

  if v_owner is null then
    raise exception 'Account % is not a member of household %.', v_account, v_household
      using errcode = '22023';
  end if;

  -- The marker is a category that only this seed creates.
  if exists (
    select 1 from public.expense_category
     where household_id = v_household and name = 'Piano lessons (never used)'
  ) then
    return false;
  end if;

  -- ═══════════════════════════════════════════════════════════════ members
  --
  -- Meera has no login, which §11 explicitly allows ("Members without logins
  -- still exist") and §470 asks the seed for — and which is what makes
  -- section 20 visible here: her private entries are invisible to the signed-in
  -- owner as rows, and still land in the household total as a Personal line.
  -- Demonstrating that otherwise needs a second account and a second
  -- authenticator, for a rule the database enforces either way.
  insert into public.member (household_id, display_name, relation, colour)
  values (v_household, 'Meera', 'spouse', 'c2')
  returning id into v_meera;

  -- Archived, not deleted, and still carrying history — "their history is the
  -- household's arithmetic".
  insert into public.member (household_id, display_name, relation, colour, status, archived_at)
  values (v_household, 'Priya (left Mar 2026)', 'help', 'c7', 'archived', now())
  returning id into v_former;

  -- ════════════════════════════════════════════════════════════ categories

  insert into public.expense_category (household_id, name, nature, is_essential, sort_order)
  values (v_household, 'Groceries', 'fixed', true, 1000) returning id into v_cat_grocery;

  insert into public.expense_category (household_id, name, nature, is_essential, sort_order)
  values (v_household, 'School fees', 'fixed', true, 1010) returning id into v_cat_school;

  insert into public.expense_category (household_id, name, nature, is_essential, sort_order)
  values (v_household, 'Fuel (demo)', 'variable', false, 1020) returning id into v_cat_fuel;

  -- The unused category. Nothing has ever been filed against it, which is the
  -- state that makes a budget total a floor rather than an estimate, and the
  -- one a report must not silently drop.
  insert into public.expense_category (household_id, name, nature, sort_order)
  values (v_household, 'Piano lessons (never used)', 'variable', 1030) returning id into v_cat_unused;

  -- Archived with history behind it. It must vanish from the picker and remain
  -- on every row that already references it.
  insert into public.expense_category (household_id, name, nature, sort_order, status, archived_at)
  values (v_household, 'Cable TV (closed)', 'fixed', 1040, 'archived', now()) returning id into v_cat_retired;

  -- ═══════════════════════════════════════════════════════════════ budgets
  --
  -- Chosen so every state of the comparison appears at once: one on track, one
  -- overspent, one planned with nothing against it, one spent with no plan.
  insert into public.budget (household_id, category_id, fy, cadence, planned_minor, currency)
  values
    (v_household, v_cat_grocery, v_fy, 'monthly', 1800000, 'INR'),   -- 18,000/mo
    (v_household, v_cat_fuel,    v_fy, 'monthly',  600000, 'INR'),   --  6,000/mo, overspent below
    (v_household, v_cat_unused,  v_fy, 'monthly',  250000, 'INR');   --  2,500/mo, never touched

  -- A yearly cadence beside the monthly ones. "A school fee is not a twelfth of
  -- itself every month", and annualising has to handle both.
  insert into public.budget (household_id, category_id, fy, cadence, planned_minor, currency)
  values (v_household, v_cat_school, v_fy, 'yearly', 12000000, 'INR');  -- 1,20,000/yr

  -- ══════════════════════════════════════════════════════════════ expenses
  --
  -- created_by is set rather than defaulted. The default is
  -- app.current_account_id(), which reads the session — and in the SQL editor
  -- there is no session, so it would be null and the insert would fail.

  insert into public.expense_txn
    (household_id, member_id, category_id, txn_date, amount_minor, currency, payee, method, visibility, created_by)
  values
    -- On track: roughly a month's groceries, spread.
    (v_household, v_owner, v_cat_grocery, v_today - 20, 620000, 'INR', 'Big Basket', 'upi', 'household', v_account),
    (v_household, v_owner, v_cat_grocery, v_today - 12, 481050, 'INR', 'Local market', 'cash', 'household', v_account),
    (v_household, v_meera, v_cat_grocery, v_today -  4, 355500, 'INR', 'Reliance Fresh', 'card', 'household', v_account),

    -- Overspent, and early in the period, which is what pace exists to catch.
    (v_household, v_owner, v_cat_fuel, v_today - 18, 450000, 'INR', 'Indian Oil', 'card', 'household', v_account),
    (v_household, v_owner, v_cat_fuel, v_today -  6, 470000, 'INR', 'HP Petrol', 'upi', 'household', v_account),

    -- Uncategorised. It cannot be compared with anything and must still reach
    -- the total, or the screen disagrees with the ledger.
    (v_household, v_owner, null, v_today - 9, 129900, 'INR', 'Something unfiled', 'upi', 'household', v_account),

    -- On an archived category, which is the whole reason archiving exists.
    (v_household, v_owner, v_cat_retired, v_fy_start + 20, 89900, 'INR', 'Cable renewal', 'auto_debit', 'household', v_account),

    -- An archived member's spending, still counted.
    (v_household, v_former, v_cat_grocery, v_fy_start + 45, 240000, 'INR', 'Household help — March', 'cash', 'household', v_account),

    -- The tax-year boundary, one day either side. These two belong to
    -- different years and nothing about them says so except the date.
    (v_household, v_owner, v_cat_grocery, v_fy_start - 1, 310000, 'INR', 'Last day of the old year', 'upi', 'household', v_account),
    (v_household, v_owner, v_cat_grocery, v_fy_start,     320000, 'INR', 'First day of the new one', 'upi', 'household', v_account),

    -- Foreign currency. Stored native, never converted on the way in.
    (v_household, v_owner, null, v_today - 30, 4999, 'USD', 'Domain renewal', 'card', 'household', v_account),

    -- Private, and belonging to somebody who cannot sign in. Invisible to the
    -- owner as a row; present in the household total as one Personal line.
    (v_household, v_meera, v_cat_grocery, v_today - 14, 770000, 'INR', 'Therapy', 'card', 'personal', v_account),
    (v_household, v_meera, null,          v_today -  3, 250000, 'INR', 'A gift, not yet given', 'upi', 'personal', v_account),

    -- Private, and the owner's own: visible to them, in their categories.
    (v_household, v_owner, v_cat_grocery, v_today - 7, 180000, 'INR', 'Also private', 'cash', 'personal', v_account);

  -- Voided rather than deleted. It must disappear from every total while
  -- staying on the ledger, because "the losing version goes to the audit log"
  -- and a figure that was once relied upon does not get to vanish.
  insert into public.expense_txn
    (household_id, member_id, category_id, txn_date, amount_minor, currency, payee, method,
     visibility, created_by, voided_at, voided_by)
  values
    (v_household, v_owner, v_cat_fuel, v_today - 16, 999900, 'INR', 'Entered twice by mistake', 'card',
     'household', v_account, now(), v_account);

  -- ═══════════════════════════════════════════════════════════ investments

  insert into public.instrument
    (household_id, name, kind, symbol, currency, exposure_currency, is_foreign_asset)
  values (v_household, 'Vanguard Total Stock Market ETF', 'etf', 'VTI', 'USD', 'USD', true)
  returning id into v_inst_us;

  -- An Indian feeder fund: INR-denominated, USD exposure, and NOT a foreign
  -- asset for disclosure. §293 exists because these two look alike on a
  -- statement and are treated completely differently.
  insert into public.instrument
    (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
  values (v_household, 'Motilal Oswal Nasdaq 100 FoF', 'mutual_fund', 'INR', 'USD', false);

  insert into public.instrument
    (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
  values (v_household, 'SBI Bond 2026 (matured)', 'bond', 'INR', 'INR', false)
  returning id into v_inst_bond;

  insert into public.instrument
    (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
  values (v_household, 'Sovereign Gold Bond', 'other', 'INR', 'INR', false)
  returning id into v_inst_gold;

  insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, opened_on)
  values (v_household, v_owner, v_inst_us, 12.5, 3400000, make_date(v_cy - 2, 3, 14))
  returning id into v_hold_us;

  -- A matured bond: still held, no longer growing, and the thing the calendar
  -- card should be shouting about.
  insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, opened_on)
  values (v_household, v_owner, v_inst_bond, 100, 10000000, make_date(v_cy - 2, 7, 1))
  returning id into v_hold_bond;

  -- Zero quantity against a real instrument — the "gold shows 0 g" case. A
  -- rate exists, nothing is held, and a naive total treats it as an asset.
  insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor)
  values (v_household, v_owner, v_inst_gold, 0, 0)
  returning id into v_hold_gold;

  -- A personal holding belonging to the member with no login, so §20 applies
  -- to net worth and not only to the ledger.
  insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, visibility)
  values (v_household, v_meera, v_inst_us, 4.25, 90000, 'personal')
  returning id into v_hold_meera;

  -- ════════════════════════════════════════════════════════════ valuations
  --
  -- Deliberately gappy. "The peak over a calendar year is the Schedule FA
  -- figure, and it exists only if the readings were taken" — so this leaves
  -- March, June, July and October unread. The peak computed from what is here
  -- is a lower bound, and the screen has to say so rather than quietly
  -- reporting it as the figure.
  insert into public.valuation_snapshot
    (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
  values
    (v_household, v_hold_us, make_date(v_cy, 1, 31), 12.5, 3980000, 'USD', 'manual',   v_account),
    (v_household, v_hold_us, make_date(v_cy, 2, 28), 12.5, 4055000, 'USD', 'manual',   v_account),
    -- March missing
    (v_household, v_hold_us, make_date(v_cy, 4, 30), 12.5, 4210000, 'USD', 'manual',   v_account),
    (v_household, v_hold_us, make_date(v_cy, 5, 31), 12.5, 4402500, 'USD', 'backfill', v_account),
    -- June and July missing — and the year's true peak may well be in them
    (v_household, v_hold_us, make_date(v_cy, 8, 31), 12.5, 4180000, 'USD', 'manual',   v_account);
    -- nothing since August: the stale valuation

  -- The bond, read until it matured and not since. Not a gap — an end.
  insert into public.valuation_snapshot
    (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
  values
    (v_household, v_hold_bond, make_date(v_cy, 1, 31), 100, 10420000, 'INR', 'manual', v_account),
    (v_household, v_hold_bond, make_date(v_cy, 6, 30), 100, 10750000, 'INR', 'manual', v_account);

  -- Meera's personal holding has its own valuation, which must be as invisible
  -- as the holding: a snapshot states no visibility of its own and inherits it.
  insert into public.valuation_snapshot
    (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
  values (v_household, v_hold_meera, make_date(v_cy, 8, 31), 4.25, 1421300, 'USD', 'manual', v_account);

  -- The zero-quantity holding gets a reading of zero rather than none. "No
  -- reading" and "read, and it was nothing" are different facts.
  insert into public.valuation_snapshot
    (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
  values (v_household, v_hold_gold, make_date(v_cy, 8, 31), 0, 0, 'INR', 'manual', v_account);


  -- ═══════════════════════════════════════════ earmarks and schemes (20261011120000)
  --
  -- Three deposits, each with something the FIRE corpus has to do about it. Without them the exclusion
  -- is a rule with nothing to apply to, and the demo household would still show a FIRE figure that
  -- counts an emergency fund, a daughter's SSY and a house deposit as retirement money.
  declare
    v_inst_fd  uuid;
    v_inst_ssy uuid;
    v_inst_rd  uuid;
    v_hold_fd  uuid;
    v_hold_ssy uuid;
    v_hold_rd  uuid;
  begin
    insert into public.instrument
      (household_id, name, kind, scheme, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Emergency fund (bank FD)', 'deposit', 'fd', 'INR', 'INR', false)
    returning id into v_inst_fd;

    insert into public.instrument
      (household_id, name, kind, scheme, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Sukanya Samriddhi (daughter)', 'deposit', 'ssy', 'INR', 'INR', false)
    returning id into v_inst_ssy;

    insert into public.instrument
      (household_id, name, kind, scheme, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'House deposit (recurring deposit)', 'deposit', 'rd', 'INR', 'INR', false)
    returning id into v_inst_rd;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, earmark)
    values (v_household, v_owner, v_inst_fd, 1, 30000000, 'emergency')
    returning id into v_hold_fd;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, earmark)
    values (v_household, v_owner, v_inst_ssy, 1, 10000000, 'child')
    returning id into v_hold_ssy;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, earmark)
    values (v_household, v_owner, v_inst_rd, 1, 45000000, 'house')
    returning id into v_hold_rd;

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
    values
      (v_household, v_hold_fd,  make_date(v_cy, 8, 31), 1, 30000000, 'INR', 'manual', v_account),
      (v_household, v_hold_ssy, make_date(v_cy, 8, 31), 1, 12000000, 'INR', 'manual', v_account),
      (v_household, v_hold_rd,  make_date(v_cy, 8, 31), 1, 50000000, 'INR', 'manual', v_account);
  end;


  -- ═══════════════════════════════════════════════════════ protection (20261012120000)
  --
  -- A term policy and a family health policy, which have a cover and no value, and a ULIP, which is two
  -- records: the policy, and a holding carrying the surrender value. The ULIP is the one that shows the
  -- gap between what has been paid in and what it is worth. The term policy renews within thirty days,
  -- so Needs attention has a renewal to call out.
  declare
    v_inst_ulip uuid;
    v_hold_ulip uuid;
  begin
    insert into public.instrument
      (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'ULIP (surrender value)', 'other', 'INR', 'INR', false)
    returning id into v_inst_ulip;

    -- What has been paid in is its cost, and what it would pay out today is its reading.
    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor)
    values (v_household, v_owner, v_inst_ulip, 1, 20000000)
    returning id into v_hold_ulip;

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
    values (v_household, v_hold_ulip, make_date(v_cy, 8, 31), 1, 14500000, 'INR', 'manual', v_account);

    insert into public.insurance_policy
      (household_id, name, kind, insurer, policy_last4, cover_minor, premium_minor, currency, cadence,
       started_on, renewal_on, member_id, linked_holding_id)
    values
      (v_household, 'Term life', 'term_life', 'Demo Life Insurance', '4821', 1000000000, 1800000, 'INR', 'yearly',
       make_date(v_cy - 3, 4, 10), v_today + 20, v_owner, null),
      (v_household, 'Family health floater', 'health', 'Demo Health Insurance', '7305', 100000000, 3200000, 'INR', 'yearly',
       make_date(v_cy - 2, 1, 5), v_today + 200, null, null),
      (v_household, 'ULIP', 'ulip', 'Demo Life Insurance', '9012', 50000000, 5000000, 'INR', 'yearly',
       make_date(v_cy - 4, 3, 1), v_today + 90, v_owner, v_hold_ulip);
  end;

  return true;
end;
$fn$;

comment on function app.seed_demo_household(uuid, uuid) is
  'Fills a demo household with the awkward cases. Refuses anything not marked demo; returns false if already seeded. Granted to nobody: reached through reset_demo_household or by the project owner.';

revoke all on function app.seed_demo_household(uuid, uuid) from public;
