-- Family Finance Buddy — the FIRE projection's return defaults to nothing.
--
-- 20260929120000 gave fire_return_pct a default of 10. That is an assumption about the future, and not the
-- least one: a household that has set nothing was being shown a date it reached on a growth nobody had
-- chosen. A return of 0 is the projection that assumes the least. The household sets its own.
--
-- Two things change, and they are different in kind.
--
--   The column default, for every household created or reset from now on. reset_demo_household sets the
--   column to `default`, so a reset follows it without being redefined.
--
--   The rows that are at 10 now. 10 was the default and not a choice: the column is a day old, and the
--   screen has stated the figure beside every date it gave, so any household that wanted 10% can set it
--   again in the one field. This cannot tell a 10 that was left from a 10 that was typed, so it moves both,
--   and says so here. Every other value is untouched.

alter table public.household
  alter column fire_return_pct set default 0;

update public.household
   set fire_return_pct = 0
 where fire_return_pct = 10;

comment on column public.household.fire_return_pct is
  'The assumed annual return on the corpus, per cent. A judgement, which is why it is a household setting; defaults to 0, the projection that assumes the least; capped at 50 because past that it stops being an assumption.';
