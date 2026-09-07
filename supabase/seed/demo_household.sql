-- Family Finance Buddy — demo household fixture.
--
-- LOCAL ONLY, and now enforced rather than asserted.
--
-- This file used to say it never runs against a hosted project. That was not
-- true: `supabase db reset --linked` seeds whatever it just reset, and it once
-- put the sign-in below — whose password is committed to a public repository
-- — onto the live project. A comment is not a control.
--
-- So it is no longer reachable by accident. Automatic seeding is off in
-- config.toml, and the only supported way to load this file is
--
--     npm run db:seed:local
--
-- whose connection string names the local stack and cannot be pointed at
-- anything else. That is the whole control: not a check inside the file that
-- tries to work out where it is — a hosted project answers from a private
-- address just as a local one does, so such a check passes exactly where it
-- most needs to fail — but a command that can only reach one database.
--
--   email     owner@finance-buddy.test
--   password  DemoHousehold!2026
--
-- The household is marked `demo`, not `real`, so nothing here can be mistaken
-- for a figure that matters. Every amount is in integer minor units — paise.


-- Writing a row into auth.users by hand means owning every column GoTrue
-- reads, not only the ones this fixture cares about.
--
-- Four of its token columns carry no database default — confirmation_token,
-- recovery_token, email_change and email_change_token_new — so an insert that
-- names a tidy subset of columns leaves exactly those null. GoTrue scans them
-- into Go strings, which cannot hold null, and the account then fails to load
-- at all: sign-in and the dashboard both answer "Database error loading user",
-- and the row cannot even be deleted through the API that refuses to read it.
-- An empty string is what GoTrue means by "no token outstanding"; null is not
-- the same thing.
--
-- The four added later — email_change_token_current, phone_change,
-- phone_change_token, reauthentication_token — do default to ''. They are
-- listed anyway, because which four have defaults is a property of whichever
-- GoTrue version a project happens to run, and is not worth depending on.
--
-- They are listed explicitly rather than left to defaults, because the whole
-- failure was a column nobody listed.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change,
   email_change_token_new, email_change_token_current,
   phone_change, phone_change_token, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000',
   'd0000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'owner@finance-buddy.test',
   extensions.crypt('DemoHousehold!2026', extensions.gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}',
   '', '', '',
   '', '',
   '', '', '')
on conflict (id) do nothing;

-- user_account is created by the on_auth_user_created trigger; pin its id so
-- the rest of this file can reference it.
update public.user_account
   set id = 'd0000000-0000-4000-8000-00000000dacc'
 where auth_user_id = 'd0000000-0000-4000-8000-000000000001';

insert into public.household (id, name, kind, base_currency, display_currency) values
  ('d0000000-0000-4000-8000-00000000d001', 'Demo household', 'demo', 'INR', 'INR')
on conflict (id) do nothing;

insert into public.member (id, household_id, display_name, relation, colour) values
  ('d0000000-0000-4000-8000-00000000d101', 'd0000000-0000-4000-8000-00000000d001', 'Ravi', 'self',   'c1'),
  ('d0000000-0000-4000-8000-00000000d102', 'd0000000-0000-4000-8000-00000000d001', 'Meera', 'spouse', 'c2')
on conflict (id) do nothing;

insert into public.membership (user_account_id, household_id, member_id, role) values
  ('d0000000-0000-4000-8000-00000000dacc',
   'd0000000-0000-4000-8000-00000000d001',
   'd0000000-0000-4000-8000-00000000d101',
   'owner')
on conflict do nothing;

insert into public.expense_txn
  (household_id, member_id, txn_date, amount_minor, currency, payee, method, note, created_by)
values
  ('d0000000-0000-4000-8000-00000000d001', 'd0000000-0000-4000-8000-00000000d101',
   current_date - 1, 248000, 'INR', 'Big Basket', 'upi', 'Weekly groceries',
   'd0000000-0000-4000-8000-00000000dacc'),
  ('d0000000-0000-4000-8000-00000000d001', 'd0000000-0000-4000-8000-00000000d102',
   current_date - 2, 65000, 'INR', 'Apollo Pharmacy', 'card', null,
   'd0000000-0000-4000-8000-00000000dacc'),
  ('d0000000-0000-4000-8000-00000000d001', 'd0000000-0000-4000-8000-00000000d101',
   current_date - 4, 1450000, 'INR', 'BESCOM', 'auto_debit', 'Electricity, two months',
   'd0000000-0000-4000-8000-00000000dacc'),
  ('d0000000-0000-4000-8000-00000000d001', 'd0000000-0000-4000-8000-00000000d102',
   current_date - 7, 89900, 'INR', 'Cubbon Park Cafe', 'cash', null,
   'd0000000-0000-4000-8000-00000000dacc'),
  -- A foreign-currency spend, stored native. Nothing here converts it; the base
  -- figure is derived on read at the rate for this date, once fx_rate exists.
  ('d0000000-0000-4000-8000-00000000d001', 'd0000000-0000-4000-8000-00000000d101',
   current_date - 9, 1299, 'USD', 'Backblaze', 'card', 'Backup, billed in dollars',
   'd0000000-0000-4000-8000-00000000dacc');
