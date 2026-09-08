-- Family Finance Buddy — the demo household, built to break things.
--
-- "Seed script producing a full fabricated household — and built to exercise
-- edge cases" (docs/build-plan.md, stage 3). A seed of tidy data proves only
-- that tidy data works, which was never in doubt. Everything below is here
-- because it is awkward: a category nobody ever used, a month with no reading,
-- a spend on the last day of a tax year, an entry one member cannot see.
--
-- WHAT THIS IS NOT
--
-- It is not demo_household.sql. That file creates an auth account with a
-- password committed to a public repository, and is local-only for that reason.
-- This one creates no account at all: it fills a household you already own,
-- which is why it can be run from the SQL editor against the hosted project
-- where the app is actually being used.
--
-- HOW TO RUN
--
--   Supabase dashboard -> SQL Editor -> paste -> Run.
--
-- Safe twice: it stops if it has already run. It refuses outright on anything
-- but a household marked `demo`, because every figure below is invented and a
-- real household must never contain one.

do $seed$
declare
  -- ─── edit this ───────────────────────────────────────────────────────────
  --
  -- Overridable without editing the file, which is how CI points it at a
  -- throwaway household to prove the SQL still matches the schema:
  --
  --   set seed.email = 'someone@example.test';
  --
  v_email text := coalesce(
    nullif(current_setting('seed.email', true), ''),
    'venkatesh.knr@gmail.com'
  );
  -- ─────────────────────────────────────────────────────────────────────────

  v_account   uuid;
  v_household uuid;
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

  -- The tax year containing today, and the calendar year, which are different
  -- questions and both matter: the ledger runs April to March, foreign-asset
  -- disclosure runs January to December.
  v_fy       integer := case when extract(month from current_date) >= 4
                             then extract(year from current_date)::integer
                             else extract(year from current_date)::integer - 1 end;
  v_fy_start date;
  v_cy       integer := extract(year from current_date)::integer;
begin
  v_fy_start := make_date(v_fy, 4, 1);

  -- ══════════════════════════════════════════════════════════ who and where

  select ua.id into v_account
    from public.user_account ua
    join auth.users u on u.id = ua.auth_user_id
   where lower(u.email) = lower(btrim(v_email));

  if v_account is null then
    raise exception 'No account for %. Check the email at the top of this file.', v_email;
  end if;

  select h.id, h.kind into v_household, v_kind
    from public.membership ms
    join public.household h on h.id = ms.household_id
   where ms.user_account_id = v_account
     and ms.revoked_at is null
     and h.kind = 'demo'
   order by h.created_at
   limit 1;

  if v_household is null then
    raise exception 'No demo household for %. This seed never touches a real one.', v_email;
  end if;

  -- Belt as well as braces. The query above already filters on kind, and this
  -- says why out loud for anyone who edits it later.
  if v_kind is distinct from 'demo' then
    raise exception 'Household % is %, not demo. Every figure here is invented.', v_household, v_kind;
  end if;

  select ms.member_id into v_owner
    from public.membership ms
   where ms.user_account_id = v_account and ms.household_id = v_household and ms.revoked_at is null;

  -- Run twice and the second run does nothing. Re-running a seed is a mistake
  -- rather than a request for two of everything, and the marker is a category
  -- that only this file creates.
  if exists (
    select 1 from public.expense_category
     where household_id = v_household and name = 'Piano lessons (never used)'
  ) then
    raise notice 'This household has already been seeded. Nothing to do.';
    return;
  end if;

  -- ═══════════════════════════════════════════════════════════════ members
  --
  -- Meera has no login, which §425 explicitly allows and which is what makes
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
    (v_household, v_owner, v_cat_grocery, current_date - 20, 620000, 'INR', 'Big Basket', 'upi', 'household', v_account),
    (v_household, v_owner, v_cat_grocery, current_date - 12, 481050, 'INR', 'Local market', 'cash', 'household', v_account),
    (v_household, v_meera, v_cat_grocery, current_date -  4, 355500, 'INR', 'Reliance Fresh', 'card', 'household', v_account),

    -- Overspent, and early in the period, which is what pace exists to catch.
    (v_household, v_owner, v_cat_fuel, current_date - 18, 450000, 'INR', 'Indian Oil', 'card', 'household', v_account),
    (v_household, v_owner, v_cat_fuel, current_date -  6, 470000, 'INR', 'HP Petrol', 'upi', 'household', v_account),

    -- Uncategorised. It cannot be compared with anything and must still reach
    -- the total, or the screen disagrees with the ledger.
    (v_household, v_owner, null, current_date - 9, 129900, 'INR', 'Something unfiled', 'upi', 'household', v_account),

    -- On an archived category, which is the whole reason archiving exists.
    (v_household, v_owner, v_cat_retired, v_fy_start + 20, 89900, 'INR', 'Cable renewal', 'auto_debit', 'household', v_account),

    -- An archived member's spending, still counted.
    (v_household, v_former, v_cat_grocery, v_fy_start + 45, 240000, 'INR', 'Household help — March', 'cash', 'household', v_account),

    -- The tax-year boundary, one day either side. These two belong to
    -- different years and nothing about them says so except the date.
    (v_household, v_owner, v_cat_grocery, v_fy_start - 1, 310000, 'INR', 'Last day of the old year', 'upi', 'household', v_account),
    (v_household, v_owner, v_cat_grocery, v_fy_start,     320000, 'INR', 'First day of the new one', 'upi', 'household', v_account),

    -- Foreign currency. Stored native, never converted on the way in.
    (v_household, v_owner, null, current_date - 30, 4999, 'USD', 'Domain renewal', 'card', 'household', v_account),

    -- Private, and belonging to somebody who cannot sign in. Invisible to the
    -- owner as a row; present in the household total as one Personal line.
    (v_household, v_meera, v_cat_grocery, current_date - 14, 770000, 'INR', 'Therapy', 'card', 'personal', v_account),
    (v_household, v_meera, null,          current_date -  3, 250000, 'INR', 'A gift, not yet given', 'upi', 'personal', v_account),

    -- Private, and the owner's own: visible to them, in their categories.
    (v_household, v_owner, v_cat_grocery, current_date - 7, 180000, 'INR', 'Also private', 'cash', 'personal', v_account);

  -- Voided rather than deleted. It must disappear from every total while
  -- staying on the ledger, because "the losing version goes to the audit log"
  -- and a figure that was once relied upon does not get to vanish.
  insert into public.expense_txn
    (household_id, member_id, category_id, txn_date, amount_minor, currency, payee, method,
     visibility, created_by, voided_at, voided_by)
  values
    (v_household, v_owner, v_cat_fuel, current_date - 16, 999900, 'INR', 'Entered twice by mistake', 'card',
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

  raise notice 'Seeded household %.', v_household;
  raise notice 'Members: Meera (no login, has private entries), Priya (archived, has history).';
  raise notice 'Sign in and look for: a Personal line in Budget vs actual, a lower-bound peak with named missing months, an archived category on an old row, a voided expense excluded from totals.';
end;
$seed$;

-- What is NOT here, and why.
--
-- docs/build-plan.md also asks for a loss-making sale, a carried-forward loss,
-- lots either side of the twenty-four-month line, and a foreign dividend with
-- withholding. None of those can be seeded yet: `lot`, `disposal`, `dividend`
-- and `tax_rule` do not exist. The holding is the fast path and the lot ledger
-- fills in behind it (§255), so those four cases arrive with the tables that
-- can hold them rather than being faked in a table that cannot.
