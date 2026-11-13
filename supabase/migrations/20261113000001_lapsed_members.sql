-- Lapsed members, with how long each has been lapsed.
--
-- The companion to member_joins_and_renewals(): that one lists who came in this
-- month, this one lists who has fallen out and for how long, so admins can work
-- the 30 / 60 / 90+ day follow-up lists.
--
-- Nothing new is recorded. A lapsed member's "renewalDueDate" is the day their
-- membership ran out, so days lapsed is computed from the current members table
-- and the list is complete from day one, not from launch.
--
-- The 30 / 60 / 90+ bucketing lives in the app (pnaa/lib/lapsed.ts), next to
-- its labels, so there is one definition of the boundaries. This returns the
-- raw day count.

create or replace function public.lapsed_members(
  p_scope_type text default null,   -- 'national' | 'region' | 'chapter'; null = the caller's own
  p_scope      text default null    -- region name or chapterId; ignored for 'national'
) returns jsonb language plpgsql stable as $$
declare
  v_scope_type text;
  v_scope      text;
  -- Day boundaries follow the org's clock, matching churn and the joins list.
  v_today      date := (now() at time zone 'America/New_York')::date;
begin
  if not public.is_admin() then
    raise exception 'lapsed_members is restricted to admins' using errcode = '42501';
  end if;

  select r.scope_type, r.scope into v_scope_type, v_scope
  from public.resolve_view_scope(p_scope_type, p_scope) r;

  -- SECURITY INVOKER, so members_read still trims the rows; the scope filter
  -- below only narrows within what the caller can already open.
  --
  -- A row with no usable renewal date is left out: the sync marks every
  -- contact without one Lapsed, including people who never held a membership
  -- (event registrants, say), and there is no lapse to measure for them.
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'memberId',        l.id,
        'name',            l."name",
        'email',           l."email",
        'membershipLevel', l."membershipLevel",
        'chapterId',       l."chapterId",
        'chapterName',     l.chapter_name,
        'region',          l."region",
        'lapsedOn',        l.lapsed_on,
        'daysLapsed',      l.days_lapsed
      )
      order by l.days_lapsed asc, l."name" asc
    )
    from (
      select
        m.id, m."name", m."email", m."membershipLevel", m."chapterId", m."region",
        c."name" as chapter_name,
        d.lapsed_on,
        -- A status flipped at midnight UTC can be a few hours ahead of the
        -- org's calendar day, so never report a negative lapse.
        greatest(v_today - d.lapsed_on, 0) as days_lapsed
      from public.members m
      cross join lateral (select public.safe_iso_date(m."renewalDueDate") as lapsed_on) d
      left join public.chapters c on c.id = m."chapterId"
      where m."activeStatus" = 'Lapsed'
        and d.lapsed_on is not null
        and (
          v_scope_type = 'national'
          or (v_scope_type = 'region'  and m."region"    is not distinct from v_scope)
          or (v_scope_type = 'chapter' and m."chapterId" is not distinct from v_scope)
        )
    ) l
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.lapsed_members(text, text) to authenticated;
