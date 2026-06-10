-- June 2026 review fixes.
--
-- (#2) attendees RLS was still plain is_admin() after 20260517000001 scoped
--      events_update by chapter. The attendance RPCs (SECURITY INVOKER) update
--      both tables, so a chapter admin toggling attendance on another
--      chapter's event updated the attendee row while the events counter
--      update silently matched zero rows — permanent counter drift. Fix both
--      sides: scope attendees writes by the parent event's chapter, AND make
--      every event-mutating RPC assert write permission up front so callers
--      get an error instead of a silent no-op.
--
-- (#5) revoke_user_sessions(): lets the admin user-management API kill a
--      user's refresh tokens when their role changes, so a demoted admin's
--      access dies with the current access token instead of refreshing
--      indefinitely.
--
-- (small) set_attendee_hours now rejects setting hours on a non-attended
--      attendee — previously it bumped contactHours while attendedCount
--      stayed 0.

-- ---------- (#2a) attendees_write scoped by parent event chapter ----------

drop policy if exists attendees_write on public.attendees;
create policy attendees_write on public.attendees for all to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = attendees."eventId"
        and public.can_write_chapter(e."chapterId")
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = attendees."eventId"
        and public.can_write_chapter(e."chapterId")
    )
  );

-- ---------- (#2b) assert helper for event-mutating RPCs ----------
-- Raises unless the caller may write the event's chapter. Service-role and
-- other non-JWT contexts (Edge Functions, scripts) have auth.uid() = null and
-- bypass the check — they already bypass RLS.

create or replace function public.assert_can_write_event(p_event_id text)
returns void language plpgsql as $$
declare
  v_chapter_id text;
  v_found boolean;
begin
  if auth.uid() is null then
    return;
  end if;
  select "chapterId", true into v_chapter_id, v_found
  from public.events where id = p_event_id;
  if v_found is null then
    raise exception 'event % not found', p_event_id;
  end if;
  if not public.can_write_chapter(v_chapter_id) then
    raise exception 'you do not have permission to modify this event';
  end if;
end;
$$;

-- ---------- (#2c) recreate event-mutating RPCs with the assert ----------
-- Bodies are unchanged from their latest definitions except for the assert
-- (and the set_attendee_hours attended-guard noted above).

create or replace function public.set_attendance(
  p_event_id    text,
  p_attendee_id text,
  p_attended    boolean,
  p_user        text
) returns void language plpgsql as $$
declare
  v_was_attended  boolean;
  v_old_hours     numeric(6,2);
  v_default_hours numeric(6,2);
  v_event_type    text;
  v_new_hours     numeric(6,2);
  v_attended_delta int;
  v_hours_delta    numeric(6,2);
begin
  perform public.assert_can_write_event(p_event_id);

  select a."attended", a."hours", e."defaultHours", e."eventType"
    into v_was_attended, v_old_hours, v_default_hours, v_event_type
  from public.attendees a
  join public.events    e on e.id = a."eventId"
  where a.id = p_attendee_id and a."eventId" = p_event_id;

  if v_was_attended is null then
    raise exception 'attendee % on event % not found', p_attendee_id, p_event_id;
  end if;

  if v_was_attended = p_attended then
    return; -- no-op
  end if;

  if not p_attended then
    v_new_hours := 0;
  elsif v_event_type = 'conference' then
    v_new_hours := coalesce(v_default_hours, 0);
  else
    -- Community outreach: reuse prior hours, falling back to defaultHours.
    v_new_hours := case
      when coalesce(v_old_hours, 0) > 0 then v_old_hours
      else coalesce(v_default_hours, 0)
    end;
  end if;

  v_attended_delta := (case when p_attended then 1 else 0 end)
                    - (case when v_was_attended then 1 else 0 end);
  v_hours_delta    := coalesce(v_new_hours, 0) - coalesce(v_old_hours, 0);

  update public.attendees
  set "attended" = p_attended,
      "hours"    = v_new_hours
  where id = p_attendee_id;

  update public.events
  set "attendedCount"   = "attendedCount" + v_attended_delta,
      "contactHours"    = "contactHours"  + v_hours_delta,
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.set_attendee_hours(
  p_event_id    text,
  p_attendee_id text,
  p_hours       numeric,
  p_user        text
) returns void language plpgsql as $$
declare
  v_old_hours numeric(6,2);
  v_attended  boolean;
  v_delta     numeric(6,2);
begin
  perform public.assert_can_write_event(p_event_id);

  select "hours", "attended" into v_old_hours, v_attended
  from public.attendees
  where id = p_attendee_id and "eventId" = p_event_id;

  if v_old_hours is null then
    raise exception 'attendee % on event % not found', p_attendee_id, p_event_id;
  end if;

  -- Hours only make sense on an attended row; otherwise contactHours would
  -- drift up while attendedCount stays put.
  if not v_attended then
    raise exception 'cannot set hours: attendee is not marked attended';
  end if;

  v_delta := coalesce(p_hours, 0) - coalesce(v_old_hours, 0);
  if v_delta = 0 then
    return;
  end if;

  update public.attendees
  set "hours" = p_hours
  where id = p_attendee_id;

  update public.events
  set "contactHours"    = "contactHours" + v_delta,
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.add_manual_attendee(
  p_event_id  text,
  p_member_id text,
  p_name      text,
  p_hours     numeric,
  p_user      text
) returns text language plpgsql as $$
declare
  v_attendee_id text := 'app-' || p_event_id || '-' || p_member_id;
begin
  perform public.assert_can_write_event(p_event_id);

  if exists (
    select 1 from public.attendees
    where "eventId" = p_event_id and "memberId" = p_member_id
  ) then
    raise exception '% is already on this event''s attendee list', p_name;
  end if;

  insert into public.attendees (
    id, "registrationId", "eventId", "contactId", "memberId", "name",
    "attended", "hours", "source",
    "registrationTypeId", "registrationType", "organization",
    "isPaid", "registrationFee", "paidSum", "OnWaitlist", "Status"
  ) values (
    v_attendee_id, v_attendee_id, p_event_id, p_member_id, p_member_id, p_name,
    true, p_hours, 'app',
    '', '', '', false, 0, 0, false, ''
  );

  update public.events
  set "attendees"       = "attendees" + 1,
      "attendedCount"   = "attendedCount" + 1,
      "contactHours"    = "contactHours" + coalesce(p_hours, 0),
      "lastUpdatedUser" = p_user
  where id = p_event_id;

  return v_attendee_id;
end;
$$;

create or replace function public.remove_manual_attendee(
  p_event_id    text,
  p_attendee_id text,
  p_user        text
) returns void language plpgsql as $$
declare
  v_source    text;
  v_attended  boolean;
  v_old_hours numeric(6,2);
begin
  perform public.assert_can_write_event(p_event_id);

  select "source", "attended", "hours"
    into v_source, v_attended, v_old_hours
  from public.attendees
  where id = p_attendee_id and "eventId" = p_event_id;

  if v_source is null then
    raise exception 'attendee % on event % not found', p_attendee_id, p_event_id;
  end if;
  if v_source <> 'app' then
    raise exception 'cannot remove WA-synced attendees';
  end if;

  delete from public.attendees where id = p_attendee_id;

  update public.events
  set "attendees"     = greatest(0, "attendees" - 1),
      "attendedCount" = greatest(0, "attendedCount" - (case when v_attended then 1 else 0 end)),
      "contactHours"  = "contactHours" - (case when v_attended then coalesce(v_old_hours, 0) else 0 end),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.bulk_set_attendance(
  p_event_id text,
  p_rows     jsonb,
  p_user     text
) returns void language plpgsql as $$
declare
  v_default        numeric(6,2);
  v_type           text;
  r                jsonb;
  v_member         text;
  v_name           text;
  v_att            boolean;
  v_hours_in       numeric(6,2);
  v_existing_id    text;
  v_existing_hours numeric(6,2);
  v_new_hours      numeric(6,2);
  v_app_id         text;
  v_inserted       int := 0;
begin
  perform public.assert_can_write_event(p_event_id);

  select coalesce("defaultHours", 0), "eventType"
    into v_default, v_type
  from public.events where id = p_event_id;

  if v_type is null then
    raise exception 'event % not found', p_event_id;
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_member := r->>'memberId';
    v_name   := coalesce(r->>'name', '');
    v_att    := coalesce((r->>'attended')::boolean, false);
    v_hours_in := nullif(r->>'hours', '')::numeric;
    if v_member is null or v_member = '' then continue; end if;

    select id, "hours" into v_existing_id, v_existing_hours
    from public.attendees
    where "eventId" = p_event_id and "memberId" = v_member
    limit 1;

    if not v_att then
      v_new_hours := 0;
    elsif v_type = 'conference' then
      v_new_hours := v_default;
    else
      v_new_hours := coalesce(
        v_hours_in,
        case when coalesce(v_existing_hours, 0) > 0 then v_existing_hours else v_default end
      );
    end if;

    if v_existing_id is not null then
      update public.attendees
      set "attended" = v_att,
          "hours"    = v_new_hours
      where id = v_existing_id;
    else
      v_app_id := 'app-' || p_event_id || '-' || v_member;
      insert into public.attendees (
        id, "registrationId", "eventId", "contactId", "memberId", "name",
        "attended", "hours", "source",
        "registrationTypeId", "registrationType", "organization",
        "isPaid", "registrationFee", "paidSum", "OnWaitlist", "Status"
      ) values (
        v_app_id, v_app_id, p_event_id, v_member, v_member, v_name,
        v_att, v_new_hours, 'app',
        '', '', '', false, 0, 0, false, ''
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.events
  set "attendees"       = "attendees" + v_inserted,
      "attendedCount"   = (select count(*)
                             from public.attendees
                            where "eventId" = p_event_id and "attended" = true),
      "contactHours"    = (select coalesce(sum("hours"), 0)
                             from public.attendees
                            where "eventId" = p_event_id),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.propagate_conference_default_hours(
  p_event_id    text,
  p_new_default numeric,
  p_user        text
) returns void language plpgsql as $$
declare
  v_chapter_id text;
begin
  perform public.assert_can_write_event(p_event_id);

  select "chapterId" into v_chapter_id from public.events where id = p_event_id;

  if v_chapter_id = 'national' then
    update public.attendees
    set "hours" = coalesce(cardinality(coalesce("attendedSubeventIds", '{}'::uuid[])), 0)::numeric * p_new_default
    where "eventId" = p_event_id;
  else
    update public.attendees
    set "hours" = p_new_default
    where "eventId" = p_event_id and "attended" = true;
  end if;

  update public.events
  set "contactHours"    = (select coalesce(sum("hours"), 0)
                             from public.attendees
                            where "eventId" = p_event_id),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.set_subevent_attendance(
  p_event_id    text,
  p_attendee_id text,
  p_subevent_id uuid,
  p_attended    boolean,
  p_user        text
) returns void language plpgsql as $$
declare
  v_old_arr      uuid[];
  v_new_arr      uuid[];
  v_default      numeric(6,2);
  v_old_hours    numeric(6,2);
  v_new_hours    numeric(6,2);
  v_was_attended boolean;
  v_is_attended  boolean;
begin
  perform public.assert_can_write_event(p_event_id);

  select coalesce("attendedSubeventIds", '{}'::uuid[]),
         coalesce("hours", 0)
    into v_old_arr, v_old_hours
  from public.attendees
  where id = p_attendee_id and "eventId" = p_event_id
  for update;

  if v_old_arr is null then
    raise exception 'attendee % on event % not found', p_attendee_id, p_event_id;
  end if;

  if p_attended then
    if p_subevent_id = any(v_old_arr) then return; end if;
    v_new_arr := v_old_arr || p_subevent_id;
  else
    if not (p_subevent_id = any(v_old_arr)) then return; end if;
    v_new_arr := array_remove(v_old_arr, p_subevent_id);
  end if;

  select coalesce("defaultHours", 0) into v_default
    from public.events where id = p_event_id;

  v_new_hours    := coalesce(cardinality(v_new_arr), 0)::numeric * v_default;
  v_was_attended := coalesce(cardinality(v_old_arr), 0) > 0;
  v_is_attended  := coalesce(cardinality(v_new_arr), 0) > 0;

  update public.attendees
  set "attendedSubeventIds" = v_new_arr,
      "hours"                = v_new_hours,
      "attended"             = v_is_attended
  where id = p_attendee_id;

  update public.events
  set "contactHours"    = "contactHours" + (v_new_hours - v_old_hours),
      "attendedCount"   = "attendedCount"
                          + (case when v_is_attended  then 1 else 0 end)
                          - (case when v_was_attended then 1 else 0 end),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.add_subevent_to_event(
  p_event_id      text,
  p_subevent_name text,
  p_user          text
) returns uuid language plpgsql as $$
declare
  v_id      uuid;
  v_name    text := trim(p_subevent_name);
begin
  perform public.assert_can_write_event(p_event_id);

  if v_name is null or v_name = '' then
    raise exception 'sub-event name is required';
  end if;

  select id into v_id from public.subevents
   where lower("name") = lower(v_name)
   limit 1;

  if v_id is null then
    insert into public.subevents ("name") values (v_name)
    returning id into v_id;
  else
    update public.subevents
      set "archived" = false
      where id = v_id and "archived" = true;
  end if;

  update public.events
  set "subeventIds" = case
        when v_id = any(coalesce("subeventIds", '{}'::uuid[])) then "subeventIds"
        else coalesce("subeventIds", '{}'::uuid[]) || v_id
      end,
      "lastUpdatedUser" = p_user
  where id = p_event_id;

  return v_id;
end;
$$;

create or replace function public.remove_subevent_from_event(
  p_event_id    text,
  p_subevent_id uuid,
  p_user        text
) returns void language plpgsql as $$
declare
  v_default numeric(6,2);
begin
  perform public.assert_can_write_event(p_event_id);

  select coalesce("defaultHours", 0) into v_default
    from public.events where id = p_event_id;

  update public.attendees a
  set "attendedSubeventIds" = array_remove(coalesce(a."attendedSubeventIds", '{}'::uuid[]), p_subevent_id),
      "hours" = coalesce(
        cardinality(array_remove(coalesce(a."attendedSubeventIds", '{}'::uuid[]), p_subevent_id)),
        0
      )::numeric * v_default,
      "attended" = coalesce(
        cardinality(array_remove(coalesce(a."attendedSubeventIds", '{}'::uuid[]), p_subevent_id)),
        0
      ) > 0
  where a."eventId" = p_event_id
    and p_subevent_id = any(coalesce(a."attendedSubeventIds", '{}'::uuid[]));

  update public.events
  set "subeventIds" = array_remove(coalesce("subeventIds", '{}'::uuid[]), p_subevent_id),
      "contactHours"  = (select coalesce(sum("hours"), 0)
                           from public.attendees
                          where "eventId" = p_event_id),
      "attendedCount" = (select count(*)
                           from public.attendees
                          where "eventId" = p_event_id and "attended" = true),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.reorder_event_subevents(
  p_event_id    text,
  p_subevent_ids uuid[],
  p_user        text
) returns void language plpgsql as $$
begin
  perform public.assert_can_write_event(p_event_id);

  update public.events
  set "subeventIds" = coalesce(p_subevent_ids, '{}'::uuid[]),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

create or replace function public.bulk_set_subevent_attendance(
  p_event_id text,
  p_rows     jsonb,
  p_user     text
) returns void language plpgsql as $$
declare
  v_default numeric(6,2);
  r         jsonb;
  v_arr     uuid[];
  v_aid     text;
  v_seid    uuid;
  v_att     boolean;
begin
  perform public.assert_can_write_event(p_event_id);

  select coalesce("defaultHours", 0) into v_default
    from public.events where id = p_event_id;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_aid := r->>'attendeeId';
    v_seid := (r->>'subeventId')::uuid;
    v_att := (r->>'attended')::boolean;

    select coalesce("attendedSubeventIds", '{}'::uuid[]) into v_arr
      from public.attendees where id = v_aid and "eventId" = p_event_id;
    if v_arr is null then continue; end if;

    if v_att and not (v_seid = any(v_arr)) then
      v_arr := v_arr || v_seid;
    elsif not v_att and (v_seid = any(v_arr)) then
      v_arr := array_remove(v_arr, v_seid);
    else
      continue;
    end if;

    update public.attendees
    set "attendedSubeventIds" = v_arr,
        "hours"                = coalesce(cardinality(v_arr), 0)::numeric * v_default,
        "attended"             = coalesce(cardinality(v_arr), 0) > 0
    where id = v_aid;
  end loop;

  update public.events
  set "contactHours"    = (select coalesce(sum("hours"), 0)
                             from public.attendees
                            where "eventId" = p_event_id),
      "attendedCount"   = (select count(*)
                             from public.attendees
                            where "eventId" = p_event_id and "attended" = true),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

-- ---------- (#5) revoke_user_sessions ----------
-- Deletes a user's auth sessions + refresh tokens so a role change takes
-- effect once the current access token expires (instead of being refreshable
-- forever). Called via service-role RPC from PATCH /api/users/[userId].
-- SECURITY DEFINER because the auth schema isn't reachable through PostgREST.

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- Service-role only.
revoke execute on function public.revoke_user_sessions(uuid) from public;
revoke execute on function public.revoke_user_sessions(uuid) from anon;
revoke execute on function public.revoke_user_sessions(uuid) from authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
