# Philippine Nurses Association of America — Chapter Management System

A full-stack web application for managing PNAA's 55+ chapters, 14,000+ members, events, and fundraising campaigns. Built with Next.js and Supabase, integrated with Wild Apricot for membership data.

> **Migration note (May 2026):** Moved off Firebase (Auth, Firestore, Storage, Cloud Functions) onto **Supabase** (Auth, Postgres, Edge Functions). At the same time the schema was **normalized** — every chapter reference is now a real foreign key (`chapterId`) rather than a duplicated chapter-name string. The event-poster upload feature was dropped, so Supabase Storage is not in scope. The migration is complete; the full state lives in the versioned SQL under [supabase/migrations/](supabase/migrations/).
>
> **First-user bootstrap:** new sign-ins land with role `member`. There is no in-app self-promotion path, so the very first `national_admin` must be set by hand. Run this once in the Supabase SQL editor, then sign out and back in for a fresh JWT — after that the in-app `/users` page can promote everyone else:
>
> ```sql
> update public.users set role = 'national_admin' where email = 'you@example.com';
> update auth.users
> set raw_app_meta_data =
>       coalesce(raw_app_meta_data, '{}'::jsonb)
>       || jsonb_build_object('user_role', 'national_admin')
> where email = 'you@example.com';
> ```

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Authentication Flow](#authentication-flow)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Staging Environment](#staging-environment)
- [Getting Started](#getting-started)
- [Supabase Edge Functions & Sync Jobs](#supabase-edge-functions--sync-jobs)
- [Roles & Permissions](#roles--permissions)
- [Event Types & Hours Tracking](#event-types--hours-tracking)
- [Bulk CSV Upload](#bulk-csv-upload)
- [Read/Write Optimization](#readwrite-optimization)
- [Data Models](#data-models)

---

## Features

- **Dashboard** — Real-time stats (total/active/lapsed members, chapters, upcoming events, total fundraised) plus chapter-list, fundraising-progress, and upcoming-events widgets
- **Chapter Management** — Browse all chapters, view chapter-level member breakdowns and activity charts; chapter aliases merge stats from alternative Wild Apricot names
- **Event Management** — Create, edit, and view events with type/subtype (Conference: In Person / Webinar; Community Outreach: Medical Mission / Health Screening / Volunteerism). Per-event attendee subcollection mixes Wild Apricot registrations with manually-added attendees. Admins toggle attendance and edit per-attendee hours; conferences apply a uniform `defaultHours` to all attended attendees, community outreach prefills it but lets admins override per person. Revenue figures and attendee payment amounts are gated to national admins.
- **Member Directory** — Paginated `/members` listing with case-insensitive substring search (Postgres `ILIKE`) and an "Active only" toggle. Per-member detail page shows total hours, events attended, and a breakdown of conference vs. community outreach hours, with a table of every event the member was marked attended on.
- **Fundraising** — Track fundraising campaigns with amounts, notes, chapter and optional subchapter attribution; campaign trend chart on detail pages
- **Subchapters** — Create subchapters within chapters, assign members, soft-delete support; events and fundraising can be tagged to a subchapter
- **Member Sync** — Wild Apricot membership sync via real-time webhooks (Contact / Membership / MembershipRenewed / Event / EventRegistration). Manual full-sync HTTP endpoints (`syncMembers` is diff-aware — skips writes for unchanged docs) plus a daily 2 AM ET scheduled status recalculation (`updateMembers`) that only touches expired-renewal rows.
- **First-Time Onboarding** — New users select their region and chapter on first sign-in; this can only be changed later by a national admin via the user management page
- **Role-Based Access** — National admins see all data; region admins manage their region; chapter admins manage their chapter; members have read-only access
- **User Management** — National admins can view all users and update roles, regions, and chapter assignments
- **Advanced Data Tables** — Chapters, Events, and Fundraising pages feature a rich table view with sortable, resizable, and drag-to-reorder columns; per-column filters; column visibility toggles; and pagination. Switchable to a card grid via a pill toggle.
- **Excel Export** — Tabular data exports to `.xlsx` via ExcelJS for offline analysis
- **Bulk CSV Upload** — Admins can import spreadsheets instead of clicking row-by-row: event attendance (matched to members by email then name), fundraising campaigns, event creation, and sub-event attendance (national conferences). A shared dialog parses the CSV, classifies each row (ready / needs-resolution / skipped), lets the admin resolve conflicts inline (ambiguous names, unknown chapters, lapsed members), then applies. See [Bulk Upload](#bulk-csv-upload).
- **Charts & Insights** — Recharts-powered visualizations for chapter activity, event attendance, and fundraising progress, plus dedicated insights panels: chapter insights, fundraising insights, and a Members insights dashboard (region health, membership-level retention, education mix, and a 24-month renewal-cliff projection) served as a single JSON blob by the `member_insights()` RPC rather than shipping all ~14k rows to the client. The fundraising and Members insights panels are visible to **chapter admins and above** (members see the plain lists); the aggregates span every chapter.
- **Responsive UI** — Mobile-friendly with sidebar navigation and dark mode support

---

## Tech Stack

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| Next.js | 16.1.6 | React framework (App Router) |
| React | 19.2.3 | UI library |
| TypeScript | 5 | Type safety |
| Tailwind CSS | 4 | Utility-first styling |
| shadcn/ui | — | Radix UI component library |
| TanStack Table | 8 | Headless table logic (sort, filter, resize, pagination, column order) |
| dnd-kit | — | Drag-and-drop for column reordering |
| React Hook Form | 7.71.2 | Form state management |
| Zod | 4.3.6 | Schema validation |
| date-fns | 4.1.0 | Date utilities |
| react-day-picker | 9 | Calendar / date picker UI |
| Recharts | 3 | Chart rendering (chapter activity, event attendance, fundraising) |
| ExcelJS | 4 | Excel (`.xlsx`) export of table data |
| Lucide React | — | Icons |
| Sonner | — | Toast notifications |
| next-themes | — | Dark mode |

### Backend & Infrastructure
| Technology | Purpose |
|---|---|
| Supabase Auth (GoTrue) | Authentication via JWT cookies set by `/api/auth/callback` after the Wild Apricot OAuth handshake |
| Supabase Postgres | Primary relational database (`public.*` tables); RLS enforces per-role access |
| Supabase Edge Functions (Deno) | Real-time WA webhook handler + on-demand event sync (`supabase/functions/`) |
| GitHub Actions (cron) | Nightly full member sync (`.github/workflows/sync-members.yml` → `scripts/sync-members.ts`) — lives outside Edge Functions because the WA contacts job exceeds the 400s function ceiling |
| pg_cron | Daily SQL job `update_member_status()` flips Active/Lapsed and rebuilds chapter aggregates |
| Wild Apricot | Membership management platform (OAuth 2.0 integration) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                              Next.js App                             │
│  ┌──────────┐  ┌────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Dashboard│  │ Events │  │ Members │  │ Chapters │  │ Funding  │  │
│  └──────────┘  └────────┘  └─────────┘  └──────────┘  └──────────┘  │
│  Realtime channels for volatile views + one-shot selects for slow    │
│  collections (members, chapters, aliases). See lib/supabase/         │
└─────────────┼────────────────────────────────────────────────────────┘
              │
   ┌──────────┴─────────────────────────────┐
   │      Supabase Postgres (RLS on)        │
   │  members / chapters / events /         │
   │  attendees / fundraising / subchapters │
   │  users / chapter_aliases               │
   │  pending_registrations / sync_logs     │
   └──────────┬─────────────────────────────┘
              │
   ┌──────────┴─────────────────────────────┐
   │      Supabase Edge Functions (Deno)    │
   │  • sync-events           (HTTP)        │
   │  • wild-apricot-webhook  (HTTP)        │
   │                                        │
   │      pg_cron job                       │
   │  • update_member_status() (daily 02ET) │
   │                                        │
   │      GitHub Actions (cron)             │
   │  • sync-members.yml      (nightly)     │
   │     → scripts/sync-members.ts          │
   └──────────┬─────────────────────────────┘
              │ Wild Apricot REST API
   ┌──────────┴─────────────────┐
   │       Wild Apricot         │
   │  (Membership management)   │
   │  Webhooks → Edge Function  │
   └────────────────────────────┘
```

---

## Authentication Flow

Authentication uses Wild Apricot OAuth 2.0 to identify users, then exchanges a Supabase Admin API magic-link for a real Supabase session — no hand-minted JWTs. Cookies are written via [`@supabase/ssr`](https://github.com/supabase/auth-helpers). This means the flow is forward-compatible with Supabase's asymmetric-JWT signing keys.

```
1. User visits /signin
2. GET /api/auth/signin
   → Generates CSRF state, sets httpOnly wa_oauth_state cookie
   → Redirects to Wild Apricot OAuth login URL
3. Wild Apricot redirects to GET /api/auth/callback?code=...&state=...
   → Validates state cookie (CSRF protection)
   → Exchanges authorization code for Wild Apricot access token
   → Fetches user contact info from Wild Apricot API
   → Finds or creates auth.users row by email (Supabase Admin API)
   → Upserts public.users row (new users get needsOnboarding: true)
   → Writes role / chapter_id / region into auth.users.app_metadata
   → admin.auth.admin.generateLink({ type: 'magiclink', email })
   → supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
     ↳ Supabase issues a real session JWT and writes sb-* cookies on the response
   → Redirects to /setup (new users) or /dashboard (returning users)
4. /setup page (first-time only):
   → User selects their region, then their chapter
   → POST /api/auth/setup updates public.users and app_metadata
   → Redirects to /dashboard
5. Protected routes:
   → middleware.ts gates protected prefixes via getSession() — a local cookie
     decode that refreshes tokens only when expired. The redirect gate trusts
     the (unverified) cookie; RLS is the actual data-access enforcement.
   → API routes call getCaller() which reads the session via @supabase/ssr
   → OnboardingGuard in app layout redirects to /setup if needsOnboarding
```

**Key security properties:**
- The session is held in HTTP-only `sb-access-token` / `sb-refresh-token` cookies (1h access + auto-refresh)
- Role/chapter/region live in `auth.users.app_metadata` (service-role-only writeable) and are read by RLS via `auth.jwt() -> 'app_metadata' ->> 'user_role'`
- CSRF protection on the OAuth flow via a state cookie
- User chapter/region can only be changed by national admins via the user management page (after initial onboarding)

---

## Project Structure

```
philippine-nurses-association-of-america/
├── supabase/                  # Supabase project (managed by Supabase CLI)
│   ├── config.toml
│   ├── migrations/            # Versioned SQL (schema, indexes, RLS, pg_cron)
│   └── functions/             # Edge Functions (Deno)
│       ├── _shared/           # WA + Supabase service client helpers
│       ├── sync-events/       # Full event + attendee sync from Wild Apricot
│       └── wild-apricot-webhook/  # Real-time WA webhook receiver
├── scripts/                   # Node scripts run outside Supabase (CI / local)
│   ├── package.json
│   ├── wa-utils.ts            # Shared WA helpers
│   └── sync-members.ts        # Nightly member sync (replaces the old Cloud Function)
├── .github/workflows/
│   └── sync-members.yml       # GitHub Actions cron → scripts/sync-members.ts
└── pnaa/                      # Next.js application
    ├── middleware.ts           # Route protection (cookie existence check)
    ├── app/
    │   ├── layout.tsx          # Root layout (AuthProvider)
    │   ├── page.tsx            # Root redirect (→ /dashboard or /signin)
    │   ├── api/
    │   │   ├── auth/
    │   │   │   ├── signin/     # Start OAuth flow
    │   │   │   ├── callback/   # Handle OAuth callback (mints the Supabase session)
    │   │   │   ├── setup/      # Save first-time chapter/region selection
    │   │   │   └── signout/    # Clear session cookie
    │   │   ├── sync/trigger/   # Manual sync trigger (national_admin only)
    │   │   └── users/[userId]/ # Update user role/chapter/region (national_admin only)
    │   ├── (auth)/
    │   │   ├── signin/         # Sign-in page
    │   │   ├── callback/       # OAuth return — handled server-side now; this page just redirects
    │   │   └── setup/          # First-time onboarding: pick region & chapter
    │   └── (app)/              # Protected app routes (wrapped in OnboardingGuard)
    │       ├── layout.tsx      # App chrome (sidebar, header) + OnboardingGuard
    │       ├── dashboard/
    │       ├── chapters/[chapterId]/
    │       │   ├── aliases/
    │       │   └── subchapters/
    │       │       ├── new/
    │       │       └── [subchapterId]/
    │       │           └── edit/
    │       ├── events/
    │       │   ├── new/
    │       │   └── [eventId]/
    │       │       └── edit/
    │       ├── members/
    │       │   └── [memberId]/  # Per-member hours rollup + events attended
    │       ├── fundraising/
    │       │   ├── new/
    │       │   └── [fundraisingId]/
    │       │       └── edit/
    │       ├── users/          # User management (national_admin only)
    │       └── about/
    ├── components/
    │   ├── ui/                 # shadcn/ui primitives
    │   ├── auth/               # OnboardingGuard
    │   ├── layout/             # Header, Sidebar, MobileNav
    │   ├── dashboard/          # Stats cards, chapter list widget, fundraising progress, upcoming events
    │   ├── events/             # Event list/card/form/detail, attendee list (paginated WA + manual), metrics & attendance charts, sub-event manager (national conferences)
    │   ├── chapters/           # Chapter list/card/detail, aliases manager, activity chart, chapter-insights charts
    │   ├── members/            # Paginated member list, per-member detail with hours rollup, member-insights charts (chapter-admin and above)
    │   ├── fundraising/        # Campaign list/card/form/detail, fundraising chart, fundraising-insights charts
    │   ├── subchapters/        # Subchapter list/form/detail
    │   ├── users/              # User list with edit dialog
    │   └── shared/             # PageHeader, SearchInput, AdvancedDataTable, DataTable, ViewToggle, EmptyState, StatusBadge
    ├── hooks/
    │   ├── use-auth.ts         # Auth helpers (role checks, chapter/region getters)
    │   ├── use-firestore.ts    # useDocument / useCollection (live listeners) + useDocumentOnce / useCollectionOnce (one-shot getDocs)
    │   ├── use-debounce.ts
    │   ├── use-mobile.ts
    │   └── use-sidebar.ts
    ├── lib/
    │   ├── auth/
    │   │   ├── context.tsx     # AuthProvider & useAuthContext (Supabase auth)
    │   │   └── guards.tsx      # RequireAuth / RequireRole components
    │   ├── supabase/
    │   │   ├── client.ts       # Browser Supabase client (createBrowserClient)
    │   │   ├── server.ts       # Admin SDK (service role) + route-handler client
    │   │   ├── firestore.ts    # Firestore-style query shim (where/orderBy/limit/getDoc/...)
    │   │   ├── query.ts        # Query constraint translator
    │   │   ├── timestamp.ts    # Firestore Timestamp shim + ISO ↔ Timestamp helpers
    │   │   ├── attendees.ts    # Attendance write helpers (toggle, hours edit, manual add/remove, defaultHours propagation)
    │   │   └── index.ts
    │   ├── wild-apricot/
    │   │   └── oauth.ts        # OAuth + API utilities
    │   └── utils.ts            # Shared client utilities (cn, formatters, etc.)
    └── types/
        ├── index.ts            # Barrel export
        ├── user.ts
        ├── member.ts
        ├── chapter.ts
        ├── chapter-alias.ts
        ├── subchapter.ts
        ├── event.ts
        ├── attendee.ts
        └── fundraising.ts
```

---

## Environment Variables

Create a `.env.local` file inside `pnaa/` for **production**:
A separate Supabase project is used for **staging** so you can test without touching production data. For more details, see [Staging Environment](#staging-environment)


```env
# Supabase (client-side — public)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Supabase (server-side — private)
SUPABASE_SERVICE_ROLE_KEY=   # secret key (sb_secret_...) or legacy service_role JWT

# Wild Apricot OAuth (used by /api/auth/signin and /api/auth/callback)
WILD_APRICOT_CLIENT_ID=
WILD_APRICOT_CLIENT_SECRET=
WILD_APRICOT_ACCOUNT_ID=
WILD_APRICOT_DOMAIN=

# Used by the sync trigger API route to authenticate Edge Function calls
WEBHOOK_SECRET=
```

Edge Functions and the sync-members script read environment variables from the Supabase project's function-secrets and from GitHub Actions secrets respectively. Use the Supabase dashboard (Settings → Edge Functions → Secrets) and the GitHub repo settings (Settings → Secrets and variables → Actions):

```env
# Required in Supabase Edge Functions
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WILD_APRICOT_API_KEY=
WILD_APRICOT_ACCOUNT_ID=
WEBHOOK_SECRET=

# Required in GitHub Actions (Settings → Secrets → Actions)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WILD_APRICOT_API_KEY=
WILD_APRICOT_ACCOUNT_ID=
```

---

## Staging environment

A separate Supabase project is used for **staging** so you can test without touching production data.

- **Production Supabase project**: `pnaa-prod` (URL + keys in `.env.local`)
- **Staging Supabase project**: `pnaa-staging` (URL + keys in `.env.staging.local`)

### App environments (Next.js)

Inside `pnaa/`:

- `.env.local` → points to **production** Supabase.
- `.env.staging.local` → points to **staging** Supabase.

```bash
cd pnaa

# Production (default)
npm run dev

# Staging (uses env-cmd to load .env.staging.local)
npm run dev:staging
```

### Deploying schema and Edge Functions

The Supabase CLI manages both projects via the `--linked` flag (run `supabase link` once per environment):

```bash
# Apply pending SQL migrations
supabase db push

# Deploy Edge Functions
supabase functions deploy sync-events
supabase functions deploy wild-apricot-webhook

# Regenerate TypeScript types from the live schema
npm run supabase:types   # inside pnaa/
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- Supabase CLI (`brew install supabase/tap/supabase` or `npm i -g supabase`)
- Deno (only if you want to run Edge Functions locally — `supabase functions serve` handles this)
- Two Supabase projects (prod + staging) with Auth, Database, Edge Functions, Realtime, and pg_cron enabled
- A Wild Apricot account with API/OAuth credentials

### Install & Run

```bash
# Install Next.js app dependencies
cd pnaa
npm install

# Run the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

### Manual Sync (Local Dev)

From the `scripts/` directory:

```bash
npm install                              # one-time
npm run sync-members                     # full member sync into Supabase
```

The scheduled run lives in [.github/workflows/sync-members.yml](.github/workflows/sync-members.yml) — trigger an ad-hoc run from the Actions tab via `workflow_dispatch`.

### Deploy

```bash
# Apply DB schema / RLS / index / pg_cron migrations
supabase db push

# Deploy Edge Functions
supabase functions deploy sync-events
supabase functions deploy wild-apricot-webhook
```

---

## Supabase Edge Functions & Sync Jobs

| Job | Trigger | Description |
|---|---|---|
| `sync-events` Edge Function | HTTP (POST, manual) | Full event sync. Acks immediately with `202` and runs in the background (`EdgeRuntime.waitUntil`) — results land in the function logs and `sync_logs`. Insert-only for new events (never overwrites app fields); for every event, diffs WA registrations against the `attendees` table preserving `attended`/`hours` on existing rows. Refreshes `registrations`, `attendees`, `incompleteRegistrations`, `totalRevenue`. Secured with `?key=<WEBHOOK_SECRET>`. |
| `wild-apricot-webhook` Edge Function | HTTP (POST) | Real-time WA event receiver for Contact / Membership / MembershipRenewed / Event / EventRegistration. Upserts members + chapter aggregates, inserts new events (insert-only), syncs attendee rows preserving admin fields. Out-of-order registrations are queued in `pending_registrations`. Always returns 200. |
| `scripts/sync-members.ts` (GitHub Actions) | Cron (nightly 02:00 ET) + manual `workflow_dispatch` | Full member sync from WA. Runs in GitHub Actions because WA's contact-job poll can take 5–8 minutes (above the Edge Functions 400s ceiling). Diff-aware upsert — only rows whose tracked fields changed are written. Rebuilds chapter aggregates from the WA snapshot. |
| `public.update_member_status()` (pg_cron) | Daily 02:00 ET | SQL function that flips `activeStatus` based on `renewalDueDate` and rebuilds chapter aggregate counts in a single transaction. |
| `POST /api/users` (Next.js route) | Authenticated (`national_admin`) | Creates an `auth.users` row + `public.users` profile + sets app_metadata claims. Replaces the old `createUser` callable Cloud Function. |

### Webhook Configuration

Configure in Wild Apricot (Apps > Integrations > Webhooks):

| Setting | Value |
|---|---|
| URL | `https://<project>.supabase.co/functions/v1/wild-apricot-webhook?key=<WEBHOOK_SECRET>` |
| Authorization | Secret token (query param) |
| Token name | `key` |
| Token value | Value of `WEBHOOK_SECRET` (set as a Supabase Edge Function secret) |
| Notification types | Contact, Membership, MembershipRenewed, Event, EventRegistration |

### Data Sync Strategy

- **Real-time**: `wild-apricot-webhook` processes contact/event/registration changes as they happen. Chapter aggregates are recalculated for the impacted chapters only.
- **Manual full sync**:
  - **Members** → trigger the GitHub Actions workflow `sync-members.yml` (`workflow_dispatch` in the Actions tab) or run `npm run sync-members` from `scripts/` locally with `.env` populated.
  - **Events** → POST to the Edge Function: `curl -X POST "https://<project>.supabase.co/functions/v1/sync-events?key=<WEBHOOK_SECRET>"`, or use the in-app trigger at `POST /api/sync/trigger { "type": "events" }` (national-admin only).
- **Daily status update**: The pg_cron job `update_member_status()` runs at 02:00 ET; flips status based on renewal date and rebuilds chapter counts. View / pause via the Supabase dashboard or `select cron.job, cron.run_jobname()` queries.
- **Chapter aggregates**: Maintained in three places: the webhook handler recalcs the impacted chapter(s) per event, `sync-members.ts` rebuilds the full set, and the pg_cron job rebuilds nightly from current member rows.

---

## Roles & Permissions

| Role | Access |
|---|---|
| `national_admin` | Full read/write access to all chapters, events, fundraising, members, users, and chapter aliases |
| `region_admin` | Read access to all data; can create/edit events and fundraising for chapters in their region; can manage chapter aliases |
| `chapter_admin` | Read access to all data; can create/edit events and fundraising for their chapter |
| `member` | Read-only access to events, chapters, fundraising, and their own user profile |

Roles live in `auth.users.app_metadata.user_role` and are mirrored in `public.users.role`. RLS policies enforce permissions server-side via `public.auth_role()` which reads `auth.jwt() -> 'app_metadata' ->> 'user_role'`.

Soft deletes are used for events, fundraising, and subchapters (no hard deletes allowed via RLS — records are archived with `archived: true`).

Members and chapters are **read-only** from the client — only the service-role client (Edge Functions, the sync-members script, Next.js API routes) writes to these tables.

The `attendees` table is **writeable by admins** (RLS) so they can mark attendance, edit per-attendee hours, and add/remove manual rows. Service-role writes from the Edge Functions still own all WA-sourced field updates and use `upsert(..., { onConflict: 'id' })` while preserving the admin-managed `attended` / `hours` fields.

### Revenue & payment visibility

Per client requirements, all monetary values associated with events are **gated to `national_admin`** in the UI:

| Surface | Field(s) | Visible to non-national admins |
|---|---|---|
| Event detail metrics ([event-metrics.tsx](pnaa/components/events/event-metrics.tsx)) | `totalRevenue` tile | Hidden |
| Events table ([event-list.tsx](pnaa/components/events/event-list.tsx)) | `totalRevenue` column (and its CSV/XLSX export) | Hidden |
| Attendee list ([attendee-list.tsx](pnaa/components/events/attendee-list.tsx)) | `paidSum`, `registrationFee` dollar amounts | Hidden — payment column still shows Free / Paid in Full / Unpaid status |

Note: this gating is **UI-only**. The underlying columns remain readable by any authenticated user under current RLS policies. Tighten the policies (or move revenue/payment fields to a `national_admin`-restricted view) if server-side enforcement is needed.

---

## Event Types & Hours Tracking

Every event has a **type** and **subtype**. The type drives how attendee hours are recorded.

| Type | Subtypes | Hours behavior |
|---|---|---|
| **Conference** | In Person, Webinar | All attendees marked attended earn the event's `defaultHours`. Editing `defaultHours` propagates live to every attended attendee (see [propagateConferenceDefaultHours](pnaa/lib/supabase/attendees.ts)). |
| **Community Outreach** | Medical Mission, Health Screening, Volunteerism | `defaultHours` autofills the field when an attendee is added or marked attended, but admins can override hours per-person. |

Wild Apricot–synced events default to `eventType: "conference"`, `eventSubtype: "in_person"`, `defaultHours: 0`. Admins can change these on the edit form; the subtype dropdown filters its options based on the chosen type.

### National-Conference Sub-Events

Events on the `national` chapter with `eventType: "conference"` gain a third hours mode: an ordered list of **sub-events** (e.g. "Opening Keynote", "Breakout A") drawn from a shared, case-insensitive catalog (`public.subevents`). Attendance is tracked per `(attendee, sub-event)` cell rather than per event, and hours roll up as `cardinality(attendedSubeventIds) * defaultHours`. An attendee's `attended` flag flips true as soon as they're marked for at least one sub-event.

- `events.subeventIds uuid[]` — the event's ordered sub-event list
- `attendees.attendedSubeventIds uuid[]` — which sub-events that attendee was marked for
- A `BEFORE` trigger keeps `attendees.hours` / `attended` aligned with the array, but **only** for `national` conferences — every other event keeps the existing conference / community-outreach behavior untouched.
- All mutations go through transactional RPCs so the attendee array and the event counters (`contactHours`, `attendedCount`) never drift: `set_subevent_attendance`, `bulk_set_subevent_attendance` (CSV import), `add_subevent_to_event` (find-or-create + unarchive), `remove_subevent_from_event`, and `reorder_event_subevents`. `propagate_conference_default_hours` is sub-event-aware: on `national` it rescales by array cardinality, elsewhere it flat-sets every attended row.

Defined in [supabase/migrations/20260520000001_subevents.sql](supabase/migrations/20260520000001_subevents.sql); GIN indexes back the array membership lookups.

### Attendees: Wild Apricot vs Manual

The `attendees` table holds two kinds of records, distinguished by the `source` column:

- **`source: "wildapricot"`** — Synced from WA event registrations. Primary key is the WA registration ID. WA-managed fields (`name`, `registrationType`, `Status`, `paidSum`, etc.) are kept fresh by `sync-events` and the webhook. App-managed fields (`attended`, `hours`) are preserved across syncs by reading the existing row before upsert.
- **`source: "app"`** — Added by an admin from the event detail page (or the bulk attendance upload). Primary key is `app-{eventId}-{memberId}` — scoped to the event so the same member can be added to multiple events without a primary-key collision, while a per-`(eventId, memberId)` check still prevents adding them twice to the *same* event. Always `attended: true` on creation (manual add). Linked to a `public.members` row via `memberId`.

The Add Attendee dialog requires the admin to pick from existing members (server-side `ILIKE` substring search, scoped to active members and optionally to the event's chapter). It refuses to add a member who is already on the event in either section.

### Per-Member Hours Rollup

The `/members/[memberId]` page queries `attendees` filtered by `memberId == X && attended == true`, then fetches each referenced event row to display:

- Total hours, total events attended
- Conference hours vs. community outreach hours
- A table of every event the member attended, with date / type / chapter / hours

Powered by the `(memberId, attended)` composite index defined in [supabase/migrations/20260515000002_indexes.sql](supabase/migrations/20260515000002_indexes.sql).

---

## Bulk CSV Upload

Admins can upload a CSV instead of entering records one at a time. All importers share one framework — a generic dialog shell plus a small per-feature **adapter** — so they parse and resolve conflicts the same way.

- **Shared parsing**: [pnaa/lib/csv.ts](pnaa/lib/csv.ts) — a dependency-free RFC-4180-ish `parseCSV`, plus `parseBoolean`, `downloadCsv`, `splitHeader`, and a header-name column accessor (so column order doesn't matter).
- **Shared shell**: [pnaa/components/shared/bulk-upload-dialog.tsx](pnaa/components/shared/bulk-upload-dialog.tsx) — `BulkUploadDialog` + `BulkUploadButton`, driven by a `BulkUploadAdapter<Row>` (`analyze`, `status`, `renderRow`, `apply`, optional `prepare`). The shell owns the dropzone, template download, summary badges (ready / needs-resolution / skipped), the row list, and apply + toasts.

| Importer | CSV columns | Matching / resolution | Apply path |
|---|---|---|---|
| **Event attendance** ([bulk-attendance-csv.tsx](pnaa/components/events/bulk-attendance-csv.tsx)) | Name, Email, Attended, Hours | Match by **email → member → memberId**, then existing-attendee name, then a members-by-name lookup. Conflicts: ambiguous name (pick), lapsed member (confirm-add), no match. | One transactional RPC `bulk_set_attendance` — inserts missing app attendees, updates WA rows in place (matched by `memberId`, never duplicated), recomputes counters. |
| **Fundraising campaigns** ([bulk-campaign-upload.tsx](pnaa/components/fundraising/bulk-campaign-upload.tsx)) | Fundraiser Name, Chapter, Date, Amount, Note | Resolve chapter by name (unknown → pick from a dropdown); validate date / amount. | Client-side `addDocument` loop, partial-failure tolerant ("Created X of Y"). |
| **Event creation** ([bulk-event-upload.tsx](pnaa/components/events/bulk-event-upload.tsx)) | Name, Start/End Date, Chapter, Event Type, Subtype, Default Hours, Location | Resolve chapter by name; validate type; snap an invalid subtype to a default with a warning. Creates `source: "app"` events. | Client-side `addDocument` loop, partial-failure tolerant. |
| **Sub-event attendance** ([bulk-attendance-upload.tsx](pnaa/components/events/bulk-attendance-upload.tsx)) | Name, Sub-Event, Attended | National-conference only. Resolves attendees + sub-event names; can create a missing sub-event inline. | RPC `bulk_set_subevent_attendance`. |

The sub-event importer predates the shared shell and keeps its own (more intricate) resolution flow; it only shares `lib/csv.ts`. **No dedupe** on the fundraising/event importers — re-uploading the same file creates duplicate rows (the dialog warns of this); the attendance importer is idempotent (matched by `memberId` + counter recompute).

---

## Read/Write Optimization

Postgres is cheaper per read than Firestore, but Supabase Realtime has its own cost shape (channels and replication messages), so the same conservatism applies. Strategies in use:

| Technique | Where | Impact |
|---|---|---|
| **Server-side cursor pagination** | `/members` listing, event attendee list (WA section) | A `/members` visit reads ~50 rows instead of 14k. A 2000-attendee conference detail page reads ~50 instead of 2000. |
| **Server-side `ILIKE` substring search** | `/members` search bar, AddManualAttendeeDialog member picker | Case-insensitive substring matching with no minimum-length gate. Active-only paths use the `(activeStatus, name)` and `(activeStatus, chapterId, name)` indexes. |
| **Lazy-mount dialogs** | `AddManualAttendeeDialog` body | Prevents the dialog's member-search hook from running on every event-detail page load. The hook only fires after the admin opens the dialog. |
| **One-shot select** instead of Realtime channel | `/members` lists, chapter list / detail (members + aliases), member detail page | Slow-changing tables don't need live listeners. Saves channel overhead. Implemented via `useCollectionOnce` / `useDocumentOnce` in [hooks/use-firestore.ts](pnaa/hooks/use-firestore.ts). |
| **Optimistic local updates** | Attendee list (toggle attended, edit hours, add/remove manual) | Admin actions update local state immediately; Postgres write happens in the background with rollback on failure. No re-fetch needed after the write. |
| **Diff-write `sync-members`** | `scripts/sync-members.ts` | Reads existing member rows once, then only upserts rows whose tracked fields actually changed. At 14k members a full sync typically writes 50–500 rows instead of 14k. |
| **Active-only filter default** | `/members` listing, member picker | Reduces working set from ~14k to active members (~9–10k typically). |
| **Transactional RPCs** | Attendee/event writes, sub-event attendance, bulk attendance import | Multi-statement writes (attendee row + event counters) collapse into one `SECURITY INVOKER` call so counters never drift and RLS still applies. See [20260516000001_rpcs.sql](supabase/migrations/20260516000001_rpcs.sql), [20260520000001_subevents.sql](supabase/migrations/20260520000001_subevents.sql), and [20260602000002_bulk_attendance.sql](supabase/migrations/20260602000002_bulk_attendance.sql) (`bulk_set_attendance`). |
| **Single-roundtrip aggregates** | `/members` insights, chapter/fundraising insights | `member_insights()` computes region/level/education/renewal-cliff rollups server-side and returns one JSON blob instead of streaming ~14k rows for client-side chart math. |

### Live listeners are kept where freshness matters

- **Event detail / attendee state during admin editing** — uses one-shot select + optimistic local state (admin needs immediate feedback on their own action).
- **Dashboard widgets** — Realtime channels on small aggregate tables (chapters, etc.).

### What's not optimized yet

- Full-text search across members ("smith" finding "John Smith") could move to Postgres `tsvector` / `pg_trgm` but isn't yet — today only **case-corrected name prefix** searches work.
- The `/events` listing fetches up to 500 events per visit (capped); not paginated. Acceptable at current event volume but a future concern.

---

## Data Models

### Member
```typescript
{
  name: string
  email: string
  membershipLevel: string
  renewalDueDate: string         // text — WA sends ISO 8601 strings, not timestamptz
  chapterId: string | null       // FK → chapters.id; resolved from WA name via ChapterResolver
  highestEducation: string
  memberId: string               // From WA custom field, fallback: WA contact ID
  region: string                 // PNAA Region — independent of the chapter's region
  activeStatus: "Active" | "Lapsed"
  lastSynced: Timestamp
}
```

### Event
```typescript
{
  id: string
  name: string
  startDate: string              // text (WA ISO string)
  endDate: string                // text
  startTime: string
  endTime: string
  location: string
  chapterId: string | null       // FK → chapters.id; WA-imported / cross-chapter events default to the seeded 'national' chapter
  about: string
  archived: boolean

  // Type / subtype — drives hours behavior (see "Event Types & Hours Tracking")
  eventType: "conference" | "community_outreach"
  eventSubtype:
    | "in_person" | "webinar"                               // Conference
    | "medical_mission" | "health_screening" | "volunteerism" // Community Outreach
  defaultHours: number      // Per-attendee hours value (uniform for conference, prefill for outreach)

  // Metrics — denormalized; maintained by the Edge Functions (sync-events / webhook) and the attendee write helpers
  attendees: number               // WA registration count (legacy name; same as `registrations`)
  registrations: number           // WA registration count
  incompleteRegistrations: number // Registrations not yet Paid/Free
  attendedCount: number           // Number of attendee subdocs with attended === true
  contactHours: number            // Sum of attendees' hours where attended === true
  totalRevenue: number
  volunteers: number
  participantsServed: number
  volunteerHours: number

  // Optional subchapter association
  subchapterId?: string

  // Ordered sub-event list (national conferences only — see "National-Conference Sub-Events")
  subeventIds: string[]

  source: "wildapricot" | "app"
  lastUpdatedUser: string
  lastUpdated: Timestamp
  creationDate: Timestamp
}
```

### Attendee (table: `public.attendees`, FK → `events.id`)
```typescript
{
  // Primary key is `registrationId` for WA records, `app-{eventId}-{memberId}` for app/manual records.
  id: string
  registrationId: string
  eventId: string
  contactId: string
  name: string

  // App-managed (admins toggle these from the event detail page)
  attended: boolean
  hours: number
  attendedSubeventIds: string[] // Sub-events this attendee was marked for (national conferences); drives hours/attended via trigger
  source: "wildapricot" | "app"
  memberId: string          // Always set; mirrors contactId for WA, the picked member for app records

  // WA-only (empty/zero for source: "app")
  registrationTypeId: string
  registrationType: string
  organization: string
  isPaid: boolean
  registrationFee: number
  paidSum: number
  OnWaitlist: boolean
  Status: string
}
```

### Fundraising Campaign
```typescript
{
  fundraiserName: string
  chapterId: string | null       // FK → chapters.id; null for national campaigns
  subchapterId?: string
  date: string                   // text (ISO 8601)
  amount: number
  note: string
  archived: boolean
  lastUpdatedUser: string
  lastUpdated: Timestamp
  creationDate: Timestamp
}
```

### Chapter
```typescript
{
  id: string                     // canonical slug, e.g. "pna-metro-houston"
  name: string                   // display name
  region: string                 // source of truth for chapter's region
  totalMembers: number           // aggregate; rebuilt by sync-members and pg_cron
  totalActive: number
  totalLapsed: number
  lastUpdated: Timestamp
}
```

### Subchapter
```typescript
{
  name: string
  chapterId: string              // FK → chapters.id; required
  description: string
  memberIds: string[]
  archived: boolean
  createdBy: string              // uuid (auth.users.id)
  lastUpdatedUser: string
  createdAt: Timestamp
  lastUpdated: Timestamp
}
```
> No `chapterName` or `region` columns — both derive via join on `chapterId`.

### Chapter Alias
```typescript
{
  id?: string                // uuid
  aliasName: string          // Alternative WA chapter name
  chapterId: string          // Canonical chapter, FK → chapters.id
  createdBy: string
  createdAt?: Timestamp
  lastUpdated?: Timestamp
}
```

### User
```typescript
{
  id: string                     // uuid, references auth.users.id
  email: string
  displayName: string
  role: "national_admin" | "region_admin" | "chapter_admin" | "member"
  chapterId?: string | null      // FK → chapters.id; set on /setup for chapter_admin / member
  region?: string                // used to scope region_admin views
  needsOnboarding?: boolean      // true for new users until they complete /setup
  waContactId?: string
  createdAt: Timestamp
  lastLogin: Timestamp
}
```
