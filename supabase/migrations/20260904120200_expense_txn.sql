-- Family Finance Buddy — the expense ledger.
--
-- One table, the first real slice of the ledger module. Policies for it live in
-- the policies migration alongside the ones for identity; this file creates the
-- table, enables row-level security (so it is deny-all the moment it exists),
-- grants privileges explicitly, and publishes it for live updates.
--
-- Deferred on purpose, and absent rather than dangling:
--   category_id  waits for expense_category
--   fx_rate      waits for the fx_rate table; conversion is derived on read,
--                and the native amount on this row is never overwritten
--   receipt_id   waits for document + storage

create table public.expense_txn (
  id            uuid        primary key default gen_random_uuid(),
  household_id  uuid        not null references public.household (id) on delete restrict,
  member_id     uuid        not null,

  txn_date      date        not null,
  amount_minor  bigint      not null check (amount_minor > 0),
  currency      text        not null check (currency ~ '^[A-Z]{3}$'),

  payee         text        check (length(btrim(payee)) between 1 and 120),
  method        text        check (method in ('cash', 'card', 'upi', 'netbanking', 'auto_debit', 'other')),
  note          text        check (length(note) <= 500),

  -- Deletes are soft everywhere. There is no delete grant and no delete policy
  -- on this table, so a hard delete is impossible from a client even by mistake.
  voided_at     timestamptz,
  voided_by     uuid        references public.user_account (id) on delete restrict,

  created_by    uuid        not null default app.current_account_id()
                            references public.user_account (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint expense_txn_voided_pair
    check ((voided_at is null) = (voided_by is null)),
  -- The member and the household on a row must agree; the database enforces it
  -- rather than trusting the caller to send a consistent pair.
  constraint expense_txn_member_in_household_fkey
    foreign key (household_id, member_id)
    references public.member (household_id, id) on delete restrict
);

comment on table public.expense_txn is
  'One spend event. Freely editable until a figure has been relied upon, then voided and re-entered.';
comment on column public.expense_txn.amount_minor is
  'Integer minor units — paise for INR, cents for USD. Never a float, and formatted only at the display edge.';
comment on column public.expense_txn.currency is
  'The currency actually spent. Stored native; the base-currency figure is derived on read at the rate for txn_date.';
comment on column public.expense_txn.txn_date is
  'The calendar date of the spend in Asia/Kolkata. A date, not a timestamp, so no device timezone can move it.';
comment on column public.expense_txn.created_by is
  'Defaulted from the caller identity so attribution cannot be forged; the insert policy checks it too.';

-- The list screen reads one household newest-first, which is exactly this index.
create index expense_txn_household_date_idx
  on public.expense_txn (household_id, txn_date desc, created_at desc);

create index expense_txn_member_idx on public.expense_txn (member_id);

create trigger expense_txn_touch_updated_at
  before update on public.expense_txn
  for each row execute function app.touch_updated_at();

alter table public.expense_txn enable row level security;
alter table public.expense_txn force row level security;

revoke all on table public.expense_txn from public, anon, authenticated;
-- No delete, ever. Voiding is an update.
grant select, insert, update on table public.expense_txn to authenticated;

-- ------------------------------------------------------------ live updates
--
-- Change streams honour the same policies as any query, so a subscriber only
-- ever receives rows their policies already allow them to select. Guarded so
-- the migration also applies to a plain Postgres instance with no such
-- publication, and is idempotent if the table is already a member.

do $pub$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'expense_txn'
    ) then
      alter publication supabase_realtime add table public.expense_txn;
    end if;
  end if;
end;
$pub$;
