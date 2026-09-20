-- Family Finance Buddy — what the registrar says a position holds.
--
-- The first real import made this concrete. A CAMS eCAS requested for April to
-- September wrote a lot per instalment in that window and nothing before it, so
-- the app held 280 units of a fund whose closing balance on the same statement
-- was 4,013. The units it derives from lots were 93% short, and nothing said so.
--
-- ── two questions, two sources ──────────────────────────────────────────
--
-- *How much is this worth* and *what did it cost* have different answers, and
-- the statement supplies both separately. The closing balance is the
-- registrar's own count of units held on a date. The lots are the purchases
-- somebody could see. A partial statement answers the first completely and the
-- second not at all for the years it does not reach — and the app has been
-- deriving both from the lots.
--
-- So the closing balance is recorded, on the holding, with the date it was
-- true and the import that stated it. Units for valuation become that balance
-- plus whatever is recorded after its date. Cost stays derived from the lots
-- alone and never borrows these columns: a cost is the sum of what was paid,
-- and there is nothing to sum for units the statement did not itemise.
--
-- Rejected: writing the opening balance in as one synthetic lot. It puts the
-- units right in a single line and invents an acquisition date and a cost for
-- units bought across years — both of which feed the tax engine, where a
-- fabricated date becomes a confident long-term classification out of nothing.
--
-- ── not a business rule ─────────────────────────────────────────────────
--
-- "A later import supersedes it; an earlier one does not" is not enforced here.
-- Policies and constraints do access and shape; which of two statements is the
-- better witness is a rule, and it lives in the repository, as one conditional
-- update so two imports running at once cannot interleave into the older one
-- winning.
--
-- What the database does hold to is the shape: a balance has a date or it is
-- not a balance — "a balance without one silently ages into a wrong figure" —
-- and it cannot cite another household's import.

alter table public.holding
  add column stated_quantity        numeric(28, 8),
  add column stated_as_at           date,
  add column stated_source_batch_id uuid;

alter table public.holding
  add constraint holding_stated_balance_shape
    check (
      (stated_quantity is null) = (stated_as_at is null)
      and (stated_quantity is null or stated_quantity >= 0)
      -- A batch says where a balance came from, so it cannot exist without one.
      and (stated_source_batch_id is null or stated_quantity is not null)
    );

-- The same composite key lot and disposal cite an import through: a holding
-- cannot claim a balance from another household's statement, and with the
-- batch null the key is not checked.
alter table public.holding
  add constraint holding_stated_batch_in_household_fkey
    foreign key (household_id, stated_source_batch_id)
    references public.import_batch (household_id, id) on delete restrict;

comment on column public.holding.stated_quantity is
  'The units a registrar''s statement reported as held on stated_as_at. Used to value the position when the lots do not reach back to its start. Never used for cost, which is derived from lots alone.';
comment on column public.holding.stated_as_at is
  'The date stated_quantity was true. A later import with a later date supersedes it; an earlier one does not. Together with stated_quantity or not at all.';
comment on column public.holding.stated_source_batch_id is
  'The import that stated the balance, so a wrong one can be traced to the file that caused it. Null for a balance nobody imported.';

-- Explicit, though the table-level grant already covers new columns: this
-- migration should be true on an instance that did not run the ones before it.
-- The row policies on holding are untouched and apply to these columns as to
-- the rest — a personal holding's balance is returned to its member and to
-- nobody else, which the policy test beside this file proves.
grant select, insert, update on table public.holding to authenticated;
