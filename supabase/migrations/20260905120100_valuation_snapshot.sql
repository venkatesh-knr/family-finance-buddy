-- Family Finance Buddy — the month-end record, and why it cannot wait.
--
-- "Foreign-asset disclosure asks for the *highest* value each holding reached
-- during the calendar year, not its closing value — and that figure cannot be
-- reconstructed from a year-end statement. Every month that passes before the
-- app starts snapshotting is a month of peak data gone. […] It is the one piece
-- of this design where delay actually destroys information."
--   (docs/blueprint.md §606)
--
-- Hence this table exists before the price driver that will eventually fill it.
-- A value typed in by hand once a month is worth incomparably more than an
-- automated one that starts next quarter, because the months in between cannot
-- be recovered at any price.
--
-- Note the two calendars. Schedule FA works on the CALENDAR year, January to
-- December, while the rest of this app runs on the Indian tax year beginning in
-- April. A snapshot is therefore stored as a plain date and aggregated whichever
-- way the question needs — never bucketed into a period on the way in.

create table public.valuation_snapshot (
  id            uuid           primary key default gen_random_uuid(),
  household_id  uuid           not null references public.household (id) on delete restrict,
  holding_id    uuid           not null,

  -- The calendar day in IST the valuation is true for. Ordinarily a month end,
  -- but not constrained to one: more readings make a better peak, and a
  -- constraint here would forbid the extra reading that improves the answer.
  as_of_date    date           not null,

  -- What was held, and what it was worth, both as at as_of_date.
  --
  -- Quantity is recorded alongside the value rather than read from the holding,
  -- because the holding changes and a snapshot must stay true to its own date.
  quantity      numeric(28, 8) not null check (quantity >= 0),

  -- Minor units of `currency`, which is the instrument's own currency. Stored
  -- native and never converted on the way in: conversion happens on read, at
  -- the rate for the snapshot's own date, so last year's disclosure does not
  -- move because the rupee did today.
  value_minor   bigint         not null check (value_minor >= 0),
  currency      text           not null check (currency ~ '^[A-Z]{3}$'),

  -- Where the figure came from. 'manual' is a person reading it off a broker
  -- app; 'backfill' is a month reconstructed afterwards from a statement, which
  -- §606 calls a defensible approximation and which should be visibly weaker
  -- than a reading taken at the time; 'driver' is the scheduled job that does
  -- not exist yet.
  source        text           not null default 'manual'
                               check (source in ('manual', 'backfill', 'driver')),
  note          text           check (note is null or length(note) <= 500),

  created_by    uuid           not null default app.current_account_id()
                               references public.user_account (id) on delete restrict,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now(),

  constraint valuation_snapshot_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict,

  -- One reading per holding per date. Correcting a figure is an update, not a
  -- second row that silently doubles a position.
  constraint valuation_snapshot_holding_date_key unique (holding_id, as_of_date)
);

comment on table public.valuation_snapshot is
  'Dated valuations. The peak over a calendar year is the Schedule FA figure, and it exists only if the readings were taken.';
comment on column public.valuation_snapshot.source is
  'manual | backfill | driver. Backfilled months are an approximation and should be shown as one.';

-- Reporting reads by household over a date range, in both calendars.
create index valuation_snapshot_household_date_idx
  on public.valuation_snapshot (household_id, as_of_date desc);

create index valuation_snapshot_holding_date_idx
  on public.valuation_snapshot (holding_id, as_of_date desc);

alter table public.valuation_snapshot enable row level security;
alter table public.valuation_snapshot force row level security;

revoke all on public.valuation_snapshot from public, anon, authenticated;
grant select, insert, update on public.valuation_snapshot to authenticated;

create trigger valuation_snapshot_touch_updated_at
  before update on public.valuation_snapshot
  for each row execute function app.touch_updated_at();
