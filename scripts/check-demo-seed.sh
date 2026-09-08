#!/usr/bin/env bash
#
# Family Finance Buddy — does the demo seed still fit the schema?
#
# The seed is a long INSERT script written by hand against a schema that keeps
# moving. Every column it names, every check constraint it has to satisfy and
# every foreign key it depends on is a chance for it to be quietly wrong, and
# nothing else in the pipeline would notice: it is not imported by the app, no
# unit test loads it, and the policy suite builds its own fixtures.
#
# It would be noticed the day somebody set up a household and the whole thing
# failed halfway, leaving a half-seeded mess.
#
# So: against the local stack CI already starts for the policy tests, make a
# throwaway owner and household, run the seed at it, and assert the edge cases
# it promises actually landed. Parsing clean is not running clean — this project
# has paid for that lesson twice.
#
# Usage: scripts/check-demo-seed.sh [database-url]

set -euo pipefail

DB="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
EMAIL='seed-smoke@demo.test'

psql "${DB}" -v ON_ERROR_STOP=1 -q <<SQL
-- A throwaway account and demo household for the seed to fill. Created the
-- long way rather than through the app, because this is testing the seed and
-- not the invite flow.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change,
   email_change_token_new, email_change_token_current,
   phone_change, phone_change_token, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999',
   'authenticated', 'authenticated', '${EMAIL}', 'not-a-real-hash', now(),
   now(), now(), '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', '', '', '', '', '');

-- The on_auth_user_created trigger made the user_account row; the household,
-- member and membership are ours to make.
do \$prep\$
declare
  v_account   uuid;
  v_household uuid;
  v_member    uuid;
begin
  select id into v_account from public.user_account
   where auth_user_id = '99999999-9999-4999-8999-999999999999';

  insert into public.household (name, kind, base_currency, display_currency, fy_start_month)
  values ('Seed smoke test', 'demo', 'INR', 'INR', 4) returning id into v_household;

  insert into public.member (household_id, display_name, colour)
  values (v_household, 'Smoke', 'c1') returning id into v_member;

  insert into public.membership (user_account_id, household_id, member_id, role)
  values (v_account, v_household, v_member, 'owner');
end;
\$prep\$;
SQL

# The seed reads its target from a setting, so this never touches a real one.
PGOPTIONS="-c seed.email=${EMAIL}" psql "${DB}" -v ON_ERROR_STOP=1 -q -f supabase/seed/demo_edge_cases.sql

# Assert the awkward cases actually arrived. A seed that runs without error and
# produces nothing interesting is the failure this script exists to catch — it
# would leave the edge cases unexercised while reporting success.
psql "${DB}" -v ON_ERROR_STOP=1 -q <<'SQL'
do $assert$
declare
  v_household uuid;
  n integer;
begin
  select id into v_household from public.household where name = 'Seed smoke test';

  select count(*) into n from public.expense_category c
   where c.household_id = v_household and c.status = 'archived';
  if n = 0 then raise exception 'no archived category'; end if;

  select count(*) into n from public.expense_category c
   where c.household_id = v_household
     and not exists (select 1 from public.expense_txn e where e.category_id = c.id);
  if n = 0 then raise exception 'no unused category'; end if;

  select count(*) into n from public.member m
   where m.household_id = v_household and m.status = 'archived';
  if n = 0 then raise exception 'no archived member'; end if;

  select count(*) into n from public.expense_txn e
   where e.household_id = v_household and e.visibility = 'personal';
  if n < 3 then raise exception 'expected private entries for two members, found %', n; end if;

  select count(*) into n from public.expense_txn e
   where e.household_id = v_household and e.voided_at is not null;
  if n = 0 then raise exception 'no voided expense'; end if;

  select count(*) into n from public.expense_txn e
   where e.household_id = v_household and e.category_id is null;
  if n = 0 then raise exception 'no uncategorised spending'; end if;

  select count(distinct e.currency) into n from public.expense_txn e
   where e.household_id = v_household;
  if n < 2 then raise exception 'expected more than one currency'; end if;

  select count(*) into n from public.holding h
   where h.household_id = v_household and h.quantity = 0;
  if n = 0 then raise exception 'no zero-quantity holding'; end if;

  select count(*) into n from public.holding h
   where h.household_id = v_household and h.visibility = 'personal';
  if n = 0 then raise exception 'no personal holding'; end if;

  select count(*) into n from public.instrument i
   where i.household_id = v_household and i.is_foreign_asset;
  if n = 0 then raise exception 'no foreign asset to disclose'; end if;

  -- The gappy year: readings exist, and not for every month. Both halves
  -- matter — a full year proves nothing and an empty one proves less.
  select count(distinct extract(month from v.as_of_date)) into n
    from public.valuation_snapshot v
    join public.holding h on h.id = v.holding_id
   where h.household_id = v_household and h.visibility = 'household';
  if n = 0 then raise exception 'no valuations at all'; end if;
  if n >= 12 then raise exception 'every month has a reading; the peak would not be a lower bound'; end if;

  -- Both cadences, or annualising is untested.
  select count(distinct b.cadence) into n from public.budget b where b.household_id = v_household;
  if n < 2 then raise exception 'expected both monthly and yearly budgets'; end if;

  raise notice 'every edge case present';
end;
$assert$;
SQL

echo "  ✓ The demo seed applies cleanly and produces the edge cases it promises."
