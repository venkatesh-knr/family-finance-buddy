-- Family Finance Buddy — the slab bands in force on any date still tile.
--
-- `tax_rule_income.test.sql` proves the 2025-26 tables are whole, and is scoped
-- to rows effective from 2025-04-01 so that a later Budget adds its own dated
-- rows without it needing to change. That scope is also its blind spot: a later
-- Budget's rows are not checked at all, and a later Budget is exactly where the
-- hazard is.
--
-- The engine reads the bands in force on a date and, where two rows start at the
-- same floor, takes the later-dated one. So when a Budget changes the *structure*
-- of the slabs — different floors, not just different rates — a migration that
-- adds the new rows and forgets to end-date the old ones leaves both sets in
-- force. The new floors and the old ones interleave, and the result is a slab
-- table with an overlap in it that computes a plausible, wrong, tax.
--
-- So this checks the property, not a year. For every date on which the rules of a
-- kind and regime start or stop, the bands in force are contiguous, start where
-- they should, and end open; no such date is left with nothing in force; and no
-- two rows are ambiguous about which supersedes which.
--
-- The last two assertions are the proof that the check can fail. They add the
-- structure of a hypothetical Budget without end-dating the old rows, and expect
-- the check to say so, then end-date them and expect it to be satisfied. Inside
-- a transaction that is rolled back, run as the owner as a migration would be.
--
-- Rates are not asserted anywhere: they are data with an `authority` and a
-- `verified_on`, and belong to a Budget rather than to a test.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(6);

-- Every date on which the rules of a kind and regime change: a row starting, or
-- the day after one ends.
create temp view boundary_days as
  select kind, regime, effective_from as day
    from public.tax_rule
   where jurisdiction = 'IN' and kind in ('slab', 'surcharge')
  union
  select kind, regime, effective_to + 1
    from public.tax_rule
   where jurisdiction = 'IN' and kind in ('slab', 'surcharge') and effective_to is not null;

-- The bands in force on each of those days, one per floor, the later-dated row
-- winning — the same reading the computation makes.
create temp view bands_in_force as
  select distinct on (d.kind, d.regime, d.day, r.band_from_minor)
         d.kind, d.regime, d.day, r.band_from_minor, r.band_to_minor
    from boundary_days d
    join public.tax_rule r
      on r.jurisdiction = 'IN'
     and r.kind = d.kind
     and r.regime = d.regime
     and r.effective_from <= d.day
     and (r.effective_to is null or r.effective_to >= d.day)
   order by d.kind, d.regime, d.day, r.band_from_minor, r.effective_from desc;

-- Bands that do not end where the next begins, or a top band that has an end.
create function pg_temp.tiling_problems() returns bigint
language sql as $$
  select count(*) from (
    select band_to_minor,
           lead(band_from_minor) over (
             partition by kind, regime, day order by band_from_minor
           ) as next_from,
           row_number() over (
             partition by kind, regime, day order by band_from_minor desc
           ) as from_top
      from bands_in_force
  ) as chained
  where (from_top > 1 and band_to_minor is distinct from next_from)
     or (from_top = 1 and band_to_minor is not null)
$$;

-- A slab table that does not start at zero leaves the first rupees untaxed by
-- anything. (A surcharge legitimately starts higher, so this is slabs only.)
create function pg_temp.slabs_not_from_zero() returns bigint
language sql as $$
  select count(*) from (
    select min(band_from_minor) as lowest
      from bands_in_force
     where kind = 'slab'
     group by regime, day
  ) as floors
  where lowest <> 0
$$;

-- A day on which the rules change and nothing of that kind is in force: a period
-- with no slabs at all.
create function pg_temp.days_with_nothing_in_force() returns bigint
language sql as $$
  select count(*) from (select distinct kind, regime, day from boundary_days) as d
   where not exists (
     select 1 from bands_in_force f
      where f.kind = d.kind and f.regime = d.regime and f.day = d.day
   )
$$;

-- Two rows for the same floor that start on the same day: neither supersedes the
-- other, so which one is used would be an accident of the query.
create function pg_temp.ambiguous_rows() returns bigint
language sql as $$
  select count(*) from (
    select 1
      from public.tax_rule
     where jurisdiction = 'IN' and kind in ('slab', 'surcharge')
     group by kind, regime, band_from_minor, effective_from
    having count(*) > 1
  ) as pairs
$$;

-- ═══════════════════════════════════ what is seeded holds together (4)

select is(
  pg_temp.tiling_problems(),
  0::bigint,
  'on every date the rules change, the bands in force are contiguous and end open'
);

select is(
  pg_temp.slabs_not_from_zero(),
  0::bigint,
  'and the slabs in force on each of those dates start at zero'
);

select is(
  pg_temp.days_with_nothing_in_force(),
  0::bigint,
  'and no date on which rules change is left with none of that kind in force'
);

select is(
  pg_temp.ambiguous_rows(),
  0::bigint,
  'and no two rows for the same floor start on the same day'
);

-- ═════════════════════════ the check can fail, and the fix satisfies it (2)
--
-- A hypothetical Budget for 2027-28 that changes the new regime's structure: two
-- bands, at floors the current table does not have.

insert into public.tax_rule
  (jurisdiction, kind, regime, band_from_minor, band_to_minor, rate_pct,
   effective_from, effective_to, authority, verified_on)
values
  ('IN', 'slab', 'new', 0,         500000000, 0,  date '2027-04-01', null, 'a hypothetical Budget', date '2027-02-01'),
  ('IN', 'slab', 'new', 500000000, null,      10, date '2027-04-01', null, 'a hypothetical Budget', date '2027-02-01');

select cmp_ok(
  pg_temp.tiling_problems(),
  '>',
  0::bigint,
  'a Budget that adds new bands and forgets to end-date the old ones is caught'
);

update public.tax_rule
   set effective_to = date '2027-03-31'
 where kind = 'slab' and regime = 'new' and effective_from = date '2025-04-01';

select is(
  pg_temp.tiling_problems()
    + pg_temp.slabs_not_from_zero()
    + pg_temp.days_with_nothing_in_force()
    + pg_temp.ambiguous_rows(),
  0::bigint,
  'and end-dating them satisfies every check'
);

select * from finish();

rollback;
