-- Churn capture (plan 007, step 1).
--
-- Churn is not recoverable from the current schema: public.members is a
-- destructive upsert, members.raw is never written, and sync_logs records only
-- sync runs. So both halves of the metric are captured from here forward:
--
--   numerator   — every activeStatus transition, via a trigger on members, so
--                 the nightly status job, the webhook, the full sync and manual
--                 edits are all covered without touching any of them.
--   denominator — the active-member count per scope at the start of each month,
--                 via a small monthly pg_cron job.
--
-- Nothing before deploy exists, and nothing here tries to invent it.

-- ---------- the event log ----------
-- Append-only. chapterId / region are recorded as they were AT THE TIME of the
-- event: a member can be moved between chapters, and the loss belongs to the
-- chapter they actually left. No FK to members.id — the log has to outlive the
-- row it describes, which is the point of an audit trail.

create table public.member_status_events (
  id uuid primary key default gen_random_uuid(),
  "memberId"   text not null,
  "chapterId"  text,
  "region"     text,
  "fromStatus" text,                 -- null when the member row was just created
  "toStatus"   text not null,
  "occurredAt" timestamptz not null default now()
);

create index member_status_events_occurred on public.member_status_events ("occurredAt");
create index member_status_events_chapter  on public.member_status_events ("chapterId", "occurredAt");
create index member_status_events_region   on public.member_status_events ("region", "occurredAt");

-- ---------- the monthly base ----------

create table public.membership_base_counts (
  id uuid primary key default gen_random_uuid(),
  "periodStart" date not null,
  "scopeType"   text not null check ("scopeType" in ('national','region','chapter')),
  scope         text not null,       -- 'national' | region name | chapterId
  "activeCount" integer not null,
  "capturedAt"  timestamptz not null default now(),
  unique ("periodStart","scopeType",scope)
);

create index membership_base_counts_scope on public.membership_base_counts ("scopeType", scope, "periodStart");

-- ---------- the trigger ----------

create or replace function public.tg_members_log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_status_events (
    "memberId", "chapterId", "region", "fromStatus", "toStatus"
  ) values (
    new.id,
    new."chapterId",
    new."region",
    case when tg_op = 'INSERT' then null else old."activeStatus" end,
    new."activeStatus"
  );
  return null;  -- AFTER trigger; return value is ignored
end;
$$;

-- Two triggers rather than one `insert or update`: a WHEN clause may only
-- reference OLD on an UPDATE trigger, and TG_OP is not visible to WHEN at all,
-- so the plan's single-trigger sketch cannot be expressed. Same function, same
-- effect.
create trigger members_log_status_insert
after insert on public.members
for each row
execute function public.tg_members_log_status_change();

-- The WHEN clause is load-bearing. update_member_status() rewrites every one of
-- the ~14k member rows nightly (it stamps lastSynced unconditionally); without
-- this guard the log would gain 14k rows a day and the feature would become a
-- storage problem.
create trigger members_log_status_update
after update on public.members
for each row
when (old."activeStatus" is distinct from new."activeStatus")
execute function public.tg_members_log_status_change();

-- ---------- the monthly base capture ----------
-- Idempotent within a month, so a re-run (or the one-off call at the bottom of
-- this migration landing in the same month as the first cron firing) updates
-- the row rather than duplicating it.

create or replace function public.capture_active_base()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Month boundaries follow the org's clock, matching dashboard_stats().
  v_period date := date_trunc('month', now() at time zone 'America/New_York')::date;
begin
  -- National.
  insert into public.membership_base_counts ("periodStart","scopeType",scope,"activeCount")
  select v_period, 'national', 'national',
         count(*) filter (where "activeStatus" = 'Active')
  from public.members
  on conflict ("periodStart","scopeType",scope)
  do update set "activeCount" = excluded."activeCount", "capturedAt" = now();

  -- Per region. Keyed on members."region" (not the chapter's) so the
  -- denominator matches how churn_trend scopes the numerator.
  insert into public.membership_base_counts ("periodStart","scopeType",scope,"activeCount")
  select v_period, 'region', r.region, r.active
  from (
    select coalesce(nullif(trim("region"), ''), 'Unspecified') as region,
           count(*) filter (where "activeStatus" = 'Active')   as active
    from public.members
    group by 1
  ) r
  on conflict ("periodStart","scopeType",scope)
  do update set "activeCount" = excluded."activeCount", "capturedAt" = now();

  -- Per chapter, driven off public.chapters so a chapter with no members still
  -- gets a row — a base of 0 reads as "rate unknown", which is correct, whereas
  -- a missing row would look the same as "not captured yet".
  insert into public.membership_base_counts ("periodStart","scopeType",scope,"activeCount")
  select v_period, 'chapter', ch.id, coalesce(m.active, 0)
  from public.chapters ch
  left join (
    select "chapterId",
           count(*) filter (where "activeStatus" = 'Active') as active
    from public.members
    where "chapterId" is not null
    group by 1
  ) m on m."chapterId" = ch.id
  on conflict ("periodStart","scopeType",scope)
  do update set "activeCount" = excluded."activeCount", "capturedAt" = now();
end;
$$;

-- Monthly on the 1st at 04:00 UTC — clear of the 07:00 daily member-status job,
-- and of plan 002's 03:00 slot should that ever land.
select cron.unschedule(jobid) from cron.job where jobname = 'capture-active-base';
select cron.schedule(
  'capture-active-base',
  '0 4 1 * *',
  $$ select public.capture_active_base(); $$
);

-- ---------- RLS ----------
-- Reads follow the model in 20260910000001_scoped_visibility.sql. Plain members
-- get no policy on either table: churn is an admin metric. There is no write
-- policy at all — both writers are security definer, and RLS denies by default.

alter table public.member_status_events   enable row level security;
alter table public.membership_base_counts enable row level security;

create policy mse_read on public.member_status_events for select to authenticated
  using (
    public.is_national_admin()
    or (
      public.auth_role() = 'region_admin'
      and (
        "region" is not distinct from public.auth_region()
        -- Also match on chapter, so a member whose own region field disagrees
        -- with their chapter's still shows up for that chapter's region admin.
        or public.can_read_chapter("chapterId")
      )
    )
    or (
      public.auth_role() = 'chapter_admin'
      and "chapterId" is not null
      and "chapterId" = public.auth_chapter_id()
    )
  );

create policy mbc_read on public.membership_base_counts for select to authenticated
  using (
    public.is_national_admin()
    or (
      public.auth_role() = 'region_admin'
      and (
        ("scopeType" = 'region'  and scope is not distinct from public.auth_region())
        or ("scopeType" = 'chapter' and public.can_read_chapter(scope))
      )
    )
    or (
      public.auth_role() = 'chapter_admin'
      and "scopeType" = 'chapter'
      and scope = public.auth_chapter_id()
    )
  );

-- Start the clock now rather than at the next month boundary. This is the
-- difference between the first churn figure appearing after one month and
-- after two.
select public.capture_active_base();
