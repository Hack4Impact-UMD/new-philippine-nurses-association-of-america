-- events.id default for app-created events.
--
-- events.id is the Wild Apricot event ID for synced events, so the column has
-- no default — WA sync always supplies it explicitly. But the in-app create
-- paths (event-form, bulk-event-upload) insert without an id, which tripped
-- "null value in column \"id\" of relation \"events\" violates not-null
-- constraint" on every save. Give the column a generated default so app inserts
-- get an id automatically. WA sync still passes its own id, so there's no
-- collision (uuid text vs. numeric WA ids).
alter table public.events
  alter column id set default gen_random_uuid()::text;
