# Plan 005: Member self-service portal ("My PNAA")

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving on. If anything in "STOP conditions" occurs, stop and
> report — do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat ae467a2..HEAD -- pnaa/components/members/member-detail.tsx pnaa/components/layout/sidebar.tsx pnaa/types/user.ts pnaa/hooks/use-auth.ts pnaa/app/\(app\)`
> If any changed, compare the "Current state" excerpts below against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (complements 003 — if 003's certificate button exists, mount it here too)
- **Category**: direction
- **Planned at**: commit `ae467a2`, 2026-06-15

## Why this matters

The sidebar nav is **identical for every role** ([sidebar.tsx:35-40](../pnaa/components/layout/sidebar.tsx)),
so a logged-in member lands in the same admin-shaped UI as a national admin — a directory of 14k
people, chapter management, etc. — with nothing personalized. Yet `users.waContactId` already links a
user to their own `members.id` record (both are Wild Apricot contact IDs), so the data to show "your
membership status, your renewal date, your chapter, your contact hours" is already there and unused.
This plan adds a "My PNAA" landing page that surfaces a member's own information, giving the ~14,000
non-admin members a reason to log in and a natural home for self-service (e.g. downloading their own
contact-hours certificate from plan 003).

## Current state

Relevant files (read each before editing):

- `pnaa/types/user.ts` — the user type. The link to the member record:
  ```ts
  export interface AppUser {
    email: string;
    displayName: string;
    role: UserRole;
    chapterId?: string | null;
    region?: string;
    needsOnboarding?: boolean;
    createdAt: Timestamp;
    lastLogin: Timestamp;
    waContactId?: string;   // ← equals members.id for linked members
  }
  ```
  **`waContactId` is optional** — some users may not be linked (e.g. an admin created manually). The
  self-view must handle the unlinked case gracefully.
- `pnaa/hooks/use-auth.ts` — `useAuth()` returns the auth context; `const { user } = useAuth()` gives
  the `AppUser` (with `waContactId`). Other helpers: `useIsAdmin()`, `useUserChapter()`,
  `useUserRegion()`.
- `pnaa/components/members/member-detail.tsx` — **the rollup logic to reuse.** It subscribes to a
  member's attended attendee rows and computes hours. The reusable core:
  ```ts
  const q = query(
    collectionGroup("attendees"),
    where("memberId", "==", memberId),
    where("attended", "==", true)
  );
  const unsub = onSnapshot(q, async (snap) => {
    const rows = snap.docs.map((d) => ({ ...(d.data() as Attendee), id: d.id,
      eventId: d.ref.parent.parent!.id }));
    // …fetch missing event docs via .from("events").select("*").in("id", missing)…
  });
  // …then build eventRows[] and:
  const stats = useMemo(() => {
    let totalHours = 0, conferenceHours = 0, outreachHours = 0;
    for (const r of eventRows) { totalHours += r.hours;
      if (r.eventType === "conference") conferenceHours += r.hours;
      else if (r.eventType === "community_outreach") outreachHours += r.hours; }
    return { totalHours, conferenceHours, outreachHours, eventsAttended: eventRows.length };
  }, [eventRows]);
  ```
  Imports it uses: `collectionGroup, onSnapshot, query, where` from `@/lib/supabase/firestore`;
  `getSupabaseBrowser` from `@/lib/supabase/client`; `hydrateTimestamps` from
  `@/lib/supabase/timestamp`; `useDocumentOnce` from `@/hooks/use-firestore`; `useChaptersMap` from
  `@/hooks/use-chapters-map`.
- `pnaa/components/layout/sidebar.tsx` — the nav array:
  ```ts
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Events", href: "/events", icon: Calendar },
  { title: "Chapters", href: "/chapters", icon: Building2 },
  { title: "Members", href: "/members", icon: UserCircle },
  { title: "Fundraising", href: "/fundraising", icon: DollarSign },
  { title: "About", href: "/about", icon: Info },
  ```
  It is rendered identically for all roles (no role conditioning in the nav map today).
- `pnaa/hooks/use-firestore.ts` — `useDocumentOnce<Member>("members", id)` fetches a single member.
- `pnaa/lib/utils.ts` — `formatDate`, `stripChapterPrefix`, `cn`.
- `pnaa/components/shared/status-badge.tsx` — `StatusBadge` for Active/Lapsed display.

Conventions:
- Client components are `"use client"`. Use shadcn `Card`, `Badge`, `Skeleton`.
- **Do not modify the working `member-detail.tsx`** — extract its rollup into a hook and use the hook
  in the new component (member-detail can adopt the hook later; that's a deferred cleanup).

## Commands you will need

| Purpose | Command (from `pnaa/`) | Expected |
|---|---|---|
| Install | `npm install` | exit 0 |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (create or modify only these):
- `pnaa/hooks/use-member-attendance.ts` (create — extract the rollup query + stats as a reusable hook)
- `pnaa/components/members/my-membership.tsx` (create — the member-facing self-view)
- `pnaa/app/(app)/me/page.tsx` (create — the "My PNAA" page)
- `pnaa/components/layout/sidebar.tsx` (modify — add a "My PNAA" nav item)

**Out of scope** (do NOT touch):
- `pnaa/components/members/member-detail.tsx` — leave it working as-is; do not refactor it to use the
  new hook in this plan (deferred cleanup, see Maintenance notes).
- Any schema / RLS / RPC change — `members` is already client-readable (RLS `members_read` =
  `using (true)`); no DB work is needed.
- Editing membership data — this is a **read-only** self-view (members can't change their own
  chapter/role; that's enforced server-side and out of scope).

## Git workflow

- Branch: `advisor/005-member-self-service`.
- Commit per logical unit (hook, then component+page, then nav). Short imperative messages matching
  `git log`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Extract the attendance rollup into a reusable hook

Create `pnaa/hooks/use-member-attendance.ts` exporting:
```ts
export function useMemberAttendance(memberId: string | undefined): {
  eventRows: AttendedEventRow[];
  stats: { totalHours: number; conferenceHours: number; outreachHours: number; eventsAttended: number };
  loading: boolean;
}
```
Move the `collectionGroup("attendees")` subscription + missing-event fetch + `eventRows` mapping +
`stats` computation from `member-detail.tsx` into this hook **by copying the logic** (do not delete it
from `member-detail.tsx`). Guard against `memberId` being undefined (return empty + `loading: false`).
Use the same imports member-detail uses. Export the `AttendedEventRow` interface from the hook (it's
currently a local interface in member-detail; redeclare it in the hook file).

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Build the "My Membership" self-view component

Create `pnaa/components/members/my-membership.tsx` — a `"use client"` component:
- `const { user } = useAuth();` then `const memberId = user?.waContactId;`
- If `!memberId`: render a friendly card — "We couldn't find a membership record linked to your
  account. If you believe this is an error, contact your chapter administrator." (Do NOT error.)
- Otherwise: `const { data: member, loading } = useDocumentOnce<Member>("members", memberId);` and
  `const { stats, eventRows, loading: hoursLoading } = useMemberAttendance(memberId);`
- Render a header greeting ("Welcome, {member.name}"), a status card (`StatusBadge` for
  Active/Lapsed, renewal due date via `formatDate(member.renewalDueDate)`, chapter name via
  `useChaptersMap().nameFor(member.chapterId)`), and a hours summary (total / conference / outreach
  from `stats`, events attended count).
- Below, a simple list/table of `eventRows` (event name, date, hours). You may reuse the same
  `AdvancedDataTable` columns member-detail builds, or a plainer list — keep it readable.
- If plan 003 has landed (check whether `pnaa/components/members/certificate-button.tsx` exists),
  also render `<CertificateButton>` here passing `member`, `eventRows` mapped to its `CertificateRow`,
  and the `stats` hours — so a member can self-download their certificate. If 003 has not landed, skip
  it (do not create that component here).

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Add the `/me` page and the nav entry

Create `pnaa/app/(app)/me/page.tsx` rendering `<MyMembership />` inside the standard page wrapper
(look at a sibling page like `pnaa/app/(app)/members/page.tsx` for the `PageHeader` + layout
convention). Title it "My PNAA".

Modify `pnaa/components/layout/sidebar.tsx`: add `{ title: "My PNAA", href: "/me", icon: UserCircle2 }`
near the top of the nav array (import `UserCircle2` from `lucide-react`, or reuse an existing icon if
`UserCircle2` isn't available). Show it to **everyone** (members and admins alike — admins benefit
from seeing their own record too). If another plan (001 or 006) has already added role-conditioning to
the nav, keep this item unconditional.

**Verify**: `npm run build` → exit 0. Manually: `npm run dev`, sign in as a user whose `waContactId`
matches a real member row → `/me` shows that member's status, renewal date, chapter, and hours, and
the totals match what the admin `/members/[memberId]` page shows for the same person. Sign in (or
simulate) a user with no `waContactId` → the friendly "no linked membership" card renders, no crash.

## Test plan

No automated test framework exists — do not add one. Verification is `npx tsc --noEmit`,
`npm run lint`, `npm run build`, and the manual smoke tests in Step 3 (linked user shows correct
data; unlinked user shows graceful empty state).

## Done criteria

ALL must hold:
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` all exit 0.
- [ ] `/me` renders a personalized membership view for a user linked via `waContactId`, with hours
      totals matching the admin member-detail page for the same member.
- [ ] A user with no `waContactId` sees a friendly "no linked membership" message, not an error.
- [ ] "My PNAA" appears in the sidebar for all roles.
- [ ] `member-detail.tsx` is unchanged (`git diff --stat` shows it untouched).
- [ ] No files outside the in-scope list modified (`git status`).
- [ ] `plans/README.md` status row for 005 updated.

## STOP conditions

Stop and report back (do not improvise) if:
- The `member-detail.tsx` rollup excerpt or the `AppUser.waContactId` field no longer matches the
  live code.
- `useDocumentOnce` / `useMemberAttendance` data for a linked member comes back empty when the admin
  page shows data for the same member (the linkage assumption `users.waContactId === members.id` is
  wrong — report it; do not guess an alternative join key).
- A verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Deferred cleanup**: once this hook is proven, `member-detail.tsx` should be switched to consume
  `useMemberAttendance` too, removing the duplicated rollup. Left out of this plan to avoid touching
  the working admin page.
- This page is the natural home for future member self-service: event registration history, updating
  contact preferences (ties into plan 004's `emailOptOut`), and self-download of certificates
  (plan 003). Keep it the single "about me" surface rather than scattering personal views.
- Reviewer should confirm the unlinked-user path never throws and that the view is strictly read-only
  (no write controls leak in).
