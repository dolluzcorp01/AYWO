-- PR 29: profile_number shows a family member's mobile only where the person card would.
begin;
create extension if not exists pgtap;
select plan(11);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000029a1', 'sn1@test.local', '919800002901', now()),
  ('00000000-0000-0000-0000-0000000029a2', 'sn2@test.local', '919800002902', now()),
  ('00000000-0000-0000-0000-0000000029a3', 'sn3@test.local', '919800002903', now());
update profiles set login_phone = '+919800002901' where id = '00000000-0000-0000-0000-0000000029a1';
insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000029a1', 'Numbers family', '00000000-0000-0000-0000-0000000029a1');
insert into persons (id, tree_id, display_name, created_by, claimed_by) values
  ('20000000-0000-0000-0000-0000000029a1', '10000000-0000-0000-0000-0000000029a1', 'Owner', '00000000-0000-0000-0000-0000000029a1', '00000000-0000-0000-0000-0000000029a1'),
  ('20000000-0000-0000-0000-0000000029a2', '10000000-0000-0000-0000-0000000029a1', 'Sister', '00000000-0000-0000-0000-0000000029a1', '00000000-0000-0000-0000-0000000029a2');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-0000000029a2', 'mobile', '+919876543210', '919876543210', '00000000-0000-0000-0000-0000000029a1');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- The Creator without Plus: the card says "needs Plus", so no number here either.
select test_login('00000000-0000-0000-0000-0000000029a1');
select is(profile_number('00000000-0000-0000-0000-0000000029a2'), null, 'no Plus: no number');
select is(profile_number('00000000-0000-0000-0000-0000000029a1'), '+919800002901', 'your own number is always shown');
reset role;

-- With Plus the Creator sees it.
update profiles set plus_bonus_until = now() + interval '30 days' where id = '00000000-0000-0000-0000-0000000029a1';
select test_login('00000000-0000-0000-0000-0000000029a1');
select is(profile_number('00000000-0000-0000-0000-0000000029a2'), '+919876543210', 'Creator with Plus sees the number');
select is(profile_number('00000000-0000-0000-0000-0000000029a3'), null, 'someone with no card in your trees: nothing');
reset role;

-- A viewer with Plus but no "Show contact numbers": still nothing.
update profiles set plus_bonus_until = now() + interval '30 days' where id = '00000000-0000-0000-0000-0000000029a2';
insert into persons (id, tree_id, display_name, created_by, claimed_by) values
  ('20000000-0000-0000-0000-0000000029a3', '10000000-0000-0000-0000-0000000029a1', 'Cousin', '00000000-0000-0000-0000-0000000029a1', '00000000-0000-0000-0000-0000000029a3');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-0000000029a3', 'mobile', '+919800002903', '919800002903', '00000000-0000-0000-0000-0000000029a1');
select test_login('00000000-0000-0000-0000-0000000029a2');
select is(profile_number('00000000-0000-0000-0000-0000000029a3'), null, 'viewer without contact rights: no number');
reset role;

-- A deleted card shows nothing.
update persons set deleted_at = now() where id = '20000000-0000-0000-0000-0000000029a2';
select test_login('00000000-0000-0000-0000-0000000029a1');
select is(profile_number('00000000-0000-0000-0000-0000000029a2'), null, 'deleted card: no number');
reset role;

-- A claimed card with no number typed on it shows the owner's sign-in number, under the same rule.
update profiles set login_phone = '+919800002902' where id = '00000000-0000-0000-0000-0000000029a2';
update persons set deleted_at = null where id = '20000000-0000-0000-0000-0000000029a2';
delete from person_contacts where person_id = '20000000-0000-0000-0000-0000000029a2';
select test_login('00000000-0000-0000-0000-0000000029a1');
select is(get_person_contacts('20000000-0000-0000-0000-0000000029a2')->'values'->0->>'value', '+919800002902', 'card shows the sign-in number when none was typed');
select is(profile_number('00000000-0000-0000-0000-0000000029a2'), '+919800002902', 'and so does the chat header');
reset role;
-- The Sister, a viewer without contact rights, is only told a number exists.
select test_login('00000000-0000-0000-0000-0000000029a2');
select is(get_person_contacts('20000000-0000-0000-0000-0000000029a1') ? 'values', false, 'viewer gets no values for the Creator');
reset role;
-- A typed number wins over the sign-in number.
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-0000000029a2', 'mobile', '+919811111111', '919811111111', '00000000-0000-0000-0000-0000000029a1');
select test_login('00000000-0000-0000-0000-0000000029a1');
select is(jsonb_array_length(get_person_contacts('20000000-0000-0000-0000-0000000029a2')->'values'), 1, 'typed number replaces the sign-in one');
reset role;

-- Not callable without signing in.
set local role anon;
select throws_ok($$ select profile_number('00000000-0000-0000-0000-0000000029a1') $$, '42501', null, 'anon cannot call it');
reset role;

select * from finish();
rollback;
