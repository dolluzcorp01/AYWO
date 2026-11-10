-- T-SEC: pgTAP tests for the access rules (LLD L4). Run: supabase test db
begin;
create extension if not exists pgtap;
select plan(19);

insert into languages (code, name_en) values ('en', 'English') on conflict do nothing;

-- Fixed test users. A trigger makes their profiles.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'creator@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'viewer@test.local'),
  ('00000000-0000-0000-0000-000000000003', 'approval@test.local'),
  ('00000000-0000-0000-0000-000000000004', 'branch@test.local'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@test.local'),
  ('00000000-0000-0000-0000-000000000006', 'plus@test.local');

insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-000000000001', 'Test family', '00000000-0000-0000-0000-000000000001');

-- top -> a, top -> b. The branch editor is scoped to a.
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Top', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Branch A', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Branch B', '00000000-0000-0000-0000-000000000001');
insert into parent_child (tree_id, parent_id, child_id) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-000000000002', 'mobile', '+919800000000', '+919800000000', '00000000-0000-0000-0000-000000000001');

insert into shares (tree_id, grantee_profile_id, role, edit_mode, contacts_visible, scope_person_id, created_by) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'viewer', 'direct', false, null, '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'editor', 'approval', false, null, '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'editor', 'direct', false, '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'viewer', 'direct', true, null, '00000000-0000-0000-0000-000000000001');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Closure and loops
select is((select depth::int from person_closure
   where ancestor_id = '20000000-0000-0000-0000-000000000001' and descendant_id = '20000000-0000-0000-0000-000000000002'),
   1, 'closure row written by trigger');
select throws_ok($$ insert into parent_child (tree_id, parent_id, child_id) values
   ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001') $$,
   'PT422', 'family_loop', 'a person cannot be their own ancestor');

-- Outsider
select test_login('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from persons), 0, 'outsider reads no people');
select is((select count(*)::int from trees), 0, 'outsider reads no trees');
reset role;

-- Viewer
select test_login('00000000-0000-0000-0000-000000000002');
select is((select count(*)::int from persons), 3, 'viewer reads the tree');
update persons set display_name = 'Hacked' where id = '20000000-0000-0000-0000-000000000001';
select throws_ok($$ select value from person_contacts $$, '42501', null, 'T-SEC: person_contacts cannot be read by any client');
select is(get_person_contacts('20000000-0000-0000-0000-000000000002') ->> 'has_mobile', 'true', 'T-CON-01: viewer without Plus sees the icon');
select is(get_person_contacts('20000000-0000-0000-0000-000000000002') -> 'values', null::jsonb, 'T-CON-01: and no value');
select throws_ok($$ update persons set claimed_by = auth.uid() $$, '42501', null, 'claimed_by cannot be set by a client');
reset role;
select is((select display_name from persons where id = '20000000-0000-0000-0000-000000000001'), 'Top', 'viewer update changed nothing');

-- T-SHR-01: approval-mode editor
select test_login('00000000-0000-0000-0000-000000000003');
update persons set display_name = 'Direct write' where id = '20000000-0000-0000-0000-000000000001';
select lives_ok($$ insert into requests (tree_id, kind, requester_id, target_person_id, payload) values
   ('10000000-0000-0000-0000-000000000001', 'change', auth.uid(), '20000000-0000-0000-0000-000000000001', '{"display_name":"New"}') $$,
   'approval editor can file a request');
reset role;
select is((select display_name from persons where id = '20000000-0000-0000-0000-000000000001'), 'Top', 'T-SHR-01: direct write rejected');

-- T-SHR-02: branch editor
select test_login('00000000-0000-0000-0000-000000000004');
update persons set display_name = 'Branch A edited', version = 1 where id = '20000000-0000-0000-0000-000000000002';
update persons set display_name = 'Outside edit' where id = '20000000-0000-0000-0000-000000000003';
reset role;
select is((select display_name from persons where id = '20000000-0000-0000-0000-000000000002'), 'Branch A edited', 'branch editor edits inside');
select is((select display_name from persons where id = '20000000-0000-0000-0000-000000000003'), 'Branch B', 'T-SHR-02: edit outside the branch rejected');

-- T-SHR-03: version clash
select throws_ok($$ update persons set display_name = 'Stale', version = 1 where id = '20000000-0000-0000-0000-000000000002' $$,
   'PT409', 'version_conflict', 'T-SHR-03: stale save gets a clash');

-- History never holds contact values
select is((select count(*)::int from history where table_name = 'person_contacts' and after ? 'value'), 0, 'contact values stay out of history');

-- T-CON-02: Plus with contacts_visible
insert into family_plans (id, payer_id, store, product_id, status, external_id) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'razorpay', 'aywo_plus_yearly', 'active', 'x');
select test_login('00000000-0000-0000-0000-000000000006');
select is(get_person_contacts('20000000-0000-0000-0000-000000000002') -> 'values' -> 0 ->> 'value', '+919800000000', 'T-CON-02: Plus and contacts_visible shows values');
reset role;

-- T-CON-03: own contacts without Plus
update persons set claimed_by = '00000000-0000-0000-0000-000000000005' where id = '20000000-0000-0000-0000-000000000002';
select test_login('00000000-0000-0000-0000-000000000005');
select is(get_person_contacts('20000000-0000-0000-0000-000000000002') -> 'values' -> 0 ->> 'value', '+919800000000', 'T-CON-03: your own contacts always show');
reset role;

-- T-PAY-02: seventh member
insert into family_plan_members (plan_id, profile_id)
  select '30000000-0000-0000-0000-000000000001', id from auth.users where email like '%@test.local';
select throws_ok($$ with u as (insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000007', 'x@test.local') returning id),
   p as (insert into profiles (id, display_name) select id, 'X' from u on conflict do nothing returning id)
   insert into family_plan_members (plan_id, profile_id) select '30000000-0000-0000-0000-000000000001', id from p $$,
   'PT422', 'family_plan_full', 'T-PAY-02: seventh member rejected');

select * from finish();
rollback;
