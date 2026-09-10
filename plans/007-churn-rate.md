# Plan 007: Membership churn rate (national / region / chapter)

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and
> report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat efb3d00..HEAD -- supabase/migrations pnaa/components/members pnaa/app/\(app\)/members`
> If the pg_cron migration, the RLS migration or the members components changed, compare the
> "Current state" excerpts below against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW — additive tables and one trigger; nothing existing changes behaviour
- **Depends on**: none. Overlaps 002 (see "Relationship to 002")
- **Category**: direction
- **Planned at**: commit `efb3d00`, 2026-09-10

## Why this matters

The app can say how many members are Active and how many are Lapsed **right now**, and the renewal
cliff shows who is due next. Nothing answers the question a board actually asks: *are we losing
members faster than last year, and which chapters are leaking?* Churn is the single number that
turns the members page from a roster into a retention tool, and it is the one metric a region admin
can act on without editing anything — which fits their read-only role exactly.

## No backfill — history starts at deploy

`public.members` is a destructive upsert. The nightly sync and the webhook both overwrite the row,
`members.raw` is declared but never written, and `sync_logs` records only sync runs. **Past churn is
not recoverable and this plan does not try to reconstruct it.** The chart shows nothing until the
first full month after deploy, and one point per month after that. That is expected and accepted —
do not let a reviewer reject it for "showing nothing" in week one, and do not invent estimated
figures to fill the gap.

What this buys instead is that every figure the chart ever shows is a measured one.

Two things get captured from the day this ships:

| Capture | What | How |
|---|---|---|
| **Numerator** — lapse events | Every `activeStatus` transition, with the chapter and region the member was in *at the time* | An `AFTER` trigger on `public.members`, so it catches the nightly status job, the webhook, the full sync and manual edits alike |
| **Denominator** — active base | The active-member count per scope at the start of each month | A small monthly `pg_cron` job |

Churn for month M = lapse events during M ÷ active base at the start of M.

## Relationship to 002

Plan 002 (trend snapshots) captures `membership_snapshots.totalActive`, which covers the same ground
as this plan's base-count table. They are independent and both can exist — the tables are small and
the jobs are minutes apart — but **if both land, one of the two monthly counts is redundant**. Note
it in `plans/README.md` when the second of the pair ships so a later pass can retire one. Do not
build a "use 002's table if it exists" branch; that conditional is not worth the complexity.

## Current state

Read each before editing:

- `supabase/migrations/20260515000005_pg_cron.sql` — the existing nightly job, `update-member-status`
  at 07:00 UTC. This is the cron pattern to copy: a `security definer` plpgsql function plus
  `cron.schedule(name, cron_expr, sql)`. **Do not modify this function or its schedule** — add new,
  separate ones. Note what it does to the trigger you are about to add: it updates **every** member
  row nightly (it sets `lastSynced` unconditionally), so the trigger must fire only on an actual
  status change or it will write ~14k rows a night.
- `supabase/migrations/20260910000001_scoped_visibility.sql` — the RLS model. Provides
  `public.can_read_chapter(text)`, and alongside it `is_admin()`, `is_national_admin()`,
  `auth_role()`, `auth_region()`, `auth_chapter_id()`. The new tables' read policies follow the
  same shape; the scope guard in Step 2 reuses these helpers.
- `supabase/migrations/20260520000003_member_insights.sql` — exemplar read RPC: `returns jsonb`,
  `jsonb_build_object` / `jsonb_agg`, a role guard that raises `42501`, trailing
  `grant execute ... to authenticated`. Its `'cliff'` block is the `generate_series(...
  interval '1 month')` idiom this plan reuses. Live definition is in
  `20260602000004_member_insights_to_date.sql`, gated on `is_admin()`.
- `pnaa/components/members/member-insights.tsx` — exemplar chart component: `supabase.rpc(...)`
  inside an effect with `authLoading` / `cancelled` guards, `ChartContainer` / `ChartTooltip` from
  `@/components/ui/chart`, colors as `var(--chart-N)` tokens, local `<ChartSkeleton/>` and
  `<EmptyChart/>` helpers. Gated with `useIsAdmin()`.
- `pnaa/components/members/member-list.tsx` — exemplar scope pickers: the chapter / region
  `<Select>`s and the `showChapterFilter` / `showRegionFilter` role flags that hide a picker with
  only one possible answer. Reuse that shape for the churn scope selector.
- `pnaa/app/(app)/members/page.tsx` — mounts `<MemberInsights />`; the new card goes here.

Conventions:
- New SQL = a new migration file, never an edit to an existing one. Quoted camelCase columns.
- `recharts` v3 is already a dependency — do not add a charting library.
- Run all `npm` commands from `pnaa/`.

## Commands you will need

| Purpose | Command (from `pnaa/` unless noted) | Expected |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | matches the pre-existing baseline (15 errors / 14 warnings), no new entries |
| Build | `npm run build` | exit 0 |
| Local DB (repo root) | `supabase start` + `supabase db reset` | applies cleanly |
| Force a base capture (local) | Studio SQL: `select public.capture_active_base();` | inserts one row per scope |
| Call the RPC (local) | Studio SQL: `select public.churn_trend('national', null, 24);` | JSON array |

## Scope

**In scope** (create or modify only these):
- `supabase/migrations/<next>_churn_capture.sql` (create — Step 1: two tables, trigger, cron, RLS)
- `supabase/migrations/<next+1>_churn_trend.sql` (create — Step 2: the read RPC)
- `pnaa/types/churn.ts` (create — Step 3)
- `pnaa/types/index.ts` (modify — barrel export)
- `pnaa/components/members/churn-trend.tsx` (create — Step 4)
- `pnaa/app/(app)/members/page.tsx` (modify — mount the card)
- `README.md` (modify — RPC list and a line on when data starts)

**Out of scope** (do NOT touch):
- `update_member_status()` and its cron schedule.
- The `members` table's columns or its RLS policies.
- Any change to how `activeStatus` is computed.
- Backfilling or estimating past churn — see "No backfill" above.
- A churn card on the chapter detail page or the dashboard — a follow-up; the RPC is already
  parameterised for it.

Migration filenames take the next free `YYYYMMDDNNNNNN_` strictly greater than the current highest,
`20260910000001_scoped_visibility.sql`.

## Git workflow

- Branch: `advisor/007-churn-rate`.
- Commit per logical unit (capture, then RPC, then types, then chart). Short imperative messages
  matching `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Capture — status-event log, base counts, trigger, cron

Migration `supabase/migrations/<next>_churn_capture.sql`.

**Table 1 — the event log.** Append-only. It records the chapter and region **as they were at the
time of the event**, because a member can be moved between chapters and the loss belongs to the
chapter they actually left:

```sql
create table public.member_status_events (
  id uuid primary key default gen_random_uuid(),
  "memberId"   text not null,
  "chapterId"  text,
  "region"     text,
  "fromStatus" text,                 -- null on insert (a new member)
  "toStatus"   text not null,
  "occurredAt" timestamptz not null default now()
);
create index member_status_events_occurred on public.member_status_events ("occurredAt");
create index member_status_events_chapter  on public.member_status_events ("chapterId", "occurredAt");
create index member_status_events_region   on public.member_status_events ("region", "occurredAt");
```

No FK to `members.id` — the log must survive a member row being removed, and that is the whole point
of an audit trail.

**Table 2 — the monthly base.** One row per scope per month:

```sql
create table public.membership_base_counts (
  id uuid primary key default gen_random_uuid(),
  "periodStart" date not null,
  "scopeType"   text not null check ("scopeType" in ('national','region','chapter')),
  scope         text not null,       -- 'national' | region name | chapterId
  "activeCount" integer not null,
  "capturedAt"  timestamptz not null default now(),
  unique ("periodStart","scopeType",scope)
);
```

**The trigger.** `AFTER INSERT OR UPDATE ON public.members FOR EACH ROW`, with a `WHEN` clause so it
fires only on a real transition:

```sql
when (tg_op = 'INSERT' or old."activeStatus" is distinct from new."activeStatus")
```

> That `WHEN` clause is load-bearing. `update_member_status()` rewrites all ~14k member rows every
> night; without it the log gains 14k rows a day and the feature becomes a storage problem.

The function inserts one row carrying `new.id`, `new."chapterId"`, `new."region"`, the old status
(null on insert) and the new status. Keep it `security definer` so it writes past the log's
read-only RLS.

**The base capture.** A `capture_active_base()` `security definer` function that, for the current
month start, upserts one `'national'` row, one row per distinct non-empty region, and one row per
chapter, each with the count of members whose `activeStatus = 'Active'`. Use
`on conflict ("periodStart","scopeType",scope) do update set` so re-running within the month is
idempotent. Schedule it monthly on the 1st at 04:00 UTC — clear of the 07:00 daily job, and of
plan 002's 03:00 slot if that ever lands:

```sql
select cron.schedule('capture-active-base', '0 4 1 * *',
  $$ select public.capture_active_base(); $$);
```

Then **call it once at the end of the migration** so the clock starts at deploy rather than at the
next month boundary. That is the difference between the first churn figure appearing after one month
and after two.

**RLS.** Enable on both tables. Reads follow the existing model — national admins see everything,
region admins their region, chapter admins their chapter — using `public.can_read_chapter(...)` for
the chapter-keyed columns and an `auth_region()` comparison for the region ones. Plain members have
no read policy on either table; churn is an admin metric and the RPC is the only intended reader.
No client write policy at all: both writers are `security definer`.

**Verify (local)**: `supabase db reset` applies cleanly. Then:
- `update public.members set "activeStatus"='Lapsed' where id = '<some active id>';` → exactly one
  new row in `member_status_events`.
- `update public.members set "lastSynced" = now();` (touches every row) → **zero** new rows. If this
  writes rows, the `WHEN` clause is wrong; fix it before continuing.
- `select count(*) from public.membership_base_counts;` is greater than zero (the migration's
  one-off call ran).

### Step 2: The `churn_trend` RPC

Migration `supabase/migrations/<next+1>_churn_trend.sql`, following the `member_insights` house
style.

```sql
create or replace function public.churn_trend(
  p_scope_type text default null,   -- 'national' | 'region' | 'chapter'; null = caller's own scope
  p_scope      text default null,   -- region name or chapterId; ignored for 'national'
  p_months     integer default 24
) returns jsonb language plpgsql stable as $$
```

Behaviour:

1. **Guard the caller.** Raise `42501` unless `public.is_admin()` — this is an admin metric.
2. **Resolve the scope, then authorise it.** When `p_scope_type` is null, default to the caller's
   own: national admins → `'national'`, region admins → their `auth_region()`, chapter admins →
   their `auth_chapter_id()`. Then reject anything wider than the caller may see:
   - `'national'` requires `is_national_admin()`
   - `'region'` requires `is_national_admin()` or `p_scope = auth_region()`
   - `'chapter'` requires `public.can_read_chapter(p_scope)`

   > This guard is about **honesty as much as security**. The function is SECURITY INVOKER, so RLS
   > already limits which rows it can see. Without the guard, a chapter admin asking for
   > `'national'` would silently get their own chapter's numbers under a "National" heading. Raise
   > instead.
3. **Clamp** `p_months` to `1..36`.
4. **Numerator** per month over `generate_series`: `member_status_events` rows in scope with
   `fromStatus = 'Active'` and `toStatus = 'Lapsed'` whose `occurredAt` falls in that month.
5. **Reactivations**, same shape but `'Lapsed' → 'Active'`. Nearly free from the same table and it
   makes a churn spike readable as gross versus net.
6. **Denominator**: `membership_base_counts."activeCount"` for that `periodStart` and scope.
7. **Return** a JSON array ordered by month:
   `{ month, lapsed, reactivated, base, churnRate }`, `churnRate` as a fraction rounded to 4 places
   and **`null` whenever no base row exists for that month or the base is zero**. Months before
   deploy have no base row and must come back `null`, never `0` — a rendered zero reads as "we lost
   nobody", which is a lie.

Grant execute to `authenticated`; the guard inside does the real work.

**Verify (local)**: `supabase db reset` applies cleanly. `select public.churn_trend();` returns a
JSON array of `p_months` elements, all but the current month having `churnRate: null` on a fresh
database. `select public.churn_trend('chapter','<some-other-chapter>');` as a non-national admin
raises `42501`.

### Step 3: Types

Create `pnaa/types/churn.ts`:

```ts
export interface ChurnPoint {
  month: string;        // YYYY-MM-01
  lapsed: number;
  reactivated: number;
  /** Active members at the start of the month. Null before capture began. */
  base: number | null;
  /** Fraction, not percent. Null when the base is unknown or zero. */
  churnRate: number | null;
}
```

Add the barrel export to `pnaa/types/index.ts`.

**Verify**: `npx tsc --noEmit` exits 0.

### Step 4: The chart

> Load the `dataviz` skill before writing chart code, and follow the existing chart conventions in
> `member-insights.tsx` — `ChartContainer` / `ChartTooltip` wrappers, `var(--chart-N)` color
> tokens, a skeleton while loading and a worded empty state.

Create `pnaa/components/members/churn-trend.tsx`, a client component gated on `useIsAdmin()` (same
audience as `MemberInsights`; plain members do not see it).

- **Controls.** A scope selector built like `member-list.tsx`'s filters: national admins get
  National / a region / a chapter; region admins get their region plus the chapters in it; chapter
  admins get nothing (one possible answer — hide the control and label the card with their chapter
  name). Plus a 12 / 24 month window toggle. Refetch on change, with the `cancelled` guard.
- **Headline.** Trailing-12-month churn: lapses over the window ÷ the base 12 months ago, as a
  percentage, with the period named beneath it. Render a dash, not a zero, when the window predates
  capture.
- **Chart.** A `LineChart` of `churnRate` by month, percent on the Y axis. Drop months whose
  `churnRate` is null rather than plotting them at zero. Put `lapsed`, `reactivated` and `base` in
  the tooltip so a spike reads as "31 of 412, 4 came back", not just a percentage.
- **Empty state.** Fewer than 2 months with a non-null `churnRate`: "Churn is measured from monthly
  snapshots that began <capture start date>. The first trend appears after two full months." Pull
  the date from the earliest `membership_base_counts` row rather than hardcoding it.

Mount `<ChurnTrend />` in `pnaa/app/(app)/members/page.tsx`, directly below `<MemberInsights />`.

**Verify**: `npm run build` exits 0. Then `npm run dev` and check each role: a national admin can
switch scope across all three levels; a region admin sees their region and its chapters and cannot
select another region; a chapter admin sees their own chapter with no selector; a plain member does
not see the card at all. On a fresh database, confirm the empty state renders rather than a flat
zero line.

### Step 5: Document it

Add `churn_trend` to the RPC list in `README.md` alongside `member_insights` and `dashboard_stats`,
with one sentence saying churn is measured forward from deploy and is not backfillable. Add the two
new tables to the data-model section.

## Test plan

No automated test framework exists — do not add one. Verification is `npx tsc --noEmit`,
`npm run lint`, `npm run build`, the SQL checks in Steps 1 and 2, and the per-role manual smoke test
in Step 4.

## Done criteria

ALL must hold:
- [ ] Migrations apply cleanly via `supabase db reset`.
- [ ] A single member status flip writes exactly one event row; a table-wide `lastSynced` touch
      writes **zero**.
- [ ] The migration's one-off `capture_active_base()` call left rows in `membership_base_counts`.
- [ ] `select public.churn_trend();` returns a JSON array; an out-of-scope request raises `42501`.
- [ ] `churnRate` is `null`, never `0`, for months with no base row.
- [ ] The chart shows its worded empty state on a fresh database, not a flat zero line.
- [ ] Each of the four roles behaves as described in Step 4's verify.
- [ ] `npx tsc --noEmit` and `npm run build` exit 0; `npm run lint` shows no new entries against the
      baseline.
- [ ] No files outside the in-scope list modified (`git status`).
- [ ] `plans/README.md` status row for 007 updated.

## STOP conditions

Stop and report (do not improvise) if:
- The trigger fires on the nightly `lastSynced` sweep (the `WHEN` clause check in Step 1 fails).
  Shipping that fills the log with ~14k rows a night.
- `pg_cron` cannot be scheduled locally — that is fine for verifying the *function*; note it and
  continue, but flag that the schedule must be confirmed on the real project by the maintainer.
- You cannot run a local Supabase. **Do NOT `supabase db push` to a linked remote project** — leave
  the migrations, mark BLOCKED with "needs maintainer to apply + verify cron", and finish the
  frontend steps, which build without the DB.
- The scope guard cannot be made to raise for an out-of-scope request. Shipping a mislabelled
  national number to a chapter admin is worse than shipping nothing.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **The chart is empty for the first two months.** Set that expectation with whoever asked for it
  before it ships, and keep the empty-state wording — it explains itself.
- **Churn here is renewal-cohort churn**, not headcount change. A month with zero lapses and zero
  joins is 0% churn even if headcount moved for other reasons. Say so if a reviewer expects the
  numbers to reconcile against `totalMembers` deltas.
- **Contacts archived in Wild Apricot never register as churn.** The full sync requests
  `$filter=Archived eq false` and `scripts/wa-utils.ts` returns `null` for them, so an archived
  member's row simply stops being updated — it keeps whatever status it had and never transitions.
  If someone is archived while Active they will inflate the base indefinitely. Fixing that means
  capturing archived contacts with a status column instead of dropping them, which touches every
  member query and belongs in its own plan.
- **Monthly cadence keeps both tables tiny** — roughly 57 chapters plus ~10 regions plus national,
  so about 70 base rows a month, and the event log only grows on real transitions. If finer
  granularity is ever wanted, change the cron expression, but weigh the growth first.
- If a future plan adds churn to the chapter detail page, call `churn_trend('chapter','<id>')`
  rather than writing a second query.
- If plan 002 lands after this, its `membership_snapshots.totalActive` duplicates
  `membership_base_counts`. Retire one rather than maintaining both.
