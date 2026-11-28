-- Family Finance Buddy — what a broker says a position cost on average (docs/build-plan.md step 7c; docs/decisions.md, "Broker files", 23 November 2026).
--
-- FOR REVIEW. Not applied. Shown before any screen is built on it (CLAUDE.md). It does not reach the live project until the maintainer runs `supabase db push` (merging does not).
--
-- A broker's holdings statement says how many units are held on a day (the stated quantity, `holding.stated_quantity`, built for the eCAS import) and, beside it, the average price the
-- broker says was paid. The owner decided (23 November 2026) that the average price is kept as a stated figure only, on the same row, with its currency and under the same rule: a later
-- statement supersedes it and an earlier one does not. It is **never** cost, gain, return, tax or the allocation return; those come from lots alone, and nothing in the database reads this
-- column to work out any of them. It is shown on the holding's detail in words: *Zerodha's average price ₹X on 30 Sep, as the broker states it*.
--
-- What it adds:
--   holding.stated_average_price           the broker's average price per unit, in the major unit of its currency; numeric, because a price is not an amount somebody owns (the one place besides
--                                          `price.value` where the schema keeps a per-unit figure as numeric: a US stock is quoted to four places, which minor units would round).
--   holding.stated_average_price_currency  the currency it is in; the holding's own currency is not assumed, since a feeder fund and a US stock differ from the rupee.
--
-- The shape the database holds to: a price has a currency and a currency has a price; it is not below nothing; and it cannot exist without the stated quantity it was stated beside, so its date is
-- `stated_as_at` and a price cannot age without one. "A later statement supersedes it" is a rule and lives in the repository, as it does for the quantity (holding_stated_balance.sql).
--
-- The export: the two columns are left out of the holding sheet on purpose (`src/domain/export/entities.ts`, `leftOut`), since a template upload writes holdings from a fixed list of columns (migration
-- 20261031120000) and the figure is only the broker's statement, which the next holdings file states again. A restore therefore comes back without it. Whether it should travel is the owner's to decide.
--
-- What it does not change: row-level security on holding (a personal holding's average price is returned to its member and to nobody else, as its quantity is; the pgTAP file beside this one proves
-- it), its grants, its audit trigger (the column is in the row the trigger records). No table is added, so no trigger is owed.

alter table public.holding
  add column stated_average_price          numeric(20, 6),
  add column stated_average_price_currency text;

alter table public.holding
  add constraint holding_stated_average_price_shape
    check (
      (stated_average_price is null) = (stated_average_price_currency is null)
      and (stated_average_price is null or stated_average_price >= 0)
      and (stated_average_price_currency is null or stated_average_price_currency ~ '^[A-Z]{3}$')
      -- a price is stated beside a quantity, on its date
      and (stated_average_price is null or stated_quantity is not null)
    );

comment on column public.holding.stated_average_price is
  'What a broker''s holdings statement says was paid per unit on average, in stated_average_price_currency, as at stated_as_at. A stated figure only: never cost, gain, return, tax or allocation return, which come from lots alone.';
comment on column public.holding.stated_average_price_currency is
  'The currency of stated_average_price. Together with the price or not at all.';

-- Explicit, though the table-level grant already covers new columns: this migration should be true on an instance that did not run the ones before it.
grant select, insert, update on table public.holding to authenticated;
