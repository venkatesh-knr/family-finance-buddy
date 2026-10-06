-- Family Finance Buddy — the terms of a fixed deposit or a bond.
--
-- "The app asks for the *terms* — principal, rate, tenure, coupon — not the
-- current value. Maturity value and accrued interest are computed, not typed."
-- (docs/blueprint.md, the table of how each class is kept up to date.)
--
-- Until now a deposit or a bond was a holding of kind 'deposit' or 'bond' with
-- nothing to say what it was: no rate, no dates, no compounding. The only way to
-- give it a value was to type one, every month, which is why the workbook this
-- replaces went stale. This is where the terms live, and `src/domain/accrual.ts`
-- turns them into a value on any day.
--
-- ── shape ────────────────────────────────────────────────────────────────────
--
-- The position is still a `holding`: it keeps its member, its visibility, its
-- archive and everything that already reads holdings. These tables hang off it,
-- exactly as `lot` and `valuation_snapshot` do, and are as private as the holding
-- they belong to. A deposit's `holding.quantity` is 1 and its money is here.
--
--   fixed_income_terms   one row per holding: the first term of a deposit, or the
--                        whole of a bond.
--   deposit_renewal      one row per later term of a deposit, as the bank renewed it.
--
-- ── auto-renewal ─────────────────────────────────────────────────────────────
--
-- A deposit that renews automatically pays its interest into the principal and is
-- redeposited for the same term, at whatever rate the bank is then offering. So a
-- deposit is a chain of terms, and the rate can differ from one to the next.
--
-- `auto_renew` says the chain continues. A renewal that has *happened* is a row in
-- `deposit_renewal`, with the principal, rate and compounding the bank's advice
-- gave: the bank's figure is the authority, and the new rate in particular is a
-- fact only the advice knows. A renewal that has not yet been recorded is
-- *projected* by the application, on the same term, from the previous maturity
-- value, at `renewal_rate_pct` if one is set and otherwise the previous rate, and
-- is shown as a projection. Nothing here stores a projected figure.
--
-- ── what this does not do ────────────────────────────────────────────────────
--
-- Chain validity (that each renewal starts where the last ended) is arithmetic and
-- belongs to the calculation module, which says so when it is broken; a policy or a
-- constraint that knew about it would be a business rule in the access layer.
--
-- No delete grant, as for `lot`: a wrong figure is corrected in place, and the
-- audit log keeps the version it replaced.
--
-- ── order ────────────────────────────────────────────────────────────────────
--
-- Must be applied after 20260927120000_audit_follows_holding.sql. These tables
-- name a `holding_id`, and that migration is what keeps their audit rows (which
-- carry the principal and the rate in full) as private as the holding.

-- ───────────────────────────────────────────── fixed_income_terms

create table public.fixed_income_terms (
  holding_id       uuid           primary key,
  household_id     uuid           not null references public.household (id) on delete restrict,

  kind             text           not null check (kind in ('deposit', 'bond')),

  -- A deposit's principal for its first term; a bond's face value.
  principal_minor  bigint         not null check (principal_minor > 0),
  currency         text           not null check (currency ~ '^[A-Z]{3}$'),

  -- A deposit's rate for its first term, or a bond's coupon. numeric(6,3), as in
  -- tax_rule: 7.5 and 10.75 are exact, and it reaches the application as text.
  rate_pct         numeric(6, 3)  not null check (rate_pct >= 0 and rate_pct <= 100),

  start_date       date           not null,
  maturity_date    date           not null,

  -- Deposits only. Per deposit and never a default: this household's compound
  -- yearly and the blueprint's example is quarterly.
  compounding      text           check (compounding is null or compounding in
                                     ('monthly', 'quarterly', 'half_yearly', 'yearly', 'simple')),

  -- Bonds only.
  coupon_frequency text           check (coupon_frequency is null or coupon_frequency in
                                     ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  rating           text           check (rating is null or length(btrim(rating)) between 1 and 12),

  -- Deposits only. The chain continues at maturity, on the same term.
  auto_renew       boolean        not null default false,
  -- The rate to project a renewal at; null means the previous term's.
  renewal_rate_pct numeric(6, 3)  check (renewal_rate_pct is null or (renewal_rate_pct >= 0 and renewal_rate_pct <= 100)),

  -- Which bank or issuer, for a person; and the last four digits of the account
  -- or certificate, which is all this app ever keeps of an identifier.
  institution      text           check (institution is null or length(btrim(institution)) between 1 and 80),
  account_last4    text           check (account_last4 is null or account_last4 ~ '^[0-9A-Za-z]{4}$'),

  note             text           check (note is null or length(note) <= 500),
  created_by       uuid           not null default app.current_account_id()
                                  references public.user_account (id) on delete restrict,
  created_at       timestamptz    not null default now(),
  updated_at       timestamptz    not null default now(),

  constraint fixed_income_terms_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict,

  constraint fixed_income_terms_matures_after_it_starts
    check (maturity_date > start_date),

  -- Each kind carries its own fields and not the other's, so a row cannot be a
  -- deposit with a coupon or a bond that compounds, which would compute nothing.
  constraint fixed_income_terms_deposit_fields
    check (kind <> 'deposit' or (compounding is not null and coupon_frequency is null and rating is null)),
  constraint fixed_income_terms_bond_fields
    check (kind <> 'bond' or (coupon_frequency is not null and compounding is null
                              and not auto_renew and renewal_rate_pct is null)),
  constraint fixed_income_terms_renewal_rate_needs_auto_renew
    check (renewal_rate_pct is null or auto_renew)
);

comment on table public.fixed_income_terms is
  'The terms of a deposit or a bond, one per holding. Value and accrued interest are computed from these by src/domain/accrual.ts and never stored.';
comment on column public.fixed_income_terms.principal_minor is
  'A deposit''s principal for its first term, or a bond''s face value, in minor units of currency.';
comment on column public.fixed_income_terms.rate_pct is
  'A deposit''s rate for its first term, or a bond''s coupon, as a percentage per year.';
comment on column public.fixed_income_terms.auto_renew is
  'Deposits only. At maturity the interest joins the principal and the deposit is renewed for the same term. A renewal that has happened is a deposit_renewal row; one that has not is projected, never stored.';
comment on column public.fixed_income_terms.renewal_rate_pct is
  'The rate to project the next, unrecorded renewal at. Null means the previous term''s rate.';

create index fixed_income_terms_household_idx on public.fixed_income_terms (household_id, maturity_date);

-- ───────────────────────────────────────────── deposit_renewal

create table public.deposit_renewal (
  id               uuid           primary key default gen_random_uuid(),
  household_id     uuid           not null references public.household (id) on delete restrict,
  holding_id       uuid           not null,

  -- The term that began at a renewal, as the bank's advice states it.
  start_date       date           not null,
  maturity_date    date           not null,

  -- What the new term starts from: normally the maturity value of the last, which
  -- the bank states, and not recomputed here.
  principal_minor  bigint         not null check (principal_minor > 0),
  currency         text           not null check (currency ~ '^[A-Z]{3}$'),
  rate_pct         numeric(6, 3)  not null check (rate_pct >= 0 and rate_pct <= 100),
  compounding      text           not null check (compounding in
                                     ('monthly', 'quarterly', 'half_yearly', 'yearly', 'simple')),

  note             text           check (note is null or length(note) <= 500),
  created_by       uuid           not null default app.current_account_id()
                                  references public.user_account (id) on delete restrict,
  created_at       timestamptz    not null default now(),
  updated_at       timestamptz    not null default now(),

  constraint deposit_renewal_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict,

  constraint deposit_renewal_matures_after_it_starts
    check (maturity_date > start_date),

  -- Two renewals starting on the same day would be two answers to one question.
  constraint deposit_renewal_one_per_start
    unique (holding_id, start_date)
);

comment on table public.deposit_renewal is
  'A later term of a deposit, as the bank renewed it. The rate may differ from the last. Hangs off the holding and is as private as it is.';
comment on column public.deposit_renewal.principal_minor is
  'What the term starts from, as the bank''s advice states it: normally the previous maturity value.';

create index deposit_renewal_holding_idx on public.deposit_renewal (holding_id, start_date);

-- ───────────────────────────────────────────── access

alter table public.fixed_income_terms enable row level security;
alter table public.fixed_income_terms force row level security;
alter table public.deposit_renewal enable row level security;
alter table public.deposit_renewal force row level security;

revoke all on public.fixed_income_terms from public, anon, authenticated;
revoke all on public.deposit_renewal from public, anon, authenticated;
grant select, insert, update on public.fixed_income_terms to authenticated;
grant select, insert, update on public.deposit_renewal to authenticated;

-- As private as the holding, decided by the holding's own policy: the subquery
-- runs as the caller, so an owner does not read a partner's personal deposit and a
-- contributor reads only their own, with no rule here to drift out of step with it.

create policy fixed_income_terms_select_same_household
  on public.fixed_income_terms
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.holding h where h.id = fixed_income_terms.holding_id)
  );

create policy deposit_renewal_select_same_household
  on public.deposit_renewal
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.holding h where h.id = deposit_renewal.holding_id)
  );

-- Whoever may record against a holding they can read: the same set, and the same
-- reason, as a purchase. A viewer writes nothing.

create policy fixed_income_terms_insert_own_household
  on public.fixed_income_terms
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = fixed_income_terms.holding_id)
  );

create policy deposit_renewal_insert_own_household
  on public.deposit_renewal
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = deposit_renewal.holding_id)
  );

create policy fixed_income_terms_update_own_household
  on public.fixed_income_terms
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = fixed_income_terms.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = fixed_income_terms.holding_id)
  );

create policy deposit_renewal_update_own_household
  on public.deposit_renewal
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = deposit_renewal.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = deposit_renewal.holding_id)
  );

comment on policy fixed_income_terms_select_same_household on public.fixed_income_terms is
  'Exactly as private as the holding, decided by the holding''s own policy.';
comment on policy fixed_income_terms_update_own_household on public.fixed_income_terms is
  'Terms may be corrected in place. The holding must still be one the caller can read.';

-- A password alone is not enough: the publishable key ships in the bundle.
create policy require_second_factor
  on public.fixed_income_terms
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.deposit_renewal
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ───────────────────────────────────────────── audit
--
-- In the same migration that creates the tables, per the invariant.

create trigger fixed_income_terms_touch_updated_at
  before update on public.fixed_income_terms
  for each row execute function app.touch_updated_at();

create trigger fixed_income_terms_audit
  after insert or update or delete on public.fixed_income_terms
  for each row execute function app.write_audit();

create trigger deposit_renewal_touch_updated_at
  before update on public.deposit_renewal
  for each row execute function app.touch_updated_at();

create trigger deposit_renewal_audit
  after insert or update or delete on public.deposit_renewal
  for each row execute function app.write_audit();
