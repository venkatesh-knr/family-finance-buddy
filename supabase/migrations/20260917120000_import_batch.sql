-- Family Finance Buddy — where an imported row came from.
--
-- The imports are next, and eCAS comes first among them (docs/build-plan.md,
-- stage 5). Before any parser exists, three things have to be true of the
-- tables, and none of them can be retrofitted comfortably once a household has
-- imported three years of SIPs.
--
-- ── one: a line must not import twice ───────────────────────────────────
--
-- "A CAS covers a date range somebody will re-request and re-import, and a
-- doubled SIP is a doubled cost basis and a wrong capital gain years later."
--
-- So every imported row carries a stable identity for the statement line it
-- came from — "date, amount, and the raw description, hashed" — and a unique
-- index refuses the second copy. Refused by the database rather than checked
-- in the client: a client-side check is a promise, and this is the failure
-- that would be discovered years later, inside a tax figure.
--
-- The hash is computed on the device, from text this schema deliberately does
-- not hold. A folio number is an account identifier, and "account identifiers
-- keep last four digits only" — so the full folio goes into the hash, which is
-- one-way, and never into a column. `holding.folio_last4` is what a person
-- sees, and four characters is what they need to tell two folios apart.
--
-- ── two: a row must say which import made it ────────────────────────────
--
-- Not for tidiness. A parser that gets a column wrong writes plausible rows,
-- and the question then is "which of these came from the file I imported on
-- Tuesday" — unanswerable unless it was recorded at the time.
--
-- `import_batch` is that record: one row per file, naming what kind of
-- statement it was, the period it covered and who imported it. The batch
-- carries no file, no name of one, and nothing parsed out of it.
--
-- ── three: two folios of one scheme are two positions ───────────────────
--
-- `holding` has been unique per member and instrument since it was created,
-- with the comment "a second one is a data-entry mistake, not a second
-- holding, until lots exist to distinguish them". Lots exist now, and an eCAS
-- is precisely where one scheme arrives twice under two folios — an old one
-- and one opened later. They are separately redeemed and separately matched,
-- so they are two positions.
--
-- The constraint is widened rather than dropped: unique per member,
-- instrument and folio, with no folio still colliding with no folio, so the
-- mistake it was catching is still caught.

-- ═════════════════════════════════════════════════════════ import_batch

create table public.import_batch (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,

  -- Which format was parsed. Named per source rather than a generic 'pdf',
  -- because a row that says only "an import" cannot tell you whether to blame
  -- the CAMS layout or a bank's CSV when the figures look wrong.
  kind          text        not null
                            check (kind in ('ecas_cams', 'ecas_kfintech', 'depository_cas',
                                            'bank_csv', 'card_csv', 'broker_csv', 'template')),

  -- What the statement covered, when it says so. Null is honest for a file
  -- that states no period, and a period is what tells somebody re-requesting a
  -- statement whether they already have those months.
  period_start  date,
  period_end    date,

  -- A short label the person chooses, for recognising this import later.
  -- Deliberately not the file's own name: a downloaded eCAS is often called
  -- after the PAN it was issued for, and this table would then hold an
  -- identifier by accident.
  label         text        check (label is null or length(btrim(label)) between 1 and 120),

  -- How many rows it wrote. Kept because it is the figure a person checks
  -- against the statement's own summary line.
  row_count     integer     not null default 0 check (row_count >= 0),

  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),

  constraint import_batch_period_order
    check (period_start is null or period_end is null or period_start <= period_end),

  -- Lets lot and disposal carry a composite foreign key, so a row cannot cite
  -- an import belonging to another household.
  constraint import_batch_household_id_id_key unique (household_id, id)
);

comment on table public.import_batch is
  'One row per imported file. Holds no file, no file name and nothing parsed out of one — only what kind of statement it was, the period it covered and who imported it.';
comment on column public.import_batch.label is
  'A short name the person chooses. Never the file name: an eCAS is often named after the PAN it was issued for.';

create index import_batch_household_idx on public.import_batch (household_id, created_at desc);

alter table public.import_batch enable row level security;
alter table public.import_batch force row level security;

revoke all on table public.import_batch from public, anon, authenticated;

-- No update and no delete. A batch is a statement of what happened, and the
-- rows citing it outlive any wish to tidy it away.
grant select, insert on table public.import_batch to authenticated;

create trigger import_batch_audit
  after insert or update or delete on public.import_batch
  for each row execute function app.write_audit();

create policy import_batch_select_same_household
  on public.import_batch for select to authenticated
  using (household_id in (select app.household_ids()));

-- Contributor included, matching lot and disposal: somebody who may record
-- their own purchases may import the statement those purchases are on.
create policy import_batch_insert_own_household
  on public.import_batch for insert to authenticated
  with check (
    app.household_role(household_id) in ('owner', 'partner', 'contributor')
    and created_by = (select app.current_account_id())
  );

create policy require_second_factor
  on public.import_batch as restrictive for all to authenticated
  using (app.has_second_factor())
  with check (app.has_second_factor());

-- ═══════════════════════════════════════════ provenance on lot and disposal

alter table public.lot
  add column source_batch_id uuid,
  add column source_hash     text
    check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$');

alter table public.disposal
  add column source_batch_id uuid,
  add column source_hash     text
    check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$');

comment on column public.lot.source_hash is
  'sha256 of the statement line this row came from, computed on the device. Hex, lower case. Null for a row somebody typed. The full folio goes into the hash and never into a column.';
comment on column public.lot.source_batch_id is
  'The import that wrote this row, so a parser''s mistakes can be found by the file that caused them.';

alter table public.lot
  add constraint lot_batch_in_household_fkey
  foreign key (household_id, source_batch_id)
  references public.import_batch (household_id, id) on delete restrict;

alter table public.disposal
  add constraint disposal_batch_in_household_fkey
  foreign key (household_id, source_batch_id)
  references public.import_batch (household_id, id) on delete restrict;

-- The line that stops a re-imported statement doubling a cost basis. Per
-- household, because two households can hold the same fund and their
-- statements are different documents about different money.
create unique index lot_source_hash_key
  on public.lot (household_id, source_hash)
  where source_hash is not null;

create unique index disposal_source_hash_key
  on public.disposal (household_id, source_hash)
  where source_hash is not null;

/**
 * Provenance is written once and never edited.
 *
 * Both tables are correctable in place — "a mistyped cost should be fixed
 * rather than left beside a second row disagreeing with it" — and that is
 * right for a figure. It is wrong for the identity of the statement line the
 * figure came from: an editable hash is a re-import away from a doubled
 * holding, and a batch id that can be moved makes the audit question
 * unanswerable again.
 */
create or replace function app.freeze_import_provenance()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.source_hash is distinct from old.source_hash
     or new.source_batch_id is distinct from old.source_batch_id then
    raise exception
      'Where an imported row came from cannot be changed. Correct the figures instead.'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

comment on function app.freeze_import_provenance() is
  'Refuses an update that moves a row to another import or another statement line. The figures stay editable.';

revoke all on function app.freeze_import_provenance() from public;

create trigger lot_freeze_import_provenance
  before update on public.lot
  for each row execute function app.freeze_import_provenance();

create trigger disposal_freeze_import_provenance
  before update on public.disposal
  for each row execute function app.freeze_import_provenance();

-- ══════════════════════════════════════════════════ two folios, one scheme

alter table public.holding
  add column folio_last4 text
    check (folio_last4 is null or folio_last4 ~ '^[0-9A-Za-z]{1,4}$');

comment on column public.holding.folio_last4 is
  'The last four characters of the folio or account number, and never more — "account identifiers keep last four digits only". Enough to tell two folios of one scheme apart, and of no use to anybody who reads it.';

alter table public.holding drop constraint holding_member_instrument_key;

-- The same rule, one column wider. coalesce rather than a plain unique index,
-- because in SQL two nulls do not collide — and without it the mistake the old
-- constraint existed to catch, a second position typed in by accident, would
-- stop being caught the moment folios existed.
create unique index holding_member_instrument_folio_key
  on public.holding (member_id, instrument_id, coalesce(folio_last4, ''));

comment on index public.holding_member_instrument_folio_key is
  'One position per member, instrument and folio. Two folios of one scheme are two positions; two of neither are still a mistake.';
