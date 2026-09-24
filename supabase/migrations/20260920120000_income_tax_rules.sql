-- Family Finance Buddy — the slabs, the rebate, the surcharge and the cess.
--
-- `20260912120000` made `tax_rule` and seeded the capital-gains regime, and left
-- the other kinds in the check constraint "so the slab and surcharge work lands
-- in this table rather than inventing a second one beside it". This is that
-- work: the rate tables an income tax computation is built from.
--
-- Same principle as before, and the same reason. The Act is the same for every
-- household and belongs to none of them, so this is readable by any member and
-- writable by no client. A Budget change is a migration, reviewed and versioned,
-- and nothing here is fetched from anywhere at runtime.
--
-- ── what is seeded, and where it comes from ─────────────────────────────
--
-- Only what could be checked, and only from the year it was checked for. Tax
-- year 2026-27 carries the 2025-26 tables: Budget 2026 (1 February 2026)
-- changed neither the slabs, the rebate, the standard deduction, the surcharge
-- nor the capital-gains rates. That was checked on the date below against
-- published summaries by several advisory sites, NOT against the text of the
-- Finance Act — so `verified_on` says when somebody looked, and the `authority`
-- column says where the figure is meant to come from, and neither is a
-- substitute for a CA reading the Act. Years before 2025-26 are deliberately
-- not seeded: with no row covering a date, the computation refuses, which is
-- better than applying this year's slabs to a year they did not govern.
--
-- The Income-tax Act 2025 takes effect for tax year 2026-27 and renumbers the
-- sections. Rates and principles carry over; section labels do not. The
-- authority strings therefore name the section it appeared under in the 1961
-- Act and say the 2025 Act carries it, rather than inventing a new number.
--
-- ── three columns ──────────────────────────────────────────────────────
--
-- `amount_minor` — a fixed rupee figure. A rebate has an income ceiling AND a
--   maximum (₹60,000 up to ₹12 lakh), and a standard deduction is an amount.
--   Neither fits `rate_pct` or a band, and stuffing one into `band_to_minor`
--   as the exemption rows did would leave a rebate with two numbers and one
--   slot.
--
-- `subject` — what a `deduction_cap` is a cap on. Without it the standard
--   deduction and a future section 80C cap are two rows nothing tells apart.
--
-- `verified_on` — when somebody last checked this row against the law. The
--   screen shows it, because the risk that matters is not a wrong rate today
--   but a Budget changing one while the app quietly goes on using last year's:
--   this is the date that lets a person see the rules are old.
--
-- ── the shape, stated as constraints ────────────────────────────────────
--
-- A slab with no rate, a rebate with no maximum, a surcharge tier with no
-- floor: each reads fine as a row and computes nonsense. So each is refused by
-- the table, the way `tax_rule_shape_matches_kind` already refuses a holding
-- period of "12.5 percent".

alter table public.tax_rule
  add column amount_minor bigint
    check (amount_minor is null or amount_minor >= 0),
  add column subject text
    check (subject is null or subject ~ '^[a-z0-9_]+$'),
  add column verified_on date;

comment on column public.tax_rule.amount_minor is
  'A fixed amount in minor units: the maximum a rebate gives, or the size of a standard deduction. Null on every other kind.';
comment on column public.tax_rule.subject is
  'What a deduction_cap is a cap on — standard_deduction today, a section number later. Null on every other kind.';
comment on column public.tax_rule.verified_on is
  'When this row was last checked against the law. A date to be shown, not a guarantee: the check was against published summaries, and a CA reading the Act is the check that counts.';

alter table public.tax_rule
  add constraint tax_rule_amount_only_where_meant
    check (amount_minor is null or kind in ('rebate', 'deduction_cap')),
  add constraint tax_rule_rebate_and_cap_have_an_amount
    check (kind not in ('rebate', 'deduction_cap') or amount_minor is not null),
  add constraint tax_rule_deduction_cap_names_its_subject
    check (kind <> 'deduction_cap' or subject is not null),
  add constraint tax_rule_slab_and_surcharge_have_a_floor_and_a_rate
    check (kind not in ('slab', 'surcharge') or (band_from_minor is not null and rate_pct is not null)),
  add constraint tax_rule_cess_has_a_rate
    check (kind <> 'cess' or rate_pct is not null),
  -- The regimes differ on all of these; cess is the same in both.
  add constraint tax_rule_regime_where_regimes_differ
    check (kind not in ('slab', 'surcharge', 'rebate', 'deduction_cap') or regime is not null);

-- ══════════════════════════════════════════════════════════════ the rows
--
-- Bands are [from, to): tax on income x is the sum, over each band the income
-- reaches, of rate × (min(x, to) − from). `to` of one band is the `from` of the
-- next, and the top band has none — the constraints and the test beside this
-- file hold it to that. All amounts are paise: ₹1 lakh is 10,000,000.

insert into public.tax_rule
  (jurisdiction, kind, regime, band_from_minor, band_to_minor, rate_pct,
   effective_from, effective_to, authority, verified_on)
values
  -- New regime. Nil to ₹4 lakh, then 5, 10, 15, 20, 25 per cent in ₹4 lakh
  -- steps, and 30 per cent above ₹24 lakh.
  ('IN', 'slab', 'new',           0,  40000000,  0, date '2025-04-01', null, 'Finance Act 2025, First Schedule — new regime, s. 115BAC(1A); carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'new',    40000000,  80000000,  5, date '2025-04-01', null, 'Finance Act 2025, First Schedule — new regime, s. 115BAC(1A); carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'new',    80000000, 120000000, 10, date '2025-04-01', null, 'Finance Act 2025, First Schedule — new regime, s. 115BAC(1A); carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'new',   120000000, 160000000, 15, date '2025-04-01', null, 'Finance Act 2025, First Schedule — new regime, s. 115BAC(1A); carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'new',   160000000, 200000000, 20, date '2025-04-01', null, 'Finance Act 2025, First Schedule — new regime, s. 115BAC(1A); carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'new',   200000000, 240000000, 25, date '2025-04-01', null, 'Finance Act 2025, First Schedule — new regime, s. 115BAC(1A); carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'new',   240000000,      null, 30, date '2025-04-01', null, 'Finance Act 2025, First Schedule — new regime, s. 115BAC(1A); carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),

  -- Old regime, for an individual under sixty. Nil to ₹2.5 lakh, 5 per cent to
  -- ₹5 lakh, 20 per cent to ₹10 lakh, 30 per cent above. Seniors have a higher
  -- basic exemption and are NOT modelled: the computation says it assumes
  -- under sixty, and nothing here holds a date of birth.
  ('IN', 'slab', 'old',           0,  25000000,  0, date '2025-04-01', null, 'Finance Act 2025, First Schedule, Part III — old regime, individual below 60; carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'old',    25000000,  50000000,  5, date '2025-04-01', null, 'Finance Act 2025, First Schedule, Part III — old regime, individual below 60; carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'old',    50000000, 100000000, 20, date '2025-04-01', null, 'Finance Act 2025, First Schedule, Part III — old regime, individual below 60; carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24'),
  ('IN', 'slab', 'old',   100000000,      null, 30, date '2025-04-01', null, 'Finance Act 2025, First Schedule, Part III — old regime, individual below 60; carried into the Income-tax Act 2025 for tax year 2026-27', date '2026-09-24');

-- Surcharge. A step on the whole tax once total income passes a threshold,
-- softened by marginal relief in the computation. The new regime stops at 25
-- per cent; the old goes on to 37 per cent above ₹5 crore.
insert into public.tax_rule
  (jurisdiction, kind, regime, band_from_minor, band_to_minor, rate_pct,
   effective_from, effective_to, authority, verified_on)
values
  ('IN', 'surcharge', 'new',   500000000, 1000000000, 10, date '2025-04-01', null, 'Finance Act 2025, First Schedule — surcharge; new regime capped at 25 per cent', date '2026-09-24'),
  ('IN', 'surcharge', 'new',  1000000000, 2000000000, 15, date '2025-04-01', null, 'Finance Act 2025, First Schedule — surcharge; new regime capped at 25 per cent', date '2026-09-24'),
  ('IN', 'surcharge', 'new',  2000000000,       null, 25, date '2025-04-01', null, 'Finance Act 2025, First Schedule — surcharge; new regime capped at 25 per cent', date '2026-09-24'),

  ('IN', 'surcharge', 'old',   500000000, 1000000000, 10, date '2025-04-01', null, 'Finance Act 2025, First Schedule — surcharge; old regime reaches 37 per cent above ₹5 crore', date '2026-09-24'),
  ('IN', 'surcharge', 'old',  1000000000, 2000000000, 15, date '2025-04-01', null, 'Finance Act 2025, First Schedule — surcharge; old regime reaches 37 per cent above ₹5 crore', date '2026-09-24'),
  ('IN', 'surcharge', 'old',  2000000000, 5000000000, 25, date '2025-04-01', null, 'Finance Act 2025, First Schedule — surcharge; old regime reaches 37 per cent above ₹5 crore', date '2026-09-24'),
  ('IN', 'surcharge', 'old',  5000000000,       null, 37, date '2025-04-01', null, 'Finance Act 2025, First Schedule — surcharge; old regime reaches 37 per cent above ₹5 crore', date '2026-09-24');

-- The rebate under section 87A. A ceiling on income (`band_to_minor`) and the
-- most it gives (`amount_minor`). New regime: up to ₹60,000 where income is up
-- to ₹12 lakh. Old regime: up to ₹12,500 where income is up to ₹5 lakh — and a
-- cliff, not a slope, which is the difference the computation has to keep.
-- It is not available against tax on income taxed at special rates, such as
-- capital gains; that is a rule of the computation, and this table has no
-- column to say it in.
insert into public.tax_rule
  (jurisdiction, kind, regime, band_from_minor, band_to_minor, amount_minor,
   effective_from, effective_to, authority, verified_on)
values
  ('IN', 'rebate', 'new', 0, 120000000, 6000000, date '2025-04-01', null, 'Finance Act 2025, s. 87A — new regime; carried into the Income-tax Act 2025 (s. 156) for tax year 2026-27', date '2026-09-24'),
  ('IN', 'rebate', 'old', 0,  50000000, 1250000, date '2025-04-01', null, 'Income-tax Act 1961, s. 87A — old regime; carried into the Income-tax Act 2025 (s. 156) for tax year 2026-27', date '2026-09-24');

-- The standard deduction, from salary. ₹75,000 in the new regime, ₹50,000 in the old.
insert into public.tax_rule
  (jurisdiction, kind, regime, subject, amount_minor,
   effective_from, effective_to, authority, verified_on)
values
  ('IN', 'deduction_cap', 'new', 'standard_deduction', 7500000, date '2025-04-01', null, 'Finance Act 2024, s. 16(ia) — new regime; unchanged for tax year 2026-27', date '2026-09-24'),
  ('IN', 'deduction_cap', 'old', 'standard_deduction', 5000000, date '2025-04-01', null, 'Income-tax Act 1961, s. 16(ia) — old regime; unchanged for tax year 2026-27', date '2026-09-24');

-- Health and education cess: four per cent of tax plus surcharge, in both regimes.
insert into public.tax_rule
  (jurisdiction, kind, rate_pct, effective_from, effective_to, authority, verified_on)
values
  ('IN', 'cess', 4, date '2025-04-01', null, 'Finance Act 2025, First Schedule — health and education cess', date '2026-09-24');

-- The capital-gains rows from `20260912120000` were checked the same day, and
-- Budget 2026 changed none of them: 12.5 per cent long term, 20 per cent short
-- term on equity, the ₹1.25 lakh allowance, and the twelve and twenty-four
-- month holding periods. Stamped so the screen can say when they were looked at.
update public.tax_rule
   set verified_on = date '2026-09-24'
 where verified_on is null;
