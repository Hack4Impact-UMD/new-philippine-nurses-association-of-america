# Plan 006: Admin audit log

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and
> report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ae467a2..HEAD -- pnaa/app/api/users pnaa/app/api/sync pnaa/lib/supabase/server.ts pnaa/components/layout/sidebar.tsx supabase/migrations`
> If any changed, compare the "Current state" excerpts below against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ae467a2`, 2026-06-15

## Why this matters

This is a multi-admin system handling sensitive actions — national admins change other users' roles
and chapter assignments, and revenue figures are gated behind those roles — yet there is **no record
of who did what.** Only `sync_logs` exists (it logs sync runs, not user actions). If a member is
wrongly promoted to admin, or a role is changed unexpectedly, there is no trail. This plan adds a
minimal, extensible `audit_log` that starts by capturing the **highest-value, server-routed actions**:
role/chapter/region changes and manual sync triggers. It deliberately does NOT try to instrument every
write — it lays the table + helper + viewer so coverage can grow.

## Current state

Relevant files (read each before editing):

- `pnaa/app/api/users/[userId]/route.ts` — the **single funnel for permission changes** (national-admin
  only). It updates `users` + `auth.users.app_metadata` and calls `revoke_user_sessions` when claims
  change. Key parts:
  ```ts
  const { uid: callerUid, role: callerRole } = await getCaller();
  // …national_admin gate…
  const { role, chapterId, region } = body as {...};
  const admin = supabaseAdmin();
  await admin.from("users").update({ role, chapterId: chapterId ?? null, region: region ?? null }).eq("id", userId);
  // …updateUserById app_metadata…
  const claimsChanged = prevMeta.user_role !== role || … ;
  if (claimsChanged) { await admin.rpc("revoke_user_sessions", { p_user_id: userId }); }
  ```
  `getCaller()` returns `{ uid, role }`. This is the natural place to record "who changed whose role
  to what."
- `pnaa/app/api/sync/trigger/route.ts` — national-admin-only sync trigger. **It already demonstrates
  the audit pattern**, inserting into `sync_logs` with the actor:
  ```ts
  const { uid, role } = await getCaller();
  // …national_admin gate…
  const admin = supabaseAdmin();
  await admin.from("sync_logs").insert({ type, status: "triggered", triggeredBy: uid });
  ```
- `pnaa/lib/supabase/server.ts` — exports `supabaseAdmin()` (service-role client, bypasses RLS — used
  for privileged inserts) and `getCaller()` (`{ uid, role }`). The audit helper goes here.
- `supabase/migrations/20260520000003_member_insights.sql` — exemplar RPC migration (read RPC with a
  role guard + trailing `grant execute … to authenticated`). Use for the audit-list RPC.
- `supabase/migrations/20260515000003_rls.sql` — exemplar RLS. The national-admin-only read precedent:
  `create policy synclogs_read on public.sync_logs for select to authenticated using (public.is_national_admin());`
  Role helpers available: `public.is_national_admin()`, `public.auth_role()`.
- `pnaa/components/layout/sidebar.tsx` — nav array (see plan 001/005 excerpt); identical for all roles
  today.
- `pnaa/app/(app)/users/page.tsx` — exemplar national-admin-only page (look at how it guards access);
  the audit page should guard the same way.

Conventions:
- Privileged server inserts use `supabaseAdmin()` from API routes.
- New SQL = new migration file. Quoted camelCase columns.
- National-admin-only reads use `using (public.is_national_admin())`.

## Commands you will need

| Purpose | Command (from `pnaa/` unless noted) | Expected |
|---|---|---|
| Install | `npm install` | exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Local DB (repo root) | `supabase start` + `supabase db reset` | applies cleanly |

## Scope

**In scope** (create or modify only these):
- `supabase/migrations/<next-timestamp>_audit_log.sql` (create — table + RLS + `audit_log_recent()` RPC)
- `pnaa/types/audit.ts` (create)
- `pnaa/types/index.ts` (modify — barrel export)
- `pnaa/lib/supabase/server.ts` (modify — add a `logAudit(...)` helper)
- `pnaa/app/api/users/[userId]/route.ts` (modify — log role/chapter/region changes)
- `pnaa/app/api/sync/trigger/route.ts` (modify — log manual sync triggers)
- `pnaa/components/audit/audit-list.tsx` (create — the viewer table)
- `pnaa/app/(app)/audit/page.tsx` (create — national-admin-only page)
- `pnaa/components/layout/sidebar.tsx` (modify — add an "Audit Log" nav item, national-admin-only)

**Out of scope** (do NOT touch):
- Event / fundraising / subchapter write paths and their RPCs — instrumenting those is a deferred
  follow-up (see Maintenance notes). Do not add audit calls scattered across client components.
- `sync_logs` — leave it; the audit log is additive, not a replacement.
- Any change to `getCaller()`'s return shape, `revoke_user_sessions`, or the auth flow.

## Git workflow

- Branch: `advisor/006-admin-audit-log`.
- Commit per logical unit (migration, helper, route instrumentation, viewer). Short imperative
  messages matching `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create the `audit_log` table + RLS + read RPC migration

New migration `supabase/migrations/<next-timestamp>_audit_log.sql` (timestamp strictly greater than
the highest existing):
```sql
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  "actorId" uuid,                    -- auth.users.id of who did it (null = system)
  action text not null,              -- e.g. 'user.role_changed', 'sync.triggered'
  "targetTable" text,                -- e.g. 'users'
  "targetId" text,                   -- e.g. the affected user id
  summary jsonb,                     -- structured before/after, no secrets
  "createdAt" timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log ("createdAt" desc);

alter table public.audit_log enable row level security;
-- National-admin read only (matches synclogs_read). No client write policy:
-- entries are inserted by the service-role client from API routes, which
-- bypasses RLS. RLS denies all client writes by default.
create policy auditlog_read on public.audit_log
  for select to authenticated using (public.is_national_admin());
```
Add an `audit_log_recent(p_limit int default 200)` read RPC (plpgsql, stable) that raises if the
caller isn't a national_admin (mirror `member_insights`'s guard), then returns the most recent
`p_limit` rows joined to `users` to resolve the actor's email/displayName, as a jsonb array of
`{ id, action, targetTable, targetId, summary, createdAt, actorEmail, actorName }`. Grant execute to
`authenticated`.

**Verify (local Supabase, repo root)**: `supabase db reset` applies cleanly; `select
public.audit_log_recent();` runs (returns `[]` initially, or raises the national-admin error if your
local session isn't a national admin — both acceptable, no SQL syntax error).

### Step 2: Add the `logAudit` server helper

In `pnaa/lib/supabase/server.ts`, add:
```ts
export async function logAudit(entry: {
  actorId: string | null;
  action: string;
  targetTable?: string;
  targetId?: string;
  summary?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin().from("audit_log").insert({
      actorId: entry.actorId,
      action: entry.action,
      targetTable: entry.targetTable ?? null,
      targetId: entry.targetId ?? null,
      summary: entry.summary ?? null,
    });
  } catch (err) {
    // Audit logging must never break the action it records.
    console.error("logAudit failed:", err);
  }
}
```
**The helper must never throw** — a failed audit write must not break the underlying operation
(matches the route's existing defensive pattern where a failed `revoke_user_sessions` only logs).
Never put secrets (tokens, keys) in `summary` — only role/chapter/region values.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Instrument the two server routes

In `pnaa/app/api/users/[userId]/route.ts`, after the successful `users` update + claims update (just
before returning success), call:
```ts
await logAudit({
  actorId: callerUid,
  action: "user.role_changed",
  targetTable: "users",
  targetId: userId,
  summary: { role, chapterId: chapterId ?? null, region: region ?? null, claimsChanged },
});
```
(Place it where `callerUid`, `role`, `chapterId`, `region`, `claimsChanged` are all in scope.)

In `pnaa/app/api/sync/trigger/route.ts`, after the `sync_logs` insert, call:
```ts
await logAudit({ actorId: uid, action: "sync.triggered", summary: { type } });
```
Import `logAudit` alongside the existing `supabaseAdmin, getCaller` import.

**Verify**: `npm run build` → exit 0. Manually (needs local Supabase + the migration applied): sign in
as a national admin, change a user's role on `/users`, then query `select action, "targetId", summary
from public.audit_log order by "createdAt" desc limit 5;` → a `user.role_changed` row exists with the
correct target and role.

### Step 4: Build the audit viewer page

Create:
- `pnaa/types/audit.ts` — `AuditEntry` interface matching the RPC output (`id, action, targetTable,
  targetId, summary, createdAt, actorEmail, actorName`). Add the barrel export to `types/index.ts`.
- `pnaa/components/audit/audit-list.tsx` — a `"use client"` component calling
  `supabase.rpc("audit_log_recent")` (copy the `authLoading`/`cancelled`/`console.error` fetch pattern
  from `pnaa/components/members/member-insights.tsx`). Render the entries in a table (Time via
  `formatDate`/`formatDateTime`, Actor = `actorName`/`actorEmail`, Action, Target, and a readable
  rendering of `summary`). Use `AdvancedDataTable` (see how member-detail uses it) or a plain table.
- `pnaa/app/(app)/audit/page.tsx` — national-admin-only page rendering `<AuditList />`. Guard with
  `useIsNationalAdmin()`; if false, render a "not authorized" message (match `users/page.tsx`).

Modify `pnaa/components/layout/sidebar.tsx`: add `{ title: "Audit Log", href: "/audit", icon: ScrollText }`
(import `ScrollText` from `lucide-react`), shown **only to national admins** — gate it on
`useIsNationalAdmin()`. If the nav array has no role conditioning yet, add minimal conditioning for
this one item (filter the rendered items, or render it separately).

**Verify**: `npm run build` → exit 0. Manually: as a national admin, `/audit` lists the entries
created in Step 3; as a non-national-admin, the page is blocked and the nav item is hidden.

## Test plan

No automated test framework exists — do not add one. Verification is `npx tsc --noEmit`,
`npm run lint`, `npm run build`, the SQL checks in Steps 1 & 3, and the manual smoke test in Step 4.

## Done criteria

ALL must hold:
- [ ] Migration applies cleanly via `supabase db reset` on a local Supabase.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` all exit 0.
- [ ] Changing a user's role writes a `user.role_changed` audit row; triggering a sync writes a
      `sync.triggered` row.
- [ ] `logAudit` swallows its own errors (a forced insert failure does NOT break the role change —
      confirm by reading the code: the insert is wrapped in try/catch).
- [ ] `/audit` renders for national admins and is blocked + hidden for everyone else.
- [ ] No secret values appear in any `summary` payload (review the instrumented routes).
- [ ] No files outside the in-scope list modified (`git status`).
- [ ] `plans/README.md` status row for 006 updated.

## STOP conditions

Stop and report back (do not improvise) if:
- The `users/[userId]/route.ts` or `sync/trigger/route.ts` excerpts no longer match the live code.
- You cannot run a local Supabase. **Do NOT `supabase db push` to a linked remote project** — leave
  the migration, mark BLOCKED with reason "needs maintainer to apply migration", and finish the code
  changes that build without the DB (helper + route instrumentation + viewer typecheck).
- Adding the audit call appears to require changing `getCaller()` or the auth flow (it should not).
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Coverage is intentionally minimal**: role changes + sync triggers. The next increments are event
  hour edits, fundraising create/edit, and bulk uploads. Prefer extending coverage at the **RPC /
  server-route layer** (where the actor is reliably known via `getCaller()` or `auth.uid()`) rather
  than from client components, which can be bypassed. Event mutations already go through RPCs that
  call `assert_can_write_event` — that's the right hook point for event auditing later.
- **Retention**: the table grows unbounded. When it gets large, add a pg_cron job to prune entries
  older than N months (model it on `update_member_status`'s schedule).
- Reviewer should scrutinize: (a) `logAudit` cannot throw, (b) no secrets in `summary`, (c) the
  national-admin-only read is enforced both by RLS and the RPC guard.
