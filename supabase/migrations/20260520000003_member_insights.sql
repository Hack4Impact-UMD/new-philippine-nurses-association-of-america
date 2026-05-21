-- Aggregated views over the members table for the global Members page.
-- Returns a single JSON blob so the client makes one round-trip instead of
-- shipping all ~14k member rows over PostgREST for chart math.

create or replace function public.member_insights()
returns jsonb language plpgsql stable as $$
begin
  -- National-admin only. The aggregate spans every chapter, so chapter / region
  -- admins shouldn't be able to call this even by bypassing the UI gate.
  if not public.is_national_admin() then
    raise exception 'member_insights is restricted to national_admin'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    -- Region totals (active/lapsed). National admins use this as the org-wide
    -- "which regions are healthy vs leaking" view.
    'regions', coalesce((
      select jsonb_agg(
        jsonb_build_object('region', region, 'active', active, 'lapsed', lapsed)
        order by total desc
      )
      from (
        select
          coalesce(nullif(trim("region"), ''), 'Unspecified') as region,
          count(*) filter (where "activeStatus" = 'Active') as active,
          count(*) filter (where "activeStatus" = 'Lapsed') as lapsed,
          count(*) as total
        from public.members
        group by 1
      ) r
    ), '[]'::jsonb),

    -- Membership level breakdown — surfaces which tiers retain best.
    'levels', coalesce((
      select jsonb_agg(
        jsonb_build_object('level', level, 'active', active, 'lapsed', lapsed)
        order by total desc
      )
      from (
        select
          coalesce(nullif(trim("membershipLevel"), ''), 'Unspecified') as level,
          count(*) filter (where "activeStatus" = 'Active') as active,
          count(*) filter (where "activeStatus" = 'Lapsed') as lapsed,
          count(*) as total
        from public.members
        group by 1
      ) l
    ), '[]'::jsonb),

    -- Education mix (donut). Empty / null → "Unspecified".
    'education', coalesce((
      select jsonb_agg(
        jsonb_build_object('education', education, 'total', total)
        order by total desc
      )
      from (
        select
          coalesce(nullif(trim("highestEducation"), ''), 'Unspecified') as education,
          count(*) as total
        from public.members
        group by 1
      ) e
    ), '[]'::jsonb),

    -- Renewal cliff — for each of the next 24 months, count active members
    -- whose renewal date is still in the future. Drama for retention planning:
    -- "if nobody renews, how steep is the drop?"
    'cliff', coalesce((
      with months as (
        select generate_series(
          date_trunc('month', now())::date,
          (date_trunc('month', now()) + interval '23 months')::date,
          interval '1 month'
        )::date as month_start
      ),
      active_members as (
        select ("renewalDueDate"::date) as due_date
        from public.members
        where "activeStatus" = 'Active'
          and "renewalDueDate" ~ '^\d{4}-\d{2}-\d{2}'
      )
      select jsonb_agg(
        jsonb_build_object('month', month_start, 'count', still_active)
        order by month_start
      )
      from (
        select
          months.month_start,
          (select count(*) from active_members where due_date >= months.month_start) as still_active
        from months
      ) c
    ), '[]'::jsonb)
  );
end;
$$;

-- Grant to authenticated; the function itself raises if the caller isn't a
-- national_admin, so the grant just lets the call reach the guard.
grant execute on function public.member_insights() to authenticated;
