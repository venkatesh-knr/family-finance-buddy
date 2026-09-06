-- Family Finance Buddy — loans and policies, as far as the annual expense needs.
--
-- The workbook keeps a second block below the categories — Home Loan, three
-- health policies, a term policy — and it is there for the same reason as the
-- categories above it: it feeds the approximate annual expense, which is what
-- the FIRE number is built on.
--
-- They are not categories, and flattening them into that list would be wrong:
-- "liabilities carry principal, rate, EMI and amortisation; policies carry
-- cover, premium and renewal. Both feed cash flow, only one reduces net worth."
-- (§127)
--
-- So they get their own tables now, carrying only what the annual expense
-- needs: what leaves the account, and how often. Principal, rate and
-- amortisation for the liability; cover, insured members and renewal for the
-- policy — the fields that make one reduce net worth and the other not —
-- arrive with the slice that computes net worth. Adding a column later is
-- cheap; discovering that loans were modelled as expense categories is not.

-- ============================================================== liability

create table public.liability (
  id             uuid        primary key default gen_random_uuid(),
  household_id   uuid        not null references public.household (id) on delete restrict,

  name           text        not null check (length(btrim(name)) between 1 and 120),
  kind           text        not null default 'loan'
                             check (kind in ('home_loan', 'vehicle_loan', 'personal_loan',
                                             'education_loan', 'credit_card', 'loan', 'other')),

  -- What actually leaves the account, and how often. This is the whole of what
  -- the annual expense needs, and all this table claims to know today.
  instalment_minor bigint    check (instalment_minor is null or instalment_minor >= 0),
  currency         text      not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  cadence          text      not null default 'monthly'
                             check (cadence in ('monthly', 'quarterly', 'half_yearly', 'yearly')),

  -- Whose it is. Null means the household's.
  member_id      uuid,

  -- A closed loan stops counting toward the annual expense, and its history
  -- stays. Same shape as every other lifecycle here.
  status         text        not null default 'active' check (status in ('active', 'closed')),
  closed_at      timestamptz,

  note           text        check (note is null or length(note) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint liability_closed_at_matches_status
    check ((status = 'closed') = (closed_at is not null)),
  constraint liability_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict
);

comment on table public.liability is
  'Carries only what the annual expense needs today. Principal, rate and amortisation arrive with net worth.';

create index liability_household_idx on public.liability (household_id, status);

alter table public.liability enable row level security;
alter table public.liability force row level security;

revoke all on public.liability from public, anon, authenticated;
grant select, insert, update on public.liability to authenticated;

create trigger liability_touch_updated_at
  before update on public.liability
  for each row execute function app.touch_updated_at();

-- ======================================================= insurance policy

create table public.insurance_policy (
  id             uuid        primary key default gen_random_uuid(),
  household_id   uuid        not null references public.household (id) on delete restrict,

  name           text        not null check (length(btrim(name)) between 1 and 120),
  kind           text        not null
                             check (kind in ('health', 'term_life', 'endowment', 'vehicle',
                                             'home', 'personal_accident', 'other')),

  -- The premium, and how often it is paid. As with a liability, this is what
  -- the annual expense is made of; cover and renewal date come with the slice
  -- that answers whether the cover is adequate.
  premium_minor  bigint      check (premium_minor is null or premium_minor >= 0),
  currency       text        not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  cadence        text        not null default 'yearly'
                             check (cadence in ('monthly', 'quarterly', 'half_yearly', 'yearly')),

  -- Who it is for. Null means the household — a family floater, typically.
  member_id      uuid,

  status         text        not null default 'active' check (status in ('active', 'lapsed')),
  lapsed_at      timestamptz,

  note           text        check (note is null or length(note) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint insurance_policy_lapsed_at_matches_status
    check ((status = 'lapsed') = (lapsed_at is not null)),
  constraint insurance_policy_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict
);

comment on table public.insurance_policy is
  'Carries only what the annual expense needs today. Cover and renewal arrive with the adequacy read.';

create index insurance_policy_household_idx on public.insurance_policy (household_id, status);

alter table public.insurance_policy enable row level security;
alter table public.insurance_policy force row level security;

revoke all on public.insurance_policy from public, anon, authenticated;
grant select, insert, update on public.insurance_policy to authenticated;

create trigger insurance_policy_touch_updated_at
  before update on public.insurance_policy
  for each row execute function app.touch_updated_at();

-- ================================================================ policies

create policy liability_select_same_household
  on public.liability for select to authenticated
  using (household_id in (select app.household_ids()));

create policy liability_insert_own_household
  on public.liability for insert to authenticated
  with check (app.household_role(household_id) in ('owner', 'partner'));

create policy liability_update_own_household
  on public.liability for update to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));

create policy insurance_policy_select_same_household
  on public.insurance_policy for select to authenticated
  using (household_id in (select app.household_ids()));

create policy insurance_policy_insert_own_household
  on public.insurance_policy for insert to authenticated
  with check (app.household_role(household_id) in ('owner', 'partner'));

create policy insurance_policy_update_own_household
  on public.insurance_policy for update to authenticated
  using (app.household_role(household_id) in ('owner', 'partner'))
  with check (app.household_role(household_id) in ('owner', 'partner'));

comment on policy liability_insert_own_household on public.liability is
  'Owner and partner only, like budgets: what the household owes is a planning fact, not a daily record.';

create policy require_second_factor
  on public.liability as restrictive for all to authenticated
  using (app.has_second_factor()) with check (app.has_second_factor());

create policy require_second_factor
  on public.insurance_policy as restrictive for all to authenticated
  using (app.has_second_factor()) with check (app.has_second_factor());
