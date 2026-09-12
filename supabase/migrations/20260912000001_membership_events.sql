-- Monthly new / renewed member lists.
--
-- Neither "joined" nor "renewed" is recorded anywhere today: members is a
-- destructive upsert, and a renewal overwrites the previous renewal due date.
-- Both are captured from here forward. Nothing before deploy is reconstructed —
-- the list starts empty and fills from launch.
--
-- Admin-only. Access to a row follows access to the member it describes, so the
-- existing members_read policy decides who sees whose name and email.
--
-- Also extracts the scope authorisation from churn_trend() into a shared
-- resolve_view_scope(), so the two admin RPCs cannot drift apart on who may view
-- what. That check has already been wrong once (the region branch compared
-- regions without checking the role).

-- ---------- lenient date parsing ----------
-- renewalDueDate is text. This trigger rides on every member write the sync and
-- the webhook make, so a malformed date must yield null, never an exception.

create or replace function public.safe_iso_date(p_value text)
returns date
language plpgsql
stable
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;
  return to_date(left(p_value, 10), 'YYYY-MM-DD');
exception when others then
  return null;
end;
$$;

-- ---------- the event table ----------

create table public.membership_events (
  id uuid primary key default gen_random_uuid(),
  "memberId"   text not null references public.members(id) on delete cascade,
  kind         text not null check (kind in ('joined', 'renewed')),
  -- Month boundaries follow the org's clock, matching churn and dashboard_stats.
  "eventMonth" date not null,
  "occurredAt" timestamptz not null default now()
);

-- A member joins once, ever.
create unique index membership_events_one_join
  on public.membership_events ("memberId") where kind = 'joined';
-- A renewal date corrected twice in a month is still one renewal.
create unique index membership_events_once_per_month
  on public.membership_events ("memberId", kind, "eventMonth");
create index membership_events_month
  on public.membership_events ("eventMonth", kind);

-- ---------- the trigger ----------

create or replace function public.tg_members_log_join_renewal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind    text;
  v_old_due date;
  v_new_due date;
begin
  -- Only members count. The sync pulls every non-archived Wild Apricot contact
  -- with no membership filter, so a row without a level is someone who never
  -- joined — an event registrant, say.
  if coalesce(trim(new."membershipLevel"), '') = '' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new."activeStatus" = 'Active' then
      v_kind := 'joined';
    end if;
  else
    v_old_due := public.safe_iso_date(old."renewalDueDate");
    v_new_due := public.safe_iso_date(new."renewalDueDate");

    -- Joined: now an active member, and either they had no level before (a
    -- contact who became a member) or they never had a renewal date (a pending
    -- application that has just been paid).
    if new."activeStatus" = 'Active'
       and (coalesce(trim(old."membershipLevel"), '') = '' or v_old_due is null) then
      v_kind := 'joined';
    -- Renewed: Wild Apricot only moves "Renewal due" later when someone renews.
    -- This covers an active member renewing early and a lapsed member coming
    -- back alike.
    elsif v_old_due is not null and v_new_due is not null and v_new_due > v_old_due then
      v_kind := 'renewed';
    end if;
  end if;

  if v_kind is not null then
    insert into public.membership_events ("memberId", kind, "eventMonth")
    values (
      new.id,
      v_kind,
      date_trunc('month', now() at time zone 'America/New_York')::date
    )
    on conflict do nothing;
  end if;

  return null;
exception when others then
  -- Logging must never break the member write it rides on. The nightly sync
  -- and the webhook both upsert through this table.
  raise warning 'membership_events: skipped logging for member %: %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger members_log_join_renewal_insert
after insert on public.members
for each row
execute function public.tg_members_log_join_renewal();

-- Fires only when a column the logic reads actually changed, so the nightly
-- all-rows lastSynced sweep in update_member_status() stays a no-op here.
create trigger members_log_join_renewal_update
after update on public.members
for each row
when (
  old."renewalDueDate"  is distinct from new."renewalDueDate"
  or old."membershipLevel" is distinct from new."membershipLevel"
  or old."activeStatus"    is distinct from new."activeStatus"
)
execute function public.tg_members_log_join_renewal();

-- ---------- RLS ----------
-- Admins only, and only for members they can already read. The subquery runs
-- under the caller's own members_read policy, so national / region / chapter
-- scoping is inherited rather than restated. No write policy: the trigger is
-- the only writer.

alter table public.membership_events enable row level security;

create policy membership_events_read on public.membership_events
  for select to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.members m where m.id = membership_events."memberId"
    )
  );

-- ---------- shared scope authorisation ----------
-- Resolves the requested scope (defaulting to the caller's own) and raises
-- unless the caller may view it. This matters for honesty as much as access:
-- callers are SECURITY INVOKER, so RLS already trims their rows, and without
-- this a chapter admin asking for 'national' would quietly get their own
-- chapter's rows under a National heading.

create or replace function public.resolve_view_scope(
  p_scope_type text,
  p_scope      text
) returns table (scope_type text, scope text)
language plpgsql
stable
as $$
declare
  v_role text := public.auth_role();
  v_type text;
  v_val  text;
begin
  if p_scope_type is null or p_scope_type = '' then
    if v_role = 'national_admin' then
      v_type := 'national';
      v_val  := 'national';
    elsif v_role = 'region_admin' then
      v_type := 'region';
      v_val  := public.auth_region();
    else
      v_type := 'chapter';
      v_val  := public.auth_chapter_id();
    end if;
  else
    v_type := p_scope_type;
    v_val  := case when p_scope_type = 'national' then 'national' else p_scope end;
  end if;

  if v_type not in ('national', 'region', 'chapter') then
    raise exception 'invalid scope type: %', v_type using errcode = '22023';
  end if;
  if v_val is null or v_val = '' then
    raise exception 'a scope value is required for scope type %', v_type using errcode = '22023';
  end if;

  if v_type = 'national' then
    if not public.is_national_admin() then
      raise exception 'not permitted to view national data' using errcode = '42501';
    end if;
  elsif v_type = 'region' then
    -- The role check is not redundant with the region comparison: chapter
    -- admins carry a region claim too, so comparing regions alone would hand a
    -- chapter admin their whole region.
    if not (
      public.is_national_admin()
      or (v_role = 'region_admin' and v_val is not distinct from public.auth_region())
    ) then
      raise exception 'not permitted to view region %', v_val using errcode = '42501';
    end if;
  else
    if not public.can_read_chapter(v_val) then
      raise exception 'not permitted to view that chapter' using errcode = '42501';
    end if;
  end if;

  return query select v_type, v_val;
end;
$$;

-- ---------- churn_trend, now on the shared guard ----------
-- Body unchanged from 20260911000002_churn_trend.sql apart from the scope
-- resolution, which moves into resolve_view_scope().

create or replace function public.churn_trend(
  p_scope_type text default null,
  p_scope      text default null,
  p_months     integer default 24
) returns jsonb language plpgsql stable as $$
declare
  v_scope_type text;
  v_scope      text;
  v_months     integer;
  v_this_month date := date_trunc('month', now() at time zone 'America/New_York')::date;
  v_start      date;
begin
  if not public.is_admin() then
    raise exception 'churn_trend is restricted to admins' using errcode = '42501';
  end if;

  select r.scope_type, r.scope into v_scope_type, v_scope
  from public.resolve_view_scope(p_scope_type, p_scope) r;

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

-- ---------- the list RPC ----------

create or replace function public.member_joins_and_renewals(
  p_month      date default null,   -- any day in the month; null = this month
  p_scope_type text default null,   -- 'national' | 'region' | 'chapter'; null = the caller's own
  p_scope      text default null    -- region name or chapterId; ignored for 'national'
) returns jsonb language plpgsql stable as $$
declare
  v_scope_type text;
  v_scope      text;
  v_month      date;
begin
  if not public.is_admin() then
    raise exception 'member_joins_and_renewals is restricted to admins' using errcode = '42501';
  end if;

  select r.scope_type, r.scope into v_scope_type, v_scope
  from public.resolve_view_scope(p_scope_type, p_scope) r;

  v_month := date_trunc(
    'month',
    coalesce(p_month, (now() at time zone 'America/New_York')::date)
  )::date;

  -- Scoped by the member's CURRENT chapter and region, the same keys
  -- members_read uses, so the list never shows a name or email the caller
  -- couldn't already open on the members page.
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'memberId',        m.id,
        'name',            m."name",
        'email',           m."email",
        'membershipLevel', m."membershipLevel",
        'chapterId',       m."chapterId",
        'chapterName',     c."name",
        'region',          m."region",
        'kind',            e.kind,
        'occurredAt',      e."occurredAt"
      )
      order by e."occurredAt" desc
    )
    from public.membership_events e
    join public.members m on m.id = e."memberId"
    left join public.chapters c on c.id = m."chapterId"
    where e."eventMonth" = v_month
      and (
        v_scope_type = 'national'
        or (v_scope_type = 'region'  and m."region"    is not distinct from v_scope)
        or (v_scope_type = 'chapter' and m."chapterId" is not distinct from v_scope)
      )
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.member_joins_and_renewals(date, text, text) to authenticated;
