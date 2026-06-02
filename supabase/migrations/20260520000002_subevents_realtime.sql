-- Surface subevents catalog inserts/updates to clients via Realtime so the
-- use-subevents singleton cache refreshes automatically on every open page.
-- Without this, only the tab that did the insert sees the new row until reload.
--
-- Idempotent: the table may already be in the publication if it was added
-- manually via Studio during development.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'subevents'
  ) then
    alter publication supabase_realtime add table public.subevents;
  end if;
end $$;
