-- Family Finance Buddy — design invariants that can be asserted against the schema alone.
--
-- Each description opens with the invariant's ID (docs/design/keeping-docs-honest.md): the title is what
-- scripts/check-invariants.mjs reads, so a run of this file names the rules it is holding. They are true
-- today and are here so that a migration which makes one false fails the deploy, not a review.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(2);

-- docs/design/detail-level.md, DL-I6. Most members never sign in, so a display preference on one does
-- nothing, and an inert setting is one somebody changes and then wonders why nothing happened. The
-- preference belongs to whoever reads, and the way to keep it from being stored on the wrong thing is
-- that the column cannot exist there.
select is_empty(
  $q$ select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'member' and column_name = 'detail_level' $q$,
  'DL-I6 — the member table has no detail_level column'
);

-- docs/design/protection-and-flow.md, PF-C1. A policy has a cover, which is not money owned and must never
-- be added to money owned. The failure is a person typing the number printed on the policy into a value
-- field and net worth jumping by a crore. So no column on it is named like a value, a worth or a
-- surrender value; cash value, where a policy has one, lives on a linked holding.
select is_empty(
  $q$ select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'insurance_policy'
         and column_name ~* '(value|worth|surrender)' $q$,
  'PF-C1 — a policy has no value column, under any name'
);

select * from finish();

rollback;
