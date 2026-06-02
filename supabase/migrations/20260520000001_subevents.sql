-- National conferences gain sub-events: a per-event ordered list drawn from a
-- shared catalog. Attendees can be marked attended per sub-event; hours roll
-- up as cardinality(attendedSubeventIds) * event.defaultHours.

-- ---------- Catalog ----------
create table public.subevents (
  id          uuid primary key default gen_random_uuid(),
  "name"      text not null,
  "archived"  boolean not null default false,
  "createdBy" uuid,
  "createdAt" timestamptz not null default now()
);

-- Case-insensitive uniqueness so "Opening Keynote" and "opening keynote" collapse.
create unique index subevents_name_lower_unique on public.subevents (lower("name"));

-- ---------- Columns ----------
alter table public.events
  add column if not exists "subeventIds" uuid[] not null default '{}';

alter table public.attendees
  add column if not exists "attendedSubeventIds" uuid[] not null default '{}';

-- ---------- RLS ----------
alter table public.subevents enable row level security;
create policy subev_read  on public.subevents for select to authenticated using (true);
create policy subev_write on public.subevents for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Derived hours/attended trigger ----------
-- For national-conference rows, keep attendees.hours and attendees.attended
-- aligned with attendedSubeventIds. Other events are untouched so the existing
-- conference / community-outreach flows keep working unchanged.

create or replace function public.tg_attendees_derive_subevent_hours()
returns trigger language plpgsql as $$
declare
  v_chapter_id    text;
  v_event_type    text;
  v_default_hours numeric(6,2);
  v_count         int;
begin
  if tg_op = 'UPDATE'
     and new."attendedSubeventIds" is not distinct from old."attendedSubeventIds" then
    return new;
  end if;

  select "chapterId", "eventType", coalesce("defaultHours", 0)
    into v_chapter_id, v_event_type, v_default_hours
  from public.events
  where id = new."eventId";

  if v_chapter_id = 'national' and v_event_type = 'conference' then
    v_count := coalesce(cardinality(new."attendedSubeventIds"), 0);
    new."hours"    := v_count * v_default_hours;
    new."attended" := v_count > 0;
  end if;
  return new;
end;
$$;

drop trigger if exists attendees_derive_subevent_hours on public.attendees;
create trigger attendees_derive_subevent_hours
  before insert or update on public.attendees
  for each row execute function public.tg_attendees_derive_subevent_hours();

-- ---------- RPC: set_subevent_attendance ----------
-- Toggle one (attendee, subevent) cell. Updates the attendee array and rolls
-- event.contactHours + attendedCount in the same transaction.

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

-- ---------- RPC: add_subevent_to_event ----------
-- Find-or-create the catalog row by case-insensitive name match, then append
-- to events.subeventIds (idempotent). If the name matches an archived catalog
-- row, unarchive it so the picker can reuse old names.

create or replace function public.add_subevent_to_event(
  p_event_id      text,
  p_subevent_name text,
  p_user          text
) returns uuid language plpgsql as $$
declare
  v_id      uuid;
  v_name    text := trim(p_subevent_name);
begin
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

-- ---------- RPC: remove_subevent_from_event ----------
-- Removes the sub-event from the event AND from every attendee's array, then
-- recomputes event totals. Attendees that lose their last sub-event flip
-- attended -> false.

create or replace function public.remove_subevent_from_event(
  p_event_id    text,
  p_subevent_id uuid,
  p_user        text
) returns void language plpgsql as $$
declare
  v_default numeric(6,2);
begin
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

-- ---------- RPC: reorder_event_subevents ----------
-- Replace the ordered list with a caller-supplied order (must be a permutation
-- of the current set; extras are appended, missing entries are dropped).

create or replace function public.reorder_event_subevents(
  p_event_id    text,
  p_subevent_ids uuid[],
  p_user        text
) returns void language plpgsql as $$
begin
  update public.events
  set "subeventIds" = coalesce(p_subevent_ids, '{}'::uuid[]),
      "lastUpdatedUser" = p_user
  where id = p_event_id;
end;
$$;

-- ---------- RPC: bulk_set_subevent_attendance ----------
-- Apply a parsed CSV of (attendeeId, subeventId, attended) triples in a single
-- transaction. Recomputes event totals once at the end. Caller is responsible
-- for resolving name/ambiguity conflicts before invoking this.

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

-- ---------- propagate_conference_default_hours: subevent-aware ----------
-- National conferences scale per-attendee hours by cardinality(arr); regular
-- conferences keep the previous behavior (flat default for every attended row).

create or replace function public.propagate_conference_default_hours(
  p_event_id    text,
  p_new_default numeric,
  p_user        text
) returns void language plpgsql as $$
declare
  v_chapter_id text;
begin
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

-- ---------- Indexes ----------
create index events_subevents_gin     on public.events     using gin ("subeventIds");
create index attendees_subevents_gin  on public.attendees  using gin ("attendedSubeventIds");
