-- DRAFT FOR REVIEW. Move to supabase/tests/tax_rule_deductions.test.sql with the migration beside it.
--
-- Family Finance Buddy — the section deduction caps are whole.
--
-- The same kind of assertion as `tax_rule_income.test.sql`: about the structure, not the figures. A figure is data with an
-- `authority` and a `verified_on`, and belongs to a Budget rather than to a test. What a test can hold is that there is one cap
-- per subject in force on a date (two would be a choice the computation cannot make), that the new regime has none (it allows
-- neither deduction), and that the 80D check-up sits inside the smallest 80D ceiling and not above it.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

select plan(6);

select is(
  (select count(*)::int from (
     select regime, subject, count(*) as n
       from public.tax_rule
      where kind = 'deduction_cap'
        and subject like 'section\_%'
        and effective_from <= date '2026-11-12'
        and (effective_to is null or effective_to > date '2026-11-12')
      group by regime, subject
   ) as per_subject
   where n <> 1),
  0,
  'each section deduction has exactly one cap in force'
);

select is(
  (select count(distinct subject)::int from public.tax_rule
    where kind = 'deduction_cap' and subject like 'section\_%' and effective_from = date '2025-04-01'),
  4,
  'the four subjects are seeded: 80C, the two 80D ceilings and the check-up'
);

select is(
  (select count(*)::int from public.tax_rule
    where kind = 'deduction_cap' and subject like 'section\_%' and regime is distinct from 'old'),
  0,
  'the new regime has no section deductions, and nothing says it allows an amount of nothing'
);

select is(
  (select count(*)::int from public.tax_rule
    where kind = 'deduction_cap' and subject like 'section\_%' and amount_minor <= 0),
  0,
  'every section cap is an amount above nothing'
);

select ok(
  (select amount_minor from public.tax_rule
    where kind = 'deduction_cap' and subject = 'section_80d_checkup' and effective_to is null)
  <= (select min(amount_minor) from public.tax_rule
       where kind = 'deduction_cap' and subject like 'section\_80d\_%' and subject <> 'section_80d_checkup' and effective_to is null),
  'the 80D check-up is inside the smallest 80D ceiling and not above it'
);

select is(
  (select count(*)::int from public.tax_rule
    where kind = 'deduction_cap' and subject like 'section\_%' and verified_on is null),
  0,
  'every section cap says when it was last checked'
);

select * from finish();
