-- Family Finance Buddy — prices, written by a driver and read by everyone.
--
-- "Prices are written by a driver into the dated `price` table on a schedule.
-- Clients never call a data vendor directly."
--
-- §795: "Nothing in the app fetches a price. A scheduled job asks a
-- `price_source` driver for a quote and writes the result into the dated
-- `price` table; every screen reads from that table."
--
-- ── this is reference data, not household data ──────────────────────────
--
-- The NAV of a fund on a date is a public fact. It is the same number for
-- every household that holds it and for every household that does not, so it
-- is keyed by the instrument's own identifier — an ISIN, an AMFI scheme code,
-- a ticker — and not by a household.
--
-- Two things follow, and both are the reason for the shape.
--
--   No duplication. Ten households holding the same fund read one row, not
--   ten copies that can disagree.
--
--   And nothing leaks. A price row says a fund exists and what it was worth.
--   It does not say who owns it, which a household-scoped price table would
--   have said by its mere presence. Reference data is safe to share precisely
--   because it is about the instrument and never about the holder.
--
-- Same shape as tax_rule, and for the same reason: readable by any
-- authenticated member, writable by no client at all.
--
-- ── appended, never updated ─────────────────────────────────────────────
--
-- §803: "Because drivers write dated rows and never update them, a snapshot
-- from last March keeps last March's price whatever happens to the feed."
--
-- There is no update grant and no delete grant. A vendor that revises a
-- published NAV — which happens — gets a new row for the same day from a
-- later fetch, and the reader takes the most recently fetched. The wrong
-- figure stays visible in the history rather than vanishing, so a total that
-- once looked different can still be explained.

create table public.price (
  id             uuid           primary key default gen_random_uuid(),

  -- Which driver produced this. Not decoration: the same instrument can be
  -- priced by two sources that disagree, and a reader has to be able to say
  -- which one it took. 'manual' is a person typing a figure the app could not
  -- fetch — it is a price like any other and is recorded as one.
  source         text           not null
                                check (source in ('amfi', 'fx', 'gold', 'manual')),

  -- How the source names this instrument. An ISIN for a fund, a pair like
  -- 'USD/INR' for a rate, a scheme code where that is all the feed gives.
  -- Text rather than a foreign key: the driver knows the vendor's identifier
  -- and must not need a row in `instrument` to exist before it can record a
  -- price. Prices are fetched for the world, not for one household's list.
  external_id    text           not null check (length(btrim(external_id)) between 1 and 64),

  -- The calendar day the price is true for, in the source's own terms. A NAV
  -- is published for a date, not an instant.
  as_of_date     date           not null,

  -- Minor units of `currency`, like every other amount here. A NAV of
  -- ₹123.4567 does not fit two decimal places, so this is the one figure in
  -- the schema stored as numeric rather than as minor units — see below.
  --
  -- numeric(20, 6), because a NAV is quoted to four decimals and an FX rate to
  -- more. Minor units would round a NAV to paise and every valuation computed
  -- from it would inherit the rounding, multiplied by the number of units
  -- held. This is a price, not an amount of money somebody has: the money
  -- invariant is about sums a person owns, and it stays in force everywhere a
  -- price is multiplied into one.
  value          numeric(20, 6) not null check (value >= 0),
  currency       text           not null check (currency ~ '^[A-Z]{3}$'),

  -- When the driver fetched it, which is not the date it is true for. A NAV
  -- for Friday fetched on Monday is normal; a NAV for Friday fetched three
  -- times is a correction history.
  fetched_at     timestamptz    not null default now(),

  created_at     timestamptz    not null default now()
);

comment on table public.price is
  'Dated prices from a driver. Reference data, not household data: a NAV is the same fact for everybody and says nothing about who holds it. Appended, never updated.';
comment on column public.price.value is
  'numeric, not minor units. A NAV quoted to four decimals rounded to paise would carry its rounding into every valuation computed from it, multiplied by the units held.';
comment on column public.price.fetched_at is
  'When the driver got it, which is not the date it is true for. Two rows for one date is a revised figure, and the later fetch wins without the earlier one being lost.';

-- The reader's query, every time: this instrument, on or before this date,
-- most recently fetched.
create index price_lookup_idx
  on public.price (source, external_id, as_of_date desc, fetched_at desc);

alter table public.price enable row level security;

revoke all on public.price from public, anon, authenticated;

-- Select only, for everybody. No client writes a price: the driver does, and
-- the driver is not a client.
grant select on public.price to authenticated;

create policy price_readable
  on public.price
  for select
  to authenticated
  using (true);

comment on policy price_readable on public.price is
  'A published price is public knowledge. Readable by any member; written by the driver alone, so no household can move a figure its own valuations depend on.';

create policy require_second_factor
  on public.price
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor());

-- ─────────────────────────────────────── which prices belong to a holding

-- How the pricing source names this instrument. Null means the app cannot
-- fetch a price for it, which is most holdings on day one and is not an
-- error: a valuation typed in by hand is what the app has always had, and
-- this only removes the typing where a feed exists.
alter table public.instrument
  add column price_source text
    check (price_source is null or price_source in ('amfi', 'fx', 'gold', 'manual')),
  add column price_external_id text
    check (price_external_id is null or length(btrim(price_external_id)) between 1 and 64);

comment on column public.instrument.price_external_id is
  'How the pricing source names this instrument — an AMFI scheme code, an ISIN. Null means no feed covers it and its value is entered by hand, which is not an error.';

-- Both or neither. A source with nothing to look up cannot fetch, and an
-- identifier with no source does not say who to ask.
alter table public.instrument
  add constraint instrument_price_source_paired
    check ((price_source is null) = (price_external_id is null));
