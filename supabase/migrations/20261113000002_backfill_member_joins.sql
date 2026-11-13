-- One-time backfill of historical joins from Wild Apricot's "Member since".
--
-- 20260912000001_membership_events.sql records joins only from deploy onward,
-- stamped with the day the sync noticed them. This RPC lets
-- scripts/backfill-member-joins.ts write each member's real start date instead:
-- a 'joined' row is inserted where none exists, and a row the trigger already
-- wrote is moved to the Wild Apricot date. Renewals are untouched.
--
-- Wild Apricot is the source of truth for when someone joined, so an existing
-- 'joined' row is overwritten even when it was recorded live. Re-running with
-- the same input changes nothing.
--
-- Input rows are { "memberId": text, "joinedOn": "YYYY-MM-DD" }. Rows for ids
-- that are not in public.members are counted and skipped, never inserted: the
-- foreign key would reject them, and one bad id must not fail the whole batch.
--
-- "occurredAt" is noon UTC on the start date. It is a date-only fact, and noon
-- UTC falls on the same calendar day from UTC-11 to UTC+11, so the list shows
-- the right day for every US state and territory.
--
-- Service role only: this rewrites history that the RLS policy otherwise lets
-- no client write.

create or replace function public.backfill_member_joins(
  p_rows    jsonb,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_received       integer;
  v_valid          integer;
  v_missing_member integer;
  v_to_insert      integer;
  v_to_update      integer;
  v_unchanged      integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  v_received := jsonb_array_length(p_rows);

  drop table if exists _backfill_joins;
  create temp table _backfill_joins on commit drop as
  with input as (
    -- A member appearing twice keeps their earliest date.
    select distinct on (r."memberId")
      r."memberId",
      r."joinedOn"
    from jsonb_to_recordset(p_rows) as r("memberId" text, "joinedOn" date)
    where nullif(trim(r."memberId"), '') is not null
      and r."joinedOn" is not null
    order by r."memberId", r."joinedOn"
  )
  select
    i."memberId",
    date_trunc('month', i."joinedOn")::date                  as new_month,
    (i."joinedOn"::timestamp + interval '12 hours') at time zone 'UTC' as new_at,
    m.id is not null                                         as has_member,
    e.id                                                     as event_id,
    e."eventMonth"                                           as cur_month,
    e."occurredAt"                                           as cur_at
  from input i
  left join public.members m on m.id = i."memberId"
  left join public.membership_events e
    on e."memberId" = i."memberId" and e.kind = 'joined';

  select
    count(*),
    count(*) filter (where not has_member),
    count(*) filter (where has_member and event_id is null),
    count(*) filter (where has_member and event_id is not null
                       and (cur_month, cur_at) is distinct from (new_month, new_at)),
    count(*) filter (where has_member and event_id is not null
                       and (cur_month, cur_at) is not distinct from (new_month, new_at))
  into v_valid, v_missing_member, v_to_insert, v_to_update, v_unchanged
  from _backfill_joins;

  if not p_dry_run then
    -- The conflict clause covers a join the trigger records between the
    -- classification above and this insert.
    insert into public.membership_events ("memberId", kind, "eventMonth", "occurredAt")
    select "memberId", 'joined', new_month, new_at
    from _backfill_joins
    where has_member and event_id is null
    on conflict ("memberId") where kind = 'joined'
    do update set "eventMonth" = excluded."eventMonth",
                  "occurredAt" = excluded."occurredAt";

    update public.membership_events e
    set "eventMonth" = b.new_month,
        "occurredAt" = b.new_at
    from _backfill_joins b
    where e.id = b.event_id
      and (e."eventMonth", e."occurredAt") is distinct from (b.new_month, b.new_at);
  end if;

  return jsonb_build_object(
    'dryRun',        p_dry_run,
    'received',      v_received,
    -- Blank ids, missing dates, and repeats of a member already in the batch.
    'ignored',       v_received - v_valid,
    'missingMember', v_missing_member,
    'inserted',      v_to_insert,
    'updated',       v_to_update,
    'unchanged',     v_unchanged
  );
end;
$$;

revoke all on function public.backfill_member_joins(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.backfill_member_joins(jsonb, boolean) to service_role;

-- ---------- member_joins_and_renewals over a month range ----------
-- With joins now reaching back decades, the list can be asked for a span of
-- months. Fetching one month per call made a twenty-year range hundreds of
-- requests. p_to_month makes it one; left null, the call is the same
-- single-month list as before. A reversed range is read as the same range.
--
-- Dropped and recreated rather than replaced: adding a parameter with
-- create-or-replace would leave the old three-argument version beside it, and
-- PostgREST could not choose between the two.

drop function if exists public.member_joins_and_renewals(date, text, text);
-- And this version itself, so re-running the migration is harmless.
drop function if exists public.member_joins_and_renewals(date, text, text, date);

create function public.member_joins_and_renewals(
  p_month      date default null,   -- any day in the (first) month; null = this month
  p_scope_type text default null,   -- 'national' | 'region' | 'chapter'; null = the caller's own
  p_scope      text default null,   -- region name or chapterId; ignored for 'national'
  p_to_month   date default null    -- any day in the last month; null = just p_month
) returns jsonb language plpgsql stable as $$
declare
  v_scope_type text;
  v_scope      text;
  v_from       date;
  v_to         date;
begin
  if not public.is_admin() then
    raise exception 'member_joins_and_renewals is restricted to admins' using errcode = '42501';
  end if;

  select r.scope_type, r.scope into v_scope_type, v_scope
  from public.resolve_view_scope(p_scope_type, p_scope) r;

  v_from := date_trunc(
    'month',
    coalesce(p_month, (now() at time zone 'America/New_York')::date)
  )::date;
  v_to := coalesce(date_trunc('month', p_to_month)::date, v_from);
  if v_to < v_from then
    select v_to, v_from into v_from, v_to;
  end if;

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
    where e."eventMonth" between v_from and v_to
      and (
        v_scope_type = 'national'
        or (v_scope_type = 'region'  and m."region"    is not distinct from v_scope)
        or (v_scope_type = 'chapter' and m."chapterId" is not distinct from v_scope)
      )
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.member_joins_and_renewals(date, text, text, date) to authenticated;
