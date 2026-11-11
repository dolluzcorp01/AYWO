-- 0015: the family calendar shows the right days to the right people, and remembrance reminders go once.
begin;
create extension if not exists pgtap;
select plan(26);

-- c1 Meena (tree Creator), c2 Ravi (hosts an invitation to Meena), c3 Outsider (no tree).
insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'meena13@test.local', '+919811400001', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'ravi13@test.local', '+919811400002', now()),
  ('00000000-0000-0000-0000-0000000000c3', 'out13@test.local', '+919811400003', now());
update profiles set display_name = 'Meena' where id = '00000000-0000-0000-0000-0000000000c1';
update profiles set display_name = 'Ravi' where id = '00000000-0000-0000-0000-0000000000c2';

insert into trees (id, name, creator_id) values ('10000000-0000-0000-0000-0000000000c1', 'Meena family', '00000000-0000-0000-0000-0000000000c1');
insert into persons (id, tree_id, display_name, created_by, living, birth_date, birth_precision, death_date, death_precision) values
  -- Meena herself, birthday in 5 days.
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'Meena', '00000000-0000-0000-0000-0000000000c1', 'living',
   (current_date - interval '30 years' + interval '5 days')::date, 'exact', null, null),
  -- A cousin born on 2 January: shows across the new year.
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c1', 'Cousin Jan', '00000000-0000-0000-0000-0000000000c1', 'living',
   '1990-01-02', 'exact', null, null),
  -- A leap-day baby.
  ('20000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c1', 'Leap Kavi', '00000000-0000-0000-0000-0000000000c1', 'living',
   '1996-02-29', 'exact', null, null),
  -- Grandpa passed 10 years ago, 3 days from now.
  ('20000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-0000000000c1', 'Grandpa Raman', '00000000-0000-0000-0000-0000000000c1', 'deceased',
   '1930-06-01', 'exact', (current_date - interval '10 years' + interval '3 days')::date, 'exact'),
  -- Only the month is known: no remembrance day is invented.
  ('20000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-0000000000c1', 'Great-grandma', '00000000-0000-0000-0000-0000000000c1', 'deceased',
   null, null, (current_date - interval '40 years' + interval '3 days')::date, 'month'),
  -- Grandma passed on this day 20 years ago: today's reminder.
  ('20000000-0000-0000-0000-0000000000c6', '10000000-0000-0000-0000-0000000000c1', 'Grandma Saroja', '00000000-0000-0000-0000-0000000000c1', 'deceased',
   null, null, (current_date - interval '20 years')::date, 'exact'),
  -- Parents married 35 years ago, in 10 days.
  ('20000000-0000-0000-0000-0000000000c7', '10000000-0000-0000-0000-0000000000c1', 'Appa', '00000000-0000-0000-0000-0000000000c1', 'living', null, null, null, null),
  ('20000000-0000-0000-0000-0000000000c8', '10000000-0000-0000-0000-0000000000c1', 'Amma', '00000000-0000-0000-0000-0000000000c1', 'living', null, null, null, null);
update persons set claimed_by = '00000000-0000-0000-0000-0000000000c1' where id = '20000000-0000-0000-0000-0000000000c1';
insert into unions (id, tree_id, partner1_id, partner2_id, kind, status, start_date) values
  ('30000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c7', '20000000-0000-0000-0000-0000000000c8',
   'marriage', 'current', (current_date - interval '35 years' + interval '10 days')::date);
insert into events (id, host_id, kind, title, starts_at) values
  ('60000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', 'housewarming', 'Ravi housewarming', now() + interval '7 days'),
  ('60000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'wedding', 'Called off', now() + interval '8 days');
update events set cancelled_at = now() where id = '60000000-0000-0000-0000-0000000000c2';
insert into event_invitees (event_id, profile_id) values
  ('60000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1'),
  ('60000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

create function cal_kinds(p_from date, p_to date, p_name text) returns text language sql as $$
  select string_agg(x ->> 'kind', ',' order by x ->> 'date') from jsonb_array_elements(family_calendar(p_from, p_to)) x where x ->> 'name' = p_name
$$;
create function cal_item(p_from date, p_to date, p_name text) returns jsonb language sql as $$
  select x from jsonb_array_elements(family_calendar(p_from, p_to)) x where x ->> 'name' = p_name limit 1
$$;
grant execute on function cal_kinds(date, date, text), cal_item(date, date, text) to authenticated;

select test_login('00000000-0000-0000-0000-0000000000c1');
select is(cal_kinds(current_date, current_date + 30, 'Meena'), 'birthday', 'my own birthday is on my calendar');
select ok((cal_item(current_date, current_date + 30, 'Meena') ->> 'me')::boolean, 'and marked as mine');
select is((cal_item(current_date, current_date + 30, 'Meena') ->> 'years')::int, 30, 'with the age I turn');
select is(cal_kinds(current_date, current_date + 30, 'Grandpa Raman'), 'remembrance', 'Grandpa''s remembrance day shows');
select is((cal_item(current_date, current_date + 30, 'Grandpa Raman') ->> 'years')::int, 10, 'with how many years since');
select is((cal_item(current_date, current_date + 30, 'Grandpa Raman') ->> 'date')::date, current_date + 3, 'on the right day');
select is(cal_kinds(current_date - 60, current_date + 1, 'Grandpa Raman'), null, 'a dead person''s birthday is not shown as a birthday');
select is(cal_kinds(current_date, current_date + 30, 'Great-grandma'), null, 'no remembrance day when only the month is known');
select is(cal_kinds(current_date, current_date + 30, 'Appa & Amma'), 'anniversary', 'the parents'' wedding anniversary shows');
select is((cal_item(current_date, current_date + 30, 'Appa & Amma') ->> 'years')::int, 35, 'with the number of years');
select is(cal_kinds(current_date, current_date + 30, 'Ravi housewarming'), 'event', 'an invitation I got shows');
select is(cal_kinds(current_date, current_date + 30, 'Called off'), null, 'a cancelled invitation does not');
select is((cal_item('2026-12-20', '2027-01-10', 'Cousin Jan') ->> 'date')::date, '2027-01-02'::date, 'a range across the new year finds January');
select is((cal_item('2027-02-01', '2027-02-28', 'Leap Kavi') ->> 'date')::date, '2027-02-28'::date, 'a 29 February birthday shows on 28 February in other years');
select is((cal_item('2028-02-01', '2028-02-29', 'Leap Kavi') ->> 'date')::date, '2028-02-29'::date, 'and on 29 February in a leap year');
select throws_ok($$ select family_calendar(current_date, current_date + 90) $$, 'PT422', 'calendar_range', 'a range over 62 days is refused');
select throws_ok($$ select family_calendar(current_date, current_date - 1) $$, 'PT422', 'calendar_range', 'a backwards range is refused');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c3');
select is(jsonb_array_length(family_calendar(current_date, current_date + 30)), 0, 'someone outside the family sees nothing');
reset role;

-- Setting a wedding date in the app.
select test_login('00000000-0000-0000-0000-0000000000c1');
select is(union_set_date('30000000-0000-0000-0000-0000000000c1', null, (current_date - interval '35 years' + interval '20 days')::date) ->> 'status', 'saved',
  'the Creator sets the wedding date');
select is((cal_item(current_date, current_date + 30, 'Appa & Amma') ->> 'date')::date, current_date + 20, 'the anniversary moves to the new day');
select throws_ok($$ select union_set_date('30000000-0000-0000-0000-0000000000c1', null, current_date + 5) $$, 'PT422', 'bad_date', 'a wedding in the future is refused');
select throws_ok($$ select union_set_date('30000000-0000-0000-0000-0000000000c1', 1, current_date - 100) $$, 'PT409', 'version_conflict', 'an old version is refused');
reset role;
select ok(exists (select 1 from history where table_name = 'unions' and row_id = '30000000-0000-0000-0000-0000000000c1'), 'the change is in History');
select test_login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select union_set_date('30000000-0000-0000-0000-0000000000c1', null, current_date - 100) $$, 'PT403', 'not_allowed', 'an outsider cannot set it');
reset role;

-- The reminder: once, only after 8 in the morning India time, and not again the same day.
select is(remembrance_reminders(),
  case when extract(hour from now() at time zone 'Asia/Kolkata') >= 8 then 1 else 0 end,
  'today''s remembrance reminder goes to the family (after 8 am)');
select is(remembrance_reminders(), 0, 'and only once');

select * from finish();
rollback;
