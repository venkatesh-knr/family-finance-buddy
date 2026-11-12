-- DRAFT FOR REVIEW. NOT IN supabase/migrations AND NOT APPLIED.
-- Move to supabase/migrations/20261112120000_section_deduction_caps.sql once the figures and the open questions are settled.
--
-- Family Finance Buddy — the caps on the deductions the old regime allows under 80C and 80D.
--
-- `20260920120000` made `deduction_cap` carry a `subject` ("standard_deduction today, a section number later") and seeded the
-- standard deduction. This is the later: the ceilings that section deductions (build-plan step 3b) are held to. Rows only. No
-- column, no constraint and no policy changes, so the table's own shape checks and its read-only grants already govern them, and
-- no new RLS, grant or audit obligation arises.
--
-- ── what is seeded, and where it comes from ───────────────────────────────
--
-- The OLD regime only. The new regime allows neither deduction, and "no row" is how the table says so: the computation applies a
-- section deduction only where a cap row exists for the regime, so nothing is read as an allowance of nothing.
--
-- The figures are the ones that applied in tax year 2025-26 and that Budget 2026 (1 February 2026) did not change: ₹1,50,000 under
-- 80C, ₹25,000 or ₹50,000 under 80D by age, ₹5,000 of it for a preventive check-up. They were checked on the date below against
-- published summaries by tax-advisory and insurer sites, NOT against the text of the Act (the Income Tax Department's own pages
-- refused the request), so `verified_on` says when somebody looked and a CA reading the Act is the check that counts.
--
-- The Income-tax Act 2025 takes effect for tax year 2026-27 and renumbers the sections. The authority strings name the section as
-- it stood in the 1961 Act and say the 2025 Act carries it, as the existing rows do, and do not give a new number: the summaries
-- consulted give 123 (with Schedule XV) for 80C and 126 for 80D, but a number nobody read in the Act is not worth writing down.
--
-- ── subjects ──────────────────────────────────────────────────────────────
--
-- `section_80c`                 one combined ceiling over everything 80C lists (life premiums, PPF, SSY, NSC, ELSS, EPF, tuition
--                               fees, the principal of a home loan, and the rest); the engine adds them and applies this once.
-- `section_80d_self`            premiums for the taxpayer, spouse and children, when none of them is a senior citizen.
-- `section_80d_self_senior`     the same, when the taxpayer or spouse is a senior citizen (sixty or over).
-- `section_80d_parents`         premiums for parents, when neither is a senior citizen.
-- `section_80d_parents_senior`  the same, when a parent is a senior citizen.
-- `section_80d_checkup`         a preventive health check-up, which is inside the 80D ceilings above and not on top of them.
--
-- Six rows, one per subject, none ended. `effective_from` is the first year seeded, as for the other kinds: a year before it has
-- no row, and the computation refuses it rather than apply a year's ceilings to a year they did not govern.

insert into public.tax_rule
  (jurisdiction, kind, regime, subject, amount_minor,
   effective_from, effective_to, authority, verified_on)
values
  ('IN', 'deduction_cap', 'old', 'section_80c',                15000000, date '2025-04-01', null,
   'Income-tax Act 1961, s. 80C (with 80CCC and 80CCD(1)) — old regime only; carried into the Income-tax Act 2025 for tax year 2026-27, limit unchanged', date '2026-11-12'),

  ('IN', 'deduction_cap', 'old', 'section_80d_self',            2500000, date '2025-04-01', null,
   'Income-tax Act 1961, s. 80D — premiums for self, spouse and children, none a senior citizen; old regime only; carried into the Income-tax Act 2025 for tax year 2026-27, limit unchanged', date '2026-11-12'),
  ('IN', 'deduction_cap', 'old', 'section_80d_self_senior',     5000000, date '2025-04-01', null,
   'Income-tax Act 1961, s. 80D — premiums for self, spouse and children where the taxpayer or spouse is sixty or over; old regime only; carried into the Income-tax Act 2025 for tax year 2026-27, limit unchanged', date '2026-11-12'),
  ('IN', 'deduction_cap', 'old', 'section_80d_parents',         2500000, date '2025-04-01', null,
   'Income-tax Act 1961, s. 80D — premiums for parents, neither a senior citizen; old regime only; carried into the Income-tax Act 2025 for tax year 2026-27, limit unchanged', date '2026-11-12'),
  ('IN', 'deduction_cap', 'old', 'section_80d_parents_senior',  5000000, date '2025-04-01', null,
   'Income-tax Act 1961, s. 80D — premiums for parents where a parent is sixty or over; old regime only; carried into the Income-tax Act 2025 for tax year 2026-27, limit unchanged', date '2026-11-12'),
  ('IN', 'deduction_cap', 'old', 'section_80d_checkup',          500000, date '2025-04-01', null,
   'Income-tax Act 1961, s. 80D — preventive health check-up, inside the limits above and not additional to them; old regime only; carried into the Income-tax Act 2025 for tax year 2026-27, limit unchanged', date '2026-11-12');

-- The most 80D allows in all, ₹1,00,000 where both the taxpayer's side and the parents' side are senior, is not a row: it is the sum
-- of the two ceilings that apply, and a row for it would be a figure that could disagree with them.
