-- Family Finance Buddy — the Act is readable, and not editable.
--
-- Every other policy test here asks who can see whose data. This one is the
-- other shape: the rules are the same for everyone and belong to nobody, so
-- the assertions are that anybody in a household can read them and that
-- nobody at all can write one.
--
-- That second half is the one that matters. A household able to edit its own
-- tax rates could compute the figure it wanted, and the app's entire claim is
-- that the numbers can be checked.

create extension if not exists pgtap with schema extensions;

set search_path to extensions, public, pg_catalog;

begin;

select plan(10);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000', 'ea110000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'tax-owner@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', 'ea110000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'tax-viewer@demo.test', 'x', now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}');

update public.user_account set id = 'eb220000-0000-4000-8000-0000000000a1'
  where auth_user_id = 'ea110000-0000-4000-8000-000000000001';
update public.user_account set id = 'eb220000-0000-4000-8000-0000000000a2'
  where auth_user_id = 'ea110000-0000-4000-8000-000000000002';

insert into public.household (id, name, kind) values
  ('ec330000-0000-4000-8000-00000000e001', 'Tax house', 'demo');

insert into public.member (id, household_id, display_name, colour) values
  ('ed440000-0000-4000-8000-00000000c001', 'ec330000-0000-4000-8000-00000000e001', 'Owner', 'c1'),
  ('ed440000-0000-4000-8000-00000000c002', 'ec330000-0000-4000-8000-00000000e001', 'Looker', 'c2');

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('eb220000-0000-4000-8000-0000000000a1', 'ec330000-0000-4000-8000-00000000e001',
   'ed440000-0000-4000-8000-00000000c001', 'owner'),
  ('eb220000-0000-4000-8000-0000000000a2', 'ec330000-0000-4000-8000-00000000e001',
   'ed440000-0000-4000-8000-00000000c002', 'viewer');

-- ═══════════════════════════════ nobody may write one, ever (4)
--
-- A grant test rather than a policy test, and the stronger guarantee for it:
-- there is no permission to argue about.

reset role;

select ok(
  not has_table_privilege('authenticated', 'public.tax_rule', 'insert'),
  'no member of any household can add a tax rule'
);

select ok(
  not has_table_privilege('authenticated', 'public.tax_rule', 'update'),
  'nor change one — a household that could edit its rates could choose its answer'
);

select ok(
  not has_table_privilege('authenticated', 'public.tax_rule', 'delete'),
  'nor delete one, which would make a prior year uncomputable rather than wrong'
);

select ok(
  has_table_privilege('authenticated', 'public.tax_rule', 'select'),
  'but everybody may read them: the Act is not a secret'
);

-- ══════════════════════════ every member reads the same rules (2)

set local role authenticated;
set local request.jwt.claim.sub to 'ea110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"ea110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';

select is(
  (select months from public.tax_rule
    where kind = 'holding_period' and asset_class = 'listed_equity'
      and effective_to is null),
  12::smallint,
  'listed equity is long term after twelve months'
);

select is(
  (select months from public.tax_rule
    where kind = 'holding_period' and asset_class = 'foreign_equity'
      and effective_to is null),
  24::smallint,
  'and a foreign holding after twenty-four — the reason lot dates matter abroad'
);

-- ════════════════════ a viewer sees them too, which is the point (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ea110000-0000-4000-8000-000000000002';
set local request.jwt.claims   to '{"sub":"ea110000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}';

select isnt_empty(
  $q$ select id from public.tax_rule where kind = 'cg_rate' $q$,
  'a viewer reads the rates: they qualify figures a viewer is entitled to see'
);

-- ═════════════════════ a password alone is not enough (1)

reset role;
set local role authenticated;
set local request.jwt.claim.sub to 'ea110000-0000-4000-8000-000000000001';
set local request.jwt.claims   to '{"sub":"ea110000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';

select is_empty(
  $q$ select id from public.tax_rule $q$,
  'a session without a second factor reads nothing, as everywhere else'
);

-- ═══════════════════ the shape constraints hold (2)
--
-- A holding period of "12.5 percent" is the kind of row that reads fine and
-- computes nonsense, so the table refuses it.

reset role;

select throws_ok(
  $q$ insert into public.tax_rule
        (jurisdiction, kind, asset_class, rate_pct, effective_from, authority)
      values ('IN', 'holding_period', 'gold', 12.5, date '2024-07-23', 'nonsense') $q$,
  '23514'::char(5),
  null::text,
  'a holding period cannot be a percentage'
);

select throws_ok(
  $q$ insert into public.tax_rule
        (jurisdiction, kind, asset_class, rate_pct, term, effective_from, effective_to, authority)
      values ('IN', 'cg_rate', 'gold', 12.5, 'long', date '2024-07-23', date '2020-01-01', 'backwards') $q$,
  '23514'::char(5),
  null::text,
  'and a rule cannot stop applying before it started'
);

reset role;

select * from finish();

rollback;
