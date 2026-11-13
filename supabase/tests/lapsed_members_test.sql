-- pgTAP tests for public.lapsed_members(). Run with `supabase test db`.
--
-- Everything runs in one transaction that is rolled back, against fixture rows
-- whose ids start with 'tst-' so they can be told apart from any data already
-- in the database. Calls are made as the `authenticated` role with forged JWT
-- claims, so members_read RLS and resolve_view_scope() are exercised for real.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

-- ---------- fixtures ----------

insert into public.chapters (id, "name", region) values
  ('tst-ch-ne', 'TST Northeast Chapter', 'TST North'),
  ('tst-ch-w',  'TST West Chapter',      'TST West');

-- Day counts are relative to the org's calendar day, as the function's are.
create temp table tst_today as
  select (now() at time zone 'America/New_York')::date as d;
grant select on tst_today to authenticated;

insert into public.members (id, "name", "email", "membershipLevel", "renewalDueDate", "chapterId", region, "activeStatus")
select v.id, v.name, v.id || '@example.com', 'Regular Member', v.due, v.ch, v.region, v.status
from (values
  ('tst-10',     'Ten',       null, 'tst-ch-ne', 'TST North', 'Lapsed'),
  ('tst-45',     'FortyFive', null, 'tst-ch-ne', 'TST North', 'Lapsed'),
  ('tst-120',    'OneTwenty', null, 'tst-ch-w',  'TST West',  'Lapsed'),
  ('tst-active', 'Active',    null, 'tst-ch-ne', 'TST North', 'Active'),
  ('tst-nodate', 'NoDate',    null, 'tst-ch-ne', 'TST North', 'Lapsed'),
  ('tst-junk',   'JunkDate',  'not a date', 'tst-ch-ne', 'TST North', 'Lapsed'),
  ('tst-future', 'Future',    null, 'tst-ch-ne', 'TST North', 'Lapsed')
) as v(id, name, due, ch, region, status);

-- Due dates relative to today. Mostly bare YYYY-MM-DD as the sync writes them;
-- one carries a time part, which some Wild Apricot fields do.
update public.members m set "renewalDueDate" = x.due
from tst_today t, (values
  ('tst-10',     -10,  false),
  ('tst-45',     -45,  true),
  ('tst-120',    -120, false),
  ('tst-active', 200,  false),
  ('tst-future', 1,    false)
) as y(id, offset_days, with_time),
lateral (
  select case when y.with_time
              then to_char(t.d + y.offset_days, 'YYYY-MM-DD') || 'T00:00:00'
              else to_char(t.d + y.offset_days, 'YYYY-MM-DD') end as due
) x
where m.id = y.id;

-- Helper: become a user with the given app_metadata, as PostgREST would.
create or replace function pg_temp.act_as(p_meta jsonb) returns void language sql as $$
  select set_config('request.jwt.claims',
                    jsonb_build_object('role', 'authenticated', 'app_metadata', p_meta)::text,
                    true);
$$;

-- Helper: the fixture rows from a call, as {memberId: daysLapsed}.
create or replace function pg_temp.tst_days(p_result jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(e ->> 'memberId', (e ->> 'daysLapsed')::int), '{}'::jsonb)
  from jsonb_array_elements(p_result) e
  where e ->> 'memberId' like 'tst-%';
$$;

set local role authenticated;

-- ---------- access ----------

select pg_temp.act_as('{"user_role": "member", "chapter_id": "tst-ch-ne"}');
select throws_ok(
  $$ select public.lapsed_members('chapter', 'tst-ch-ne') $$,
  '42501', null,
  'a plain member may not call it'
);

select pg_temp.act_as('{"user_role": "chapter_admin", "chapter_id": "tst-ch-ne", "region": "TST North"}');
select throws_ok(
  $$ select public.lapsed_members('national', null) $$,
  '42501', null,
  'a chapter admin may not ask for national'
);
select throws_ok(
  $$ select public.lapsed_members('chapter', 'tst-ch-w') $$,
  '42501', null,
  'a chapter admin may not ask for another chapter'
);

-- ---------- national admin: the computation ----------

select pg_temp.act_as('{"user_role": "national_admin"}');

select is(
  pg_temp.tst_days(public.lapsed_members('national', null)),
  '{"tst-10": 10, "tst-45": 45, "tst-120": 120, "tst-future": 0}'::jsonb,
  'national: every lapsed member with a usable date, with exact days lapsed'
);

select ok(
  not (pg_temp.tst_days(public.lapsed_members('national', null)) ? 'tst-active'),
  'active members are not listed'
);
select ok(
  not (pg_temp.tst_days(public.lapsed_members('national', null)) ?| array['tst-nodate', 'tst-junk']),
  'lapsed contacts with no or an unparseable renewal date are not listed'
);
select is(
  (pg_temp.tst_days(public.lapsed_members('national', null)) ->> 'tst-future')::int,
  0,
  'a due date still ahead on the org calendar reports 0 days, never negative'
);
select is(
  (pg_temp.tst_days(public.lapsed_members('national', null)) ->> 'tst-45')::int,
  45,
  'a renewal date with a time part is parsed by its date'
);

select is(
  (select e ->> 'lapsedOn' from jsonb_array_elements(public.lapsed_members('national', null)) e
    where e ->> 'memberId' = 'tst-10'),
  to_char((select d from tst_today) - 10, 'YYYY-MM-DD'),
  'lapsedOn is the renewal due date that passed'
);

select is(
  (select e ->> 'chapterName' from jsonb_array_elements(public.lapsed_members('national', null)) e
    where e ->> 'memberId' = 'tst-120'),
  'TST West Chapter',
  'rows carry the chapter name'
);

select is(
  (select array_agg(e ->> 'memberId' order by ord)
     from jsonb_array_elements(public.lapsed_members('national', null)) with ordinality as a(e, ord)
    where e ->> 'memberId' like 'tst-%'),
  array['tst-future', 'tst-10', 'tst-45', 'tst-120'],
  'freshest lapses first'
);

-- ---------- scoping ----------

select is(
  pg_temp.tst_days(public.lapsed_members('chapter', 'tst-ch-w')),
  '{"tst-120": 120}'::jsonb,
  'chapter scope lists only that chapter'
);
select is(
  pg_temp.tst_days(public.lapsed_members('region', 'TST North')),
  '{"tst-10": 10, "tst-45": 45, "tst-future": 0}'::jsonb,
  'region scope lists only that region'
);

select pg_temp.act_as('{"user_role": "chapter_admin", "chapter_id": "tst-ch-ne", "region": "TST North"}');
select is(
  pg_temp.tst_days(public.lapsed_members(null, null)),
  '{"tst-10": 10, "tst-45": 45, "tst-future": 0}'::jsonb,
  'a chapter admin with no scope gets their own chapter'
);

select pg_temp.act_as('{"user_role": "region_admin", "region": "TST West"}');
select is(
  pg_temp.tst_days(public.lapsed_members(null, null)),
  '{"tst-120": 120}'::jsonb,
  'a region admin with no scope gets their own region'
);
select throws_ok(
  $$ select public.lapsed_members('region', 'TST North') $$,
  '42501', null,
  'a region admin may not ask for another region'
);

select * from finish();
rollback;
