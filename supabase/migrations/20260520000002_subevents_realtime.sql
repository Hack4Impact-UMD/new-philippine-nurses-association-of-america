-- Surface subevents catalog inserts/updates to clients via Realtime so the
-- use-subevents singleton cache refreshes automatically on every open page.
-- Without this, only the tab that did the insert sees the new row until reload.

alter publication supabase_realtime add table public.subevents;
