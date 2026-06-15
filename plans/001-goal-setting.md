# Plan 001: Goal-setting & progress-to-target for fundraising and membership

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ae467a2..HEAD -- pnaa/types/fundraising.ts pnaa/types/chapter.ts pnaa/components/dashboard pnaa/app/\(app\)/dashboard supabase/migrations`
> If any of those changed since this plan was written, compare the "Current state" excerpts below
> against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ae467a2`, 2026-06-15

## Why this matters

PNAA's board and chapters set annual fundraising goals and membership-growth targets, but the app
has **no concept of a goal anywhere** — `types/fundraising.ts` and `types/chapter.ts` store raw
running totals only, and the dashboard's fundraising widget lists recent campaigns without comparing
them to any target. Adding goals turns raw numbers into accountability: "$42k of $75k (56%)" instead
of "$42k". This is the lowest-risk, highest-clarity win of the roadmap and establishes the
new-table + new-RPC + dashboard-widget pattern the later plans reuse.

## Current state

Relevant files (read each before editing):

- `pnaa/types/fundraising.ts` — fundraising campaign type. No goal field. Full contents today:
  ```ts
  export interface FundraisingCampaign {
    fundraiserName: string;
    /** FK to chapters.id — null for national campaigns. */
    chapterId: string | null;
    subchapterId?: string;
    date: string;
    amount: number;
    note: string;
    archived: boolean;
    lastUpdated: Timestamp;
    lastUpdatedUser: string;
    creationDate: Timestamp;
  }
  ```
- `pnaa/types/chapter.ts` — chapter type, raw totals only (`totalMembers`, `totalActive`,
  `totalLapsed`). No target field.
- `pnaa/app/(app)/dashboard/page.tsx` — dashboard composition. Imports widgets from
  `@/components/dashboard/*` and renders them. Uses `useDashboardStats()`, `useChaptersMap()`,
  `useAuth()` + role hooks (`useIsNationalAdmin`, `useIsRegionAdmin`, `useIsAdmin`,
  `useUserChapter`, `useUserRegion`).
- `pnaa/components/dashboard/recent-fundraising.tsx` — exemplar dashboard widget (a `Card` with a
  `CardHeader`/`CardTitle` + "View all" link, maps rows). **Match this component's shape and styling
  for the new widget.**
- `supabase/migrations/20260520000003_member_insights.sql` — exemplar **RPC** migration. Note the
  conventions: `create or replace function public.<name>() returns jsonb language plpgsql stable`,
  role guard at the top using `public.is_national_admin()` / `public.auth_role()`, `jsonb_build_object`
  + `coalesce(jsonb_agg(...), '[]'::jsonb)`, and a closing
  `grant execute on function public.<name>() to authenticated;`.
- `supabase/migrations/20260515000003_rls.sql` — exemplar **RLS** migration. Conventions:
  ```sql
  create policy fund_read    on public.fundraising for select to authenticated using (true);
  create policy fund_create  on public.fundraising for insert to authenticated with check (public.is_admin());
  create policy fund_update  on public.fundraising for update to authenticated using (public.is_admin());
  ```
  Available SQL role helpers (defined in earlier migrations, safe to call): `public.auth_role()`,
  `public.is_admin()`, `public.is_national_admin()`, `public.is_region_admin()`,
  `public.auth_chapter_id()`, `public.auth_region()`.
- `pnaa/lib/supabase/firestore.ts` — the Firestore-style shim. `addDocument(collection, data)` and
  `updateDocument(collection, id, data)` write through `tableFor()`, which falls through to the
  identity for unknown names (`TABLE_BY_COLLECTION[collection] ?? collection`), so a new collection
  name `"goals"` resolves to table `goals` **with no registration needed**.
- `pnaa/components/fundraising/campaign-form.tsx` — exemplar form (React Hook Form + Zod +
  shadcn `Form*` components + `addDocument`/`updateDocument` + `toast` from `sonner`). **Match this
  for the goal form.**
- `pnaa/lib/utils.ts` — exports `formatCurrency`, `formatDate`, `stripChapterPrefix`, `cn`.

Conventions to follow:
- New SQL goes in a new migration file, never by editing an existing one.
- Frontend data reads go through `supabase.rpc(...)` for aggregates (see how `member-insights.tsx`
  calls `supabase.rpc("member_insights")`) or through the `addDocument`/`updateDocument` shim for
  writes.
- Column names in this DB are **quoted camelCase** (e.g. `"chapterId"`, `"totalActive"`). Match it.

## Commands you will need

| Purpose | Command (run from `pnaa/` unless noted) | Expected on success |
|---|---|---|
| Install | `npm install` | exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 (compiles + typechecks) |
| Local DB (repo root) | `supabase start` then `supabase db reset` | migrations apply cleanly, no SQL error |

## Scope

**In scope** (create or modify only these):
- `supabase/migrations/<next-timestamp>_goals.sql` (create — table + RLS + `goal_progress()` RPC)
- `pnaa/types/goal.ts` (create)
- `pnaa/types/index.ts` (modify — add the barrel export for the new type)
- `pnaa/components/dashboard/goal-progress.tsx` (create — dashboard widget)
- `pnaa/app/(app)/dashboard/page.tsx` (modify — render the new widget)
- `pnaa/components/goals/goal-form.tsx` (create — admin create/edit form)
- `pnaa/components/goals/goal-list.tsx` (create — admin management list)
- `pnaa/app/(app)/goals/page.tsx` (create — admin goals management page)
- `pnaa/components/layout/sidebar.tsx` (modify — add a "Goals" nav item, admin-gated)

**Out of scope** (do NOT touch):
- `pnaa/types/fundraising.ts` and `pnaa/types/chapter.ts` — goals live in their own table; do NOT
  add goal columns to campaigns or chapters.
- The nightly `update_member_status()` job and `dashboard_stats()` RPC — do not modify them.
- Any RLS helper function (`is_admin`, `auth_role`, etc.) — call them, never redefine them.
- Subchapter-level goals — out of scope for this iteration (see Maintenance notes).

## Git workflow

- Branch: `advisor/001-goal-setting`.
- Commit per logical unit (migration, then types, then widget, then management UI). Repo commit
  messages are short and imperative (`git log` shows "Designed dashboard better", "Add filtering and
  sorting to the members table"). Match that style.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Create the `goals` table + RLS + progress RPC migration

Pick the next migration filename: list `supabase/migrations/`, take the highest `YYYYMMDDNNNNNN`
prefix, and use a strictly greater one (e.g. `20260616000001_goals.sql`). Create that file with:

A `goals` table:
- `id uuid primary key default gen_random_uuid()`
- `type text not null check (type in ('fundraising','membership'))`
- `scope text not null check (scope in ('national','region','chapter'))`
- `"chapterId" text references public.chapters(id)` — non-null only when `scope = 'chapter'`
- `region text` — non-null only when `scope = 'region'`
- `label text not null`
- `"targetAmount" numeric not null check ("targetAmount" >= 0)` — dollars for fundraising,
  member count for membership
- `"periodStart" date not null`
- `"periodEnd" date not null`
- `archived boolean not null default false`
- `"createdBy" uuid` , `"createdAt" timestamptz not null default now()`,
  `"lastUpdated" timestamptz not null default now()`
- a CHECK enforcing scope/column coherence:
  `check ((scope = 'chapter' and "chapterId" is not null) or (scope = 'region' and region is not null) or (scope = 'national'))`

Enable RLS and add policies (read = everyone authenticated; write = admins, scope-restricted):
```sql
alter table public.goals enable row level security;

create policy goals_read on public.goals
  for select to authenticated using (true);

create policy goals_write on public.goals
  for all to authenticated
  using (
    public.is_national_admin()
    or (public.is_region_admin()  and scope = 'region'  and region = public.auth_region())
    or (public.auth_role() = 'chapter_admin' and scope = 'chapter' and "chapterId" = public.auth_chapter_id())
  )
  with check (
    public.is_national_admin()
    or (public.is_region_admin()  and scope = 'region'  and region = public.auth_region())
    or (public.auth_role() = 'chapter_admin' and scope = 'chapter' and "chapterId" = public.auth_chapter_id())
  );
```

A `goal_progress()` RPC returning each non-archived goal with its computed actual. Follow the
`member_insights` structure (plpgsql, stable, `jsonb_agg` + `coalesce`, trailing grant). For each goal:
- **fundraising** actual = `sum(fundraising.amount)` where `archived = false`, `date` (text ISO) is
  between `periodStart` and `periodEnd`, AND scope matches: national = all rows; region = rows whose
  chapter's region equals the goal's region (join `chapters`); chapter = rows where
  `fundraising."chapterId" = goal."chapterId"`.
- **membership** actual = count of `members` with `activeStatus = 'Active'` matching scope: national =
  all; region = `members.region = goal.region`; chapter = `members."chapterId" = goal."chapterId"`.

Return a JSON array of objects: `{ id, type, scope, chapterId, region, label, target, actual, periodStart, periodEnd }`.
Grant execute to `authenticated`. (Reads are not role-gated — every authenticated user may see
goal progress; this matches `fund_read`/`members_read` being open.)

**Verify**: from repo root, `supabase start` (if not already running) then `supabase db reset` →
all migrations apply with no error; the final lines mention applying your new migration.
If you cannot run a local Supabase, see STOP conditions — do **not** push to a remote project.

### Step 2: Add the `Goal` type

Create `pnaa/types/goal.ts` mirroring the table (camelCase fields, `targetAmount: number`,
`periodStart`/`periodEnd` as `string`). Add a progress-row interface too:
```ts
export interface Goal {
  type: "fundraising" | "membership";
  scope: "national" | "region" | "chapter";
  chapterId: string | null;
  region: string | null;
  label: string;
  targetAmount: number;
  periodStart: string;
  periodEnd: string;
  archived: boolean;
  createdBy?: string;
}
export interface GoalProgress {
  id: string;
  type: Goal["type"];
  scope: Goal["scope"];
  chapterId: string | null;
  region: string | null;
  label: string;
  target: number;
  actual: number;
  periodStart: string;
  periodEnd: string;
}
```
Add `export * from "./goal";` (or the matching named exports) to `pnaa/types/index.ts`, following
how the other types are re-exported there.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Build the dashboard goal-progress widget

Create `pnaa/components/dashboard/goal-progress.tsx` — a client component that calls
`supabase.rpc("goal_progress")` (use the exact fetch pattern from `member-insights.tsx`: guard on
`authLoading`, `cancelled` flag, `console.error` on failure). Render a `Card` matching
`recent-fundraising.tsx`'s shape. For each goal show: label, a progress bar
(`actual / target`, clamp at 100%), and `formatCurrency(actual)` of `formatCurrency(target)` for
fundraising goals, or `actual / target members` for membership goals. If the RPC returns an empty
array, render an empty state like `recent-fundraising.tsx` does ("No goals set yet"). Use the shadcn
`Progress` component if present in `pnaa/components/ui/`; if not, render a simple
`<div>` bar with a width style (do not add a new dependency).

Then modify `pnaa/app/(app)/dashboard/page.tsx` to import and render `<GoalProgress />` in the
widget grid alongside `<RecentFundraising>`.

**Verify**: `npm run build` → exit 0. Manually: `npm run dev`, sign in, load `/dashboard` — the
widget renders (empty state is fine since no goals exist yet).

### Step 4: Build the admin goals management UI

Create:
- `pnaa/components/goals/goal-form.tsx` — RHF + Zod create/edit form modeled on
  `campaign-form.tsx`. Fields: `label`, `type` (Select), `scope` (Select), conditional `chapterId`
  (Select from `useChaptersMap().canonical` when scope=chapter) or `region` (Select when
  scope=region), `targetAmount` (number), `periodStart`/`periodEnd` (date inputs). On submit call
  `addDocument("goals", {...})` (create) or `updateDocument("goals", id, {...})` (edit), then
  `toast.success(...)` and `router.push("/goals")`. Set `createdBy: user?.id` on create.
- `pnaa/components/goals/goal-list.tsx` — lists goals (use `useCollection<Goal>("goals")` from
  `@/hooks/use-firestore`, same as other list components) with edit/archive actions. Archive via
  `updateDocument("goals", id, { archived: true })`.
- `pnaa/app/(app)/goals/page.tsx` — page that renders the list + a "New Goal" button. Gate the whole
  page to admins: if `!useIsAdmin()` render a "not authorized" message (match how other admin-only
  pages guard, e.g. look at `pnaa/app/(app)/users/page.tsx`).

Modify `pnaa/components/layout/sidebar.tsx`: add a `{ title: "Goals", href: "/goals", icon: Target }`
item to the nav array (import `Target` from `lucide-react`). If the nav array currently renders the
same items for all roles, gate the Goals item so only admins see it — check whether the sidebar
already has any role conditioning; if it does not, render the Goals link conditionally on
`useIsAdmin()`. (Members can still see goal *progress* on the dashboard; only goal *management* is
admin-only.)

**Verify**: `npm run build` → exit 0. Manually as a national admin: create a fundraising goal scoped
national for the current year; reload `/dashboard` and confirm the goal-progress widget now shows it
with the correct actual (compare against the total of this year's fundraising rows).

## Test plan

No automated test framework exists in this repo — do not add one. Verification is:
- `npx tsc --noEmit` and `npm run lint` pass.
- `npm run build` passes.
- Manual smoke tests embedded in Steps 1, 3, and 4 above.

## Done criteria

ALL must hold:
- [ ] New migration file exists under `supabase/migrations/` and `supabase db reset` applies it
      cleanly on a local Supabase.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npm run lint` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `/goals` page renders for admins and is blocked for members.
- [ ] Dashboard shows a goal-progress widget; with a national fundraising goal created, the
      displayed actual equals the sum of this year's non-archived fundraising amounts.
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for 001 updated.

## STOP conditions

Stop and report back (do not improvise) if:
- The "Current state" excerpts for `types/fundraising.ts`, `types/chapter.ts`, or the dashboard page
  no longer match the live code.
- You cannot run a local Supabase to validate the migration. **Do NOT run `supabase db push` against
  a linked remote project** — that writes to the user's production or staging database. Instead,
  leave the migration file in place, mark this step BLOCKED in the index with reason "needs maintainer
  to apply migration", and continue with the frontend steps (they typecheck/build without the DB).
- The sidebar turns out to already have a goals concept or a conflicting `/goals` route.
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this next:
- **Subchapter-scoped goals** were deliberately deferred. If added later, extend the `scope` CHECK,
  the RLS policy, and the `goal_progress()` joins to handle `subchapterId`.
- **Goal period semantics**: this uses explicit `periodStart`/`periodEnd` dates, not fiscal-year
  enums. If the org standardizes on a fiscal year, consider a helper to default the date range.
- The fundraising actual joins on `fundraising.date` being a valid ISO string. Rows with malformed
  `date` text silently fall outside every range — same fragility the existing `dashboard_stats()` and
  `member_insights()` RPCs already have with `renewalDueDate`. Acceptable, but note it in review.
- **Reviewer should scrutinize the `goals_write` RLS policy** — the scope-restriction
  (region admins limited to their region, chapter admins to their chapter) is the security-relevant
  part. Confirm a chapter admin cannot create a national goal by tampering with the request body.
