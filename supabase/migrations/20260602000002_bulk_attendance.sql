-- ---------- RPC: bulk_set_attendance ----------
-- Apply a parsed CSV of regular (non-sub-event) attendance in one transaction.
-- Each row is { memberId, name, attended, hours? }. The caller (the bulk-upload
-- dialog) has already resolved every row to a memberId.
--
-- Matching is by memberId within the event, so a member who is already a WA
-- registrant is updated IN PLACE (never duplicated); a member not yet on the
-- event gets a fresh app-source row (id = 'app-' || memberId), mirroring
-- add_manual_attendee. Hours follow the same rule as set_attendance:
--   * not attended            -> 0
--   * conference              -> event.defaultHours
--   * community outreach      -> uploaded hours, else keep existing, else default
--
-- attendedCount / contactHours are recomputed from scratch at the end (safe
-- against the mixed insert+update batch); the running `attendees` total is bumped
-- by the number of newly-inserted rows, consistent with add_manual_attendee.
--
-- SECURITY INVOKER (default) so attendees/events RLS still gates the caller.

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

    -- Existing attendee for this member on this event (WA or app), if any.
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
      v_app_id := 'app-' || v_member;
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
