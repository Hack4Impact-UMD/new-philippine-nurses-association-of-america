-- churn_trend() — monthly membership churn for one scope (plan 007, step 2).
--
-- Reads the two capture tables from 20260911000001_churn_capture.sql:
--   numerator   member_status_events   'Active' -> 'Lapsed' during the month
--   denominator membership_base_counts active members at the month's start
--
-- Months before capture began have no base row and come back with a null
-- churnRate. That is deliberate: a rendered 0 would read as "we lost nobody",
-- which is a different claim from "we weren't measuring yet".

create or replace function public.churn_trend(
  p_scope_type text default null,     -- 'national' | 'region' | 'chapter'; null = the caller's own
  p_scope      text default null,     -- region name or chapterId; ignored for 'national'
  p_months     integer default 24
) returns jsonb language plpgsql stable as $$
declare
  v_role       text := public.auth_role();
  v_scope_type text;
  v_scope      text;
  v_months     integer;
  v_this_month date := date_trunc('month', now() at time zone 'America/New_York')::date;
  v_start      date;
begin
  if not public.is_admin() then
    raise exception 'churn_trend is restricted to admins' using errcode = '42501';
  end if;

  -- Default to whatever the caller can see without asking.
  if p_scope_type is null or p_scope_type = '' then
    if v_role = 'national_admin' then
      v_scope_type := 'national';
      v_scope      := 'national';
    elsif v_role = 'region_admin' then
      v_scope_type := 'region';
      v_scope      := public.auth_region();
    else
      v_scope_type := 'chapter';
      v_scope      := public.auth_chapter_id();
    end if;
  else
    v_scope_type := p_scope_type;
    v_scope      := case when p_scope_type = 'national' then 'national' else p_scope end;
  end if;

  if v_scope_type not in ('national','region','chapter') then
    raise exception 'invalid scope type: %', v_scope_type using errcode = '22023';
  end if;
  if v_scope is null or v_scope = '' then
    raise exception 'a scope value is required for scope type %', v_scope_type using errcode = '22023';
  end if;

  -- Authorise the requested scope. This is about honesty as much as security:
  -- the function is SECURITY INVOKER, so RLS already limits which rows it can
  -- see, and without this guard a chapter admin asking for 'national' would
  -- quietly get their own chapter's numbers under a National heading.
  if v_scope_type = 'national' then
    if not public.is_national_admin() then
      raise exception 'not permitted to view national churn' using errcode = '42501';
    end if;
  elsif v_scope_type = 'region' then
    -- The role check is not redundant with the region comparison: chapter
    -- admins carry a region claim too (users.region is set for them), so
    -- comparing regions alone would hand a chapter admin their whole region.
    if not (
      public.is_national_admin()
      or (v_role = 'region_admin' and v_scope is not distinct from public.auth_region())
    ) then
      raise exception 'not permitted to view churn for region %', v_scope using errcode = '42501';
    end if;
  else
    if not public.can_read_chapter(v_scope) then
      raise exception 'not permitted to view churn for that chapter' using errcode = '42501';
    end if;
  end if;

  v_months := least(greatest(coalesce(p_months, 24), 1), 36);
  v_start  := (v_this_month - make_interval(months => v_months - 1))::date;

  return coalesce((
    with months as (
      select generate_series(v_start, v_this_month, interval '1 month')::date as month_start
    ),
    ev as (
      select
        date_trunc('month', e."occurredAt" at time zone 'America/New_York')::date as month_start,
        count(*) filter (where e."fromStatus" = 'Active' and e."toStatus" = 'Lapsed') as lapsed,
        count(*) filter (where e."fromStatus" = 'Lapsed' and e."toStatus" = 'Active') as reactivated
      from public.member_status_events e
      where e."occurredAt" >= v_start
        and (
          v_scope_type = 'national'
          or (v_scope_type = 'region'  and e."region"    is not distinct from v_scope)
          or (v_scope_type = 'chapter' and e."chapterId" is not distinct from v_scope)
        )
      group by 1
    ),
    base as (
      select b."periodStart" as month_start, b."activeCount" as active_count
      from public.membership_base_counts b
      where b."scopeType" = v_scope_type
        and b.scope = v_scope
        and b."periodStart" >= v_start
    )
    select jsonb_agg(
      jsonb_build_object(
        'month',       m.month_start,
        'lapsed',      coalesce(ev.lapsed, 0),
        'reactivated', coalesce(ev.reactivated, 0),
        'base',        base.active_count,
        'churnRate',   case
                         when base.active_count is null or base.active_count = 0 then null
                         else round(coalesce(ev.lapsed, 0)::numeric / base.active_count, 4)
                       end
      )
      order by m.month_start
    )
    from months m
    left join ev   on ev.month_start   = m.month_start
    left join base on base.month_start = m.month_start
  ), '[]'::jsonb);
end;
$$;

-- The guard inside raises for anyone who shouldn't be here; the grant just lets
-- the call reach it.
grant execute on function public.churn_trend(text, text, integer) to authenticated;
