-- Family Finance Buddy — the rate tables are whole, and malformed rows are refused.
--
-- `tax_rule.test.sql` proves who may read and who may write the rules. This is
-- the other half: that what is in them is the right shape.
--
-- A slab table has three ways to be wrong without looking wrong. A gap between
-- two bands leaves a slice of income untaxed; an overlap taxes it twice; a top
-- band with an upper limit stops taxing at some figure nobody chose. Each reads
-- as a plausible table and computes a plausible, wrong, number. So the
-- assertions are about the structure — contiguous, starting at zero, one open
-- top, rates that only go up — and not about the rates themselves, which are
-- data with an `authority` and a `verified_on`, and belong to a Budget rather
-- than to a test.
--
-- The second block is the constraints added beside them: a rebate with no
-- maximum, a deduction cap that names nothing, a slab with no rate. Each is
-- refused by the table, as a holding period of "12.5 percent" already is.
--
-- Scoped to the rows effective from 2025-04-01, the first year seeded, so a
-- later Budget adds its own dated rows without this needing to change.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(16);

-- ═══════════════════════════════════════════════ the slabs are whole (4)

select is(
  (select count(*)::int from (
     select band_from_minor,
            lag(band_to_minor) over (partition by regime order by band_from_minor) as previous_to
       from public.tax_rule
      where kind = 'slab' and jurisdiction = 'IN' and effective_from = date '2025-04-01'
   ) as bands
   where previous_to is not null and band_from_minor <> previous_to),
  0,
  'every slab band starts where the one before it ended — no gap, no overlap'
);

select is(
  (select count(*)::int from (
     select regime, min(band_from_minor) as lowest
       from public.tax_rule
      where kind = 'slab' and jurisdiction = 'IN' and effective_from = date '2025-04-01'
      group by regime
   ) as floors
   where lowest <> 0),
  0,
  'each regime''s slabs start at zero, so the first rupee is accounted for'
);

select is(
  (select count(*)::int from (
     select regime, count(*) filter (where band_to_minor is null) as open_tops
       from public.tax_rule
      where kind = 'slab' and jurisdiction = 'IN' and effective_from = date '2025-04-01'
      group by regime
   ) as tops
   where open_tops <> 1),
  0,
  'each regime has exactly one open-ended top band, so no income falls off the end'
);

select is(
  (select count(*)::int from (
     select rate_pct,
            lag(rate_pct) over (partition by regime order by band_from_minor) as previous_rate
       from public.tax_rule
      where kind = 'slab' and jurisdiction = 'IN' and effective_from = date '2025-04-01'
   ) as rates
   where previous_rate is not null and rate_pct < previous_rate),
  0,
  'a slab rate never falls as income rises'
);

-- ═══════════════════════════════════════════ the surcharge is whole (4)

select is(
  (select count(*)::int from (
     select band_from_minor,
            lag(band_to_minor) over (partition by regime order by band_from_minor) as previous_to
       from public.tax_rule
      where kind = 'surcharge' and jurisdiction = 'IN' and effective_from = date '2025-04-01'
   ) as tiers
   where previous_to is not null and band_from_minor <> previous_to),
  0,
  'every surcharge tier starts where the one before it ended'
);

-- Fifty lakh, in paise. Below it there is no surcharge, and that is what the
-- computation takes an absent tier to mean.
select is(
  (select count(*)::int from (
     select regime, min(band_from_minor) as lowest
       from public.tax_rule
      where kind = 'surcharge' and jurisdiction = 'IN' and effective_from = date '2025-04-01'
      group by regime
   ) as floors
   where lowest <> 500000000),
  0,
  'the surcharge starts at ₹50 lakh in both regimes'
);

select is(
  (select max(rate_pct) from public.tax_rule
    where kind = 'surcharge' and regime = 'new' and effective_from = date '2025-04-01'),
  25.000::numeric,
  'the new regime''s surcharge stops at 25 per cent'
);

select is(
  (select max(rate_pct) from public.tax_rule
    where kind = 'surcharge' and regime = 'old' and effective_from = date '2025-04-01'),
  37.000::numeric,
  'and the old regime''s reaches 37 per cent'
);

-- ═════════════════════════════════════ one of each, and it says when (4)

select is(
  (select count(*)::int from (
     select regime, count(*) as n
       from public.tax_rule
      where kind = 'rebate' and effective_from = date '2025-04-01'
      group by regime
   ) as per_regime
   where n <> 1),
  0,
  'each regime has exactly one rebate — two would be a choice the computation cannot make'
);

select is(
  (select count(*)::int from (
     select regime, count(*) as n
       from public.tax_rule
      where kind = 'deduction_cap' and subject = 'standard_deduction' and effective_from = date '2025-04-01'
      group by regime
   ) as per_regime
   where n <> 1),
  0,
  'and exactly one standard deduction'
);

select is(
  (select count(*)::int from public.tax_rule
    where kind = 'cess' and effective_from = date '2025-04-01' and rate_pct = 4),
  1,
  'there is one cess, at four per cent, for both regimes'
);

-- "verified_on says when somebody looked" is only worth showing if it is there.
select is(
  (select count(*)::int from public.tax_rule where verified_on is null),
  0,
  'every rule says when it was last checked'
);

-- ══════════════════════════════ malformed rows are refused by the table (4)
--
-- Run as the owner, which is how a migration would insert one. A check
-- constraint applies to everybody, so this is the same refusal a client would
-- meet if a client could write at all — which is the point of stating the shape
-- as constraints rather than trusting whoever writes the next Budget.

select throws_ok(
  $q$ insert into public.tax_rule
        (jurisdiction, kind, regime, band_from_minor, band_to_minor, effective_from, authority)
      values ('IN', 'rebate', 'new', 0, 1, date '2030-01-01', 'a test') $q$,
  '23514'::char(5),
  null::text,
  'a rebate with no maximum is refused'
);

select throws_ok(
  $q$ insert into public.tax_rule
        (jurisdiction, kind, regime, amount_minor, effective_from, authority)
      values ('IN', 'deduction_cap', 'new', 100, date '2030-01-01', 'a test') $q$,
  '23514'::char(5),
  null::text,
  'a deduction cap that names nothing it caps is refused'
);

select throws_ok(
  $q$ insert into public.tax_rule
        (jurisdiction, kind, regime, band_from_minor, amount_minor, rate_pct, effective_from, authority)
      values ('IN', 'slab', 'new', 0, 100, 5, date '2030-01-01', 'a test') $q$,
  '23514'::char(5),
  null::text,
  'a fixed amount on a slab is refused — it is a rebate''s or a deduction''s'
);

select throws_ok(
  $q$ insert into public.tax_rule
        (jurisdiction, kind, regime, band_from_minor, band_to_minor, effective_from, authority)
      values ('IN', 'slab', 'new', 0, 100, date '2030-01-01', 'a test') $q$,
  '23514'::char(5),
  null::text,
  'and a slab with no rate is refused'
);

select * from finish();

rollback;
