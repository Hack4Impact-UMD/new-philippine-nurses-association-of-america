-- Row Level Security — mirrors firestore.rules
-- Roles come from auth.users.app_metadata.user_role (set by the OAuth callback).

create or replace function public.auth_role() returns text
language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'user_role'),
    'member'
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$
  select public.auth_role() in ('national_admin','region_admin','chapter_admin');
$$;

create or replace function public.is_national_admin() returns boolean
language sql stable as $$
  select public.auth_role() = 'national_admin';
$$;

create or replace function public.is_region_admin() returns boolean
language sql stable as $$
  select public.auth_role() = 'region_admin';
$$;

-- Enable RLS
alter table public.members              enable row level security;
alter table public.chapters             enable row level security;
alter table public.events               enable row level security;
alter table public.attendees            enable row level security;
alter table public.fundraising          enable row level security;
alter table public.subchapters          enable row level security;
alter table public.chapter_aliases      enable row level security;
alter table public.users                enable row level security;
alter table public.pending_registrations enable row level security;
alter table public.sync_logs            enable row level security;

-- members: read all authed, no client writes
create policy members_read on public.members for select
  to authenticated using (true);

-- chapters: read all authed, no client writes
create policy chapters_read on public.chapters for select
  to authenticated using (true);

-- events: read authed, create/update admins, no client deletes
create policy events_read   on public.events for select to authenticated using (true);
create policy events_create on public.events for insert to authenticated with check (public.is_admin());
create policy events_update on public.events for update to authenticated using (public.is_admin());

-- attendees: read authed, full CRUD for admins
create policy attendees_read   on public.attendees for select to authenticated using (true);
create policy attendees_write  on public.attendees for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- fundraising: read authed, create/update admins
create policy fund_read    on public.fundraising for select to authenticated using (true);
create policy fund_create  on public.fundraising for insert to authenticated with check (public.is_admin());
create policy fund_update  on public.fundraising for update to authenticated using (public.is_admin());

-- subchapters: read authed, create/update admins
create policy subch_read   on public.subchapters for select to authenticated using (true);
create policy subch_create on public.subchapters for insert to authenticated with check (public.is_admin());
create policy subch_update on public.subchapters for update to authenticated using (public.is_admin());

-- chapter aliases: read authed, create/delete national/region only
create policy aliases_read   on public.chapter_aliases for select to authenticated using (true);
create policy aliases_create on public.chapter_aliases for insert to authenticated
  with check (public.is_national_admin() or public.is_region_admin());
create policy aliases_delete on public.chapter_aliases for delete to authenticated
  using (public.is_national_admin() or public.is_region_admin());

-- users: read self or national_admin reads all
create policy users_read on public.users for select to authenticated
  using (auth.uid() = id or public.is_national_admin());

-- sync_logs: read national_admin only
create policy synclogs_read on public.sync_logs for select to authenticated using (public.is_national_admin());

-- pending_registrations: service role only (no policy needed — RLS denies by default)
