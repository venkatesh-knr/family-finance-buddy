-- Family Finance Buddy — closing a month, and the readings it could not take.
--
-- "Foreign-asset disclosure asks for the highest value each holding reached
-- during the calendar year […] and that figure cannot be reconstructed from a
-- year-end statement. Every month that passes before the app starts
-- snapshotting is a month of peak data gone. […] It is the one piece of this
-- design where delay actually destroys information." (§606)
--
-- WHAT THIS JOB CAN AND CANNOT DO
--
-- It cannot value anything. There is no `price` table and no driver yet, so
-- nothing here can look up what a holding was worth on the last day of the
-- month. A job that guessed would be worse than no job: a fabricated reading
-- is indistinguishable from a real one once it is in the table, and it would
-- corrupt the very figure §606 is trying to protect.
--
-- What it can do is stop a reading that WAS taken from being lost as a
-- month-end figure. Somebody enters a value on the 20th; the month closes on
-- the 30th; the series now has a gap at month end even though the month was
-- read. This carries that reading to the month end and marks it `backfill` —
-- which the schema already defines as "a month reconstructed afterwards […] a
-- defensible approximation […] visibly weaker than a reading taken at the
-- time". That is exactly what it is.
--
-- A month with no reading at all gets nothing. The gap is the truth and must
-- stay visible: the screens already say a peak computed over missing months is
-- a lower bound rather than the figure, and inventing a value would turn an
-- honest lower bound into a confident wrong answer.

-- ──────────────────────────────────────────── what the system may write
--
-- Two changes so the job can write at all, both narrow on purpose.
--
-- created_by becomes nullable. A row this job writes has no author, and null
-- says so — the same reading audit_log takes of a scheduled actor: "nobody did
-- this, the system did". Attributing it to whichever member happened to be the
-- oldest owner would be a small lie told in a column people read.
alter table public.valuation_snapshot alter column created_by drop not null;

comment on column public.valuation_snapshot.created_by is
  'Null when the month-end close job wrote the row. Nobody typed it; the system carried it forward.';

/*
 * And a policy for that path, because the table forces row-level security and
 * a security-definer function is still subject to it. The alternative was to
 * stop forcing RLS on a table of household data, which is a far larger
 * concession than this.
 *
 * The three clauses are the whole of the system path and nothing else fits
 * through them: a signed-in caller always has auth.uid(), so `authenticated`
 * cannot use this policy; `anon` holds no insert privilege on the table at
 * all; and even the job may only write an unattributed backfill row.
 */
create policy valuation_snapshot_insert_by_the_close_job
  on public.valuation_snapshot
  for insert
  to public
  with check (
    (select auth.uid()) is null
    and source = 'backfill'
    and created_by is null
  );

comment on policy valuation_snapshot_insert_by_the_close_job on public.valuation_snapshot is
  'The month-end close job only: no session, no author, and backfill rows alone. A signed-in caller always has auth.uid() and cannot match it.';

/**
 * Close one month for one household.
 *
 * Idempotent by the unique key on (holding_id, as_of_date): running it twice
 * inserts nothing the second time. Returns how many month-end readings it
 * carried forward and how many holdings it could not read at all, because the
 * second number is the one worth acting on.
 */
create or replace function app.close_month(
  target_household_id uuid,
  month_end date
)
returns table (carried integer, unread integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_month_start date := date_trunc('month', month_end)::date;
  v_carried integer := 0;
  v_unread  integer := 0;
  -- Null when a cron fires this, the caller's account when a person does.
  -- Both are true statements about who wrote the row, and the two insert
  -- policies each accept exactly one of them: the system policy wants no
  -- author and no session, the ordinary one wants the author to be you.
  v_author  uuid := app.current_account_id();
begin
  -- One row per holding, taking that holding's latest reading within the
  -- month. distinct on is the cheapest way to say "the most recent one".
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
           latest.quantity, latest.value_minor, latest.currency, 'backfill', v_author,
           'Carried to month end by the close job from the latest reading in the month.'
      from latest
     -- Nothing is overwritten. A reading actually taken on the last day is
     -- worth more than this one and must win.
     on conflict (holding_id, as_of_date) do nothing
    returning 1
  )
  select count(*)::integer into v_carried from inserted;

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

comment on function app.close_month(uuid, date) is
  'Carries each holding''s latest in-month reading to the month end as backfill. Values nothing it was not told; a holding read in no month stays unread.';

revoke all on function app.close_month(uuid, date) from public;

/**
 * Close the month that has just ended, for every household.
 *
 * The IST rule, and it is the whole reason this is not simply "run on the 1st".
 * "All period boundaries are IST (Asia/Kolkata), whatever the device says."
 * A job at midnight UTC on the 1st is still the previous month in India for
 * five and a half hours, and would close September on a row that India calls
 * 30 September — off by a day, every month, in the one direction nobody checks.
 */
create or replace function app.close_last_month()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_today_ist date := (now() at time zone 'Asia/Kolkata')::date;
  v_month_end date := (date_trunc('month', v_today_ist) - interval '1 day')::date;
  v_household uuid;
begin
  -- Only on the first IST day of a month. The schedule fires daily because a
  -- cron expression cannot say "last day of the month" without knowing how
  -- long the month is, and getting February wrong is how a year loses a
  -- reading.
  if v_today_ist <> date_trunc('month', v_today_ist)::date then
    return;
  end if;

  for v_household in select id from public.household loop
    perform app.close_month(v_household, v_month_end);
  end loop;
end;
$fn$;

revoke all on function app.close_last_month() from public;

/**
 * A household can close its own month early, or catch one up.
 *
 * Owner and partner only. This exists because the scheduled job cannot help
 * with a month that has already passed unread, and somebody entering figures
 * from a statement in March should be able to say "that is the January
 * reading" without waiting for a cron.
 */
create or replace function public.close_month(
  target_household_id uuid,
  month_end date
)
returns table (carried integer, unread integer)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if app.household_role(target_household_id) not in ('owner', 'partner') then
    raise exception 'Only an owner or partner can close a month.' using errcode = '42501';
  end if;

  -- A month end, not any date. Closing "the month" on the 17th would write a
  -- reading dated the 17th and call it a month-end figure.
  if month_end <> (date_trunc('month', month_end) + interval '1 month' - interval '1 day')::date then
    raise exception '% is not the last day of its month.', month_end using errcode = '22023';
  end if;

  return query select * from app.close_month(target_household_id, month_end);
end;
$fn$;

revoke all on function public.close_month(uuid, date) from public;
grant execute on function public.close_month(uuid, date) to authenticated;

-- ─────────────────────────────────────────────────────────── the schedule
--
-- Guarded, because pg_cron is a Supabase-hosted extension and this migration
-- must still apply to a plain Postgres or a local stack without it. A missing
-- schedule is a degraded install, not a broken one: public.close_month is
-- still there to be called by hand.

do $sched$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;

    -- 18:35 UTC is 00:05 IST the following day, so this runs a few minutes
    -- into each IST day and the function itself decides whether that day is
    -- the first of a month.
    if not exists (select 1 from cron.job where jobname = 'close-last-month') then
      perform cron.schedule('close-last-month', '35 18 * * *', 'select app.close_last_month()');
    end if;
  else
    raise notice 'pg_cron unavailable; month-end close must be run by hand via public.close_month().';
  end if;
exception
  -- Deliberately broad. pg_cron usually needs shared_preload_libraries as well
  -- as the extension, and the ways it can be half-available are more varied
  -- than a list of error codes. None of them are a reason to fail a migration:
  -- an unscheduled job is a degraded install, and public.close_month() is still
  -- there to be called by hand or by the app.
  when others then
    raise notice 'Could not schedule the month-end close: %. The function still exists.', sqlerrm;
end;
$sched$;
