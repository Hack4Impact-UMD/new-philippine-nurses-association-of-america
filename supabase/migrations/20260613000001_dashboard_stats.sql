-- Dashboard summary RPC.
--
-- The dashboard previously computed its stat cards client-side from the five
-- most-recent fundraising rows and a five-row events page, so "Total Fundraised
-- (all campaigns)" and "Upcoming Events" were both silently capped/wrong. This
-- function returns true aggregates in a single round trip and scopes them to
-- the caller's role:
--   national_admin              -> whole org
--   region_admin (with region)  -> their region
--   chapter_admin / member      -> their chapter
-- A user with neither region nor chapter falls back to the org-wide view
-- (read-only via RLS regardless).
--
-- Events and fundraising only carry chapterId, so region scope joins chapters
-- to resolve the region. Members carry their own region column.

create or replace function public.dashboard_stats()
returns jsonb language plpgsql stable as $$
declare
  v_role    text := public.auth_role();
  v_chapter text := public.auth_chapter_id();
  v_region  text := public.auth_region();
  v_scope   text;
  v_today   date := (now() at time zone 'America/New_York')::date;
  v_today_s text;

  v_total   bigint := 0;
  v_active  bigint := 0;
  v_lapsed  bigint := 0;
  v_renew   bigint := 0;
  v_chapters bigint := 0;
  v_events  bigint := 0;
  v_fund    numeric := 0;
begin
  v_today_s := to_char(v_today, 'YYYY-MM-DD');

  if v_role = 'national_admin' then
    v_scope := 'national';
  elsif v_role = 'region_admin' and v_region is not null and v_region <> '' then
    v_scope := 'region';
  elsif v_chapter is not null and v_chapter <> '' then
    v_scope := 'chapter';
  else
    v_scope := 'national';
  end if;

  -- Member counts + renewals due in the next 30 days (active members only).
  select
    count(*),
    count(*) filter (where "activeStatus" = 'Active'),
    count(*) filter (where "activeStatus" = 'Lapsed'),
    count(*) filter (
      where "activeStatus" = 'Active'
        and "renewalDueDate" ~ '^\d{4}-\d{2}-\d{2}'
        and to_date("renewalDueDate", 'YYYY-MM-DD')
              between v_today and (v_today + 30)
    )
  into v_total, v_active, v_lapsed, v_renew
  from public.members m
  where v_scope = 'national'
     or (v_scope = 'region'  and m."region"    is not distinct from v_region)
     or (v_scope = 'chapter' and m."chapterId" is not distinct from v_chapter);

  -- Chapter count in scope.
  select count(*)
  into v_chapters
  from public.chapters c
  where v_scope = 'national'
     or (v_scope = 'region'  and c."region" is not distinct from v_region)
     or (v_scope = 'chapter' and c.id        is not distinct from v_chapter);

  -- Upcoming, non-archived events. startDate is YYYY-MM-DD text — lexical >=
  -- is chronological.
  select count(*)
  into v_events
  from public.events e
  left join public.chapters c on c.id = e."chapterId"
  where e."archived" = false
    and e."startDate" >= v_today_s
    and (
      v_scope = 'national'
      or (v_scope = 'region'  and c."region"    is not distinct from v_region)
      or (v_scope = 'chapter' and e."chapterId" is not distinct from v_chapter)
    );

  -- True all-campaigns fundraising total in scope.
  select coalesce(sum(f."amount"), 0)
  into v_fund
  from public.fundraising f
  left join public.chapters c on c.id = f."chapterId"
  where f."archived" = false
    and (
      v_scope = 'national'
      or (v_scope = 'region'  and c."region"    is not distinct from v_region)
      or (v_scope = 'chapter' and f."chapterId" is not distinct from v_chapter)
    );

  return jsonb_build_object(
    'scope',          v_scope,
    'totalMembers',   v_total,
    'activeMembers',  v_active,
    'lapsedMembers',  v_lapsed,
    'renewalsDue30',  v_renew,
    'totalChapters',  v_chapters,
    'upcomingEvents', v_events,
    'totalFundraised', v_fund,
    -- Members-by-region for the dashboard chart. Chapter scope is a single
    -- region, so the chart isn't meaningful there — return [].
    'regions', case when v_scope = 'chapter' then '[]'::jsonb else coalesce((
      select jsonb_agg(
        jsonb_build_object('region', region, 'active', active, 'lapsed', lapsed)
        order by total desc
      )
      from (
        select
          coalesce(nullif(trim(m."region"), ''), 'Unspecified') as region,
          count(*) filter (where m."activeStatus" = 'Active') as active,
          count(*) filter (where m."activeStatus" = 'Lapsed') as lapsed,
          count(*) as total
        from public.members m
        where v_scope = 'national'
           or (v_scope = 'region' and m."region" is not distinct from v_region)
        group by 1
      ) r
    ), '[]'::jsonb) end
  );
end;
$$;

grant execute on function public.dashboard_stats() to authenticated;
