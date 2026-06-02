-- PR #14 review fixes.
--
-- (#7) Pin search_path on the SECURITY DEFINER trigger function
--      handle_new_auth_user (Supabase lint 0011_function_search_path_mutable).
--      All object references are already schema-qualified, so an empty
--      search_path is safe.
--
-- (#8) App-attendee primary keys collide across events. The id was
--      'app-' || memberId, which is identical for the same member on different
--      events, so adding a member to a second event hit a attendees_pkey unique
--      violation (surfacing as a 500 instead of the intended dedupe path).
--      Scope the id to the event: 'app-' || eventId || '-' || memberId.
--      Existing rows keep their old ids (matched by (eventId, memberId), so they
--      still update in place); only newly-inserted app rows use the new scheme.

-- ---------- (#7) handle_new_auth_user: fixed search_path ----------
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, "email", "displayName", "role", "needsOnboarding")
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'displayName', new.email),
    'member',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- (#8) add_manual_attendee: event-scoped app id ----------
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

-- ---------- (#8) bulk_set_attendance: event-scoped app id ----------
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
