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

  -- Rebuild chapter aggregates from current member rows
  update public.chapters c
  set "totalMembers" = coalesce(stats.total, 0),
      "totalActive"  = coalesce(stats.active, 0),
      "totalLapsed"  = coalesce(stats.lapsed, 0)
  from (
    select
      "chapterName",
      count(*)                                         as total,
      count(*) filter (where "activeStatus" = 'Active') as active,
      count(*) filter (where "activeStatus" = 'Lapsed') as lapsed
    from public.members
    where "chapterName" is not null
    group by "chapterName"
  ) stats
  where c."name" = stats."chapterName";
end;
$$;

-- 02:00 America/New_York = 07:00 UTC (DST shifts by 1h — adjust if needed)
select cron.schedule(
  'update-member-status',
  '0 7 * * *',
  $$ select public.update_member_status(); $$
);
