-- Family Finance Buddy — purchases and sales, so a gain can be derived.
--
-- "Capital gains are derived from lots. Never store a gain."
--
-- Until now a holding carried `quantity` and a single `cost_minor`, and that
-- column said of itself: "Kept for the day lots arrive; until then it is what
-- the sheet already knows." This is that day. One cost figure per holding can
-- answer what a position cost in total and nothing else — not which units were
-- sold, not what those units cost, not how long they were held. Every one of
-- those is needed before a gain can be computed at all, and all three are
-- unrecoverable once a part-sale has happened against a single averaged
-- figure.
--
-- So: a row per acquisition, a row per sale, and the arithmetic between them
-- derived on read by `src/domain/lots.ts`. Nothing here stores a gain, a
-- holding period, or whether a parcel is long-term. The first is derived; the
-- last is a dated rule in `tax_rule`, which does not exist yet and which prior
-- years must recompute against.
--
-- ── first in, first out ─────────────────────────────────────────────────
--
-- Not modelled as a choice. For shares held in demat and for mutual fund
-- units the Act prescribes FIFO, so there is no per-household matching
-- setting to be set wrong. The schema stores the facts; the matcher applies
-- the one rule.
--
-- ── why a disposal does not reference a lot ─────────────────────────────
--
-- The obvious shape is a link table saying which sale consumed which purchase.
-- It is the wrong one. Those links are *derived* — enter a forgotten purchase
-- from two years ago and every subsequent match shifts, because FIFO is
-- positional. Stored links would then be stale in a way nothing detects, and
-- the gain computed from them would be wrong while looking authoritative. The
-- matching lives in code that runs fresh every time, and the tables hold only
-- what somebody actually observed: a purchase happened, a sale happened.
--
-- ── what happens to holding.cost_minor ──────────────────────────────────
--
-- It stays, and it is not dropped in this migration. Positions entered before
-- today have a cost there and no lots behind it, and dropping the column would
-- delete the only cost those holdings have. It is now the fallback: a holding
-- with lots derives its cost from them, and a holding without lots keeps
-- showing what the sheet knew. `holding_cost_source` below says which, so a
-- screen can be honest about the difference rather than presenting a
-- reconstructed figure and a recorded one as the same kind of number.

-- ─────────────────────────────────────────────────────────────── lot

create table public.lot (
  id             uuid           primary key default gen_random_uuid(),
  household_id   uuid           not null references public.household (id) on delete restrict,
  holding_id     uuid           not null,

  -- The calendar day in IST the units were acquired. A date, not a timestamp:
  -- a holding period is counted in days and the hour it was bought has never
  -- mattered to any rule that uses it.
  acquired_on    date           not null,

  -- Units bought. Same type and reasoning as holding.quantity — fractional
  -- shares are ordinary on US brokers, numeric never a float.
  --
  -- Greater than zero, not merely non-negative: a lot of nothing is not an
  -- acquisition, and allowing one would put rows in the FIFO queue that can
  -- never be consumed.
  quantity       numeric(28, 8) not null check (quantity > 0),

  -- What those units cost, in minor units of `currency`, all in. Brokerage,
  -- STT and stamp duty belong in here rather than in a column of their own:
  -- they are part of the cost of acquisition for the purpose that matters, and
  -- splitting them out invites a cost basis that forgets to add them back.
  cost_minor     bigint         not null check (cost_minor >= 0),
  currency       text           not null check (currency ~ '^[A-Z]{3}$'),

  -- How the units arrived. It changes what the cost means, and a bonus issue
  -- costing nothing is a real zero rather than a missing figure — which is why
  -- cost_minor permits zero and quantity does not.
  kind           text           not null default 'purchase'
                                check (kind in ('purchase', 'bonus', 'split', 'transfer', 'gift', 'esop')),

  -- Free text, for the things a schema should not try to enumerate: which
  -- broker, which folio, why the cost looks odd.
  note           text           check (note is null or length(note) <= 500),

  created_by     uuid           not null default app.current_account_id()
                                references public.user_account (id) on delete restrict,
  created_at     timestamptz    not null default now(),
  updated_at     timestamptz    not null default now(),

  constraint lot_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict
);

comment on table public.lot is
  'One acquisition. Gains are derived from these and never stored; the matching to sales is FIFO, computed on read.';
comment on column public.lot.cost_minor is
  'Cost of acquisition, all in — brokerage, STT and stamp duty included, in minor units of currency.';
comment on column public.lot.kind is
  'purchase | bonus | split | transfer | gift | esop. A bonus issue has a real cost of zero, which is why zero is allowed here and not in quantity.';

-- The matcher reads a holding's lots oldest first. This is that query.
create index lot_holding_acquired_idx on public.lot (holding_id, acquired_on, id);
create index lot_household_idx on public.lot (household_id, acquired_on desc);

-- ────────────────────────────────────────────────────────── disposal

create table public.disposal (
  id             uuid           primary key default gen_random_uuid(),
  household_id   uuid           not null references public.household (id) on delete restrict,
  holding_id     uuid           not null,

  disposed_on    date           not null,
  quantity       numeric(28, 8) not null check (quantity > 0),

  -- What the sale fetched, net of the costs of selling, in minor units of
  -- `currency`. Net for the same reason a lot's cost is gross: it is the
  -- figure the gain is actually computed from, and holding it any other way
  -- means every consumer has to remember to adjust it.
  proceeds_minor bigint         not null check (proceeds_minor >= 0),
  currency       text           not null check (currency ~ '^[A-Z]{3}$'),

  kind           text           not null default 'sale'
                                check (kind in ('sale', 'redemption', 'maturity', 'transfer', 'gift')),
  note           text           check (note is null or length(note) <= 500),

  created_by     uuid           not null default app.current_account_id()
                                references public.user_account (id) on delete restrict,
  created_at     timestamptz    not null default now(),
  updated_at     timestamptz    not null default now(),

  constraint disposal_holding_in_household_fkey
    foreign key (household_id, holding_id)
    references public.holding (household_id, id) on delete restrict
);

comment on table public.disposal is
  'One sale. Which purchases it consumed is derived by FIFO on read, never stored — a forgotten purchase entered later shifts every subsequent match.';
comment on column public.disposal.proceeds_minor is
  'Net proceeds, after the costs of selling. The figure the gain is computed from.';

create index disposal_holding_disposed_idx on public.disposal (holding_id, disposed_on, id);
create index disposal_household_idx on public.disposal (household_id, disposed_on desc);

-- ──────────────────────────────────────── what a position cost, and how we know

/**
 * The cost of what is still held, and where that figure came from.
 *
 * Two sources, and a screen must be able to tell them apart. 'lots' means the
 * cost was derived from recorded acquisitions net of recorded sales — the
 * figure the tax computation will eventually use. 'holding' means there are no
 * lots and this is the single number somebody typed in before this table
 * existed. They are not the same kind of fact, and presenting them
 * identically would be the app being confidently vague.
 *
 * SECURITY INVOKER. Every row it reads is one the caller could read anyway, so
 * there is nothing here that needs to see past a policy — and a definer
 * function on a FORCE RLS table would see nothing at all, which is a trap this
 * project has already walked into once.
 */
create or replace function public.holding_cost_source(target_holding_id uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from public.lot l where l.holding_id = target_holding_id)
      then 'lots'
    else 'holding'
  end;
$$;

comment on function public.holding_cost_source(uuid) is
  'lots | holding. Whether a position''s cost is derived from recorded acquisitions or is the pre-lots figure on the holding row.';

revoke all on function public.holding_cost_source(uuid) from public;
grant execute on function public.holding_cost_source(uuid) to authenticated;

comment on column public.holding.cost_minor is
  'The pre-lots cost figure. Superseded by public.lot wherever lots exist — see holding_cost_source(). Kept because holdings entered before lots have no other cost, and dropping it would delete it.';

-- ───────────────────────────────────────────────────────────── security

alter table public.lot enable row level security;
alter table public.lot force row level security;
alter table public.disposal enable row level security;
alter table public.disposal force row level security;

revoke all on public.lot from public, anon, authenticated;
revoke all on public.disposal from public, anon, authenticated;

-- No delete, on either. A sale that did not happen is a correction to make in
-- place; a purchase that did not happen is the same. "Deletes are soft
-- everywhere", and a deleted lot silently re-matches every sale after it.
grant select, insert, update on public.lot to authenticated;
grant select, insert, update on public.disposal to authenticated;

/**
 * A lot is as private as the holding it belongs to.
 *
 * Neither table carries a member_id or a visibility of its own. They hang off
 * a holding and that is where the question belongs — the same reasoning
 * valuation_snapshot was built on, and for the sharper version of the same
 * reason: publishing what a personal holding cost and what it sold for, while
 * hiding the holding, would leak more than the holding row does.
 *
 * The subquery runs as the caller so the holding's own policy decides. One
 * rule, written once, rather than a copy here to drift out of step with it.
 */
create policy lot_select_same_household
  on public.lot
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.holding h where h.id = lot.holding_id)
  );

create policy disposal_select_same_household
  on public.disposal
  for select
  to authenticated
  using (
    household_id in (select app.household_ids())
    and exists (select 1 from public.holding h where h.id = disposal.holding_id)
  );

-- Writing needs the same visibility test in the with-check, not only the same
-- role. Without it a contributor could attach a lot to a holding they cannot
-- read — which both writes into somebody's private position and tells them it
-- exists, from the error they do not get.
create policy lot_insert_own_household
  on public.lot
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = lot.holding_id)
  );

create policy disposal_insert_own_household
  on public.disposal
  for insert
  to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
    and exists (select 1 from public.holding h where h.id = disposal.holding_id)
  );

-- Correctable in place, like a valuation and unlike a transaction: a mistyped
-- cost should be fixed rather than left beside a second row disagreeing with
-- it. created_by is absent from the with-check, so attribution cannot be moved
-- to somebody else.
create policy lot_update_own_household
  on public.lot
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = lot.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = lot.holding_id)
  );

create policy disposal_update_own_household
  on public.disposal
  for update
  to authenticated
  using (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = disposal.holding_id)
  )
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and exists (select 1 from public.holding h where h.id = disposal.holding_id)
  );

comment on policy lot_update_own_household on public.lot is
  'A cost may be corrected in place. Attribution cannot be moved, and the holding must still be one the caller can read.';

-- Restrictive, narrowing the policies above rather than adding a way past
-- them. The publishable key ships in the bundle, so a password alone must not
-- reach household data.
create policy require_second_factor
  on public.lot
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

create policy require_second_factor
  on public.disposal
  as restrictive
  for all
  to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ────────────────────────────────────────────────────────────── audit

-- "Every table holding household data gets its audit trigger in the same
-- migration that creates the table — never in a later one."

create trigger lot_touch_updated_at
  before update on public.lot
  for each row execute function app.touch_updated_at();

create trigger lot_audit
  after insert or update or delete on public.lot
  for each row execute function app.write_audit();

create trigger disposal_touch_updated_at
  before update on public.disposal
  for each row execute function app.touch_updated_at();

create trigger disposal_audit
  after insert or update or delete on public.disposal
  for each row execute function app.write_audit();
