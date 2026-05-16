-- pg_cron job: nightly member status refresh + chapter aggregate rebuild
-- Replaces functions/src/update-members.ts (daily 02:00 ET).
--
-- Renewal dates are stored as text (ISO format) — parse to timestamptz for comparison.

create extension if not exists pg_cron;

create or replace function public.update_member_status()
returns void language plpgsql security definer as $$
declare
  v_now timestamptz := now();
begin
  -- Flip status based on renewal due date
  update public.members
  set "activeStatus" = case
        when "renewalDueDate" is null or "renewalDueDate" = '' then 'Lapsed'
        when ("renewalDueDate")::timestamptz < v_now then 'Lapsed'
        else 'Active'
      end,
      "lastSynced" = v_now;

  -- Rebuild chapter aggregates from current member rows (joined by FK).
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

  -- Zero out chapters that no longer have any members.
  update public.chapters
  set "totalMembers" = 0, "totalActive" = 0, "totalLapsed" = 0
  where id not in (
    select distinct "chapterId" from public.members where "chapterId" is not null
  );
end;
$$;

-- 02:00 America/New_York = 07:00 UTC (DST shifts by 1h — adjust if needed)
select cron.schedule(
  'update-member-status',
  '0 7 * * *',
  $$ select public.update_member_status(); $$
);
