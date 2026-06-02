-- RPCs that compress multi-statement attendee/event writes into single calls.
-- Each runs in one transaction so the attendee row + event counters never drift.
--
-- SECURITY INVOKER (default) so RLS on attendees/events still applies — only
-- callers who could write directly can call these.

-- ---------- set_attendance ----------
-- Toggle an attendee's attended status with the same rules the TS helper uses:
--   * Conference: hours = event.defaultHours when attended, 0 when not.
--   * Community outreach: hours snapshots defaultHours on first toggle-on if
--     no hours were set; otherwise reuses the prior hours.
-- Updates the event's attendedCount + contactHours deltas in the same txn.

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

-- ---------- set_attendee_hours ----------
-- Edit hours on an already-attended attendee (community outreach only). The
-- TS helper called this `setAttendeeHours`. Updates contactHours by the delta.

create or replace function public.set_attendee_hours(
  p_event_id    text,
  p_attendee_id text,
  p_hours       numeric,
  p_user        text
) returns void language plpgsql as $$
declare
  v_old_hours numeric(6,2);
  v_delta     numeric(6,2);
begin
  select "hours" into v_old_hours
  from public.attendees
  where id = p_attendee_id and "eventId" = p_event_id;

  if v_old_hours is null then
    raise exception 'attendee % on event % not found', p_attendee_id, p_event_id;
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

-- ---------- add_manual_attendee ----------
-- Insert an app-source attendee + bump event counters. Rejects if the member
-- is already on the event (matching the TS helper's behavior).

create or replace function public.add_manual_attendee(
  p_event_id  text,
  p_member_id text,
  p_name      text,
  p_hours     numeric,
  p_user      text
) returns text language plpgsql as $$
declare
  v_attendee_id text := 'app-' || p_member_id;
begin
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

-- ---------- remove_manual_attendee ----------
-- Delete an app-source attendee + adjust event counters. WA-source rows must
-- not be removed via this RPC.

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

-- ---------- sync_event_registrations ----------
-- Atomically reconcile an event's attendees against a fresh WA registration
-- payload. Replaces 6 round-trips per event in the sync-events Edge Function
-- with a single RPC call.
--
-- `p_registrations` is a JSONB array of objects with the WA registration
-- shape (registrationId, contactId, name, registrationTypeId, registrationType,
-- organization, isPaid, registrationFee, paidSum, OnWaitlist, Status). The
-- function:
--   1. Acquires the per-event syncLock.
--   2. Upserts each registration into attendees, preserving `attended` and
--      `hours` on existing rows (those are admin-managed).
--   3. Deletes any source='wildapricot' attendees not in the new set
--      (app-source rows are never touched).
--   4. Recomputes event counters from the new registration set.
--   5. Releases the syncLock.

create or replace function public.sync_event_registrations(
  p_event_id      text,
  p_registrations jsonb
) returns void language plpgsql as $$
declare
  v_count int;
  v_incomplete int;
  v_revenue numeric(10,2);
begin
  -- Acquire sync lock so the webhook handler defers concurrent writes.
  update public.events set "syncLock" = now() where id = p_event_id;

  -- Upsert new/changed registrations. attended/hours preserved on UPDATE
  -- because we explicitly omit them from the SET clause.
  insert into public.attendees (
    id, "registrationId", "eventId", "contactId", "memberId", "name",
    "attended", "hours", "source",
    "registrationTypeId", "registrationType", "organization",
    "isPaid", "registrationFee", "paidSum", "OnWaitlist", "Status"
  )
  select
    r->>'registrationId',
    r->>'registrationId',
    p_event_id,
    r->>'contactId',
    r->>'contactId',
    r->>'name',
    false,                                 -- attended (only on insert)
    0,                                     -- hours    (only on insert)
    'wildapricot',
    r->>'registrationTypeId',
    r->>'registrationType',
    r->>'organization',
    (r->>'isPaid')::boolean,
    coalesce((r->>'registrationFee')::numeric, 0),
    coalesce((r->>'paidSum')::numeric, 0),
    (r->>'OnWaitlist')::boolean,
    r->>'Status'
  from jsonb_array_elements(p_registrations) r
  on conflict (id) do update set
    "registrationId"     = excluded."registrationId",
    "eventId"            = excluded."eventId",
    "contactId"          = excluded."contactId",
    "memberId"           = excluded."memberId",
    "name"               = excluded."name",
    "source"             = 'wildapricot',
    "registrationTypeId" = excluded."registrationTypeId",
    "registrationType"   = excluded."registrationType",
    "organization"       = excluded."organization",
    "isPaid"             = excluded."isPaid",
    "registrationFee"    = excluded."registrationFee",
    "paidSum"            = excluded."paidSum",
    "OnWaitlist"         = excluded."OnWaitlist",
    "Status"             = excluded."Status";
  -- Note: attended + hours intentionally untouched on update.

  -- Delete WA-source attendees whose registrationId isn't in the new payload.
  delete from public.attendees
  where "eventId" = p_event_id
    and "source"  = 'wildapricot'
    and "registrationId" not in (
      select r->>'registrationId' from jsonb_array_elements(p_registrations) r
    );

  -- Recompute event counters from the payload.
  select
    count(*),
    count(*) filter (where (r->>'isPaid')::boolean is not true),
    coalesce(sum(coalesce((r->>'paidSum')::numeric, 0)), 0)
    into v_count, v_incomplete, v_revenue
  from jsonb_array_elements(p_registrations) r;

  update public.events
  set "registrations"           = v_count,
      "attendees"               = v_count,
      "incompleteRegistrations" = v_incomplete,
      "totalRevenue"            = v_revenue,
      "syncLock"                = null
  where id = p_event_id;
end;
$$;

-- ---------- propagate_conference_default_hours ----------
-- Apply a new defaultHours value to every attended attendee on the event and
-- recompute the event's contactHours total. No-op for community outreach.

create or replace function public.propagate_conference_default_hours(
  p_event_id     text,
  p_new_default  numeric,
  p_user         text
) returns void language plpgsql as $$
declare
  v_attended_count int;
begin
  update public.attendees
  set "hours" = p_new_default
  where "eventId" = p_event_id and "attended" = true;

  select count(*) into v_attended_count
  from public.attendees
  where "eventId" = p_event_id and "attended" = true;

  update public.events
  set "contactHours"    = v_attended_count * p_new_default,
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;
