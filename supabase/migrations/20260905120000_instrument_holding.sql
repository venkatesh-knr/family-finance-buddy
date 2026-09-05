-- Family Finance Buddy — what you own, and how much of it.
--
-- Two tables with different jobs. `instrument` is the thing itself — an ETF, a
-- fund, a stock — and is shared by everyone in the household who holds it.
-- `holding` is one member's position in one instrument.
--
-- Deliberately no `lot` yet. "The holding is the fast path — it is what the
-- sheet already gives you, so migration is instant and the app is useful on day
-- one. The ledger fills in behind it" (docs/blueprint.md §255). Capital gains
-- need lots; net worth and foreign-asset disclosure do not, and those are what
-- the calendar is pressing on.

-- ============================================================== instrument

create table public.instrument (
  id                 uuid        primary key default gen_random_uuid(),
  household_id       uuid        not null references public.household (id) on delete restrict,
  name               text        not null check (length(btrim(name)) between 1 and 160),

  kind               text        not null
                                 check (kind in ('equity', 'etf', 'mutual_fund', 'bond', 'deposit', 'other')),

  -- Identifiers, all optional: a US ticker has no ISIN to hand, an Indian fund
  -- has no ticker, and nothing here should refuse a holding for want of a code.
  symbol             text        check (symbol is null or length(btrim(symbol)) between 1 and 32),
  isin               text        check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),

  -- The two currencies are different questions and both are needed.
  --
  -- `currency` is what the instrument is bought and priced in. `exposure_currency`
  -- is what its value actually tracks. An Indian feeder fund following a US index
  -- is INR/USD; a US ETF bought through a US broker is USD/USD. They look alike
  -- on a statement and are treated completely differently (§293).
  currency           text        not null check (currency ~ '^[A-Z]{3}$'),
  exposure_currency  text        not null check (exposure_currency ~ '^[A-Z]{3}$'),

  -- Whether this counts as a foreign asset for Schedule FA.
  --
  -- NOT derivable from currency, which is the trap §293 exists to warn about.
  -- That Indian feeder fund is INR-denominated with USD exposure and is an
  -- Indian asset for tax — no disclosure. The US ETF is a foreign asset and
  -- must be disclosed. The difference is where it is held, not what it costs.
  -- So it is recorded as a decision, not inferred.
  is_foreign_asset   boolean     not null default false,

  status             text        not null default 'active' check (status in ('active', 'archived')),
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint instrument_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null)),

  -- Lets holding carry a composite foreign key and so guarantee that a holding
  -- and its instrument belong to the same household. Same device as member.
  constraint instrument_household_id_id_key unique (household_id, id)
);

comment on column public.instrument.exposure_currency is
  'What the value tracks, which is not always what it is priced in. See §293.';
comment on column public.instrument.is_foreign_asset is
  'Schedule FA classification. A decision, never inferred from currency.';

create index instrument_household_status_idx
  on public.instrument (household_id, status);

alter table public.instrument enable row level security;
alter table public.instrument force row level security;

revoke all on public.instrument from public, anon, authenticated;
grant select, insert, update on public.instrument to authenticated;

-- ================================================================= holding

create table public.holding (
  id             uuid          primary key default gen_random_uuid(),
  household_id   uuid          not null references public.household (id) on delete restrict,
  member_id      uuid          not null,
  instrument_id  uuid          not null,

  -- Quantity is NOT money and must not be a bigint of minor units. Fractional
  -- shares are ordinary on US brokers — INDmoney sells them — so this needs a
  -- fractional type. numeric, never a float: exact, and eight places is more
  -- than any broker fragments a share into.
  quantity       numeric(28, 8) not null check (quantity >= 0),

  -- What it cost, in the instrument's own currency, in minor units. Kept for
  -- the day lots arrive; until then it is what the sheet already knows.
  cost_minor     bigint        check (cost_minor is null or cost_minor >= 0),

  opened_on      date,
  status         text          not null default 'active' check (status in ('active', 'archived')),
  archived_at    timestamptz,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),

  constraint holding_archived_at_matches_status
    check ((status = 'archived') = (archived_at is not null)),

  -- The member and the instrument must both belong to this holding's household.
  -- Composite keys rather than triggers, so the database refuses a mismatch
  -- outright instead of a policy having to notice one.
  constraint holding_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict,
  constraint holding_instrument_in_household_fkey
    foreign key (household_id, instrument_id)
    references public.instrument (household_id, id) on delete restrict,

  -- One position per member per instrument. A second one is a data-entry
  -- mistake, not a second holding, until lots exist to distinguish them.
  constraint holding_member_instrument_key unique (member_id, instrument_id),

  constraint holding_household_id_id_key unique (household_id, id)
);

create index holding_household_status_idx
  on public.holding (household_id, status);

alter table public.holding enable row level security;
alter table public.holding force row level security;

revoke all on public.holding from public, anon, authenticated;
grant select, insert, update on public.holding to authenticated;

create trigger holding_touch_updated_at
  before update on public.holding
  for each row execute function app.touch_updated_at();

create trigger instrument_touch_updated_at
  before update on public.instrument
  for each row execute function app.touch_updated_at();
