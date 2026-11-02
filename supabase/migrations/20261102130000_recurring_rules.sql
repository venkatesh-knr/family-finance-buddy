-- Family Finance Buddy — recurring rules, and what posts them.
--
-- docs/design/spending-capture.md section 3 (item 1) and SC-I10; docs/build-plan.md, step 6c (slice S1); blueprint section 04
-- (`recurring_rule`). The predictable spending (electricity, DTH, school fee, premiums, household help) posts itself, once per due
-- date, so a month of it is not typed.
--
--   * `recurring_rule` says what recurs: the category, the member, the amount and its currency, how often, the day of the month it
--     falls due (1 to 28, so it exists in every month), the day it next falls due, whether it posts itself, and how many days ahead a
--     reminder is wanted. A rule is paused or archived, never deleted (CLAUDE.md).
--   * `expense_txn` gains `captured_via` (how the entry arrived: typed by a person, shared, posted by a rule, imported), and for an
--     entry a rule posted, `recurring_rule_id` and the `due_date` it was posted for. A unique index on (rule, due date) is what makes
--     a rule post once per due date (SC-I10): running the poster twice, or on two devices, posts once, and an entry that was voided
--     is not posted again, because its row still holds the date.
--   * `post_due_recurring` is what posts them. There is no server of our own and no scheduler (the month-end close made the same
--     choice), so it runs when an owner or a partner opens the app: for each active rule that posts itself and is due, it posts every
--     due date up to today in India, not the device's, advances the rule, and returns how many entries it made. It runs as the caller,
--     so row-level security decides every row, and a rule is locked while it is posted so two devices take turns.
--
-- A rule is the household's: its owner and partner read and write them; a contributor reads the rules filed under their own name; a
-- viewer reads none; a personal rule is its member's alone, as a personal expense is. The audit trigger, row-level security, the
-- grants, the second-factor policy, the demo reset and the demo seed are all in this migration.
--
-- Must be applied after 20261102120000_gold.sql, whose seed and reset functions this replaces.

-- ───────────────────────────────────────────── the rule

create table public.recurring_rule (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,

  name          text        not null check (length(btrim(name)) between 1 and 80),
  category_id   uuid        not null,
  member_id     uuid        not null,

  amount_minor  bigint      not null check (amount_minor > 0),
  currency      text        not null check (currency ~ '^[A-Z]{3}$'),
  cadence       text        not null check (cadence in ('monthly', 'quarterly', 'half_yearly', 'yearly')),

  -- The day of the month it falls due, and the next day it does. The next due day is always on the due day, so a rule that falls due
  -- on the 10th is never nudged to the 9th by a short month.
  due_day       smallint    not null check (due_day between 1 and 28),
  next_due      date        not null,

  payee         text        check (payee is null or length(btrim(payee)) between 1 and 120),
  method        text        check (method is null or method in ('cash', 'card', 'upi', 'netbanking', 'auto_debit', 'other')),
  visibility    text        not null default 'household' check (visibility in ('household', 'personal')),

  auto_post     boolean     not null default true,
  reminder_days smallint    not null default 0 check (reminder_days between 0 and 30),

  status        text        not null default 'active' check (status in ('active', 'paused', 'archived')),
  archived_at   timestamptz,

  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint recurring_rule_next_due_on_due_day check (extract(day from next_due) = due_day),
  constraint recurring_rule_archived_matches_status check ((status = 'archived') = (archived_at is not null)),
  constraint recurring_rule_household_id_id_key unique (household_id, id),
  constraint recurring_rule_category_in_household_fkey
    foreign key (household_id, category_id) references public.expense_category (household_id, id) on delete restrict,
  constraint recurring_rule_member_in_household_fkey
    foreign key (household_id, member_id) references public.member (household_id, id) on delete restrict
);

comment on table public.recurring_rule is
  'What recurs: a category, a member, an amount, how often and on which day. Posted by public.post_due_recurring, once per due date. Paused or archived, never deleted.';

create index recurring_rule_due_idx on public.recurring_rule (household_id, next_due) where status = 'active' and auto_post;

create trigger recurring_rule_touch_updated_at
  before update on public.recurring_rule
  for each row execute function app.touch_updated_at();

create trigger recurring_rule_audit
  after insert or update or delete on public.recurring_rule
  for each row execute function app.write_audit();

-- ───────────────────────────────────────────── what an entry says of how it arrived

alter table public.expense_txn
  add column captured_via      text not null default 'typed'
    check (captured_via in ('typed', 'shared', 'rule', 'import')),
  add column recurring_rule_id uuid,
  add column due_date          date,
  add constraint expense_txn_rule_pair
    check ((recurring_rule_id is null) = (due_date is null)),
  add constraint expense_txn_rule_is_captured_by_rule
    check ((captured_via = 'rule') = (recurring_rule_id is not null)),
  add constraint expense_txn_rule_in_household_fkey
    foreign key (household_id, recurring_rule_id) references public.recurring_rule (household_id, id) on delete restrict;

comment on column public.expense_txn.captured_via is
  'How the entry arrived: typed by a person, shared into the app, posted by a recurring rule, or imported from a statement. Existing entries were typed.';

-- SC-I10: a rule posts once per due date. The row of an entry that was voided still holds its date, so it is not posted again.
create unique index expense_txn_one_per_due
  on public.expense_txn (recurring_rule_id, due_date)
  where recurring_rule_id is not null;

-- ───────────────────────────────────────────── access

alter table public.recurring_rule enable row level security;
alter table public.recurring_rule force row level security;

revoke all on public.recurring_rule from public, anon, authenticated;
grant select, insert, update on public.recurring_rule to authenticated;

-- Owner and partner: the shared rules and their own personal ones. A contributor: the rules under their own name. A viewer: none.
create policy recurring_rule_select_by_role
  on public.recurring_rule
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

create policy recurring_rule_insert
  on public.recurring_rule
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  );

create policy recurring_rule_update
  on public.recurring_rule
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner')
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and (visibility = 'household' or member_id = app.current_member_id(household_id))
  );

comment on policy recurring_rule_select_by_role on public.recurring_rule is
  'Owner and partner: the shared rules and their own personal ones. Contributor: the rules under their own name. Viewer: none.';

-- A password alone is not enough: the publishable key ships in the bundle.
create policy require_second_factor
  on public.recurring_rule
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ───────────────────────────────────────────── posting what is due

create function public.post_due_recurring(p_household uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  -- The day in India, whatever the device says (CLAUDE.md: period boundaries are IST).
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  r        record;
  v_due    date;
  v_step   integer;
  v_count  integer;
  v_made   integer;
  v_posted integer := 0;
begin
  if not app.has_second_factor() then
    raise exception 'Posting recurring entries needs an authenticator code in this session, not only a password.' using errcode = '42501';
  end if;
  if coalesce(app.household_role(p_household), '') not in ('owner', 'partner') then
    raise exception 'Only an owner or a partner posts the household''s recurring entries.' using errcode = '42501';
  end if;

  -- Each rule is locked while it is posted, and one another device holds is skipped: two devices take turns and neither posts twice.
  for r in
    select x.*
      from public.recurring_rule x
     where x.household_id = p_household and x.status = 'active' and x.auto_post and x.next_due <= v_today
     order by x.next_due, x.id
       for update skip locked
  loop
    v_step := case r.cadence when 'monthly' then 1 when 'quarterly' then 3 when 'half_yearly' then 6 else 12 end;
    v_due := r.next_due;
    v_count := 0;

    -- Every due date up to today, and at most two years of catching up at a time: a rule left for longer finishes next time.
    while v_due <= v_today and v_count < 24 loop
      insert into public.expense_txn
        (household_id, member_id, category_id, txn_date, amount_minor, currency, payee, method, visibility,
         captured_via, recurring_rule_id, due_date)
      values
        (p_household, r.member_id, r.category_id, v_due, r.amount_minor, r.currency, coalesce(r.payee, r.name), r.method, r.visibility,
         'rule', r.id, v_due)
      on conflict (recurring_rule_id, due_date) where recurring_rule_id is not null do nothing;
      get diagnostics v_made = row_count;
      v_posted := v_posted + v_made;

      v_due := (date_trunc('month', v_due) + make_interval(months => v_step))::date + (r.due_day - 1);
      v_count := v_count + 1;
    end loop;

    update public.recurring_rule set next_due = v_due where id = r.id;
  end loop;

  return v_posted;
end;
$fn$;

comment on function public.post_due_recurring(uuid) is
  'Posts every due date up to today (in India) of each active, self-posting rule of the household, once per due date, and advances the rule. As the caller, so row-level security decides each entry. Owner and partner, second factor. Returns how many entries it made.';

revoke all on function public.post_due_recurring(uuid) from public;
grant execute on function public.post_due_recurring(uuid) to authenticated;

-- ───────────────────────────────────────────── the demo household gets two

-- Replaces the seed of 20261102120000_gold.sql with one that also seeds two recurring rules.

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
  v_inst_gs    uuid;   -- the gold savings scheme's instrument
  v_hold_gs    uuid;   -- and its holding
  v_gs_start   date;
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

    -- A jeweller's gold savings scheme, by amount: eleven instalments of five thousand on the 10th, five of them paid, the bonus one
    -- instalment at maturity. Valued as the instalments paid (GD-I2), so its value is twenty-five thousand and the bonus is not in
    -- it. The jeweller is fictional.
    v_gs_start := (date_trunc('month', v_today) - interval '4 months')::date + 9;

    insert into public.instrument
      (household_id, name, kind, gold_form, currency, exposure_currency, is_foreign_asset)
    values (v_household, 'Gold savings (Demo Jewellers)', 'gold', 'jeweller_scheme', 'INR', 'INR', false)
    returning id into v_inst_gs;

    insert into public.holding (household_id, member_id, instrument_id, quantity, cost_minor, opened_on)
    values (v_household, v_owner, v_inst_gs, 1, 2500000, v_gs_start)
    returning id into v_hold_gs;

    insert into public.gold_scheme_terms
      (holding_id, household_id, variant, jeweller, instalment_minor, currency, instalments, start_date, due_day,
       bonus_text, bonus_minor, scheme_last4, created_by)
    values (v_hold_gs, v_household, 'amount', 'Demo Jewellers', 500000, 'INR', 11, v_gs_start, 10,
            'one instalment, at maturity', 500000, '2093', v_account);

    insert into public.lot (household_id, holding_id, acquired_on, quantity, cost_minor, currency, kind, note, created_by)
    select v_household, v_hold_gs, (v_gs_start + make_interval(months => n))::date, 5000, 500000, 'INR', 'purchase',
           'Instalment ' || (n + 1)::text, v_account
      from generate_series(0, 4) as n;

    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, note, created_by)
    values (v_household, v_hold_gs, v_today, 1, 2500000, 'INR', 'manual', 'Worked out from the instalments paid.', v_account);

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
  -- A gold scheme's terms hang off its holding by a restricting foreign key, so they go with the other terms, before the holdings.
  delete from public.gold_scheme_terms   where household_id = target_household_id;
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
