-- Family Finance Buddy — the FIRE inputs belong to the household, not the phone.
--
-- The multiplier, the inflation assumption and the horizon have lived in React
-- state since the FIRE card was written: useState(25), useState(6),
-- useState(10). Three consequences, and none of them were intended.
--
--   An owner sets 30× and their partner opens the app to 25×. There is no
--   shared number, which is the whole point of a household target — a couple
--   planning to retire together were looking at two different figures.
--
--   The choice does not survive a refresh, so even one person's answer is
--   not kept.
--
--   And because it never reached the database, nothing recorded that a
--   decision had been made at all.
--
-- These are household settings in exactly the way base_currency is: one
-- answer, agreed once, that everybody's screen then reflects. So they go where
-- base_currency went.

alter table public.household
  add column fire_multiplier   numeric(6, 2)  not null default 25
    check (fire_multiplier > 0 and fire_multiplier <= 200),
  add column fire_inflation_pct numeric(5, 2) not null default 6
    check (fire_inflation_pct >= 0 and fire_inflation_pct <= 100),
  add column fire_years_ahead   smallint      not null default 10
    check (fire_years_ahead >= 0 and fire_years_ahead <= 60);

comment on column public.household.fire_multiplier is
  'How many years of spending the target is. 25 is the common rule of thumb; the app recommends nothing and shows what is asked for.';
comment on column public.household.fire_inflation_pct is
  'The assumed annual rise in prices. A judgement, not a fact, which is why it is a household setting and not a constant.';
comment on column public.household.fire_years_ahead is
  'How far ahead the target is struck. Capped at sixty: beyond that the compounding dominates and the figure stops being a plan.';

-- ────────────────────────────────────────────────── who may change them
--
-- The household row has had no update policy at all until now: readable by its
-- members and writable by nobody, which was right while nothing on it was
-- meant to change.
--
-- Owner and partner, matching every other household-wide setting. It is a
-- whole-row policy because row-level security cannot speak about columns, so
-- this also opens the name, the currencies and the tax-year start to the same
-- two roles. That is the correct set for all of them — "the owner role
-- administers a household; that is the highest privilege in the system" — and
-- worth saying out loud rather than discovering later.
create policy household_update_own
  on public.household
  for update
  to authenticated
  using (app.household_role(id) in ('owner', 'partner'))
  with check (app.household_role(id) in ('owner', 'partner'));

comment on policy household_update_own on public.household is
  'Owner and partner. Whole-row, because RLS cannot restrict columns — the same two roles are the right answer for every setting on this table.';

grant update on table public.household to authenticated;
