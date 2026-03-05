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

- **Dashboard** — Real-time stats (total/active/lapsed members, chapters, upcoming events, total fundraised)
- **Chapter Management** — Browse all chapters, view chapter-level member breakdowns
- **Event Management** — Create, edit, and view events with metrics (attendees, volunteers, contact hours, etc.); synced from Wild Apricot
- **Fundraising** — Track fundraising campaigns with amounts, notes, and chapter attribution
- **Member Sync** — Automated Wild Apricot membership data sync every minute via Cloud Functions
- **Role-Based Access** — National admins see all data; chapter admins and members see scoped data
- **Advanced Data Tables** — Chapters, Events, and Fundraising pages feature a rich table view with sortable, resizable, and drag-to-reorder columns; per-column filters; column visibility toggles; and pagination. Switchable to a card grid via a pill toggle.
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
| Lucide React | — | Icons |
| Sonner | — | Toast notifications |
| next-themes | — | Dark mode |

### Backend & Infrastructure
| Technology | Purpose |
|---|---|
| Firebase Auth | Authentication via custom tokens |
| Firestore | Primary NoSQL database |
| Firebase Storage | Event poster image uploads (5MB max, images only) |
| Firebase Cloud Functions | Scheduled data sync from Wild Apricot |
| Wild Apricot | Membership management platform (OAuth 2.0 integration) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Next.js App                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐ │
│  │ Dashboard│  │  Events  │  │ Fundraising│  │ Chapters │ │
│  └──────────┘  └──────────┘  └────────────┘  └──────────┘ │
│                     │ Real-time listeners                   │
└─────────────────────┼───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │         Firestore          │
        │  members / events /        │
        │  fundraising / chapters /  │
        │  users                     │
        └──────────┬────────────────┘
                   │
     ┌─────────────┴──────────────┐
     │   Firebase Cloud Functions  │
     │  • syncMembers (scheduled)  │
     │  • syncEvents (scheduled)   │
     │  • updateMembers            │
     │  • createUser (callable)    │
     └──────────┬──────────────────┘
                │ Wild Apricot REST API
     ┌──────────┴──────────────────┐
     │       Wild Apricot          │
     │  (Membership management)    │
     └─────────────────────────────┘
```

---

## Authentication Flow

Authentication uses Wild Apricot OAuth 2.0 to identify users, then issues Firebase custom tokens for session management.

```
1. User visits /signin
2. GET /api/auth/signin
   → Generates CSRF state, sets state cookie
   → Redirects to Wild Apricot OAuth login URL
3. Wild Apricot redirects to GET /api/auth/callback?code=...&state=...
   → Validates state cookie (CSRF check)
   → Exchanges code for Wild Apricot access token
   → Fetches user contact info from Wild Apricot API
   → Creates or updates Firebase Auth user
   → Creates or updates Firestore /users/{uid} document
   → Issues Firebase custom token
   → Sets secure session cookie (firebase_token)
   → Redirects to /callback with token
4. Client-side: signs into Firebase with custom token
5. Middleware checks firebase_token cookie on protected routes
```

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
│       ├── index.ts           # Function exports
│       ├── sync-members.ts    # Scheduled member sync
│       ├── sync-events.ts     # Scheduled event sync
│       ├── update-members.ts  # Member data updates
│       └── create-user.ts     # Callable: admin user creation
└── pnaa/                      # Next.js application
    ├── middleware.ts           # Route protection
    ├── app/
    │   ├── layout.tsx          # Root layout (AuthProvider)
    │   ├── page.tsx            # Root redirect
    │   ├── api/
    │   │   ├── auth/
    │   │   │   ├── signin/     # Start OAuth flow
    │   │   │   ├── callback/   # Handle OAuth callback
    │   │   │   └── signout/    # Sign out
    │   │   └── sync/trigger/   # Manual sync trigger
    │   ├── (auth)/
    │   │   ├── signin/         # Sign-in page
    │   │   └── callback/       # OAuth return handler
    │   └── (app)/              # Protected app routes
    │       ├── dashboard/
    │       ├── chapters/[chapterId]/
    │       ├── events/[eventId]/edit/
    │       ├── fundraising/[fundraisingId]/edit/
    │       └── about/
    ├── components/
    │   ├── ui/                 # shadcn/ui primitives
    │   ├── layout/             # Header, Sidebar, MobileNav
    │   ├── dashboard/          # Stats cards, widgets
    │   ├── events/             # Event list, card, form, detail
    │   ├── chapters/           # Chapter list, card, detail
    │   ├── fundraising/        # Campaign list, card, form, detail
    │   └── shared/             # PageHeader, SearchInput, AdvancedDataTable, ViewToggle, etc.
    ├── hooks/
    │   ├── use-auth.ts         # Auth helpers (role checks)
    │   ├── use-firestore.ts    # useDocument / useCollection
    │   ├── use-debounce.ts
    │   ├── use-mobile.ts
    │   └── use-sidebar.ts
    ├── lib/
    │   ├── auth/
    │   │   ├── context.tsx     # AuthProvider & useAuthContext
    │   │   └── guards.tsx      # Route guard components
    │   ├── firebase/
    │   │   ├── config.ts       # Client SDK init
    │   │   ├── admin.ts        # Admin SDK (server-side)
    │   │   ├── firestore.ts    # Firestore helpers
    │   │   ├── storage.ts      # Storage helpers
    │   │   └── index.ts
    │   └── wild-apricot/
    │       └── oauth.ts        # OAuth + API utilities
    └── types/
        ├── user.ts
        ├── member.ts
        ├── chapter.ts
        ├── event.ts
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

Firebase Admin credentials are required for the OAuth callback route (issues custom tokens). Obtain them from a Firebase service account JSON file.

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
- Node.js 18+
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
| `syncMembers` | Scheduled (every 1 min) | Fetches all contacts from Wild Apricot and upserts to `members` collection. Determines active/lapsed status from renewal due date. |
| `syncEvents` | Scheduled (every 1 min) | Fetches events from Wild Apricot and inserts into `events` collection. **Insert-only** — existing events are never overwritten. |
| `updateMembers` | Scheduled (daily, 2 AM EST) | Recalculates active/lapsed status for all members and rebuilds chapter aggregate totals in the `chapters` collection. |
| `createUser` | Callable (admin only) | Creates a Firebase Auth user and Firestore user document. Restricted to `national_admin` role. |

---

## Roles & Permissions

| Role | Access |
|---|---|
| `national_admin` | Full read/write access to all chapters, events, fundraising, members, and users |
| `chapter_admin` | Read access to all data; can create/edit events and fundraising for their chapter |
| `member` | Read-only access to events, chapters, and their own user profile |

Roles are stored as Firebase Auth custom claims and mirrored in Firestore `/users/{uid}`. Firestore security rules enforce these permissions server-side.

Soft deletes are used for events and fundraising (no direct deletes allowed via security rules — records are archived with `archived: true`).

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
  memberId: string
  region: string
  activeStatus: "Active" | "Lapsed"
  lastSynced: Timestamp
}
```

### Event
```typescript
{
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
  attendees: number
  volunteers: number
  participantsServed: number
  contactHours: number
  volunteerHours: number
  eventPoster: { name: string; ref: string; downloadURL: string }
  source: "wildapricot" | "app"
  lastUpdatedUser: string
  lastUpdated: Timestamp
  creationDate: Timestamp
}
```

### Fundraising Campaign
```typescript
{
  fundraiserName: string
  chapterName: string
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

### User
```typescript
{
  email: string
  displayName: string
  role: "national_admin" | "chapter_admin" | "member"
  chapterName?: string
  region?: string
  waContactId?: string
  createdAt: Timestamp
  lastLogin: Timestamp
}
```
