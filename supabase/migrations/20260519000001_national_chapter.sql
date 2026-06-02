-- Seed the National chapter that WA-imported events default to.
-- Also surfaces "National" as a region in the chapter/region pickers
-- (they derive options from chapters.region).

insert into public.chapters (id, "name", "region")
values ('national', 'National', 'National')
on conflict (id) do nothing;

-- Backfill events that arrived from WA before chapterId defaulted to 'national'.
update public.events
set "chapterId" = 'national'
where "chapterId" is null;
