# Plan 002: Membership & fundraising trend snapshots (historical analytics)

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and
> report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ae467a2..HEAD -- supabase/migrations/20260515000005_pg_cron.sql supabase/migrations pnaa/components/dashboard pnaa/components/members`
> If the pg_cron migration or the dashboard/members components changed, compare the "Current state"
> excerpts below against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ae467a2`, 2026-06-15

## Why this matters

Every number in this app is **point-in-time**. There is no snapshot/history table (only
`sync_logs`), and the nightly `update_member_status()` job **overwrites** chapter aggregates rather
than recording them — so "are we growing?", year-over-year membership change, and fundraising trends
are unrecoverable from the current schema. The insights panels can show the *current* distribution
but never a trend line. This plan starts capturing a monthly snapshot so trend charts become
possible. **Critically: no backfill is possible — history only accrues from the day capture starts,**
so landing this early maximizes the eventual value even though it shows almost nothing on day one.

## Current state

Relevant files (read each before editing):

- `supabase/migrations/20260515000005_pg_cron.sql` — the existing nightly job. Full contents:
  ```sql
  create extension if not exists pg_cron;

  create or replace function public.update_member_status()
  returns void language plpgsql security definer as $$
  declare
    v_now timestamptz := now();
  begin
    update public.members
    set "activeStatus" = case
          when "renewalDueDate" is null or "renewalDueDate" = '' then 'Lapsed'
          when ("renewalDueDate")::timestamptz < v_now then 'Lapsed'
          else 'Active'
        end,
        "lastSynced" = v_now;

    update public.chapters c
    set "totalMembers" = coalesce(stats.total, 0),
        "totalActive"  = coalesce(stats.active, 0),
        "totalLapsed"  = coalesce(stats.lapsed, 0)
    from ( ... aggregate by "chapterId" ... ) stats
    where c.id = stats.chapter_id;
    -- ... zero-out branch ...
  end;
  $$;

  select cron.schedule('update-member-status', '0 7 * * *',
    $$ select public.update_member_status(); $$);
  ```
  This is the pattern for cron jobs: a `security definer` plpgsql function + `cron.schedule(name,
  cron_expr, sql)`. **Do not modify this function or its schedule** — add a new, separate one.
- `supabase/migrations/20260520000003_member_insights.sql` — exemplar read RPC (jsonb, `jsonb_agg`,
  trailing `grant execute ... to authenticated`). Note its `'cliff'` block uses
  `generate_series(... interval '1 month')` — reuse that month-series idiom.
- `pnaa/components/members/member-insights.tsx` — exemplar Recharts component + RPC fetch pattern
  (`supabase.rpc("member_insights")`, `authLoading`/`cancelled` guards, Tabs of charts). It already
  imports `Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis` from `recharts` and the
  `ChartContainer`/`ChartTooltip` wrappers from `@/components/ui/chart`. **Match this for the new
  trend chart.**
- `pnaa/components/dashboard/region-chart.tsx` — a smaller dashboard chart, simpler exemplar if the
  trend chart goes on the dashboard.
- SQL role helpers available: `public.is_admin()`, `public.is_national_admin()`,
  `public.auth_role()`, `public.auth_region()`, `public.auth_chapter_id()`.

Conventions:
- New SQL = new migration file, never edit an existing one.
- Quoted camelCase columns.
- `recharts` (v3) is already a dependency — do not add a charting library.

## Commands you will need

| Purpose | Command (from `pnaa/` unless noted) | Expected |
|---|---|---|
| Install | `npm install` | exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Local DB (repo root) | `supabase start` + `supabase db reset` | applies cleanly |
| Manually run the snapshot fn (repo root, local) | `supabase db reset` then in Studio SQL or psql: `select public.capture_membership_snapshot();` | inserts rows into `membership_snapshots` |

## Scope

**In scope** (create or modify only these):
- `supabase/migrations/<next-timestamp>_trend_snapshots.sql` (create — tables, capture function,
  cron schedule, read RPC)
- `pnaa/types/snapshot.ts` (create)
- `pnaa/types/index.ts` (modify — barrel export)
- `pnaa/components/members/membership-trend.tsx` (create — trend chart component)
- `pnaa/components/members/member-insights.tsx` **OR** `pnaa/app/(app)/members/page.tsx` (modify —
  mount the trend chart near the existing insights; pick whichever currently hosts `<MemberInsights/>`
  and place the trend chart adjacent)

**Out of scope** (do NOT touch):
- `update_member_status()` and its `update-member-status` cron schedule — add a new function and a
  new schedule; never fold snapshotting into the existing job.
- Backfilling historical data — impossible; do not fabricate past snapshots.
- Per-member snapshots — too large at ~14k rows/day; this plan snapshots **aggregates only**.

## Git workflow

- Branch: `advisor/002-trend-snapshots`.
- Commit per logical unit (migration, then types, then chart). Short imperative messages matching
  `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create the snapshot tables + capture function + cron + read RPC

New migration `supabase/migrations/<next-timestamp>_trend_snapshots.sql` (timestamp strictly greater
than the highest existing). Include:

Two append-only aggregate tables:
```sql
create table public.membership_snapshots (
  id uuid primary key default gen_random_uuid(),
  "capturedAt" timestamptz not null default now(),
  "snapshotDate" date not null,
  scope text not null,                 -- 'national' | region name | chapterId
  "scopeType" text not null check ("scopeType" in ('national','region','chapter')),
  "totalMembers" integer not null,
  "totalActive"  integer not null,
  "totalLapsed"  integer not null,
  unique ("snapshotDate","scopeType",scope)
);

create table public.fundraising_snapshots (
  id uuid primary key default gen_random_uuid(),
  "capturedAt" timestamptz not null default now(),
  "snapshotDate" date not null,
  scope text not null,
  "scopeType" text not null check ("scopeType" in ('national','region','chapter')),
  "totalRaised" numeric not null,      -- cumulative all-time at snapshot time
  "raisedThisMonth" numeric not null,  -- sum of campaigns dated within the snapshot month
  unique ("snapshotDate","scopeType",scope)
);
```
Enable RLS on both with read-only-for-authenticated policies (writes happen via the `security
definer` capture function, which bypasses RLS):
```sql
alter table public.membership_snapshots  enable row level security;
alter table public.fundraising_snapshots enable row level security;
create policy memsnap_read  on public.membership_snapshots  for select to authenticated using (true);
create policy fundsnap_read on public.fundraising_snapshots for select to authenticated using (true);
```

A `capture_membership_snapshot()` `security definer` function that, for the current date, inserts:
- one `national` membership row (counts over all `members`),
- one row per distinct non-empty `region`,
- one row per `chapterId`,
and the parallel fundraising rows (cumulative `sum(amount)` where `archived=false` for `totalRaised`;
sum within the current month for `raisedThisMonth`). Use `insert ... on conflict ("snapshotDate",
"scopeType",scope) do update set ...` so re-running the same day is idempotent.

Schedule it monthly, on the 1st at 03:00 UTC (offset from the 07:00 member-status job so they don't
overlap):
```sql
select cron.schedule(
  'capture-monthly-snapshot',
  '0 3 1 * *',
  $$ select public.capture_membership_snapshot(); $$
);
```

A `membership_trend(p_scope_type text default 'national', p_scope text default null)` read RPC that
returns a JSON array of `{ snapshotDate, totalMembers, totalActive, totalLapsed, totalRaised,
raisedThisMonth }` joining the two snapshot tables on `(snapshotDate, scopeType, scope)`, ordered by
date. Default to national scope. Grant execute to `authenticated`. (Keep it readable by all
authenticated users, consistent with the open read policies.)

**Verify (local Supabase, repo root)**: `supabase db reset` applies cleanly. Then run
`select public.capture_membership_snapshot();` (Studio SQL editor or psql) → returns without error
and `select count(*) from public.membership_snapshots;` is > 0. Then
`select public.membership_trend();` returns a JSON array (one element if seed data has one month).

### Step 2: Add the `Snapshot` / trend types

Create `pnaa/types/snapshot.ts`:
```ts
export interface TrendPoint {
  snapshotDate: string;
  totalMembers: number;
  totalActive: number;
  totalLapsed: number;
  totalRaised: number;
  raisedThisMonth: number;
}
```
Add the barrel export to `pnaa/types/index.ts`.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Build the trend chart and mount it

Create `pnaa/components/members/membership-trend.tsx` — client component calling
`supabase.rpc("membership_trend")` (copy the `authLoading`/`cancelled`/`console.error` fetch pattern
from `member-insights.tsx`). Render an `AreaChart` (active vs lapsed over `snapshotDate`) using the
same `ChartContainer`/`ChartTooltip` wrappers `member-insights.tsx` uses. If the array has fewer than
2 points, render an informational empty state: "Trend data starts accruing from the first monthly
snapshot — check back next month." (This is expected on a fresh install.)

Mount `<MembershipTrend />` adjacent to the existing `<MemberInsights />`. Find where
`<MemberInsights />` is rendered (grep `MemberInsights` under `pnaa/app` / `pnaa/components`) and
place the trend chart in the same parent, gated to the same audience (chapter-admin and above — reuse
whatever guard already wraps `MemberInsights`).

**Verify**: `npm run build` → exit 0. Manually: `npm run dev`, sign in as admin, open the members
page → the trend section renders (empty-state message is acceptable with no snapshots).

## Test plan

No automated test framework exists — do not add one. Verification is `npx tsc --noEmit`,
`npm run lint`, `npm run build`, and the manual smoke tests in Steps 1 and 3.

## Done criteria

ALL must hold:
- [ ] New migration applies cleanly via `supabase db reset` on a local Supabase.
- [ ] `select public.capture_membership_snapshot();` inserts rows; running it twice the same day does
      NOT create duplicates (idempotent upsert).
- [ ] `select public.membership_trend();` returns a JSON array.
- [ ] `npx tsc --noEmit`, `npm run lint`, and `npm run build` all exit 0.
- [ ] The members page shows a trend section (empty-state allowed with no data).
- [ ] No files outside the in-scope list modified (`git status`).
- [ ] `plans/README.md` status row for 002 updated.

## STOP conditions

Stop and report (do not improvise) if:
- The `20260515000005_pg_cron.sql` excerpt no longer matches the live file.
- You cannot run a local Supabase. **Do NOT `supabase db push` to a linked remote project** —
  leave the migration file, mark this BLOCKED with reason "needs maintainer to apply + verify cron",
  and finish the frontend steps (they build without the DB).
- `pg_cron` cannot be scheduled locally (some local stacks disable it) — that's fine for local
  verification of the *function*; note it and continue, but flag that the schedule must be confirmed
  on the real project by the maintainer.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **This only ever shows data from the day it's deployed forward.** Set expectations: the chart is
  near-empty for the first couple of months. Do not let a reviewer reject it for "showing nothing."
- Monthly cadence keeps the tables tiny (~57 chapters + ~10 regions + 1 national ≈ 70 rows/month).
  If finer granularity is wanted later, change the cron expression — but weigh table growth.
- The capture function is `security definer` so it can insert despite the read-only RLS policies.
  A reviewer should confirm it does **not** expose a write path to clients (no RPC wraps the insert).
- If a future plan adds the chapter detail page a trend view, reuse `membership_trend('chapter',
  '<chapterId>')` rather than writing a new query.
- The `update-member-status` job runs at 07:00 UTC daily; this one at 03:00 UTC monthly. If either
  schedule changes, keep them non-overlapping to avoid lock contention on `members`.
