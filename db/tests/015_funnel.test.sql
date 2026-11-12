-- 0017: step notes count once per device, carry nothing personal, and only Analytics staff can read the funnel.
begin;
create extension if not exists pgtap;
select plan(14);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'staff15@test.local', '+919811600001', now()),
  ('00000000-0000-0000-0000-0000000000a2', 'user15@test.local', '+919811600002', now());
insert into app_admins (profile_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'aywo_admin');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- Start from an empty table so the numbers below are exact.
delete from app_events;

-- Device 1: Android, Tamil, goes all the way to five people. Device 2: web, English, stops after asking for a code.
-- Device 3: web, English, only opens the app. Device 4: opened 60 days ago, outside a 30-day window.
select track_event('10000000-0000-0000-0000-0000000000d1', e, 'android', 'ta-IN')
  from unnest(array['app_opened', 'code_requested', 'code_verified', 'name_saved', 'tree_started', 'first_relative', 'five_people']) e;
select track_event('10000000-0000-0000-0000-0000000000d2', e, 'web', 'en-US') from unnest(array['app_opened', 'code_requested']) e;
select track_event('10000000-0000-0000-0000-0000000000d3', 'app_opened', 'web', 'en');
insert into app_events (device_id, event, platform, lang, created_at) values
  ('10000000-0000-0000-0000-0000000000d4', 'app_opened', 'ios', 'en', now() - interval '60 days'),
  ('10000000-0000-0000-0000-0000000000d4', 'code_requested', 'ios', 'en', now() - interval '60 days');

select is((select count(*)::int from app_events where device_id = '10000000-0000-0000-0000-0000000000d1'), 7, 'one note per step');
select lives_ok($$ select track_event('10000000-0000-0000-0000-0000000000d1', 'app_opened', 'android', 'ta') $$, 'sending a step again is fine');
select is((select count(*)::int from app_events where device_id = '10000000-0000-0000-0000-0000000000d1'), 7, 'and adds nothing');
select is((select lang from app_events where device_id = '10000000-0000-0000-0000-0000000000d2' limit 1), 'en', 'language is kept short (en-US becomes en)');
select throws_ok($$ select track_event('10000000-0000-0000-0000-0000000000d5', 'bought_house', 'web', 'en') $$, '23514', null, 'unknown steps are refused');
select throws_ok($$ select track_event('10000000-0000-0000-0000-0000000000d5', 'app_opened', 'windows', 'en') $$, '23514', null, 'unknown platforms are refused');
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns where table_name = 'app_events'),
  array['created_at', 'device_id', 'event', 'lang', 'platform'],
  'the table has no room for a name, phone or account');

select test_login('00000000-0000-0000-0000-0000000000a1');
select is((admin_funnel(30) -> 'steps' -> 0 ->> 'devices')::int, 3, 'three devices opened the app in 30 days');
select is((admin_funnel(30) -> 'steps' -> 1 ->> 'devices')::int, 2, 'two asked for a code');
select is((admin_funnel(30) -> 'steps' -> 6 ->> 'devices')::int, 1, 'one reached five people');
select is(admin_funnel(30) -> 'by_platform' -> 'web', '[2, 1, 0, 0, 0, 0, 0, 0]'::jsonb, 'web, step by step');
select is(admin_funnel(30) -> 'by_lang' -> 'ta', '[1, 1, 1, 1, 1, 1, 1, 0]'::jsonb, 'Tamil, step by step');
select is((admin_funnel(90) -> 'steps' -> 0 ->> 'devices')::int, 4, 'a 90-day window includes the older device');
reset role;

select test_login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ select admin_funnel(30) $$, 'PT403', null, 'an ordinary user cannot read the funnel');
reset role;

select * from finish();
rollback;
