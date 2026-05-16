-- PNAA Chapter Management — initial schema
-- Mirrors the Firestore data model. Column names are camelCase (quoted) to
-- keep the frontend code drop-in compatible.
--
-- Normalization rules:
--   * Every reference to a chapter is `chapterId text references chapters(id)`.
--     The id is the canonical slug. The display name lives in chapters.name.
--   * Region is stored only on rows where it differs from the parent chapter:
--     - chapters.region   — the source of truth
--     - members.region    — WA reports per-member, can differ from chapter
--     - users.region      — used to scope region_admin views
--     Drop redundant region columns on events / subchapters — derive via join.

create extension if not exists "pgcrypto";

-- Roles
create type public.user_role as enum (
  'national_admin',
  'region_admin',
  'chapter_admin',
  'member'
);

-- ---------- chapters (created first because everyone FKs it) ----------
create table public.chapters (
  id text primary key,
  "name" text not null,
  "region" text,
  "totalMembers" int not null default 0,
  "totalActive" int not null default 0,
  "totalLapsed" int not null default 0,
  "lastUpdated" timestamptz not null default now()
);

-- ---------- subchapters ----------
create table public.subchapters (
  id uuid primary key default gen_random_uuid(),
  "name" text not null,
  "chapterId" text not null references public.chapters(id) on delete cascade,
  "description" text,
  "memberIds" text[] not null default '{}',
  "archived" boolean not null default false,
  "createdBy" uuid,
  "lastUpdatedUser" text,
  "createdAt" timestamptz not null default now(),
  "lastUpdated" timestamptz not null default now()
);

-- ---------- chapter aliases ----------
create table public.chapter_aliases (
  id uuid primary key default gen_random_uuid(),
  "chapterId" text not null references public.chapters(id) on delete cascade,
  "aliasName" text not null unique,
  "createdBy" text not null,
  "createdAt" timestamptz not null default now(),
  "lastUpdated" timestamptz not null default now()
);

-- ---------- members (synced from Wild Apricot; id = WA contact ID) ----------
create table public.members (
  id text primary key,
  "name" text,
  "email" text,
  "membershipLevel" text,
  "renewalDueDate" text,
  "chapterId" text references public.chapters(id) on delete set null,
  "highestEducation" text,
  "memberId" text,
  "region" text,
  "activeStatus" text,
  "lastSynced" timestamptz not null default now(),
  "raw" jsonb
);

-- ---------- events (id = WA event ID) ----------
create table public.events (
  id text primary key,
  "name" text,
  "startDate" text,
  "endDate" text,
  "location" text,
  "chapterId" text references public.chapters(id) on delete set null,
  "archived" boolean not null default false,

  "eventType" text,
  "eventSubtype" text,
  "defaultHours" numeric(6,2) not null default 0,

  "about" text,
  "startTime" text,
  "endTime" text,

  "attendees" int not null default 0,
  "registrations" int not null default 0,
  "incompleteRegistrations" int not null default 0,
  "totalRevenue" numeric(10,2) not null default 0,
  "volunteers" int not null default 0,
  "participantsServed" int not null default 0,
  "contactHours" numeric(10,2) not null default 0,
  "attendedCount" int not null default 0,
  "volunteerHours" numeric(10,2) not null default 0,

  "subchapterId" uuid references public.subchapters(id) on delete set null,

  "source" text not null default 'wildapricot',
  "lastUpdatedUser" text,
  "lastUpdated" timestamptz not null default now(),
  "creationDate" timestamptz not null default now(),

  "syncLock" timestamptz
);

-- ---------- attendees (subcollection becomes flat table) ----------
create table public.attendees (
  id text primary key,
  "registrationId" text not null,
  "eventId" text not null references public.events(id) on delete cascade,
  "contactId" text,
  "memberId" text,
  "name" text,
  "attended" boolean not null default false,
  "hours" numeric(6,2) not null default 0,
  "source" text not null default 'wildapricot',
  "registrationTypeId" text,
  "registrationType" text,
  "organization" text,
  "isPaid" boolean,
  "registrationFee" numeric(10,2),
  "paidSum" numeric(10,2),
  "OnWaitlist" boolean,
  "Status" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- ---------- fundraising ----------
create table public.fundraising (
  id uuid primary key default gen_random_uuid(),
  "fundraiserName" text not null,
  "chapterId" text references public.chapters(id) on delete set null,
  "subchapterId" uuid references public.subchapters(id) on delete set null,
  "date" text,
  "amount" numeric(10,2) not null default 0,
  "note" text,
  "archived" boolean not null default false,
  "lastUpdated" timestamptz not null default now(),
  "lastUpdatedUser" text,
  "creationDate" timestamptz not null default now()
);

-- ---------- users (1:1 with auth.users) ----------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  "email" text not null,
  "displayName" text,
  "role" public.user_role not null default 'member',
  "chapterId" text references public.chapters(id) on delete set null,
  "region" text,
  "waContactId" text,
  "needsOnboarding" boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "lastLogin" timestamptz not null default now()
);

-- ---------- pending registrations: durable queue for out-of-order WA webhooks ----------
create table public.pending_registrations (
  id text primary key,
  "eventId" text not null,
  "payload" jsonb not null,
  "attempts" int not null default 0,
  "createdAt" timestamptz not null default now()
);

-- ---------- sync logs (parity with previous "syncLogs" Firestore collection) ----------
create table public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  "type" text not null,
  "status" text not null,
  "triggeredBy" uuid,
  "triggeredAt" timestamptz not null default now(),
  "completedAt" timestamptz,
  "error" text
);

-- ---------- generic lastUpdated trigger ----------
create or replace function public.tg_set_last_updated()
returns trigger language plpgsql as $$
begin
  new."lastUpdated" := now();
  return new;
end;
$$;

create trigger chapters_last_updated before update on public.chapters
  for each row execute function public.tg_set_last_updated();
create trigger events_last_updated   before update on public.events
  for each row execute function public.tg_set_last_updated();
create trigger fund_last_updated     before update on public.fundraising
  for each row execute function public.tg_set_last_updated();
create trigger subch_last_updated    before update on public.subchapters
  for each row execute function public.tg_set_last_updated();
create trigger alias_last_updated    before update on public.chapter_aliases
  for each row execute function public.tg_set_last_updated();

-- members has "lastSynced" (not "lastUpdated") — separate trigger.
create or replace function public.tg_set_last_synced()
returns trigger language plpgsql as $$
begin
  new."lastSynced" := now();
  return new;
end;
$$;
create trigger members_last_synced before update on public.members
  for each row execute function public.tg_set_last_synced();

-- attendees uses "updatedAt"
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new."updatedAt" := now();
  return new;
end;
$$;

create trigger attendees_updated_at before update on public.attendees
  for each row execute function public.tg_set_updated_at();

-- replica identity full so realtime + update triggers carry old row data
alter table public.events      replica identity full;
alter table public.fundraising replica identity full;
alter table public.attendees   replica identity full;

-- ---------- public.users row created on auth.users insert ----------
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, "email", "displayName", "role", "needsOnboarding")
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'displayName', new.email),
    'member',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
