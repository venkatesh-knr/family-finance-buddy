-- Family Finance Buddy — a bond's repay mode, and a log of its rating.
--
-- "Coupon, period, repay mode, rating, start and close dates — becomes a maturity
-- ladder. Accrued-but-unpaid interest is computed rather than typed, and rating
-- changes are logged so a downgrade doesn't pass unnoticed." (docs/blueprint.md,
-- Bonds & fixed income.)
--
-- Two things the first fixed-income migration (20260927130000) left out, and said so.
--
-- ── repay mode ───────────────────────────────────────────────────────────────
--
-- A bond either PAYS OUT its interest on each coupon date, or lets it ACCUMULATE and
-- pays it with the face at maturity (a cumulative bond). The first is what the
-- accrual code has always assumed; the second, valued that way, would be wrong
-- after its first "coupon" date, because the interest it has earned is not paid
-- out and does not reset.
--
--   null or 'payout'   coupons are paid on each coupon date. Null is what every
--                      bond recorded so far has, and means exactly this, so nothing
--                      already stored changes meaning and no backfill is needed.
--   'cumulative'       interest compounds at `coupon_frequency` and is paid, with
--                      the face, at maturity. For this mode `coupon_frequency` is how
--                      often it is credited, not how often it is paid.
--
-- Bonds only: a deposit has its own `compounding`, and carrying a repay mode too
-- would be two answers to one question. The check says so.
--
-- Left nullable on purpose. A NOT NULL for bonds would refuse every insert made by
-- the application as it stands, between this migration being applied and the code
-- that sets it being deployed.
--
-- ── the rating log ───────────────────────────────────────────────────────────
--
-- `fixed_income_terms.rating` is the current rating and is edited in place, which
-- loses the one thing worth knowing about it: that it changed. This table is the
-- record of each change, and it is written by a trigger on the terms and by nothing
-- else. Nobody inserts, updates or deletes a row of it, so a downgrade cannot be
-- tidied away and a made-up one cannot be added. It is the shape of `audit_log`,
-- and for the same reason RLS is enabled and not forced: the trigger writes it as
-- the table's owner.
--
-- A row records the change and the day it was noticed (IST), not the day the agency
-- announced it, which this app is not told. The first row for a bond has no
-- `from_rating`: it is the rating as first recorded.
--
-- It hangs off the holding and is as private as it is, decided by the holding's own
-- policy, as `fixed_income_terms` is. Its audit rows name a `holding_id` and so
-- follow the holding too (20260927120000).

-- ───────────────────────────────────────────── repay mode

alter table public.fixed_income_terms
  add column repay_mode text
    check (repay_mode is null or repay_mode in ('payout', 'cumulative'));

alter table public.fixed_income_terms
  add constraint fixed_income_terms_repay_mode_is_for_bonds
    check (repay_mode is null or kind = 'bond');

comment on column public.fixed_income_terms.repay_mode is
  'Bonds only. Null or payout: coupons are paid on each coupon date. Cumulative: interest compounds at coupon_frequency and is paid with the face at maturity.';

-- ───────────────────────────────────────────── rating log

create table public.bond_rating_change (
  id            bigint      generated always as identity primary key,
  household_id  uuid        not null references public.household (id) on delete restrict,
  holding_id    uuid        not null,

  -- Null on the first row, which is the rating as first recorded.
  from_rating   text        check (from_rating is null or length(btrim(from_rating)) between 1 and 12),
  -- Null when a rating was removed.
  to_rating     text        check (to_rating is null or length(btrim(to_rating)) between 1 and 12),

  -- The day it was noticed, in IST. Not when the agency changed it.
  changed_on    date        not null,

  -- Null for a change made by a migration or a job.
  created_by    uuid        references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint bond_rating_change_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict,

  constraint bond_rating_change_is_a_change
    check (from_rating is distinct from to_rating)
);

comment on table public.bond_rating_change is
  'Each change to a bond''s rating, written by trigger on fixed_income_terms and by nothing else. Append-only: nobody inserts, updates or deletes.';

create index bond_rating_change_holding_idx on public.bond_rating_change (holding_id, id);

-- The ratings recorded before this table existed are the first rows of their logs.
insert into public.bond_rating_change (household_id, holding_id, from_rating, to_rating, changed_on)
select household_id, holding_id, null, rating, (now() at time zone 'Asia/Kolkata')::date
  from public.fixed_income_terms
 where rating is not null;

-- ───────────────────────────────────────────── the trigger

create or replace function app.log_rating_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.rating is null then
      return new;
    end if;
    insert into public.bond_rating_change (household_id, holding_id, from_rating, to_rating, changed_on, created_by)
    values (new.household_id, new.holding_id, null, new.rating,
            (now() at time zone 'Asia/Kolkata')::date, app.current_account_id());
  else
    insert into public.bond_rating_change (household_id, holding_id, from_rating, to_rating, changed_on, created_by)
    values (new.household_id, new.holding_id, old.rating, new.rating,
            (now() at time zone 'Asia/Kolkata')::date, app.current_account_id());
  end if;
  return new;
end;
$fn$;

revoke all on function app.log_rating_change() from public, anon, authenticated;

create trigger fixed_income_terms_log_rating_insert
  after insert on public.fixed_income_terms
  for each row
  when (new.rating is not null)
  execute function app.log_rating_change();

create trigger fixed_income_terms_log_rating_update
  after update of rating on public.fixed_income_terms
  for each row
  when (old.rating is distinct from new.rating)
  execute function app.log_rating_change();

-- ───────────────────────────────────────────── access

-- Enabled and not forced, as audit_log: the trigger above writes it as the owner.
alter table public.bond_rating_change enable row level security;

revoke all on public.bond_rating_change from public, anon, authenticated;
grant select on public.bond_rating_change to authenticated;

-- As private as the holding, decided by the holding's own policy: the subquery runs
-- as the caller. No insert, update or delete policy exists, and none is granted.
create policy bond_rating_change_select_same_household
  on public.bond_rating_change
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.holding h where h.id = bond_rating_change.holding_id)
  );

comment on policy bond_rating_change_select_same_household on public.bond_rating_change is
  'Exactly as private as the holding, decided by the holding''s own policy.';

-- A password alone is not enough: the publishable key ships in the bundle.
create policy require_second_factor
  on public.bond_rating_change
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ───────────────────────────────────────────── audit
--
-- In the same migration that creates the table, per the invariant.

create trigger bond_rating_change_audit
  after insert or update or delete on public.bond_rating_change
  for each row execute function app.write_audit();
