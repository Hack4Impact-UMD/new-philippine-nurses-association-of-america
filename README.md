# Philippine Nurses Association of America — Chapter Management System

A full-stack web application for managing PNAA's 55+ chapters, 4,000+ members, events, and fundraising campaigns. Built with Next.js and Firebase, integrated with Wild Apricot for membership data.

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
- [Firebase Cloud Functions](#firebase-cloud-functions)
- [Roles & Permissions](#roles--permissions)
- [Data Models](#data-models)

---

## Features

- **Dashboard** — Real-time stats (total/active/lapsed members, chapters, upcoming events, total fundraised) plus chapter-list, fundraising-progress, and upcoming-events widgets
- **Chapter Management** — Browse all chapters, view chapter-level member breakdowns and activity charts; chapter aliases merge stats from alternative Wild Apricot names
- **Event Management** — Create, edit, and view events with metrics (attendees, registrations, revenue, volunteers, contact hours, etc.); per-event attendee subcollection synced from Wild Apricot; event posters uploaded to Firebase Storage. Revenue figures and attendee payment amounts are visible to national admins only — other roles see paid / unpaid / free status without dollar amounts.
- **Fundraising** — Track fundraising campaigns with amounts, notes, chapter and optional subchapter attribution; campaign trend chart on detail pages
- **Subchapters** — Create subchapters within chapters, assign members, soft-delete support; events and fundraising can be tagged to a subchapter
- **Member Sync** — Wild Apricot membership sync via real-time webhooks (Contact / Membership / Event), manual full-sync HTTP endpoints, and a daily 2 AM ET scheduled status recalculation
- **First-Time Onboarding** — New users select their region and chapter on first sign-in; this can only be changed later by a national admin via the user management page
- **Role-Based Access** — National admins see all data; region admins manage their region; chapter admins manage their chapter; members have read-only access
- **User Management** — National admins can view all users and update roles, regions, and chapter assignments
- **Advanced Data Tables** — Chapters, Events, and Fundraising pages feature a rich table view with sortable, resizable, and drag-to-reorder columns; per-column filters; column visibility toggles; and pagination. Switchable to a card grid via a pill toggle.
- **Excel Export** — Tabular data exports to `.xlsx` via ExcelJS for offline analysis
- **Charts** — Recharts-powered visualizations for chapter activity, event attendance, and fundraising progress
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
| Firebase Auth | Authentication via custom tokens + session cookies |
| Firestore | Primary NoSQL database |
| Firebase Storage | Event poster image uploads (5MB max, images only) |
| Firebase Cloud Functions | Scheduled data sync + real-time webhooks from Wild Apricot |
| Wild Apricot | Membership management platform (OAuth 2.0 integration) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Next.js App                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐  │
│  │ Dashboard │  │  Events  │  │ Fundraising│  │ Chapters │  │
│  └──────────┘  └──────────┘  └────────────┘  └──────────┘  │
│                     │ Real-time listeners                   │
└─────────────────────┼───────────────────────────────────────┘
                      │
        ┌─────────────┴───────────────────┐
        │           Firestore             │
        │  members / chapters /           │
        │  events (+ attendees subcoll) / │
        │  fundraising / subchapters /    │
        │  users / chapter_aliases        │
        └──────────┬──────────────────────┘
                   │
     ┌─────────────┴──────────────────┐
     │    Firebase Cloud Functions    │
     │  • syncMembers  (HTTP, manual) │
     │  • syncEvents   (HTTP, manual) │
     │  • updateMembers (daily 2 AM)  │
     │  • wildApricotWebhook (HTTP)   │
     │  • createUser (callable)       │
     └──────────┬─────────────────────┘
                │ Wild Apricot REST API
     ┌──────────┴──────────────────┐
     │       Wild Apricot          │
     │  (Membership management)    │
     │  Webhooks → Cloud Functions │
     └─────────────────────────────┘
```

---

## Authentication Flow

Authentication uses Wild Apricot OAuth 2.0 to identify users, then issues Firebase session cookies for secure server-side verification.

```
1. User visits /signin
2. GET /api/auth/signin
   → Generates CSRF state, sets httpOnly state cookie
   → Redirects to Wild Apricot OAuth login URL
3. Wild Apricot redirects to GET /api/auth/callback?code=...&state=...
   → Validates state cookie (CSRF protection)
   → Exchanges authorization code for Wild Apricot access token
   → Fetches user contact info from Wild Apricot API
   → Creates or finds Firebase Auth user by email
   → Creates Firestore /users/{uid} doc (new users get needsOnboarding: true)
   → Returning users: only lastLogin is updated (chapter/region preserved)
   → Issues Firebase custom token with role claims
   → Redirects to /callback?token=<customToken>
4. Client-side /callback page:
   → Signs into Firebase with custom token (signInWithCustomToken)
   → Obtains ID token from the signed-in user (getIdToken)
   → POSTs ID token to /api/auth/session
   → Server creates a verified session cookie (createSessionCookie)
   → Sets httpOnly cookie "firebase_token" (1 hour)
   → Redirects to /setup (new users) or /dashboard (returning users)
5. /setup page (first-time only):
   → User selects their region, then their chapter
   → Saves via POST /api/auth/setup → sets needsOnboarding: false
   → Redirects to /dashboard
6. Protected routes:
   → Middleware checks firebase_token cookie existence
   → API routes verify the cookie via verifySessionCookie (cryptographic check)
   → OnboardingGuard in app layout redirects to /setup if needsOnboarding
```

**Key security properties:**
- Session cookies are created by `createSessionCookie` and verified by `verifySessionCookie` — cryptographic verification on every API call
- The `firebase_token` cookie is httpOnly, secure (in production), SameSite=Lax
- CSRF protection on the OAuth flow via a state cookie
- User chapter/region can only be changed by national admins via the user management page (after initial onboarding)

---

## Project Structure

```
philippine-nurses-association-of-america/
├── firebase.json              # Firebase project config
├── firestore.rules            # Firestore security rules
├── firestore.indexes.json     # Composite indexes
├── storage.rules              # Firebase Storage rules
├── functions/                 # Firebase Cloud Functions
│   └── src/
│       ├── index.ts           # Function exports + Admin SDK init
│       ├── sync-members.ts    # HTTP endpoint for manual full member sync
│       ├── sync-events.ts     # HTTP endpoint for manual full event sync
│       ├── update-members.ts  # Scheduled daily status recalculation (2 AM ET)
│       ├── webhook-handler.ts # Real-time Wild Apricot webhook receiver
│       ├── create-user.ts     # Callable: admin user creation
│       ├── wa-utils.ts        # Shared WA utilities (token, mapping, aggregation)
│       └── run-sync.ts        # Local dev script for manual syncs
└── pnaa/                      # Next.js application
    ├── middleware.ts           # Route protection (cookie existence check)
    ├── app/
    │   ├── layout.tsx          # Root layout (AuthProvider)
    │   ├── page.tsx            # Root redirect (→ /dashboard or /signin)
    │   ├── api/
    │   │   ├── auth/
    │   │   │   ├── signin/     # Start OAuth flow
    │   │   │   ├── callback/   # Handle OAuth callback
    │   │   │   ├── session/    # Create verified session cookie from ID token
    │   │   │   ├── setup/      # Save first-time chapter/region selection
    │   │   │   └── signout/    # Clear session cookie
    │   │   ├── sync/trigger/   # Manual sync trigger (national_admin only)
    │   │   └── users/[userId]/ # Update user role/chapter/region (national_admin only)
    │   ├── (auth)/
    │   │   ├── signin/         # Sign-in page
    │   │   ├── callback/       # OAuth return → Firebase sign-in → session cookie
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
    │   ├── events/             # Event list/card/form/detail, attendee list, attendance & metrics charts
    │   ├── chapters/           # Chapter list/card/detail, aliases manager, activity chart
    │   ├── fundraising/        # Campaign list/card/form/detail, fundraising chart
    │   ├── subchapters/        # Subchapter list/form/detail
    │   ├── users/              # User list with edit dialog
    │   └── shared/             # PageHeader, SearchInput, AdvancedDataTable, DataTable, ViewToggle, FileUpload, EmptyState, StatusBadge
    ├── hooks/
    │   ├── use-auth.ts         # Auth helpers (role checks, chapter/region getters)
    │   ├── use-firestore.ts    # useDocument / useCollection (real-time listeners)
    │   ├── use-debounce.ts
    │   ├── use-mobile.ts
    │   └── use-sidebar.ts
    ├── lib/
    │   ├── auth/
    │   │   ├── context.tsx     # AuthProvider & useAuthContext
    │   │   └── guards.tsx      # RequireAuth / RequireRole components
    │   ├── firebase/
    │   │   ├── config.ts       # Client SDK init
    │   │   ├── admin.ts        # Admin SDK (server-side, lazy Proxy pattern)
    │   │   ├── firestore.ts    # Firestore helpers
    │   │   ├── storage.ts      # Storage helpers
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
A separate Firebase project is used for **staging** so you can test without touching production data. For more details, see [Staging Environment](#staging-environment)


```env
# Firebase (client-side — public)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Firebase Admin (server-side — private)
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

# Wild Apricot OAuth
WILD_APRICOT_CLIENT_ID=
WILD_APRICOT_CLIENT_SECRET=
WILD_APRICOT_ACCOUNT_ID=
WILD_APRICOT_DOMAIN=
```

Firebase Admin credentials are required for the OAuth callback route (issues custom tokens) and the session route (creates/verifies session cookies). Obtain them from a Firebase service account JSON file.

Cloud Functions use separate environment variables configured in `functions/.env`:

```env
WILD_APRICOT_API_KEY=
WILD_APRICOT_ACCOUNT_ID=
WEBHOOK_SECRET=          # For webhook endpoint authentication
```

---

## Staging environment

A separate Firebase project is used for **staging** so you can test without touching production data.

- **Production Firebase project ID**: `pnaa-chapter-management`
- **Staging Firebase project ID**: `pnaa-chaptermanagement-staging`

### Firebase project aliases

The repo uses Firebase CLI aliases defined in `.firebaserc`:

```json
{
  "projects": {
    "default": "pnaa-chapter-management",
    "staging": "pnaa-chaptermanagement-staging"
  }
}
```

From the repo root:

```bash
# Use production for deploys
firebase use default

# Use staging for deploys
firebase use staging
```

On the free plan, **only Firestore** is deployed to staging as of now:

- `firebase deploy --only firestore` works for both prod and staging.
- `firebase deploy --only functions` and `--only storage` require the Blaze plan on the target project, so Functions and Storage are **not deployed** to staging as of now.

### App environments (Next.js)

Inside `pnaa/`:

- `.env.local` → points to **production** Firebase.
- `.env.staging.local` → points to **staging** Firebase (`pnaa-chaptermanagement-staging`).

Typical workflows:

- **Run app against production** (local):

  - Ensure `.env.local` has production values.
  - Run:

    ```bash
    cd pnaa
    npm run dev
    ```

- **Run app against staging** (local):

  - Ensure `.env.staging.local` exists with staging values.
  - Either temporarily copy it over:

    ```bash
    cd pnaa
    cp .env.staging.local .env.local
    npm run dev
    ```

  - Or, if using `env-cmd`, run the dedicated staging script:

    ```bash
    cd pnaa
    npm run dev:staging
    ```

When the app is using staging, all Firestore/Auth operations go to the **staging** Firebase project; production continues to use its own env and project.

---

## Getting Started

### Prerequisites
- Node.js 20+
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Firestore, Auth, Storage, and Functions enabled
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

```bash
# Install Cloud Functions dependencies
cd functions
npm install

# Build functions
npm run build

# Run functions locally with Firebase emulator
npm run serve
```

### Manual Sync (Local Dev)

From the `functions/` directory:

```bash
npm run sync                              # sync members + events
npm run sync:members                      # members only
npm run sync:events                       # events only
npm run sync:members -- --from 5000       # start at contact #5000
npm run sync:members -- --limit 1000      # first 1000 contacts only
```

### Deploy

```bash
# Deploy Firestore rules and indexes
firebase deploy --only firestore

# Deploy Storage rules
firebase deploy --only storage

# Deploy Cloud Functions
firebase deploy --only functions
```

---

## Firebase Cloud Functions

| Function | Trigger | Description |
|---|---|---|
| `syncMembers` | HTTP (POST, manual) | Full member sync: fetches all contacts from Wild Apricot via async job polling, upserts to `members` collection in batches of 450, rebuilds chapter aggregates. Secured with `?key=[WEBHOOK_SECRET]`. Timeout: 540s. |
| `syncEvents` | HTTP (POST, manual) | Full event sync: fetches all events from Wild Apricot. Event docs are **insert-only** — existing event app fields are never overwritten. Then for every event, diffs the `attendees` subcollection against WA registrations (add/update/delete) and refreshes `attendees`, `registrations`, and `incompleteRegistrations` counters. Secured with `?key=[WEBHOOK_SECRET]`. Timeout: 300s. |
| `updateMembers` | Scheduled (daily, 2 AM ET) | Queries only `Active` members whose `renewalDueDate` has passed and flips them to `Lapsed`. Updates chapter aggregates via `FieldValue.increment` — no full member re-read required. |
| `wildApricotWebhook` | HTTP (POST) | Real-time webhook receiver for Wild Apricot contact, membership, event, and event-registration changes. Contact/membership changes upsert the member and update chapter aggregates via increments (old/new delta). Event changes: Created = insert-only, Changed = updates WA-owned fields only (preserves app fields), Deleted = soft-delete (`archived: true`). EventRegistration changes upsert / delete the matching `events/{eventId}/attendees/{registrationId}` doc and increment the parent event's `attendees` counter. Always returns 200 to prevent WA retry loops. |
| `createUser` | Callable | Creates a Firebase Auth user and Firestore user document with role/chapter/region. Restricted to `national_admin` callers. |

### Webhook Configuration

Configure in Wild Apricot (Apps > Integrations > Webhooks):

| Setting | Value |
|---|---|
| URL | `https://[region]-[project].cloudfunctions.net/wildApricotWebhook?key=[WEBHOOK_SECRET]` |
| Authorization | Secret token (query param) |
| Token name | `key` |
| Token value | Value of `WEBHOOK_SECRET` from `functions/.env` |
| Notification types | Contact, Membership, MembershipRenewed, Event, EventRegistration |

### Data Sync Strategy

- **Real-time**: The webhook handler processes individual contact/event changes as they happen in Wild Apricot. Chapter aggregates are updated via `FieldValue.increment` using the old/new member delta — no member re-reads required.
- **Manual full sync**: `syncMembers` and `syncEvents` are HTTP endpoints (no schedule). Trigger them via `POST /syncMembers?key=[WEBHOOK_SECRET]` and `POST /syncEvents?key=[WEBHOOK_SECRET]` when a full re-sync is needed (e.g. after a gap in webhook coverage or initial setup).
- **Daily status update**: `updateMembers` runs at 2 AM ET, querying only `Active` members with an expired `renewalDueDate`. On a typical day this touches tens to a few hundred documents rather than the full membership, and updates chapter counts via increments.
- **Chapter aggregates**: The webhook and `updateMembers` use incremental updates. `syncMembers` rebuilds aggregates from scratch from the in-memory contact list during a full sync. `recalculateChapterAggregates` in `wa-utils.ts` is available as a manual recovery utility if counts drift.

---

## Roles & Permissions

| Role | Access |
|---|---|
| `national_admin` | Full read/write access to all chapters, events, fundraising, members, users, and chapter aliases |
| `region_admin` | Read access to all data; can create/edit events and fundraising for chapters in their region; can manage chapter aliases |
| `chapter_admin` | Read access to all data; can create/edit events and fundraising for their chapter |
| `member` | Read-only access to events, chapters, fundraising, and their own user profile |

Roles are stored as Firebase Auth custom claims and mirrored in Firestore `/users/{uid}`. Firestore security rules enforce permissions server-side via `getUserRole()` which reads from the Firestore user document.

Soft deletes are used for events, fundraising, and subchapters (no hard deletes allowed via security rules — records are archived with `archived: true`).

Members and chapters are **read-only** from the client — only Cloud Functions write to these collections.

### Revenue & payment visibility

Per client requirements, all monetary values associated with events are **gated to `national_admin`** in the UI:

| Surface | Field(s) | Visible to non-national admins |
|---|---|---|
| Event detail metrics ([event-metrics.tsx](pnaa/components/events/event-metrics.tsx)) | `totalRevenue` tile | Hidden |
| Events table ([event-list.tsx](pnaa/components/events/event-list.tsx)) | `totalRevenue` column (and its CSV/XLSX export) | Hidden |
| Attendee list ([attendee-list.tsx](pnaa/components/events/attendee-list.tsx)) | `paidSum`, `registrationFee` dollar amounts | Hidden — payment column still shows Free / Paid in Full / Unpaid status |

Note: this gating is **UI-only**. The underlying fields remain readable from Firestore by any authenticated user under current security rules. Tighten the rules if server-side enforcement is needed.

---

## Data Models

### Member
```typescript
{
  name: string
  email: string
  membershipLevel: string
  renewalDueDate: string
  chapterName: string
  highestEducation: string
  memberId: string               // From WA custom field, fallback: WA contact ID
  region: string
  activeStatus: "Active" | "Lapsed"
  lastSynced: Timestamp
}
```

### Event
```typescript
{
  id: string
  name: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  location: string
  chapter: string
  region: string
  about: string
  archived: boolean

  // Metrics
  attendees: number
  registrations: number
  incompleteRegistrations: number
  totalRevenue: number
  volunteers: number
  participantsServed: number
  contactHours: number
  volunteerHours: number

  // Optional subchapter association
  subchapterId?: string

  eventPoster: { name: string; ref: string; downloadURL: string }
  source: "wildapricot" | "app"
  lastUpdatedUser: string
  lastUpdated: Timestamp
  creationDate: Timestamp
}
```

### Attendee (subcollection: `events/{eventId}/attendees/{attendeeId}`)
```typescript
{
  registrationId: string
  eventId: string
  contactId: string
  name: string
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
  chapterName: string
  subchapterId?: string
  date: string
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
  name: string
  region: string
  totalMembers: number
  totalActive: number
  totalLapsed: number
  lastUpdated: Timestamp
}
```

### Subchapter
```typescript
{
  name: string
  chapterId: string
  chapterName: string
  region: string
  description: string
  memberIds: string[]
  archived: boolean
  createdBy: string
  lastUpdatedUser: string
  createdAt: Timestamp
  lastUpdated: Timestamp
}
```

### Chapter Alias
```typescript
{
  id?: string                // Firestore doc id
  aliasName: string          // Alternative WA chapter name
  chapterId: string          // Canonical chapter, maps to chapters/{chapterId}
  createdBy: string
  createdAt?: Timestamp
  lastUpdated?: Timestamp
}
```

### User
```typescript
{
  email: string
  displayName: string
  role: "national_admin" | "region_admin" | "chapter_admin" | "member"
  chapterName?: string
  region?: string
  needsOnboarding?: boolean  // true for new users until they complete /setup
  waContactId?: string
  createdAt: Timestamp
  lastLogin: Timestamp
}
```
