-- Indexes — all chapter-scoped queries hit the FK column "chapterId" now,
-- not the legacy text "chapterName" / "chapter" columns.

-- events
create index events_archived_start_date       on public.events ("archived", "startDate");
create index events_archived_start_date_desc  on public.events ("archived", "startDate" desc);
create index events_chapter_archived_start    on public.events ("chapterId", "archived", "startDate" desc);
create index events_subch_archived_start      on public.events ("subchapterId", "archived", "startDate" desc);

-- fundraising
create index fundraising_archived_date_desc   on public.fundraising ("archived", "date" desc);
create index fundraising_chapter_archived_dt  on public.fundraising ("chapterId", "archived", "date" desc);
create index fundraising_subch_archived_date  on public.fundraising ("subchapterId", "archived", "date" desc);

-- members
create index members_chapter_name             on public.members ("chapterId", "name");
create index members_active_renewal           on public.members ("activeStatus", "renewalDueDate");
create index members_active_name              on public.members ("activeStatus", "name");
create index members_active_chapter_name      on public.members ("activeStatus", "chapterId", "name");

-- subchapters
create index subch_chapter_archived_name      on public.subchapters ("chapterId", "archived", "name");

-- attendees (replaces collection-group index)
create index attendees_member_attended        on public.attendees ("memberId", "attended");
create index attendees_event                  on public.attendees ("eventId");

-- pending registrations queue
create index pending_reg_event                on public.pending_registrations ("eventId");

-- chapter scan by name (used when resolving WA chapter strings → id)
create unique index chapters_name_unique      on public.chapters (lower("name"));

-- users / chapter scope
create index users_chapter                    on public.users ("chapterId");
