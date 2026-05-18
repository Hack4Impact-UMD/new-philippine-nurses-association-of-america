-- Round of fixes off the May 2026 Supabase integration review.
-- Each block is independent and can be reverted in isolation if needed.

-- ---------- (#3) Scope event/fundraising/subchapter writes by chapter ----------
-- The previous policies let any admin write to any chapter. Region admins
-- now need their region to match the row's chapter region; chapter admins
-- need the row's chapterId to match their app_metadata.chapter_id.
-- National admins keep unrestricted access.

create or replace function public.auth_chapter_id() returns text
language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'chapter_id';
$$;

create or replace function public.auth_region() returns text
language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'region';
$$;

create or replace function public.can_write_chapter(p_chapter_id text) returns boolean
language sql stable as $$
  select
    public.is_national_admin()
    or (
      public.auth_role() = 'region_admin'
      and exists (
        select 1 from public.chapters c
        where c.id = p_chapter_id
          and c.region is not distinct from public.auth_region()
      )
    )
    or (
      public.auth_role() = 'chapter_admin'
      and p_chapter_id is not null
      and p_chapter_id = public.auth_chapter_id()
    );
$$;

drop policy if exists events_create on public.events;
drop policy if exists events_update on public.events;
create policy events_create on public.events for insert to authenticated
  with check (public.can_write_chapter("chapterId"));
create policy events_update on public.events for update to authenticated
  using (public.can_write_chapter("chapterId"))
  with check (public.can_write_chapter("chapterId"));

drop policy if exists fund_create on public.fundraising;
drop policy if exists fund_update on public.fundraising;
create policy fund_create on public.fundraising for insert to authenticated
  with check (public.can_write_chapter("chapterId"));
create policy fund_update on public.fundraising for update to authenticated
  using (public.can_write_chapter("chapterId"))
  with check (public.can_write_chapter("chapterId"));

drop policy if exists subch_create on public.subchapters;
drop policy if exists subch_update on public.subchapters;
create policy subch_create on public.subchapters for insert to authenticated
  with check (public.can_write_chapter("chapterId"));
create policy subch_update on public.subchapters for update to authenticated
  using (public.can_write_chapter("chapterId"))
  with check (public.can_write_chapter("chapterId"));

-- ---------- (#4) Users table RLS gaps ----------
-- Add a read policy for chapter scope so chapter/region admins see their
-- members. Add an update policy so users can edit their own displayName
-- (but not their role/chapter/region — those still go through the admin API).

drop policy if exists users_read on public.users;
create policy users_read on public.users for select to authenticated
  using (
    auth.uid() = id
    or public.is_national_admin()
    or (
      public.auth_role() = 'region_admin'
      and "region" is not distinct from public.auth_region()
    )
    or (
      public.auth_role() = 'chapter_admin'
      and "chapterId" is not distinct from public.auth_chapter_id()
    )
  );

-- Self-update guard: only allow updating displayName from the client. Role,
-- chapter, region, needsOnboarding stay server-only (admin API or RPC).
create or replace function public.tg_users_self_update_guard()
returns trigger language plpgsql as $$
begin
  -- Service-role calls (OAuth callback, admin API routes, Edge Functions)
  -- bypass this guard. auth.uid() is null in those contexts.
  if auth.uid() is null then
    return new;
  end if;

  if new."role"            is distinct from old."role"
  or new."chapterId"       is distinct from old."chapterId"
  or new."region"          is distinct from old."region"
  or new."needsOnboarding" is distinct from old."needsOnboarding"
  or new."waContactId"     is distinct from old."waContactId"
  or new.id                is distinct from old.id
  or new."email"           is distinct from old."email" then
    raise exception 'users.% can only be changed via the admin API',
      case
        when new."role"           is distinct from old."role"           then 'role'
        when new."chapterId"      is distinct from old."chapterId"      then 'chapterId'
        when new."region"         is distinct from old."region"         then 'region'
        when new."needsOnboarding" is distinct from old."needsOnboarding" then 'needsOnboarding'
        when new."waContactId"    is distinct from old."waContactId"    then 'waContactId'
        when new.id               is distinct from old.id               then 'id'
        else 'email'
      end;
  end if;
  return new;
end;
$$;

drop trigger if exists users_self_update_guard on public.users;
create trigger users_self_update_guard
  before update on public.users
  for each row execute function public.tg_users_self_update_guard();

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------- (#6) sync_event_registrations: null-safe orphan delete ----------
-- The previous `not in (subquery)` was unsafe if any subquery row was null.
-- We also now short-circuit if the event syncLock is held by another
-- run that started recently (#19).

create or replace function public.sync_event_registrations(
  p_event_id      text,
  p_registrations jsonb
) returns void language plpgsql as $$
declare
  v_count int;
  v_incomplete int;
  v_revenue numeric(10,2);
  v_existing_lock timestamptz;
begin
  -- (#19) Refuse to start if another run grabbed the lock less than 10 minutes ago.
  select "syncLock" into v_existing_lock from public.events where id = p_event_id for update;
  if v_existing_lock is not null and v_existing_lock > now() - interval '10 minutes' then
    raise exception 'event % is locked by an in-flight sync (started %)',
      p_event_id, v_existing_lock;
  end if;

  update public.events set "syncLock" = now() where id = p_event_id;

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
    false,
    0,
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
  where r->>'registrationId' is not null
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

  -- Null-safe orphan delete: only consider non-null registrationIds from the payload.
  delete from public.attendees a
  where a."eventId" = p_event_id
    and a."source"  = 'wildapricot'
    and not exists (
      select 1 from jsonb_array_elements(p_registrations) r
      where r->>'registrationId' is not null
        and r->>'registrationId' = a."registrationId"
    );

  select
    count(*),
    count(*) filter (where (r->>'isPaid')::boolean is not true),
    coalesce(sum(coalesce((r->>'paidSum')::numeric, 0)), 0)
    into v_count, v_incomplete, v_revenue
  from jsonb_array_elements(p_registrations) r
  where r->>'registrationId' is not null;

  update public.events
  set "registrations"           = v_count,
      "attendees"               = v_count,
      "incompleteRegistrations" = v_incomplete,
      "totalRevenue"            = v_revenue,
      "syncLock"                = null
  where id = p_event_id;
end;
$$;

-- ---------- (#8) recalculate_chapter_aggregates: one round-trip per webhook ----------
-- Replaces the per-chapter `for ... await select` loop in the webhook handler.
-- Accepts an array of chapter ids. Null/empty entries are ignored.

create or replace function public.recalculate_chapter_aggregates(
  p_chapter_ids text[]
) returns void language plpgsql as $$
begin
  with stats as (
    select
      m."chapterId" as chapter_id,
      count(*)                                                                  as total,
      count(*) filter (where public.is_renewal_active(m."renewalDueDate"))      as active,
      count(*) filter (where not public.is_renewal_active(m."renewalDueDate"))  as lapsed
    from public.members m
    where m."chapterId" = any(p_chapter_ids)
      and m."chapterId" is not null
    group by m."chapterId"
  )
  update public.chapters c
  set "totalMembers" = coalesce(stats.total, 0),
      "totalActive"  = coalesce(stats.active, 0),
      "totalLapsed"  = coalesce(stats.lapsed, 0)
  from stats
  where c.id = stats.chapter_id;

  -- Zero out any target chapters that no longer have members.
  update public.chapters c
  set "totalMembers" = 0, "totalActive" = 0, "totalLapsed" = 0
  where c.id = any(p_chapter_ids)
    and not exists (
      select 1 from public.members m where m."chapterId" = c.id
    );
end;
$$;

-- ---------- (#16) update_member_status: safe renewal-date cast ----------
-- Replaces the previous version, which crashed if any row had a malformed
-- renewalDueDate. We now validate the string with a regex before casting.
-- Reused by recalculate_chapter_aggregates above via is_renewal_active().

create or replace function public.is_renewal_active(p text)
returns boolean language sql immutable as $$
  select
    p is not null
    and p ~ '^\d{4}-\d{2}-\d{2}'
    and (p::timestamptz) >= now();
$$;

create or replace function public.update_member_status()
returns void language plpgsql security definer as $$
begin
  update public.members
  set "activeStatus" = case
        when public.is_renewal_active("renewalDueDate") then 'Active'
        else 'Lapsed'
      end,
      "lastSynced" = now();

  update public.chapters c
  set "totalMembers" = coalesce(stats.total, 0),
      "totalActive"  = coalesce(stats.active, 0),
      "totalLapsed"  = coalesce(stats.lapsed, 0)
  from (
    select
      "chapterId" as chapter_id,
      count(*)                                          as total,
      count(*) filter (where "activeStatus" = 'Active') as active,
      count(*) filter (where "activeStatus" = 'Lapsed') as lapsed
    from public.members
    where "chapterId" is not null
    group by "chapterId"
  ) stats
  where c.id = stats.chapter_id;

  update public.chapters c
  set "totalMembers" = 0, "totalActive" = 0, "totalLapsed" = 0
  where not exists (
    select 1 from public.members m where m."chapterId" = c.id
  );
end;
$$;

-- ---------- (#13) Drop replica identity full on hot-write tables ----------
-- Realtime subscribers in this codebase refetch on change rather than reading
-- payload.old, so the WAL overhead of `replica identity full` buys nothing.

alter table public.events      replica identity default;
alter table public.fundraising replica identity default;
alter table public.attendees   replica identity default;

-- ---------- (#15) Foreign key on attendees.memberId ----------
-- `not valid` so existing orphan rows (if any) don't block the migration.
-- New inserts/updates are checked. Run `alter table ... validate constraint`
-- once members has been backfilled with contact ids.

alter table public.attendees
  add constraint attendees_member_fk
  foreign key ("memberId") references public.members(id) on delete set null
  not valid;

-- ---------- (#20) Drop redundant ascending events index ----------
-- Postgres uses the descending index for both directions.

drop index if exists public.events_archived_start_date;

-- ---------- (#14) Track WA contact id explicitly on members ----------
-- Going forward, members.id == WA contact id. Backfill via the next full
-- sync; the column lets us detect rows that still carry the old Member-ID
-- key so we can dedupe them.

alter table public.members
  add column if not exists "contactId" text;
create index if not exists members_contact_id on public.members ("contactId");
