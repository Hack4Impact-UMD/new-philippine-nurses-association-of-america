-- Scoped visibility + region-admin read-only.
--
-- Until now every authenticated user could SELECT every row of members /
-- chapters / events / fundraising / subchapters / attendees / chapter_aliases,
-- and region admins could write to any chapter in their region. The client
-- requirements are now:
--
--   national_admin -> read + write everything
--   region_admin   -> read every chapter in their region, write NOTHING
--   chapter_admin  -> read + write their own chapter only
--   member         -> read their own chapter only
--
-- The 'national' chapter is the organization itself rather than "someone
-- else's chapter", so its row — and the national conferences that hang off it
-- — stay readable by every authenticated user. Without that carve-out the
-- national conference, its sub-events and its attendee roster would vanish for
-- everyone except national admins.

-- ---------- read scope helper ----------
-- SECURITY DEFINER so the chapters lookup in the region branch is not itself
-- filtered by the chapters_read policy below (that would recurse).

create or replace function public.can_read_chapter(p_chapter_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_national_admin()
    or p_chapter_id = 'national'
    or (
      public.auth_role() = 'region_admin'
      and p_chapter_id is not null
      and exists (
        select 1 from public.chapters c
        where c.id = p_chapter_id
          and c."region" is not distinct from public.auth_region()
      )
    )
    or (
      public.auth_role() in ('chapter_admin', 'member')
      and p_chapter_id is not null
      and p_chapter_id = public.auth_chapter_id()
    );
$$;

-- Roles allowed to change anything at all. Region admins are deliberately
-- absent: they review their region, they do not edit it.
create or replace function public.is_writer() returns boolean
language sql stable as $$
  select public.auth_role() in ('national_admin', 'chapter_admin');
$$;

-- ---------- region admins lose write access ----------
-- can_write_chapter() is the single gate behind events / fundraising /
-- subchapters / attendees RLS *and* every event-mutating RPC (via
-- assert_can_write_event), so dropping the region branch here revokes region
-- writes everywhere at once.

create or replace function public.can_write_chapter(p_chapter_id text) returns boolean
language sql stable as $$
  select
    public.is_national_admin()
    or (
      public.auth_role() = 'chapter_admin'
      and p_chapter_id is not null
      and p_chapter_id = public.auth_chapter_id()
    );
$$;

-- ---------- chapters ----------
-- Written inline rather than via can_read_chapter() so the policy never
-- queries the table it guards.

create index if not exists chapters_region on public.chapters ("region");

drop policy if exists chapters_read on public.chapters;
create policy chapters_read on public.chapters for select to authenticated
  using (
    public.is_national_admin()
    or id = 'national'
    or (
      public.auth_role() = 'region_admin'
      and "region" is not distinct from public.auth_region()
    )
    or (
      public.auth_role() in ('chapter_admin', 'member')
      and id = public.auth_chapter_id()
    )
  );

-- ---------- members ----------
-- Region scope keys off members."region" (not the chapter's) to match
-- dashboard_stats() and users_read, and to avoid a per-row chapters lookup
-- across a ~14k-row table.

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (
    public.is_national_admin()
    or (
      public.auth_role() = 'region_admin'
      and "region" is not distinct from public.auth_region()
    )
    or (
      public.auth_role() in ('chapter_admin', 'member')
      and "chapterId" is not null
      and "chapterId" = public.auth_chapter_id()
    )
  );

-- ---------- events ----------
-- A null chapterId means national / cross-chapter (see types/event.ts), so it
-- reads as 'national' rather than as an invisible orphan.

drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated
  using (public.can_read_chapter(coalesce("chapterId", 'national')));

-- ---------- fundraising ----------

drop policy if exists fund_read on public.fundraising;
create policy fund_read on public.fundraising for select to authenticated
  using (public.can_read_chapter("chapterId"));

-- ---------- subchapters ----------

drop policy if exists subch_read on public.subchapters;
create policy subch_read on public.subchapters for select to authenticated
  using (public.can_read_chapter("chapterId"));

-- ---------- attendees ----------
-- Scoped by the parent event, mirroring attendees_write.

drop policy if exists attendees_read on public.attendees;
create policy attendees_read on public.attendees for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = attendees."eventId"
        and public.can_read_chapter(coalesce(e."chapterId", 'national'))
    )
  );

-- ---------- chapter aliases ----------
-- Readable within scope; managed by national admins only.

drop policy if exists aliases_read on public.chapter_aliases;
create policy aliases_read on public.chapter_aliases for select to authenticated
  using (public.can_read_chapter("chapterId"));

drop policy if exists aliases_create on public.chapter_aliases;
create policy aliases_create on public.chapter_aliases for insert to authenticated
  with check (public.is_national_admin());

drop policy if exists aliases_delete on public.chapter_aliases;
create policy aliases_delete on public.chapter_aliases for delete to authenticated
  using (public.is_national_admin());

-- ---------- subevents catalog ----------
-- Shared catalog, so it stays readable. Writes follow is_writer() — in
-- practice national admins, since sub-events only attach to national
-- conferences and only national admins can write those events.

drop policy if exists subev_write on public.subevents;
create policy subev_write on public.subevents for all to authenticated
  using (public.is_writer()) with check (public.is_writer());

-- ---------- onboarding chapter directory ----------
-- /setup asks a brand-new user to pick their region and chapter, but at that
-- point they have no chapter_id and chapters_read shows them nothing. This
-- returns the picker's rows (id / name / region, aliased chapters excluded)
-- without opening up the aggregate member counts on the table itself.

create or replace function public.chapter_directory()
returns table (id text, "name" text, "region" text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c."name", c."region"
  from public.chapters c
  where not exists (
    select 1 from public.chapter_aliases a where a."aliasName" = c."name"
  )
  order by c."name";
$$;

revoke all on function public.chapter_directory() from public;
grant execute on function public.chapter_directory() to authenticated;
grant execute on function public.chapter_directory() to service_role;
