-- Family Finance Buddy — closing a month, and the readings it could not take.
--
-- "Foreign-asset disclosure asks for the highest value each holding reached
-- during the calendar year […] and that figure cannot be reconstructed from a
-- year-end statement. Every month that passes before the app starts
-- snapshotting is a month of peak data gone. […] It is the one piece of this
-- design where delay actually destroys information." (§606)
--
-- WHAT THIS CAN AND CANNOT DO
--
-- It cannot value anything. There is no `price` table and no driver yet, so
-- nothing here can look up what a holding was worth on the last day of the
-- month. A job that guessed would be worse than none: a fabricated reading is
-- indistinguishable from a real one once written, and it would corrupt the
-- very figure §606 is trying to protect.
--
-- What it can do is stop a reading that WAS taken from being lost as a
-- month-end figure. Somebody enters a value on the 20th; the month closes on
-- the 30th; the series has a gap at month end even though the month was read.
-- This carries that reading to the month end and marks it `backfill` — which
-- the schema already defines as "a month reconstructed afterwards […] a
-- defensible approximation […] visibly weaker than a reading taken at the
-- time". That is exactly what it is.
--
-- A month with no reading at all gets nothing. The gap is the truth and must
-- stay visible: the screens already say a peak computed over missing months is
-- a lower bound rather than the figure, and inventing a value would turn an
-- honest lower bound into a confident wrong answer.
--
-- WHY THERE IS NO SCHEDULED JOB
--
-- The first version ran on pg_cron. Running without a session meant a
-- security-definer function, which meant an insert policy for a caller that is
-- nobody, which meant a policy written `to public` — and the structural test
-- forbidding exactly that failed the build. It was right to. Deny-by-default
-- is not a rule to route around for a convenience.
--
-- Following that back turned out to be the answer rather than the obstacle.
-- Because this carries forward only readings that already exist and invents
-- nothing, running it late is exactly as good as running it on time: no
-- information decays in the meantime. The cron bought nothing that closing the
-- month next time somebody opens the app does not.
--
-- So it is an ordinary function run by an ordinary caller under the policies
-- everyone else obeys. SECURITY INVOKER on purpose: every row it reads and
-- writes passes the checks the member would face doing this by hand, and there
-- is no path here a person could not have walked themselves.

create or replace function public.close_month(
  target_household_id uuid,
  month_end date
)
returns table (carried integer, unread integer)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_month_start date := date_trunc('month', month_end)::date;
  v_carried integer := 0;
  v_unread  integer := 0;
begin
  if app.household_role(target_household_id) not in ('owner', 'partner') then
    raise exception 'Only an owner or partner can close a month.' using errcode = '42501';
  end if;

  -- A month end, not any date. Closing "the month" on the 17th would write a
  -- row dated the 17th and call it a month-end figure: a wrong number wearing
  -- the right label.
  if month_end <> (date_trunc('month', month_end) + interval '1 month' - interval '1 day')::date then
    raise exception '% is not the last day of its month.', month_end using errcode = '22023';
  end if;

  -- One row per holding, taking that holding's latest reading within the
  -- month. `distinct on` is the cheapest way to say "the most recent one".
  with latest as (
    select distinct on (v.holding_id)
           v.holding_id, v.quantity, v.value_minor, v.currency
      from public.valuation_snapshot v
      join public.holding h on h.id = v.holding_id
     where h.household_id = target_household_id
       and h.status = 'active'
       and v.as_of_date between v_month_start and month_end
     order by v.holding_id, v.as_of_date desc
  ),
  inserted as (
    insert into public.valuation_snapshot
      (household_id, holding_id, as_of_date, quantity, value_minor, currency, source, created_by, note)
    select target_household_id, latest.holding_id, month_end,
           latest.quantity, latest.value_minor, latest.currency, 'backfill',
           (select app.current_account_id()),
           'Carried to month end from the latest reading in the month.'
      from latest
     -- Nothing is overwritten. A reading actually taken on the last day is
     -- worth more than a carried one and must win.
     on conflict (holding_id, as_of_date) do nothing
    returning 1
  )
  select count(*)::integer into v_carried from inserted;

  -- The number worth acting on: holdings whose peak for this year is now
  -- permanently a lower bound, because nobody read them this month.
  select count(*)::integer into v_unread
    from public.holding h
   where h.household_id = target_household_id
     and h.status = 'active'
     and not exists (
       select 1 from public.valuation_snapshot v
        where v.holding_id = h.id
          and v.as_of_date between v_month_start and month_end
     );

  return query select v_carried, v_unread;
end;
$fn$;

comment on function public.close_month(uuid, date) is
  'Carries each holding''s latest in-month reading to the month end as backfill, and counts the holdings it could not read. Values nothing it was not told. Invoker rights: it does nothing a member could not do by hand.';

revoke all on function public.close_month(uuid, date) from public;
grant execute on function public.close_month(uuid, date) to authenticated;
