# Firebase → Supabase Migration Plan

> **Status (2026-05-16):** Code migration complete on branch `ChaseFournier/Switch-to-Supabase`. Project deployed to one Supabase environment; sync-members + sign-in + member listing all working end-to-end. See **§13 Post-deploy fixes** for the issues hit during first-run testing and how each was resolved. The event-poster upload feature was dropped during the migration (see §4), so Supabase Storage is **not** in scope. Remaining cloud-side steps: standing up a second (staging) project, repointing the WA webhook, rotating the leaked service-account key.

This document is the complete punch list for moving the PNAA Chapter Management System off Firebase (Auth, Firestore, Storage, Cloud Functions) onto Supabase (Auth, Postgres, Edge Functions). It is organized so each section can be worked through in order, with no hidden cross-cutting surprises.

> **Stack today:** Next.js 16 (App Router) + Firebase Web SDK 12 (frontend), Firebase Admin SDK 13 (Next.js API routes), Firebase Functions v6 (5 functions), Wild Apricot OAuth → Firebase Custom Token → session cookie.
>
> **Target:** Same Next.js app, `@supabase/supabase-js` (browser) + `@supabase/ssr` (Next.js cookies) + service-role client (server), Postgres tables with RLS, Supabase Storage, Supabase Edge Functions (Deno) + pg_cron for the scheduled job.

---

## 0. Migration Strategy & Sequencing

The system has **~14k members, 55+ chapters, live Wild Apricot webhooks, and ~399 `onSnapshot` listeners**. A big-bang cutover is risky. The recommended order:

1. **Stand up Supabase project** (dev/staging/prod) with schema, RLS, Storage buckets, and Edge Functions deployed but not yet receiving traffic.
2. **Dual-write phase (optional but recommended)** — temporarily have Cloud Functions write to both Firestore and Supabase so the new system can be validated against live data before cutover.
3. **Backfill** — one-shot export of every Firestore collection into Postgres.
4. **Frontend swap** — replace `firebase/*` imports with Supabase equivalents behind the same hook signatures (`useDocument`, `useCollection`) so component code is unchanged.
5. **Auth swap** — repoint Wild Apricot OAuth callback to mint a Supabase JWT instead of a Firebase custom token.
6. **Webhook cutover** — point Wild Apricot's webhook at the new Edge Function URL; decommission the Firebase Functions.
7. **Decommission** — delete Firebase project after a freeze period.

Each section below lists work for one of these phases.

---

## 1. Supabase Project Setup

### 1.1 Create projects
- [ ] Create two Supabase projects: `pnaa-prod` and `pnaa-staging` (mirror the current Firebase split: `pnaa-chapter-management` / `pnaa-chaptermanagement-staging`).
- [ ] Enable: Auth, Database, Storage, Edge Functions, Realtime, pg_cron, pg_net (for outbound HTTP from cron).
- [ ] Capture: Project URL, anon key, service-role key, JWT secret, DB connection string. Add to a password manager.

### 1.2 Replace these env vars
| Old (Firebase) | New (Supabase) |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `NEXT_PUBLIC_SUPABASE_URL` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | (delete) |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | (delete) |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | (delete) |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | (delete) |
| `FIREBASE_ADMIN_PROJECT_ID` | (delete) |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | (delete) |
| `FIREBASE_ADMIN_PRIVATE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| `NEXT_PUBLIC_USE_EMULATOR` | `NEXT_PUBLIC_USE_LOCAL_SUPABASE` (optional, with the Supabase CLI) |

Keep unchanged: `WILD_APRICOT_API_KEY`, `WILD_APRICOT_ACCOUNT_ID`, `WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`.

### 1.3 Delete from repo
- [x] `firebase.json`
- [x] `.firebaserc`
- [x] `firestore.rules`
- [x] `firestore.indexes.json`
- [x] `storage.rules`
- [x] `pnaa-chapter-management-firebase-adminsdk-fbsvc-ae69bf85fa.json` (removed from working tree — **still need to rotate the key in Firebase + `git filter-repo` from history**)
- [x] `firestore-debug.log`
- [x] `functions/` directory + obsolete `pnaa/proxy.ts`

### 1.4 Add to repo
- [x] `supabase/` directory + `supabase/config.toml`
- [x] `supabase/migrations/` (5 migrations — schema, indexes, RLS, storage, pg_cron)
- [x] `supabase/functions/` (Edge Functions — `sync-events`, `wild-apricot-webhook`, `_shared/`)

---

## 2. Schema Design (Firestore → Postgres)

Eight Firestore collections become Postgres tables. Use `text` for the primary key when the doc id is meaningful (member ID, event ID from Wild Apricot); otherwise `uuid default gen_random_uuid()`.

### 2.1 Tables (target SQL)

```sql
-- Roles as enum so RLS can compare cleanly
create type user_role as enum ('national_admin', 'region_admin', 'chapter_admin', 'member');

-- users: 1-to-1 with auth.users (Supabase's built-in)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role user_role not null default 'member',
  chapter_name text,
  region text,
  wa_contact_id text,
  needs_onboarding boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- members: synced from Wild Apricot (id = WA contact ID as text)
create table public.members (
  id text primary key,
  name text,
  email text,
  level text,                -- "Membership level"
  renewal_due_date timestamptz,
  chapter_name text,
  highest_education text,
  member_id text,            -- the WA "Member ID" custom field (different from PK)
  region text,
  active_status text,        -- 'Active' | 'Lapsed'
  raw jsonb,                 -- preserve any unmapped WA fields
  updated_at timestamptz not null default now()
);

-- chapters: aggregates only; rebuilt by sync
create table public.chapters (
  id text primary key,                    -- canonical chapter slug
  name text not null,
  region text,
  total_members int not null default 0,
  total_active int not null default 0,
  total_lapsed int not null default 0,
  updated_at timestamptz not null default now()
);

-- events: WA + app fields, soft delete
create table public.events (
  id text primary key,                    -- WA event ID as text
  title text,
  description text,
  start_date timestamptz,
  end_date timestamptz,
  location text,
  chapter text,
  subchapter_id uuid references public.subchapters(id),
  poster_url text,
  poster_path text,
  registrations int not null default 0,
  attendees int not null default 0,
  incomplete_registrations int not null default 0,
  total_revenue numeric(10,2) not null default 0,
  contact_hours numeric(6,2),
  archived boolean not null default false,
  sync_lock timestamptz,                  -- coordinates webhook vs full-sync
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- attendees: Firestore subcollection events/{eventId}/attendees → flat table
create table public.attendees (
  id text primary key,                    -- WA registration ID; for manual rows use 'manual_<uuid>'
  event_id text not null references public.events(id) on delete cascade,
  member_id text references public.members(id) on delete set null,
  name text,
  email text,
  attended boolean not null default false,
  contact_hours numeric(6,2),
  registration_status text,
  is_paid boolean,
  amount numeric(10,2),
  source text not null default 'wild_apricot',  -- 'wild_apricot' | 'manual'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fundraising (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  goal numeric(10,2),
  raised numeric(10,2) not null default 0,
  date timestamptz,
  chapter_name text,
  subchapter_id uuid references public.subchapters(id),
  archived boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subchapters (
  id uuid primary key default gen_random_uuid(),
  chapter_id text not null references public.chapters(id) on delete cascade,
  name text not null,
  member_ids text[] not null default '{}',
  archived boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chapter_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null unique,
  canonical_chapter_id text not null references public.chapters(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- pendingRegistrations: durable queue for WA webhooks that arrive before the event doc
create table public.pending_registrations (
  id text primary key,                    -- WA registration ID
  event_id text not null,
  payload jsonb not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
```

### 2.2 Indexes (translate from `firestore.indexes.json`)

```sql
-- events
create index events_archived_start_date         on public.events (archived, start_date);
create index events_archived_start_date_desc    on public.events (archived, start_date desc);
create index events_chapter_archived_start      on public.events (chapter, archived, start_date desc);
create index events_subchapter_archived_start   on public.events (subchapter_id, archived, start_date desc);

-- fundraising
create index fundraising_archived_date_desc     on public.fundraising (archived, date desc);
create index fundraising_chapter_archived_date  on public.fundraising (chapter_name, archived, date desc);
create index fundraising_subch_archived_date    on public.fundraising (subchapter_id, archived, date desc);

-- members
create index members_chapter_name               on public.members (chapter_name, name);
create index members_active_renewal             on public.members (active_status, renewal_due_date);
create index members_active_name                on public.members (active_status, name);
create index members_active_chapter_name        on public.members (active_status, chapter_name, name);

-- subchapters
create index subchapters_chapter_archived_name  on public.subchapters (chapter_id, archived, name);

-- attendees (replaces collection-group index)
create index attendees_member_attended          on public.attendees (member_id, attended);
create index attendees_event                    on public.attendees (event_id);
```

### 2.3 Triggers
- [x] `lastUpdated` / `updatedAt` auto-update triggers (see [supabase/migrations/20260515000001_schema.sql](supabase/migrations/20260515000001_schema.sql))
- [x] `on_auth_user_created` trigger that creates the `public.users` row when an `auth.users` row is inserted

**Status:** ✅ Code complete. Run `supabase db push` on each project to apply.

---

## 3. RLS Policies (Firestore Rules → Postgres)

Recreate the rules in [firestore.rules](firestore.rules) as RLS. The key idiom: `auth.jwt() ->> 'role'` reads the custom claim that the OAuth callback embeds.

```sql
-- Helper: pull role from JWT (set by our custom-token mint)
create or replace function public.current_role() returns text
language sql stable as $$ select coalesce(auth.jwt() ->> 'user_role', 'member') $$;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select public.current_role() in ('national_admin','region_admin','chapter_admin')
$$;

-- Enable RLS
alter table public.members enable row level security;
alter table public.chapters enable row level security;
alter table public.events enable row level security;
alter table public.attendees enable row level security;
alter table public.fundraising enable row level security;
alter table public.subchapters enable row level security;
alter table public.chapter_aliases enable row level security;
alter table public.users enable row level security;
alter table public.pending_registrations enable row level security;

-- members: read all authed; writes by service role only
create policy members_read on public.members for select
  to authenticated using (true);

-- chapters: same
create policy chapters_read on public.chapters for select
  to authenticated using (true);

-- events: read authed, create/update admins, no client deletes
create policy events_read on public.events for select to authenticated using (true);
create policy events_write on public.events for insert to authenticated with check (public.is_admin());
create policy events_update on public.events for update to authenticated using (public.is_admin());

-- attendees: read authed, write admins
create policy attendees_read on public.attendees for select to authenticated using (true);
create policy attendees_write on public.attendees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- fundraising / subchapters: same shape as events
create policy fundraising_read on public.fundraising for select to authenticated using (true);
create policy fundraising_write on public.fundraising for insert to authenticated with check (public.is_admin());
create policy fundraising_update on public.fundraising for update to authenticated using (public.is_admin());

create policy subchapters_read on public.subchapters for select to authenticated using (true);
create policy subchapters_write on public.subchapters for insert to authenticated with check (public.is_admin());
create policy subchapters_update on public.subchapters for update to authenticated using (public.is_admin());

-- chapter_aliases: read all authed, write national/region only
create policy aliases_read on public.chapter_aliases for select to authenticated using (true);
create policy aliases_insert on public.chapter_aliases for insert to authenticated
  with check (public.current_role() in ('national_admin','region_admin'));
create policy aliases_delete on public.chapter_aliases for delete to authenticated
  using (public.current_role() in ('national_admin','region_admin'));

-- users: read self or national_admin reads all; no client writes
create policy users_read on public.users for select to authenticated
  using (auth.uid() = id or public.current_role() = 'national_admin');
```

Service-role queries bypass RLS — Edge Functions and Next.js API routes use the service-role key for writes, matching the current "Cloud Functions only" rule.

**Status:** ✅ Code complete — see [supabase/migrations/20260515000003_rls.sql](supabase/migrations/20260515000003_rls.sql). Helper functions `auth_role()`, `is_admin()`, `is_national_admin()`, `is_region_admin()` are defined; policies cover every table.

---

## 3.5 Normalization pass (2026-05-15 follow-up)

After the initial deploy, the schema was normalized so every chapter reference is a real foreign key. The old Firestore-style "chapter name as join key" columns are gone.

| Table | Before | After |
|---|---|---|
| `members` | `chapterName text` | `chapterId text` → `chapters(id)` |
| `events` | `chapter text`, `region text` | `chapterId text` → `chapters(id)` (region derives from the joined chapter) |
| `fundraising` | `chapterName text` | `chapterId text` → `chapters(id)` |
| `subchapters` | `chapterName text`, `region text` | dropped (already had `chapterId`) |
| `users` | `chapterName text` | `chapterId text` → `chapters(id)` |
| JWT `app_metadata` | `chapter_name` | `chapter_id` |

The sync layer learned a new helper, [`ChapterResolver`](scripts/wa-utils.ts), shared between the Node sync-members script, the Firestore backfill, and the Deno Edge Functions. It translates WA's free-form chapter strings into the canonical `chapters.id`, looking up aliases via `chapter_aliases` first and creating a new chapter row (slug-id) when WA introduces an unknown name.

The frontend gained a [`useChaptersMap()`](pnaa/hooks/use-chapters-map.ts) hook — one cheap fetch of the chapters table at the top of any component, then `nameFor(chapterId)` / `regionFor(chapterId)` for display.

**To apply this on an already-deployed Supabase project:** because the schema migration files themselves changed (not appended), you'll need to reset the DB:

```bash
# WARNING: drops every row in every table. Only safe if you haven't backfilled.
supabase db reset --linked    # against the linked project
supabase db push              # reapplies all migrations
supabase functions deploy sync-events
supabase functions deploy wild-apricot-webhook
```

If you have real data, write an additive migration that does the rename + backfill instead — left as future work since the project is pre-cutover.

## 4. Storage Migration — feature dropped

The Firebase Storage bucket was only used for **event posters**. Rather than re-create the bucket and migrate the blobs, the feature was removed during the migration. If posters are wanted back later, the simplest path is to add a `posterUrl text` column on `events` and let admins paste a URL hosted somewhere else (CDN, S3, the org's existing image host).

What changed:
- [x] Removed `eventPoster` JSONB column from [supabase/migrations/20260515000001_schema.sql](supabase/migrations/20260515000001_schema.sql).
- [x] Deleted `supabase/migrations/20260515000004_storage.sql` (bucket + RLS policies) and the storage section of [supabase/config.toml](supabase/config.toml).
- [x] Deleted `pnaa/lib/supabase/storage.ts` and the `uploadEventPoster` / `deleteFile` / `getFileUrl` re-exports from `pnaa/lib/supabase/index.ts` and `client.ts`.
- [x] Deleted [pnaa/components/shared/file-upload.tsx](pnaa/components/shared/file-upload.tsx) (only used by the event form).
- [x] Removed the `EventPoster` type from `pnaa/types/event.ts` and the `eventPoster` field from `AppEvent`.
- [x] Removed the poster UI from `event-form.tsx`, `event-card.tsx`, and `event-detail.tsx`.
- [x] Updated the README and the data-model snippet to drop `eventPoster`.

No Firebase Storage backfill is needed; the WA-synced events never carried posters, and any admin-uploaded posters are simply gone after migration.

---

## 5. Authentication Cutover (the tricky part)

The current flow ([documented in CLAUDE.md/MEMORY.md]):

```
/signin → /api/auth/signin → WA OAuth → /api/auth/callback
  → Admin SDK creates Firebase user, sets custom claims, mints custom token
  → /callback?token=… → client signInWithCustomToken → /api/auth/session
  → Admin SDK creates session cookie 'firebase_token' (1h httpOnly)
  → middleware checks the cookie
```

Supabase has no "custom token" primitive; instead, **mint a Supabase-compatible JWT yourself** in `/api/auth/callback` using the project's JWT secret, then set it directly as the Supabase session cookie via `@supabase/ssr`.

### 5.1 Files to rewrite

| File | Change | Status |
|---|---|---|
| `pnaa/lib/firebase/admin.ts` | Deleted. New: [pnaa/lib/supabase/server.ts](pnaa/lib/supabase/server.ts) exports `supabaseAdmin()` (service role) and `supabaseRoute()` (cookie-bound). | ✅ |
| `pnaa/lib/firebase/config.ts` | Deleted. New: [pnaa/lib/supabase/client.ts](pnaa/lib/supabase/client.ts) exports `supabase` (browser client) + back-compat aliases `auth` / `db` / `storage`. | ✅ |
| [pnaa/app/api/auth/signin/route.ts](pnaa/app/api/auth/signin/route.ts) | Unchanged — still redirects to WA OAuth. | ✅ |
| [pnaa/app/api/auth/callback/route.ts](pnaa/app/api/auth/callback/route.ts) | Rewritten: validates state, exchanges WA code, fetches contact, upserts into `auth.users` via Admin API, upserts `public.users`, mints a JWT with `jose`, sets session via `@supabase/ssr`, redirects to `/setup` or `/dashboard`. | ✅ |
| `pnaa/app/(auth)/callback/page.tsx` | Reduced to a server-side redirect — session is established in the route handler. | ✅ |
| `pnaa/app/api/auth/session/route.ts` | Deleted (cookies are set in the OAuth callback now). | ✅ |
| [pnaa/app/api/auth/setup/route.ts](pnaa/app/api/auth/setup/route.ts) | Rewritten: updates `public.users` + mirrors into `app_metadata`. | ✅ |
| [pnaa/app/api/auth/signout/route.ts](pnaa/app/api/auth/signout/route.ts) | Rewritten: `supabase.auth.signOut()` clears the `sb-*` cookies. | ✅ |
| [pnaa/app/api/users/[userId]/route.ts](pnaa/app/api/users/[userId]/route.ts) | Rewritten: uses `auth.admin.updateUserById` to set `app_metadata` + updates `public.users`. | ✅ |
| [pnaa/app/api/users/route.ts](pnaa/app/api/users/route.ts) | New: `POST` replaces the old `createUser` callable Cloud Function. | ✅ |
| [pnaa/lib/auth/context.tsx](pnaa/lib/auth/context.tsx) | Rewritten: uses `supabase.auth.onAuthStateChange` + a select from `public.users`. Keeps the `firebaseUser` field name for back-compat. | ✅ |
| [pnaa/lib/auth/guards.tsx](pnaa/lib/auth/guards.tsx) | Unchanged behavior; reads role from the context which now pulls from `public.users`. | ✅ |
| [pnaa/middleware.ts](pnaa/middleware.ts) | New file replacing `proxy.ts`; uses `@supabase/ssr` to refresh tokens and gate the protected prefixes. | ✅ |

### 5.2 Important auth gotchas — decisions made
- ✅ Claims go in `app_metadata.user_role`. The RLS helper [auth_role()](supabase/migrations/20260515000003_rls.sql) reads from `auth.jwt() -> 'app_metadata' ->> 'user_role'`.
- ✅ JWT TTL = 3600s (1 hour), the Supabase default. Refresh tokens are rotated automatically by `@supabase/ssr` via the middleware.
- ✅ **No shared-secret JWT minting.** Sessions are issued by Supabase itself via `admin.generateLink({ type: 'magiclink' })` redeemed with `verifyOtp` server-side. No `SUPABASE_JWT_SECRET` needed; works unchanged when Supabase moves to asymmetric JWT signing keys.
- ⚠️ **Email collisions still open.** The callback finds existing users by email via `auth.admin.listUsers` (page 1, perPage 200). If the prod project has more than 200 users by the time you cut over, switch this to paginated `listUsers` (or `getUserByEmail` when it ships). Today this is fine; flag a TODO when traffic hits ~150 users.
- ✅ Email/password sign-up disabled in [supabase/config.toml](supabase/config.toml) (`auth.enable_signup = false`, `auth.email.enable_signup = false`). `generateLink` for an *existing* user still works because the Admin API bypasses these toggles.
- ⚠️ **UID continuity (NOT done in code).** Decide whether to preserve Firebase UIDs as Supabase `auth.users.id` before backfill. If preserving: backfill script needs to pass `id: <existing-uuid>` to `auth.admin.createUser`. If not: existing `subchapters.createdBy` / `fundraising.createdBy` FKs will break.

---

## 6. Frontend Data Layer

### 6.1 Replace [pnaa/hooks/use-firestore.ts](pnaa/hooks/use-firestore.ts)

The hook signatures stay the same so callers don't change. Internally, swap `onSnapshot` for Supabase Realtime channels, and `getDocs` for `.from(...).select()`.

```ts
// pnaa/hooks/use-supabase.ts
export function useDocument<T>(table: string, id: string | undefined) {
  // 1. initial select().eq('id', id).single()
  // 2. supabase.channel(`${table}:${id}`)
  //      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `id=eq.${id}` }, …)
  //      .subscribe()
}

export function useCollection<T>(table: string, opts: { eq?, order?, limit? } = {}) {
  // 1. initial query with eq/order/limit
  // 2. .channel(table).on('postgres_changes', { event: '*', schema:'public', table, filter? })
  // 3. on each change: optimistically merge into local state (or refetch on UPDATE/DELETE)
}
```

**Behavior to preserve:**
- The `useCollectionOnce` / `useDocumentOnce` variants stay one-shot (no realtime channel). These are the highest-value hooks — most member/chapter usage is already one-shot.
- Default pagination/ordering remain unchanged.

**Constraint translation table (caller-side):**

| Firestore | Supabase query |
|---|---|
| `where('field', '==', v)` | `.eq('field', v)` |
| `where('field', 'in', [...])` | `.in('field', [...])` |
| `where('archived', '==', false)` | `.eq('archived', false)` |
| `orderBy('startDate', 'desc')` | `.order('start_date', { ascending: false })` |
| `limit(n)` | `.limit(n)` |
| Collection group `attendees` | `.from('attendees').select()` (just a flat table now) |

**Status:** ✅ Done. The hooks signatures are preserved exactly (`useCollection("events", [where("archived", "==", false), orderBy("startDate", "desc")])` still works) because [pnaa/lib/supabase/firestore.ts](pnaa/lib/supabase/firestore.ts) re-exports compatibility-shaped `where` / `orderBy` / `limit` / `Timestamp` / `serverTimestamp` / `doc` / `getDoc` / `getDocs` / `writeBatch` / `increment` / `collection` / `collectionGroup` / `onSnapshot` / `startAfter` / `deleteDoc`. The constraint objects are translated to Supabase PostgREST calls inside [applyConstraints()](pnaa/lib/supabase/query.ts). No component call sites needed constraint-argument rewrites — only their import paths (handled by sed).

### 6.2 Field name casing — decision made

✅ Used **camelCase column names in Postgres** (quoted identifiers). This eliminated the boundary translator entirely — component code, types, and queries all use the same camelCase identifiers that Firestore used. See the column names in [supabase/migrations/20260515000001_schema.sql](supabase/migrations/20260515000001_schema.sql).

Only `Timestamp` ↔ ISO-string conversion happens at the boundary, via [hydrateTimestamps()](pnaa/lib/supabase/timestamp.ts) on reads and [serializeTimestamps()](pnaa/lib/supabase/timestamp.ts) on writes.

### 6.3 Server timestamps and increments

| Firestore | Postgres / Supabase |
|---|---|
| `serverTimestamp()` | `now()` (or DB default) |
| `Timestamp.now()` | `now()::timestamptz` |
| `increment(n)` | `update … set field = field + n` (in SQL) or `rpc('increment_…')` |
| `FieldValue.delete()` | `update … set field = null` |
| `writeBatch().commit()` | a single transaction (`pg` `begin/commit`) or `rpc()` calling a function |

The 450-doc batching pattern is unnecessary in Postgres — multi-row `insert ... on conflict do update` handles thousands per statement.

### 6.4 Files that imported `firebase/*` — all updated

✅ Done. 35 files were touched. The original `pnaa/lib/firebase/` directory was renamed to [pnaa/lib/supabase/](pnaa/lib/supabase/) with the same export surface. Direct `from "firebase/firestore"` imports in components were rewritten to pull from `@/lib/supabase/firestore`. Verify with:

```bash
rg "from \"firebase/|from \"@/lib/firebase" pnaa/
# Expect: no matches.
```

---

## 7. Cloud Functions → Supabase Edge Functions

The five functions in [functions/src/](functions/src/) become Edge Functions (Deno) **except** `update-members.ts` which fits better as a `pg_cron` job calling a SQL function.

| Firebase Function | New home | Status |
|---|---|---|
| `sync-members.ts` | **GitHub Actions cron + local npm script** → [scripts/sync-members.ts](scripts/sync-members.ts), [.github/workflows/sync-members.yml](.github/workflows/sync-members.yml) | ✅ |
| `sync-events.ts` | Edge Function → [supabase/functions/sync-events/](supabase/functions/sync-events/index.ts) | ✅ |
| `webhook-handler.ts` | Edge Function → [supabase/functions/wild-apricot-webhook/](supabase/functions/wild-apricot-webhook/index.ts). Handles Contact / Membership / MembershipRenewed / Event / EventRegistration. Out-of-order registrations get queued in `pending_registrations`. Always returns 200. | ✅ |
| `update-members.ts` | pg_cron + SQL function → [supabase/migrations/20260515000005_pg_cron.sql](supabase/migrations/20260515000005_pg_cron.sql) | ✅ |
| `create-user.ts` | Next.js API route → [POST /api/users](pnaa/app/api/users/route.ts) | ✅ |

### 7.4 GitHub Actions workflow for `sync-members`

The full member sync has to live outside Supabase Edge Functions because Wild Apricot's async-job poll for 14k contacts routinely runs 5–8 minutes. The plan:

- [x] Added [scripts/sync-members.ts](scripts/sync-members.ts) — port using `@supabase/supabase-js` (service-role). Diff-write logic + chapter aggregate rebuild + sync_logs entry on success/failure. Uses [scripts/wa-utils.ts](scripts/wa-utils.ts) for WA helpers.
- [x] Wire `npm run sync-members` in [scripts/package.json](scripts/package.json) so it can be invoked locally. (`--from` and `--limit` flags weren't preserved — add later if needed; current run is full-sync only.)
- [x] Added [.github/workflows/sync-members.yml](.github/workflows/sync-members.yml):

  ```yaml
  name: Sync Members
  on:
    schedule:
      - cron: '0 7 * * *'           # 02:00 ET daily (adjust for DST)
    workflow_dispatch:               # manual trigger from the Actions tab
  jobs:
    sync:
      runs-on: ubuntu-latest
      timeout-minutes: 30
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20' }
        - run: npm ci
        - run: npm run sync-members
          env:
            SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
            SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
            WILD_APRICOT_API_KEY: ${{ secrets.WILD_APRICOT_API_KEY }}
            WILD_APRICOT_ACCOUNT_ID: ${{ secrets.WILD_APRICOT_ACCOUNT_ID }}
  ```

- [ ] **(Manual)** Add the four secrets to the GitHub repo settings (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WILD_APRICOT_API_KEY`, `WILD_APRICOT_ACCOUNT_ID`).
- [x] Failure annotation step is in the workflow. **TODO:** wire it to a Slack/email webhook (currently just emits `::error::`).
- ⚠️ `sync-events` stays in Edge Functions for now (300s budget). Move to Actions if it ever grows.

**Why GitHub Actions over alternatives:**
- Free at this volume (private repo: ~2000 min/mo free; this job uses ~10 min/day = 300 min/mo).
- 6-hour timeout ceiling — far above what's needed.
- Persistent logs in the Actions tab; `workflow_dispatch` gives one-click manual runs without a deploy.
- No servers to patch, no extra hosting bill, no cold-start tuning.

### 7.1 Concurrency / locking
The webhook handler's `runTransaction` + `syncLock` pattern translates well: do the equivalent inside a SQL function with `select … for update` + an explicit `sync_lock` column check. Postgres transactions are stronger than Firestore's, so the pending-registration retry logic gets simpler — you can foreign-key the registration directly and let it fail loudly if the event is missing, then retry from the queue.

### 7.2 Webhook URL change — manual
- [ ] After deploying the `wild-apricot-webhook` Edge Function, log into Wild Apricot, change the webhook URL from the old Cloud Functions URL to `https://<project>.supabase.co/functions/v1/wild-apricot-webhook?key=<WEBHOOK_SECRET>`.
- [ ] Keep the old URL alive (returning 200 OK) for 24h after cutover so any in-flight retries don't pile up — or accept that the old endpoint will start 404'ing once the Firebase project is decommissioned.

### 7.3 Delete after cutover — done
- [x] `functions/` directory removed
- [x] `firebase-functions`, `firebase-admin`, `node-fetch` removed (deleted with the directory)
- [x] `firebase` and `firebase-admin` removed from [pnaa/package.json](pnaa/package.json)

---

## 8. Data Backfill

**Status:** ✅ Script written. Run it once after Supabase is up.

### How to run

```bash
cd scripts
cp .env.example .env            # paste Firebase Admin + Supabase service-role creds
npm install                     # installs firebase-admin

npm run migrate:dry-run         # read everything, print counts, write nothing
npm run migrate                 # do the writes
npm run migrate -- --only=members,events     # subset rerun
npm run migrate -- --limit=50                # smoke test with a small slice
```

### What it does (in order — each step is one Firestore call)

1. **users** — paginated `auth.listUsers()` walk + `firestore.collection('users').get()`. Creates `auth.users` rows preserving original Firebase UIDs (so `subchapters.createdBy` / `fundraising.createdBy` FKs survive). Upserts `public.users` profiles. Existing auth.users rows are skipped, not overwritten.
2. **chapters** — `firestore.collection('chapters').get()` → upsert.
3. **subchapters** — single get → upsert. FKs to `chapters` resolved by this point.
4. **chapter_aliases** — single get → upsert.
5. **members** — single get → upsert.
6. **events** — single get → upsert.
7. **attendees** — `firestore.collectionGroup('attendees').get()` — ONE query fetches every attendee across every event. The script extracts `eventId` from `doc.ref.parent.parent.id`. Rows whose parent event didn't make it into the migration set are dropped (logged).
8. **fundraising** — single get → upsert.

### Firebase read budget (worst case)

For ~14k members, 500 events, 5k attendees, the script makes **8 Firestore queries total** (plus auth pagination). Each query streams; no per-row reads, no re-reads. Safely under any free-tier ceiling.

### Idempotency

Every Supabase write is an `upsert(rows, { onConflict: 'id' })`, so re-running the script is safe. `auth.users` creation handles "email already exists" errors and continues.

### What it does NOT do
- Storage backfill — the event-poster feature was dropped (see §4).
- Custom `lastSynced`/`creationDate` overrides — defaults `now()` when the source doc didn't have one.
- Schema validation — relies on the migrations (§2) already being applied.

### Suggested cutover order

1. Apply all SQL migrations (`supabase db push`).
2. Run `npm run migrate:dry-run` against **staging** first; eyeball the counts.
3. Run `npm run migrate` against staging; manually QA a few pages in the app.
4. Run `npm run migrate:dry-run` against **production**; compare row counts to Firestore.
5. Briefly freeze writes in the production app (or accept that anything written during the next ~5 minutes may need to be re-synced via the webhook handler).
6. Run `npm run migrate` against production.
7. Repoint Wild Apricot webhook → Supabase Edge Function.
8. Trigger one `npm run sync-members` to make sure WA + Supabase are in sync.

**Validation queries** to run after backfill:

```sql
select count(*) from public.members;          -- should be ~14,000
select count(*) from public.chapters;         -- should be 55+
select count(*) from public.events where archived = false;
select count(*) from public.attendees;
select sum(total_active) from public.chapters; -- sanity check vs members
```

Compare each to a Firestore-side count taken at the same moment.

---

## 9. Realtime Listener Audit

The Explore pass counted **~399 `onSnapshot` instances**. Most of these are inside `useCollection` / `useDocument`, so they migrate transparently if §6.1 is done well. But Supabase Realtime has different cost/scaling characteristics:

- **Per-channel cost.** Hundreds of open channels per browser tab is fine, but each `useCollection` opens a new channel. Consider a shared channel per table with client-side filtering for high-fanout collections.
- **Filter limits.** Postgres changes filters support `eq`, `neq`, `gt`, `lt`, `in` on a single column. Compound filters (e.g. `archived=false AND chapter='X'`) need to be split — subscribe to a broader filter and filter client-side, OR create a Postgres view + replication on the view.
- **Replication identity.** For `update`/`delete` events to carry the old row, set `alter table public.events replica identity full` on tables where the frontend cares about the previous row state. Otherwise only `id` is delivered on delete.
- **Initial load.** Firestore's `onSnapshot` delivers an initial snapshot; Supabase Realtime does not — you must do an initial `select()` and then subscribe.

Action: convert highest-traffic listeners (members table, attendees table) to **`useCollectionOnce` + manual refetch on mutation** rather than realtime. Keep realtime for dashboards and event detail pages where the live updates are the point.

---

## 10. CI / Tooling / Repo Hygiene

- [x] No existing CI used `firebase-tools` (no `.github/workflows/` Firebase-deploy workflow existed). New workflow `.github/workflows/sync-members.yml` uses Node + Supabase CLI only.
- [x] Added `supabase/.temp`, `supabase/functions/.deno_cache`, `scripts/node_modules`, `scripts/.env` to [.gitignore](.gitignore).
- [ ] **(Manual, post-deploy)** Generate Postgres types: `npm run supabase:types` inside `pnaa/` — requires `supabase link` to a real project first. Wire into clients for end-to-end type safety.
- [x] Updated [README.md](README.md) — Supabase setup instructions, new Tech Stack table, new Edge Functions section, new project structure.
- [ ] **(Manual)** Update the project memory at [memory/MEMORY.md](../../.claude/projects/-home-warforged-Documents-PNAA-philippine-nurses-association-of-america/memory/MEMORY.md) once cutover is complete (collections → tables, Cloud Functions → Edge Functions, `firebase_token` cookie → `sb-*` cookies, etc.).
- [x] Removed the leaked service account JSON from the working tree.
- [ ] **(URGENT, manual)** Rotate the Firebase service account key (the leaked one was `pnaa-chapter-management-firebase-adminsdk-fbsvc-ae69bf85fa.json`) in the Firebase console, and `git filter-repo` or BFG it out of history before pushing this branch publicly.

---

## 11. Risks & Open Questions

1. ~~**`syncMembers` 720s timeout.**~~ **Resolved:** runs as GitHub Actions cron + local npm script (§7.4).
2. **Webhook ordering.** The handler has tuned out-of-order delivery handling via `pending_registrations`. Reproduce this exactly — load-bearing for data correctness during membership renewals.
3. ~~**UID continuity.**~~ **Resolved:** `scripts/migrate.ts` preserves Firebase UIDs as `auth.users.id` via the Admin API. Existing `createdBy` FKs continue to work.
4. **Real-time listener load.** Audit aggressively. Most member/chapter lists use `useCollectionOnce` (one-shot). Realtime is reserved for dashboards and event detail.
5. **Wild Apricot OAuth client config.** The redirect URI registered with WA must match `/api/auth/callback` — unchanged from the old setup, so no WA-side change needed.
6. **Composite index on collection group `attendees`** — replaced by a flat-table `(memberId, attended)` index. Verify any code that did `collectionGroup('attendees')` is now `from('attendees')`.
7. **No tests.** Codebase has zero tests. Add integration tests for at least the auth callback and the webhook handler before broader rollout.
8. **`auth.admin.listUsers` pagination.** The OAuth callback uses `listUsers({ page: 1, perPage: 200 })` to find existing users by email. Switch to paginated walks (or `getUserByEmail` when it ships) before user count crosses ~150.
9. **First-user bootstrap.** No self-service path to promote the first user from `member` → `national_admin`. Documented manual SQL in §13.8.

---

## 12. Rollback Plan

Keep the Firebase project running and the Cloud Functions deployed for **at least two weeks** after Supabase cutover. The rollback path is:

1. Repoint Wild Apricot webhook back to the Firebase Function URL.
2. Revert the frontend deploy to the last Firebase-based commit.
3. Replay any Supabase-only writes back into Firestore from a diff query (the `updated_at` columns make this tractable).

Once you've gone two weeks without rolling back, decommission Firebase: disable Cloud Functions, export Firestore as a final backup, delete the project.

---

## 13. Post-deploy fixes (lessons from first-run testing)

After applying the migrations and running the first `sync-members` + sign-in, several issues surfaced. All have been resolved on this branch; documenting them here so future deploys don't re-step on the same rakes.

### 13.1 Wrong trigger on `members`
- **Symptom:** `record "new" has no field "lastUpdated"` on any UPDATE to `public.members`.
- **Cause:** the generic `tg_set_last_updated()` trigger was originally attached to every table, but `members` uses `lastSynced` (not `lastUpdated`).
- **Fix:** [supabase/migrations/20260515000001_schema.sql](supabase/migrations/20260515000001_schema.sql) now defines a separate `tg_set_last_synced()` function and attaches `members_last_synced` to `members`. The bad trigger is no longer created.
- **Manual unblock on a pre-existing DB:** `drop trigger if exists members_last_updated on public.members;`

### 13.2 Chapter aggregate upsert violating `chapters.name NOT NULL`
- **Symptom:** `null value in column "name" of relation "chapters"` at the end of `sync-members`.
- **Cause:** the aggregate upsert at the end of `sync-members.ts` sent only `{id, totalMembers, …}`. When PostgREST took the INSERT path (chapter row didn't exist yet, or an earlier broken run left an orphan), the missing `name` violated NOT NULL.
- **Fix:** [scripts/sync-members.ts](scripts/sync-members.ts) now pulls canonical `name` + `region` from the resolver for every aggregate upsert. Also restored a missing closing brace on the WA-contacts pagination loop.
- **Bonus fix:** `ChapterResolver.resolve()` now back-fills `name`/`region` if it sees an existing chapter row with a null name — so re-running sync repairs damage from earlier partial runs.

### 13.3 `dateString.split is not a function`
- **Symptom:** error on the events / members / fundraising pages.
- **Cause:** the Timestamp-hydration regex was too greedy — fields like `startDate`, `endDate`, `renewalDueDate`, `startTime`, `endTime` are stored as **text** (WA sends them as strings) but matched the `Date|Time|…` regex and were being wrapped in `Timestamp` instances. Then `formatDate()`/`parseISO()` tried `.split(…)` on a Timestamp and crashed.
- **Fix:** [pnaa/lib/supabase/timestamp.ts](pnaa/lib/supabase/timestamp.ts) replaced the regex with an explicit `TIMESTAMP_COLUMNS` allowlist of the columns that are actually `timestamptz` in the schema. Plain string date columns now pass through untouched.

### 13.4 Setup page submitted chapter name instead of chapter id
- **Symptom:** "Unknown chapter" error on first-time onboarding.
- **Cause:** `<SelectItem value={c.name}>` left over from the pre-normalization code. The page state variable was renamed to `chapterId` but the dropdown still wrote the *name* into it.
- **Fix:** [pnaa/app/(auth)/setup/page.tsx](pnaa/app/(auth)/setup/page.tsx) — `value={c.id}` (display still `c.name`).

### 13.5 Chapter column showing "—" on member list (but worked on member detail)
- **Symptom:** members page Chapter column blank; clicking into a member showed the chapter correctly.
- **Cause:** `useMemo` with `[]` deps captured `nameFor` from `useChaptersMap()` before the chapters fetch completed; the empty-map version stayed sticky forever.
- **Fix:** Always include `nameFor` / `regionFor` / `chapters` in the deps of any `useMemo` that builds columns or row data. Same fix applied in [pnaa/components/members/member-list.tsx](pnaa/components/members/member-list.tsx), [pnaa/components/users/user-list.tsx](pnaa/components/users/user-list.tsx), and [pnaa/components/members/member-detail.tsx](pnaa/components/members/member-detail.tsx).

### 13.6 Search filters crashing on null fields
- **Symptom:** `Cannot read properties of null (reading 'toLowerCase')`.
- **Cause:** chapter/event filters called `chapter.region.toLowerCase()` etc. directly; nullable columns (`chapter.region`, `event.location`) would throw.
- **Fix:** Each list-page filter now uses an `lc(v) = (v ?? "").toLowerCase()` helper. Touched [chapter-list.tsx](pnaa/components/chapters/chapter-list.tsx), [event-list.tsx](pnaa/components/events/event-list.tsx), [campaign-list.tsx](pnaa/components/fundraising/campaign-list.tsx), [subchapter-detail.tsx](pnaa/components/subchapters/subchapter-detail.tsx).

### 13.7 `addDocument` schema-cache error on `chapter_aliases`
- **Symptom:** `Could not find the 'creationDate' column of 'chapter_aliases' in the schema cache`.
- **Cause:** `addDocument` auto-injected `creationDate` + `lastUpdated` on every insert. Works for events/fundraising/subchapters, breaks on `chapter_aliases` (`createdAt`), `members` (`lastSynced`), `users` (`createdAt`/`lastLogin`), `attendees` (`createdAt`/`updatedAt`).
- **Fix:** [pnaa/lib/supabase/firestore.ts](pnaa/lib/supabase/firestore.ts) `addDocument` no longer auto-injects timestamps. Postgres column defaults (`now()`) and per-table BEFORE-UPDATE triggers handle them. Callers can still pass them explicitly to override.

### 13.8 First user can't bootstrap themselves to national_admin
- **Symptom:** `new row violates row-level security policy for table "chapter_aliases"` (or any admin-only write) for the first user.
- **Cause:** Every new sign-in lands with role `member`. Only `national_admin`/`region_admin` can create aliases. There's no in-app self-promotion path.
- **Fix (manual SQL, one-time):**
  ```sql
  update public.users set role = 'national_admin' where email = 'you@example.com';
  update auth.users
  set raw_app_meta_data =
        coalesce(raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('user_role', 'national_admin')
  where email = 'you@example.com';
  ```
  Sign out + back in for a fresh JWT. After that, the `/users` page can promote others via the API.

### 13.9 Stray lockfile at the repo root broke Next dev server
- **Symptom:** `Can't resolve 'tailwindcss' in '/.../philippine-nurses-association-of-america'` (note: repo root, not `pnaa/`).
- **Cause:** A `package-lock.json` got created at the repo root (likely an accidental `npm` invocation up a directory). Next.js 16's auto-workspace detection treats lockfiles as workspace-root markers and started resolving modules from the repo root instead of `pnaa/`.
- **Fix:** delete any `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` above `pnaa/`. Don't run `npm` from the repo root.

### 13.10 Search restrictions relaxed
- The old "minimum 2 characters" gate (Firestore prefix-only search limitation) was removed from the member list and the Add Attendee dialog. Both now use Postgres `ILIKE '%term%'` for case-insensitive **substring** search, no minimum length. Implemented by adding `like`/`ilike` to the `WhereOp` union in [pnaa/lib/supabase/query.ts](pnaa/lib/supabase/query.ts).

---

## Section Checklist Summary

- [ ] §1 Supabase project + env vars — **code ready; manual project creation + env-var setup needed**
- [x] §2 Schema + indexes + triggers in `supabase/migrations/` — code complete; `supabase db push` to apply
- [x] §3 RLS policies — code complete; applied via `supabase db push`
- [x] §4 Storage — feature dropped (event posters removed); no bucket needed
- [x] §5 Auth callback rewrite — code complete, and rewritten to use `admin.generateLink` + `verifyOtp` so we don't depend on the legacy shared JWT secret (forward-compatible with Supabase's new `sb_publishable_` / `sb_secret_` keys + asymmetric JWTs)
- [x] §6 Frontend hooks + shim layer — code complete (no constraint rewrites needed thanks to the shim)
- [x] §7 Edge Functions + pg_cron job + create-user API route + GitHub Actions sync-members — code complete
- [x] §8 Data backfill script — written at [scripts/migrate.ts](scripts/migrate.ts); single-pass Firestore reads, idempotent upserts, preserves Firebase UIDs
- [ ] §9 Realtime audit — defer to post-cutover load testing
- [x] §10 CI, README, .gitignore — code complete (still need to rotate the leaked service-account key + scrub from git history)
- [ ] §11 Resolve open questions — UID continuity decision pending; sync-members timeout resolved; WA OAuth redirect URI unchanged
- [ ] §12 Two-week rollback window before deleting Firebase

## Remaining manual steps (in execution order)

1. **Rotate the leaked Firebase service-account key** (urgent, regardless of migration timing).
2. Create production + staging Supabase projects.
3. `supabase link` each project, then `supabase db push` to apply migrations.
4. `supabase functions deploy sync-events && supabase functions deploy wild-apricot-webhook`.
5. Set Edge Function secrets (`WILD_APRICOT_API_KEY`, `WILD_APRICOT_ACCOUNT_ID`, `WEBHOOK_SECRET`).
6. Set GitHub Actions secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WILD_APRICOT_API_KEY`, `WILD_APRICOT_ACCOUNT_ID`).
7. Set `pnaa/.env.local` from the new Supabase project + WA credentials.
8. Run `cd scripts && cp .env.example .env`, fill in Firebase + Supabase creds, `npm install`.
9. `npm run migrate:dry-run` against staging, verify counts, then `npm run migrate`. UID continuity is handled — Firebase UIDs are preserved.
10. Repeat 9 against prod during a brief write freeze.
11. Repoint Wild Apricot's webhook URL to the new Edge Function.
12. Cut DNS / Vercel env vars over to the new Supabase project.
13. Monitor for two weeks; then decommission Firebase.
