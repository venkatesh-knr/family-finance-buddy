-- Family Finance Buddy — the seed's partial-statement fund says so.
--
-- 20261014120000 seeded a fund with purchases for 600 of its 1,500.5 units, and the Holdings screen still
-- showed it with a return, because a position is "resting on a partial statement" only when the holding
-- carries a stated closing balance (stated_quantity, stated_as_at: 20260919120000), and units are counted
-- from that balance and not from the holding's own quantity. The fund now carries one, dated the last day
-- of August like the readings beside it. Its name no longer says "(partial statement)": a row that long
-- wraps on a phone, and the screen is meant to say it, not the name.
--
-- app.seed_demo_household as 20261014120000 left it, with those two changes. Seed data only.

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
  end;

  return true;
end;
$fn$;

comment on function app.seed_demo_household(uuid, uuid) is
  'Fills a demo household with the awkward cases. Refuses anything not marked demo; returns false if already seeded. Granted to nobody: reached through reset_demo_household or by the project owner.';

revoke all on function app.seed_demo_household(uuid, uuid) from public;
