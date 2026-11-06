-- Family Finance Buddy — gold is physical gold and gold ETFs and funds. The jeweller's scheme is withdrawn.
--
-- The owner withdrew the jeweller's gold savings scheme on 6 November 2026 (docs/design/gold.md section 0; docs/decisions.md, Gold).
-- This migration takes it out and puts in what replaces it. It is a new file: 20261102120000_gold.sql is applied to the live project
-- and is never edited.
--
--   * It REFUSES, and changes nothing, if a household that is not a demo one holds a jeweller's scheme. Naming how many, so no real
--     record is dropped silently (gold.md section 7, step 1). The owner then re-enters each as physical gold, or confirms it can go.
--   * `gold_scheme_terms`, its trigger function and its policies are dropped.
--   * `instrument.gold_form` is physical | etf | fund, still null unless the kind is gold (GD-I1). `instrument.gold_purity` is new: a
--     physical holding is valued at grams times the rate for its purity (GD-I3), and the purity is a fact about the gold, so it lives
--     with the form.
--   * An ETF or a fund already recorded with tax_asset_class = 'gold' moves to kind `gold`, with its lots and its price untouched
--     (gold.md section 1). Its tax class is NOT changed: a listed gold ETF needs a class of its own and the owner has not agreed the
--     rows (gold.md section 8, item 4). Until then it stays classed `gold`, whose holding period is the physical one.
--   * `gold_rate` is new: the household's own dated gold rate per purity, typed by an owner or a partner, appended and never edited
--     (GD-I12). It is not `price`, which is reference data shared by every household and written only by a driver.
--   * The demo seed and reset are replaced.
--
-- Nothing here fetches a rate, and nothing may: no international metals API, and no scraping of Indian rate sites (gold.md section 3).
--
-- Must be applied after 20261102130000_recurring_rules.sql, whose seed and reset functions this replaces.

-- ───────────────────────────────────────────── refuse before changing anything

do $guard$
declare
  v_schemes  integer;
  v_physical integer;
begin
  select count(*) into v_schemes
    from public.instrument i
    join public.household h on h.id = i.household_id
   where i.gold_form = 'jeweller_scheme'
     and h.kind <> 'demo';

  if v_schemes > 0 then
    raise exception
      'Not applied: % jeweller''s gold savings scheme(s) belong to a household that is not a demo one. Re-enter each as physical gold, or confirm it can go, and then apply this again. Nothing was changed.',
      v_schemes
      using errcode = '55000';
  end if;

  -- Nothing makes physical gold before this migration, so none should exist. If one does it has no purity to give the new check, and
  -- giving it one here would be a guess about somebody's gold.
  select count(*) into v_physical from public.instrument where gold_form = 'physical';

  if v_physical > 0 then
    raise exception
      'Not applied: % physical gold instrument(s) already exist, and have no purity. Nothing was changed.', v_physical
      using errcode = '55000';
  end if;
end;
$guard$;

-- ───────────────────────────────────────────── a rule that posted into a scheme has nothing left to post into

-- `recurring_rule` is not linked to a holding: a rule names a category, a member and a payee. So a rule "that posted scheme instalments"
-- can be recognised only by the payee or name being the jeweller of a scheme. The refusal above leaves only demo households, which
-- have one fictional jeweller and no rule by that name, so this is expected to archive nothing. It archives, and does not delete, so
-- it can be undone. Before the terms are dropped, since it reads them.
do $rules$
declare
  v_archived integer;
begin
  update public.recurring_rule r
     set status = 'archived', archived_at = now()
   where r.status <> 'archived'
     and exists (
       select 1
         from public.gold_scheme_terms t
        where t.household_id = r.household_id
          and (lower(btrim(coalesce(r.payee, ''))) = lower(btrim(t.jeweller)) or lower(btrim(r.name)) = lower(btrim(t.jeweller)))
     );
  get diagnostics v_archived = row_count;
  raise notice 'Recurring rules archived because they named a jeweller: %', v_archived;
end;
$rules$;

-- ───────────────────────────────────────────── the demo household's scheme, kept as history

-- Only a demo household can have one now. Its instrument stops being gold, since a scheme is no longer a form of gold, and its holding is
-- archived with its lots and readings untouched. A reset removes both and seeds the new gold (below).
with converted as (
  update public.instrument
     set kind = 'other', gold_form = null
   where gold_form = 'jeweller_scheme'
  returning id
)
update public.holding
   set status = 'archived', archived_at = now()
 where instrument_id in (select id from converted)
   and status <> 'archived';

-- ───────────────────────────────────────────── the scheme goes

-- Its policies and trigger go with the table. The trigger function is its own object.
drop table public.gold_scheme_terms;
drop function app.require_gold_scheme_holding();

-- ───────────────────────────────────────────── the forms of gold (GD-I1)

alter table public.instrument
  drop constraint instrument_gold_form_check;

alter table public.instrument
  add constraint instrument_gold_form_check
    check (gold_form in ('physical', 'etf', 'fund'));

comment on column public.instrument.gold_form is
  'Which gold a gold holding is: physical gold, a gold ETF or a gold fund. Required when kind is gold and null otherwise (GD-I1). The kind drives allocation, colour and tile; the form drives what is asked and how it is valued.';

-- Purity belongs with physical gold alone: a fund's gold is whatever the fund holds. The check reads a null form as not physical, so
-- a purity on anything else is refused, and so is a physical instrument without one.
alter table public.instrument
  add column gold_purity text
    check (gold_purity in ('24k', '22k', '18k'));

alter table public.instrument
  add constraint instrument_gold_purity_matches_form
    check ((coalesce(gold_form, '') = 'physical') = (gold_purity is not null));

comment on column public.instrument.gold_purity is
  '24k, 22k or 18k. Set exactly when gold_form is physical (GD-I1); physical gold is valued at grams times the dated rate for this purity (GD-I3).';

-- ───────────────────────────────────────────── gold ETFs and funds are gold (gold.md section 1)

-- Their lots and their price are untouched; only the kind and the form change. The tax class stays as it was (see the head of this file).
update public.instrument
   set kind = 'gold',
       gold_form = case kind when 'etf' then 'etf' else 'fund' end
 where kind in ('etf', 'mutual_fund')
   and tax_asset_class = 'gold';

-- ───────────────────────────────────────────── the household's gold rate (GD-I12)

-- A rate per gram for a purity on a day, typed by an owner or a partner from IBJA's published rate (gold.md section 3). Appended and
-- never edited or removed: a value uses the latest row on or before its date, so a correction is a later row, and an earlier day's value
-- does not move because a rate was typed today. Two rows on one day are allowed for that reason; the later one wins.
--
-- Per household, as fx_rate is, and for the same reason: `price` is reference data written only by a driver, and no driver writes this.
create table public.gold_rate (
  id                   uuid        primary key default gen_random_uuid(),
  household_id         uuid        not null references public.household (id) on delete restrict,

  purity               text        not null check (purity in ('24k', '22k', '18k')),

  -- Per gram, in minor units of `currency`: paise for rupees. An integer, as every amount is.
  rate_per_gram_minor  bigint      not null check (rate_per_gram_minor > 0),
  currency             text        not null default 'INR' check (currency ~ '^[A-Z]{3}$'),

  -- The day the rate is for, which is not always the day it was typed.
  as_at                date        not null,

  created_by           uuid        not null default app.current_account_id()
                                   references public.user_account (id) on delete restrict,
  created_at           timestamptz not null default now()
);

comment on table public.gold_rate is
  'The household''s typed gold rate per gram for a purity, on a day. Appended, never updated or deleted (GD-I12). Valuing physical gold reads the latest row on or before the valuation date.';
comment on column public.gold_rate.rate_per_gram_minor is
  'Minor units of currency per gram of that purity. Typed from a published rate; nothing fetches it.';

create index gold_rate_lookup_idx
  on public.gold_rate (household_id, purity, as_at desc, created_at desc);

create trigger gold_rate_audit
  after insert or update or delete on public.gold_rate
  for each row execute function app.write_audit();

alter table public.gold_rate enable row level security;
alter table public.gold_rate force row level security;

revoke all on public.gold_rate from public, anon, authenticated;
-- No update and no delete. A rate a value was worked from does not get to change or disappear.
grant select, insert on public.gold_rate to authenticated;

create policy gold_rate_select_same_household
  on public.gold_rate
  for select
  to authenticated
  using (household_id in (select app.household_ids()));

create policy gold_rate_insert_owner_or_partner
  on public.gold_rate
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
  );

comment on policy gold_rate_select_same_household on public.gold_rate is
  'Everyone in the household reads its rate, a viewer included: it is the figure physical gold is valued at, and it is the household''s own, not a person''s.';

create policy require_second_factor
  on public.gold_rate
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ───────────────────────────────────────────── the demo household gets the new gold

-- Replaces the seed of 20261102130000_recurring_rules.sql: the jeweller's scheme is gone, and there is physical gold, a gold ETF and a typed rate.

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
  v_inst_neck  uuid;   -- a 22K necklace bought for a price
  v_hold_neck  uuid;
  v_inst_coin  uuid;   -- a coin that was a gift
  v_hold_coin  uuid;
  v_inst_getf  uuid;   -- a gold ETF
  v_hold_getf  uuid;
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
       make_date(v_cy - 3, 3, 1), v_today + 90, v_owner, v_hold_ulip);
  end;

  -- ═══════════════════════════════════════════════════════ what the screens and the end-to-end suite stand on
  --
  -- A household reset to the seed has to be one the app can show. Without these a reset household had no
  -- rate to turn a dollar holding into rupees (so net worth read "₹11.73L + $41.8K" and the FIRE
  -- projection, the cover gap and the corpus all refused), a deposit with no terms (so it could not be
  -- opened on them), and no position resting on a partial statement (so the refused return the Holdings
  -- screen is built to explain never appeared). The figures are invented, like the rest of the seed.
  declare
    v_inst_fund uuid;
    v_hold_fund uuid;
    v_hold_fd2  uuid;
  begin
    -- Dated rates, appended and never updated: a figure converts at the rate for its own date.
    insert into public.fx_rate (household_id, base_currency, quote_currency, rate, as_of_date, source, created_by)
    values
      (v_household, 'USD', 'INR', 85.2000000000, make_date(v_cy, 1, 31), 'manual', v_account),
      (v_household, 'USD', 'INR', 86.4000000000, make_date(v_cy, 5, 31), 'manual', v_account),
      (v_household, 'USD', 'INR', 88.1000000000, make_date(v_cy, 8, 31), 'manual', v_account);

    -- The emergency-fund FD says what it is: a quarterly-compounding deposit that matures in the future.
    update public.holding
       set opened_on = v_today - 120
     where id = (select h.id from public.holding h
                   join public.instrument i on i.id = h.instrument_id
                  where h.household_id = v_household and i.name = 'Emergency fund (bank FD)')
       and opened_on is null;

    insert into public.fixed_income_terms
      (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date,
       compounding, institution, account_last4, created_by)
    select h.id, v_household, 'deposit', 30000000, 'INR', 6.500, v_today - 120, v_today + 245,
           'quarterly', 'Demo Bank', '4521', v_account
      from public.holding h
      join public.instrument i on i.id = h.instrument_id
     where h.household_id = v_household and i.name = 'Emergency fund (bank FD)';

    -- A second deposit, a year, which the list and the holding screen can show beside the first.
    insert into public.instrument
      (household_id, name, kind, scheme, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Term deposit (bank FD)', 'deposit', 'fd', 'INR', 'INR', false)
    returning id into v_inst_fund;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, opened_on)
    values (v_household, v_owner, v_inst_fund, 1, 20000000, v_today - 60)
    returning id into v_hold_fd2;

    insert into public.fixed_income_terms
      (holding_id, household_id, kind, principal_minor, currency, rate_pct, start_date, maturity_date,
       compounding, institution, account_last4, created_by)
    values (v_hold_fd2, v_household, 'deposit', 20000000, 'INR', 7.000, v_today - 60, v_today + 305,
            'yearly', 'Demo Bank', '8830', v_account);

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
    values (v_household, v_hold_fd2, make_date(v_cy, 8, 31), 1, 20180000, 'INR', 'manual', v_account);

    -- A fund whose statement covers only part of its history: units from the closing balance, a purchase
    -- for only some of them. Its cost is therefore not known, and no return is shown (HD-I3). The closing
    -- balance is the holding's stated quantity: that, and not the purchases, is what the app counts units from.
    insert into public.instrument
      (household_id, name, kind, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Demo Flexi Cap Fund', 'mutual_fund', 'INR', 'INR', false)
    returning id into v_inst_fund;

    insert into public.holding
      (household_id, member_id, instrument_id, quantity, cost_minor, opened_on, stated_quantity, stated_as_at)
    values (v_household, v_owner, v_inst_fund, 1500.500, 9000000, v_today - 400, 1500.500, make_date(v_cy, 8, 31))
    returning id into v_hold_fund;

    insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, created_by)
    values (v_household, v_hold_fund, v_today - 200, 600.000, 9000000, 'INR', v_account);

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
    values
      (v_household, v_hold_fund, make_date(v_cy, 7, 31), 1500.500, 21800000, 'INR', 'manual', v_account),
      (v_household, v_hold_fund, make_date(v_cy, 8, 31), 1500.500, 22400000, 'INR', 'manual', v_account);

    -- ═══ gold (docs/design/gold.md) ═══
    --
    -- Physical gold: a 22K necklace bought a little over a year ago for a price that includes making charges and GST, so at today's rate
    -- it is worth less than was paid (gold.md section 2). It is valued at grams times the typed rate for its purity (GD-I3): the reading
    -- below is that product, 20 g at the 22K rate of 11,550 rupees a gram.
    insert into public.instrument
      (household_id, name, kind, gold_form, gold_purity, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Necklace', 'gold', 'physical', '22k', 'INR', 'INR', false)
    returning id into v_inst_neck;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, opened_on)
    values (v_household, v_owner, v_inst_neck, 20.000, 23500000, v_today - 400)
    returning id into v_hold_neck;

    insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, kind, note, created_by)
    values (v_household, v_hold_neck, v_today - 400, 20.000, 23500000, 'INR', 'purchase',
            'Price paid, with making charges and GST.', v_account);

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, note, created_by)
    values (v_household, v_hold_neck, v_today, 20.000, 23100000, 'INR', 'manual',
            'Worked out: 20 g at the 22K rate typed for this household.', v_account);

    -- A coin that was a gift: 24K, ten grams, and no cost. The gain on selling it cannot be worked out, and the Tax screen says so.
    insert into public.instrument
      (household_id, name, kind, gold_form, gold_purity, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Gold coin (a gift)', 'gold', 'physical', '24k', 'INR', 'INR', false)
    returning id into v_inst_coin;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, opened_on)
    values (v_household, v_owner, v_inst_coin, 10.000, 0, v_today - 900)
    returning id into v_hold_coin;

    insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, kind, note, created_by)
    values (v_household, v_hold_coin, v_today - 900, 10.000, 0, 'INR', 'gift', 'A gift: what it cost is not known.', v_account);

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, note, created_by)
    values (v_household, v_hold_coin, v_today, 10.000, 12600000, 'INR', 'manual',
            'Worked out: 10 g at the 24K rate typed for this household.', v_account);

    -- A gold ETF, which is gold and is priced as a fund (gold.md sections 1 and 4). The name and ISIN are those of Axis Gold ETF in
    -- AMFI's published NAV file (scheme code 113434, read from the file on 5 November 2026) so that Fetch prices finds it; the units,
    -- the cost and the date bought are invented, and the reading is the file's NAV of 118.6261 times the units. Its tax class is left
    -- unset: a listed gold ETF needs a class of its own, and the owner has not yet agreed it (gold.md section 8, item 4).
    insert into public.instrument
      (household_id, name, kind, gold_form, isin, price_source, price_external_id, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Axis Gold ETF', 'gold', 'etf', 'INF846K01W80', 'amfi', 'INF846K01W80', 'INR', 'INR', false)
    returning id into v_inst_getf;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, opened_on)
    values (v_household, v_owner, v_inst_getf, 50.000, 520000, v_today - 200)
    returning id into v_hold_getf;

    insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, kind, created_by)
    values (v_household, v_hold_getf, v_today - 200, 50.000, 520000, 'INR', 'purchase', v_account);

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by)
    values (v_household, v_hold_getf, v_today, 50.000, 593131, 'INR', 'manual', v_account);

    -- The household's typed rates (GD-I12): an earlier 22K rate, so the history shows that a rate is appended and not replaced, then
    -- today's 22K and 24K. Rupees a gram times a hundred: 10,900, 11,550 and 12,600.
    insert into public.gold_rate (household_id, purity, rate_per_gram_minor, currency, as_at, created_by)
    values
      (v_household, '22k', 1090000, 'INR', v_today - 60, v_account),
      (v_household, '22k', 1155000, 'INR', v_today - 2,  v_account),
      (v_household, '24k', 1260000, 'INR', v_today - 2,  v_account);

    -- Two recurring rules, neither due yet, so seeding posts nothing and every seeded total is as it was: a school fee each quarter on
    -- the 5th, and the milk on the 1st of each month, both from next month.
    insert into public.recurring_rule
      (household_id, name, category_id, member_id, amount_minor, currency, cadence, due_day, next_due, method, created_by)
    values
      (v_household, 'School fee', v_cat_school, v_owner, 1500000, 'INR', 'quarterly', 5,
       (date_trunc('month', v_today) + interval '1 month')::date + 4, 'netbanking', v_account),
      (v_household, 'Milk delivery', v_cat_grocery, v_owner, 300000, 'INR', 'monthly', 1,
       (date_trunc('month', v_today) + interval '1 month')::date, 'upi', v_account);
  end;

  return true;
end;
$fn$;

comment on function app.seed_demo_household(uuid, uuid) is
  'Fills a demo household with the awkward cases. Refuses anything not marked demo; returns false if already seeded. Granted to nobody: reached through reset_demo_household or by the project owner.';

revoke all on function app.seed_demo_household(uuid, uuid) from public;

-- ───────────────────────────────────────────── and the reset clears them

-- Replaces the reset of 20261102120000_gold.sql with one that also clears the rules.

-- Replaces the reset of 20261102130000_recurring_rules.sql: the scheme's terms are gone, and the gold rate is cleared.

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
  -- A rule's entries cite it by a restricting foreign key, so the rules go once the entries have.
  delete from public.recurring_rule     where household_id = target_household_id;
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
