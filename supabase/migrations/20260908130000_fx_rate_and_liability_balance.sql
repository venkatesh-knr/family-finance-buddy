-- Family Finance Buddy — the two figures net worth has been missing.
--
-- Overview has been able to say "assets, per currency" and nothing more,
-- because two things were absent from the schema and both are needed before
-- one honest number exists:
--
--   a rate, to add a dollar to a rupee
--   a balance, to subtract what is owed
--
-- Neither is invented here. Both are recorded facts a person enters, and both
-- carry the date they were true on, because a figure without its date is the
-- thing that quietly makes last year's net worth move.

-- ═══════════════════════════════════════════════════════════════ fx_rate
--
-- "Exchange rates are dated rows, appended, never updated. A transaction
-- converts at the rate for its own date. Yesterday's net worth must not change
-- because the rupee moved today." (CLAUDE.md)
--
-- Household-scoped, which deserves a word since a rate is a fact about the
-- world rather than about a household. A shared table would need a write
-- surface where one member's entry silently rewrites every other household's
-- history, and there is no price driver yet to own that surface properly. Per
-- household it stays inside the policies every other table obeys, and the
-- duplication is a handful of rows. When a driver arrives it can write a
-- shared table and these become the fallback.

create table public.fx_rate (
  id              uuid        primary key default gen_random_uuid(),
  household_id    uuid        not null references public.household (id) on delete restrict,

  -- One unit of `base` costs `rate` of `quote`. USD→INR at 88.5 means a dollar
  -- costs 88.5 rupees. Naming them base and quote rather than "from" and "to"
  -- because the pair is conventionally written that way and a reversed rate is
  -- a silent factor-of-7000 error.
  base_currency   text        not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency  text        not null check (quote_currency ~ '^[A-Z]{3}$'),

  -- numeric, not a float and not minor units. A rate is not money: it is a
  -- ratio, it needs fractional precision, and rounding it to paise would put
  -- an error of up to half a paise on every converted figure.
  rate            numeric(20, 10) not null check (rate > 0),

  as_of_date      date        not null,

  source          text        not null default 'manual'
                              check (source in ('manual', 'driver')),

  created_by      uuid        not null default app.current_account_id()
                              references public.user_account (id) on delete restrict,
  created_at      timestamptz not null default now(),

  constraint fx_rate_not_self check (base_currency <> quote_currency),
  -- One rate per pair per day. A second is a correction, and a correction is
  -- an update to that row rather than a second row that disagrees with it.
  constraint fx_rate_pair_date_key unique (household_id, base_currency, quote_currency, as_of_date)
);

comment on table public.fx_rate is
  'Dated conversion rates. One unit of base costs `rate` of quote. Appended per date; a figure converts at the rate for its own date so old totals do not move.';
comment on column public.fx_rate.rate is
  'numeric, not money and not a float. A ratio needs fractional precision that minor units cannot hold.';

create index fx_rate_lookup_idx
  on public.fx_rate (household_id, base_currency, quote_currency, as_of_date desc);

alter table public.fx_rate enable row level security;
alter table public.fx_rate force row level security;

revoke all on table public.fx_rate from public, anon, authenticated;
-- No delete. A rate that was used to convert a figure somebody relied on does
-- not get to disappear; a wrong one is corrected in place, and the audit log
-- keeps what it said before.
grant select, insert, update on table public.fx_rate to authenticated;

create trigger fx_rate_audit
  after insert or update or delete on public.fx_rate
  for each row execute function app.write_audit();

create policy fx_rate_select_same_household
  on public.fx_rate for select to authenticated
  using (household_id in (select app.household_ids()));

create policy fx_rate_insert_own_household
  on public.fx_rate for insert to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner')
    and created_by = (select app.current_account_id())
  );

create policy fx_rate_update_own_household
  on public.fx_rate for update to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));

create policy require_second_factor
  on public.fx_rate as restrictive to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ══════════════════════════════════════════════════ what is still owed
--
-- `liability` has recorded an instalment since it was created, which says what
-- leaves the account each month and nothing about the size of the debt. Net
-- worth needs the second number, and an instalment cannot be turned into it
-- without a rate and a term the app does not hold.
--
-- A column with its own date rather than a dated table of balances. The
-- comparison is valuation_snapshot, which is a table because a *peak* over a
-- year is the disclosure figure and needs every reading. Nothing asks for the
-- peak of a loan balance; what is wanted is what is owed now, and the audit
-- log already keeps what it said before. A balance history can arrive if
-- something ever needs to plot one.

alter table public.liability
  add column outstanding_minor bigint check (outstanding_minor is null or outstanding_minor >= 0),
  add column outstanding_as_of date;

comment on column public.liability.outstanding_minor is
  'What is still owed, in minor units of this liability''s currency. Null means nobody has said — which is not the same as nothing owed, and net worth has to show the difference.';
comment on column public.liability.outstanding_as_of is
  'The date that balance was true. A balance with no date silently ages into a wrong figure.';

-- Both or neither. A balance without a date cannot be judged for staleness,
-- and a date without a balance says nothing at all.
alter table public.liability
  add constraint liability_outstanding_pair
  check ((outstanding_minor is null) = (outstanding_as_of is null));
