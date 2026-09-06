-- Family Finance Buddy — changing somebody's role.
--
-- membership has no write grant and no write policy, which is right: a client
-- that could update that table directly could grant itself ownership. So this
-- is a function, and it checks three things a policy could not express
-- together.
--
-- The third is the one that matters. "A second person holding owner rights, so
-- a locked-out owner is not a locked-out household" (§955) only works while an
-- owner exists — and the way a household loses its last owner is not malice,
-- it is somebody tidying up their own role and not noticing they were the only
-- one. That is refused here rather than explained afterwards.
--
-- Still outstanding, and deliberately not smuggled in: §931 wants "a
-- re-authentication prompt before destructive or sensitive actions — deleting
-- a member, exporting the full dataset, changing someone's role". That prompt
-- belongs to all three and deserves its own slice; this function is where it
-- will attach when it exists.

create or replace function public.set_member_role(target_member_id uuid, new_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_household uuid;
  v_current   text;
  v_owners    integer;
begin
  if new_role not in ('owner', 'partner', 'contributor', 'viewer') then
    raise exception 'Unknown role: %', new_role using errcode = '22023';
  end if;

  select ms.household_id, ms.role
    into v_household, v_current
    from public.membership ms
   where ms.member_id = target_member_id
     and ms.revoked_at is null;

  if v_household is null then
    -- Says nothing about whether the member exists elsewhere. Somebody probing
    -- ids should learn only that this one is not theirs to change.
    raise exception 'No such member in a household you can administer.' using errcode = '42501';
  end if;

  if app.household_role(v_household) is distinct from 'owner' then
    raise exception 'Only an owner can change a role.' using errcode = '42501';
  end if;

  if v_current = new_role then
    return v_current;
  end if;

  -- The last owner cannot stop being one. Counted at the moment of the change
  -- and under the row lock below, so two owners demoting each other at once
  -- cannot both succeed and leave nobody.
  if v_current = 'owner' and new_role <> 'owner' then
    -- Lock first, then count. Postgres refuses FOR UPDATE alongside an
    -- aggregate, and the two steps are what make the guard hold anyway: the
    -- lock serialises two owners demoting each other at once, so the second
    -- transaction counts after the first has committed rather than beside it.
    perform 1
       from public.membership
      where household_id = v_household
        and role = 'owner'
        and revoked_at is null
        for update;

    select count(*) into v_owners
      from public.membership
     where household_id = v_household
       and role = 'owner'
       and revoked_at is null;

    if v_owners <= 1 then
      raise exception
        'This is the household''s only owner. Make somebody else an owner first — otherwise nobody could invite, administer, or recover the household.'
        using errcode = '22023';
    end if;
  end if;

  update public.membership
     set role = new_role
   where member_id = target_member_id
     and revoked_at is null;

  return new_role;
end;
$fn$;

comment on function public.set_member_role(uuid, text) is
  'Owner only. Refuses to remove the last owner, which is how a household loses the ability to administer itself.';

revoke all on function public.set_member_role(uuid, text) from public;
grant execute on function public.set_member_role(uuid, text) to authenticated;
