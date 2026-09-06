-- Family Finance Buddy — categories, and budgets as envelopes over them.
--
-- "Categories stay exactly as named, but each becomes a budget envelope over a
-- real ledger with member attribution." (§103)
--
-- Two rules from §269 shape this table more than anything else:
--
--   renaming changes only the label, because transactions reference a category
--   by identity rather than by name, so past months keep their figures;
--
--   and a category that has ever been used is archived rather than deleted,
--   disappearing from the picker while remaining on every historical row.
--
-- Both fall out of a category being a row with an id: the name is a label, and
-- there is no delete policy anywhere in this project to begin with.

-- ============================================================ the category

create table public.expense_category (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,

  name          text        not null check (length(btrim(name)) between 1 and 80),

  -- Nesting, so Vegetables, Fruits, Grocery and Milk can roll up to Food while
  -- each stays tracked separately (§269). One level is all the sheet needs and
  -- all the UI will show, but nothing here forbids deeper.
  parent_id     uuid,

  -- The workbook's primary grouping, kept as the primary grouping.
  nature        text        not null check (nature in ('fixed', 'variable')),

  -- Whether this is spending the household could not simply stop. Feeds the
  -- FIRE floor later; here it is only recorded.
  is_essential  boolean     not null default false,

  sort_order    integer     not null default 0,

  status        text        not null default 'active' check (status in ('active', 'archived')),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint expense_category_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null)),

  -- A parent must be in the same household. Composite key again, so the
  -- database refuses a cross-household nesting outright.
  constraint expense_category_household_id_id_key unique (household_id, id),
  constraint expense_category_parent_in_household_fkey
    foreign key (household_id, parent_id)
    references public.expense_category (household_id, id) on delete restrict,

  -- A category cannot be its own parent. Deeper cycles are possible in theory
  -- and prevented in the UI; this catches the one that happens by accident.
  constraint expense_category_not_its_own_parent check (parent_id is distinct from id)
);

comment on table public.expense_category is
  'User-managed. Renaming changes the label only; a used category is archived, never deleted.';

create index expense_category_household_idx
  on public.expense_category (household_id, status, sort_order);

alter table public.expense_category enable row level security;
alter table public.expense_category force row level security;

revoke all on public.expense_category from public, anon, authenticated;
grant select, insert, update on public.expense_category to authenticated;

create trigger expense_category_touch_updated_at
  before update on public.expense_category
  for each row execute function app.touch_updated_at();

-- ============================================== the ledger gains a category

-- Nullable, and deliberately so. Every expense already recorded has no
-- category, and inventing one for it would be worse than admitting it has
-- none — "Uncategorised" is a real answer that the screens can show and
-- somebody can fix, where a guess is a figure nobody can audit.
alter table public.expense_txn
  add column category_id uuid;

alter table public.expense_txn
  add constraint expense_txn_category_in_household_fkey
  foreign key (household_id, category_id)
  references public.expense_category (household_id, id) on delete restrict;

comment on column public.expense_txn.category_id is
  'Null means uncategorised, which is a state to be shown rather than guessed at.';

create index expense_txn_category_idx
  on public.expense_txn (household_id, category_id, txn_date desc);

-- ============================================================== the budget

create table public.budget (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,
  category_id   uuid        not null,

  -- The Indian tax year, named by the calendar year it starts in: 2026 means
  -- 1 April 2026 to 31 March 2027. Written down because a bare "2026" is
  -- otherwise read as January onward by half the people who see it, and the
  -- calendar year is the one Schedule FA uses — so both exist in this app and
  -- must never be confused.
  fy            smallint    not null check (fy between 2000 and 2100),

  -- How often this planned figure recurs.
  --
  -- On the budget rather than on the category, because the workbook has a
  -- category carrying both: Bus/Train Ticket is planned at 0 a month and
  -- 30,000 a year. A cadence on the category would have made that impossible
  -- to record, and the app would have quietly dropped one of the two.
  cadence       text        not null default 'monthly'
                            check (cadence in ('monthly', 'yearly')),

  -- Which month within that year, 1 meaning April.
  --
  -- Null is the ordinary case and means "one occurrence of the cadence above",
  -- which is exactly what the workbook records. Annualising is then
  --
  --     monthly -> planned x 12
  --     yearly  -> planned
  --
  -- which is what M&Y Total computes. A number 1..12 overrides one particular
  -- month, for the December that is never like the others.
  period        smallint    check (period is null or period between 1 and 12),

  planned_minor bigint      not null check (planned_minor >= 0),
  currency      text        not null check (currency ~ '^[A-Z]{3}$'),

  -- Null means the whole household. A budget can also be set per member, which
  -- is what "with member attribution" asks for.
  member_id     uuid,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint budget_category_in_household_fkey
    foreign key (household_id, category_id)
    references public.expense_category (household_id, id) on delete restrict,
  constraint budget_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict,

  -- One planned figure per category, per year, per cadence, per period, per
  -- member. A second at the same cadence is a correction, not an addition, so
  -- it replaces rather than sums — but a monthly and a yearly figure for one
  -- category are two different plans and both stand.
  constraint budget_one_per_period
    unique (household_id, category_id, fy, cadence, period, member_id)
);

comment on column public.budget.fy is
  'The Indian tax year by its starting calendar year: 2026 is 1 Apr 2026 to 31 Mar 2027.';
comment on column public.budget.cadence is
  'How often this planned figure recurs. On the budget, not the category: a category can be planned monthly and yearly at once.';
comment on column public.budget.period is
  'Month within the tax year, 1 = April. Null means one occurrence of the cadence — the ordinary case.';

create index budget_household_fy_idx on public.budget (household_id, fy);

alter table public.budget enable row level security;
alter table public.budget force row level security;

revoke all on public.budget from public, anon, authenticated;
grant select, insert, update on public.budget to authenticated;

create trigger budget_touch_updated_at
  before update on public.budget
  for each row execute function app.touch_updated_at();

-- ====================================================== the starter list

/**
 * Seed a household with the categories from the workbook.
 *
 * "The 33 category names are a starting point, not the list. Add, rename,
 * reorder and nest them freely." (§269) So this exists to save typing on day
 * one and is never consulted again — nothing in the app depends on a category
 * being one of these.
 *
 * Taken from the sheet as it stands, with the spelling of "Sccoty" and
 * "Maintance" corrected; renaming is free and safe by design, so this is a
 * starting point either way.
 *
 * Two pairs are per-person rather than per-kind — office expense and mobile,
 * one of each per person. The sheet names them after the people; this does not.
 * A starter list is seeded into every household that asks for it, including
 * ones with different people in them, so a name from somebody else's family is
 * noise at best. person1 and person2 are placeholders to be renamed, which
 * costs nothing and is safe by design.
 *
 * Member attribution on the transaction would let each pair become a single
 * category — one Office expense, told apart by who spent it. That is the
 * better shape and it is a later decision, not one to impose while seeding.
 *
 * is_essential is left false everywhere. The sheet does not record it, and it
 * feeds the FIRE floor later — a guess there would be a fabricated number in a
 * calculation, which is worse than an unset flag somebody fills in once.
 */
create or replace function public.seed_starter_categories(target_household_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_added integer;
begin
  if app.household_role(target_household_id) is distinct from 'owner' then
    raise exception 'Only an owner can set up categories.' using errcode = '42501';
  end if;

  -- Refuses rather than duplicates. Running it twice is a mistake, not a
  -- request for a second set of envelopes.
  if exists (select 1 from public.expense_category where household_id = target_household_id) then
    raise exception 'This household already has categories.' using errcode = '22023';
  end if;

  insert into public.expense_category (household_id, name, nature, sort_order)
  select target_household_id, starter.name, starter.nature, starter.sort_order
    from (values
    (10, 'School fee', 'fixed'),
    (20, 'Maintenance', 'fixed'),
    (30, 'Maid', 'fixed'),
    (40, 'Day Care', 'fixed'),
    (50, 'GAS', 'fixed'),
    (60, 'EB', 'fixed'),
    (70, 'DTH', 'fixed'),
    (80, 'Mobile1', 'fixed'),
    (90, 'Mobile2', 'fixed'),
    (100, 'Data1', 'fixed'),
    (110, 'Insurance Bike', 'fixed'),
    (120, 'Insurance Scooty', 'fixed'),
    (130, 'Insurance Car', 'fixed'),
    (140, 'Bike Maintenance', 'fixed'),
    (150, 'Scooty Maintenance', 'fixed'),
    (160, 'Car Maintenance', 'fixed'),
    (170, 'Vegetables', 'fixed'),
    (180, 'Fruits', 'fixed'),
    (190, 'Grocery', 'fixed'),
    (200, 'Rice', 'fixed'),
    (210, 'Petrol', 'fixed'),
    (220, 'Oil', 'fixed'),
    (230, 'Milk Aavin', 'fixed'),
    (240, 'Milk A2', 'fixed'),
    (250, 'Restaurants', 'variable'),
    (260, 'Bus/Train Ticket', 'variable'),
    (270, 'Extracurricular Activity', 'variable'),
    (280, 'Dress', 'variable'),
    (290, 'Office expense person1', 'variable'),
    (300, 'Office expense person2', 'variable'),
    (310, 'House Appliances maintenance', 'variable'),
    (320, 'FastTag', 'variable'),
    (330, 'RO Water maintenance', 'variable'),
    (340, 'Vacation', 'variable'),
    (350, 'To Friends', 'variable'),
    (360, 'Others', 'variable')
    ) as starter (sort_order, name, nature);

  get diagnostics v_added = row_count;
  return v_added;
end;
$fn$;

comment on function public.seed_starter_categories(uuid) is
  'Owner only, once per household. A starting point from the workbook, not a fixed list.';

revoke all on function public.seed_starter_categories(uuid) from public;
grant execute on function public.seed_starter_categories(uuid) to authenticated;
