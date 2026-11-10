-- Person card: locked contacts, asking, elder and younger. Run: supabase test db
begin;
create extension if not exists pgtap;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'c3@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'v3@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'o3@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'approve3@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', 'branch3@test.local');
update profiles set display_name = 'Tree Maker' where id = '00000000-0000-0000-0000-0000000000a1';

insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000000a1', 'Card family', '00000000-0000-0000-0000-0000000000a1');
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', 'Parent', '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a1', 'Older', '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a1', 'Younger', '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-0000000000a1', 'Third', '00000000-0000-0000-0000-0000000000a1');
insert into parent_child (tree_id, parent_id, child_id) values
  ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a2'),
  ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a3'),
  ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a4');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-0000000000a2', 'mobile', '98000 00009', '+919800000009', '00000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000a3', 'mobile', '98000 00008', '+919800000008', '00000000-0000-0000-0000-0000000000a1');
insert into shares (tree_id, grantee_profile_id, role, edit_mode, contacts_visible, scope_person_id, created_by) values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'viewer', 'direct', false, null, '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4', 'editor', 'approval', false, null, '00000000-0000-0000-0000-0000000000a1'),
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5', 'editor', 'direct', true, '20000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Locked, with the reason (D2)
select test_login('00000000-0000-0000-0000-0000000000a2');
select is(person_card('20000000-0000-0000-0000-0000000000a2') ->> 'access', 'ask', 'D2: a viewer without permission must ask');
select is(person_card('20000000-0000-0000-0000-0000000000a2') ->> 'ask_from', 'Tree Maker', 'D2: the card says who to ask');
select ok(person_card('20000000-0000-0000-0000-0000000000a2') -> 'contacts' -> 'values' is null, 'D2: no contact values reach the app');
select lives_ok($$ select request_contacts('20000000-0000-0000-0000-0000000000a2') $$, 'asking works');
select lives_ok($$ select request_contacts('20000000-0000-0000-0000-0000000000a2') $$, 'asking twice works');
select is((select count(*)::int from requests where kind = 'access_contacts' and requester_id = auth.uid()), 1, 'asking twice stays one request');
select is((person_card('20000000-0000-0000-0000-0000000000a2') ->> 'request_pending'), 'true', 'the card shows the request is waiting');
reset role;
select is((select count(*)::int from notifications where kind = 'request_created' and recipient_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'the Creator is told once');

-- Creator without Plus: permission yes, Plus no
select test_login('00000000-0000-0000-0000-0000000000a1');
select is(person_card('20000000-0000-0000-0000-0000000000a2') ->> 'access', 'plus', 'the Creator still needs Plus');
reset role;

-- Branch share: contacts open only inside the branch
insert into family_plans (id, payer_id, store, product_id, status, external_id) values
  ('30000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5', 'razorpay', 'aywo_plus_yearly', 'active', 'y');
select test_login('00000000-0000-0000-0000-0000000000a5');
select is(person_card('20000000-0000-0000-0000-0000000000a2') ->> 'access', 'open', 'contacts_visible with Plus opens inside the branch');
select is(person_card('20000000-0000-0000-0000-0000000000a2') -> 'contacts' -> 'values' -> 0 ->> 'link_value', '+919800000009', 'the value comes with a clean number for the link');
select throws_ok($$ select person_card('20000000-0000-0000-0000-0000000000a3') $$, 'PT403', 'not_allowed', 'outside the branch the card is refused');
reset role;

-- Outsider
select test_login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select person_card('20000000-0000-0000-0000-0000000000a2') $$, 'PT403', 'not_allowed', 'an outsider gets no card');
reset role;

-- D4 by someone who can edit
select test_login('00000000-0000-0000-0000-0000000000a1');
select is(set_elder_younger('20000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-0000000000a2', false) ->> 'status', 'saved', 'D4: the answer is saved');
select is(set_elder_younger('20000000-0000-0000-0000-0000000000a4', '20000000-0000-0000-0000-0000000000a3', true) ->> 'status', 'saved', 'D4: a third sibling goes between');
select results_eq(
  $$ select display_name from persons where tree_id = '10000000-0000-0000-0000-0000000000a1' and birth_order is not null order by birth_order $$,
  $$ values ('Older'), ('Third'), ('Younger') $$,
  'F-TREE-06: birth order ends up right');
reset role;

-- D4 by an approval editor: nothing changes, a request is filed
select test_login('00000000-0000-0000-0000-0000000000a4');
select is(set_elder_younger('20000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-0000000000a3', false) ->> 'status', 'requested', 'T-SHR-01: goes for approval');
reset role;

select * from finish();
rollback;
