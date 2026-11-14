-- PR 23: linking people already in the tree, and fixing links (change, remove) without deleting anyone.
begin;
create extension if not exists pgtap;
select plan(26);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000023a1', 'links1@test.local', '919800002301', now()),
  ('00000000-0000-0000-0000-0000000023a2', 'links2@test.local', '919800002302', now());
insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000023a1', 'Links family', '00000000-0000-0000-0000-0000000023a1');
insert into shares (tree_id, grantee_profile_id, role, edit_mode, scope_person_id, created_by) values
  ('10000000-0000-0000-0000-0000000023a1', '00000000-0000-0000-0000-0000000023a2', 'viewer', 'direct', null, '00000000-0000-0000-0000-0000000023a1');
-- Pavithran's case: Sathana has Veeraiyan only; Pavithran has Veeraiyan and Ezhilarasi (a couple).
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-0000000023a1', '10000000-0000-0000-0000-0000000023a1', 'Pavithran', '00000000-0000-0000-0000-0000000023a1'),
  ('20000000-0000-0000-0000-0000000023a2', '10000000-0000-0000-0000-0000000023a1', 'Veeraiyan', '00000000-0000-0000-0000-0000000023a1'),
  ('20000000-0000-0000-0000-0000000023a3', '10000000-0000-0000-0000-0000000023a1', 'Ezhilarasi', '00000000-0000-0000-0000-0000000023a1'),
  ('20000000-0000-0000-0000-0000000023a4', '10000000-0000-0000-0000-0000000023a1', 'Sathana', '00000000-0000-0000-0000-0000000023a1'),
  ('20000000-0000-0000-0000-0000000023a5', '10000000-0000-0000-0000-0000000023a1', 'Cousin', '00000000-0000-0000-0000-0000000023a1'),
  ('20000000-0000-0000-0000-0000000023a6', '10000000-0000-0000-0000-0000000023a1', 'Uncle', '00000000-0000-0000-0000-0000000023a1');
insert into unions (id, tree_id, partner1_id, partner2_id, kind, status) values
  ('30000000-0000-0000-0000-0000000023a1', '10000000-0000-0000-0000-0000000023a1',
   '20000000-0000-0000-0000-0000000023a2', '20000000-0000-0000-0000-0000000023a3', 'marriage', 'current');
insert into parent_child (tree_id, parent_id, child_id, union_id) values
  ('10000000-0000-0000-0000-0000000023a1', '20000000-0000-0000-0000-0000000023a2', '20000000-0000-0000-0000-0000000023a1', '30000000-0000-0000-0000-0000000023a1'),
  ('10000000-0000-0000-0000-0000000023a1', '20000000-0000-0000-0000-0000000023a3', '20000000-0000-0000-0000-0000000023a1', '30000000-0000-0000-0000-0000000023a1'),
  ('10000000-0000-0000-0000-0000000023a1', '20000000-0000-0000-0000-0000000023a2', '20000000-0000-0000-0000-0000000023a4', null),
  ('10000000-0000-0000-0000-0000000023a1', '20000000-0000-0000-0000-0000000023a6', '20000000-0000-0000-0000-0000000023a5', null);

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;
create function parents_of(p uuid) returns text language sql as $$
  select string_agg(pp.display_name, ',' order by pp.display_name)
  from parent_child pc join persons pp on pp.id = pc.parent_id where pc.child_id = p
$$;
grant execute on function parents_of(uuid) to authenticated;

select test_login('00000000-0000-0000-0000-0000000023a1');

-- 1. The exact failure: Sathana (already Veeraiyan's child) added as Ezhilarasi's child with Veeraiyan.
select lives_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a3', 'child', null,
  '20000000-0000-0000-0000-0000000023a4', '30000000-0000-0000-0000-0000000023a1') $$,
  'adding Sathana as Ezhilarasi''s child (already Veeraiyan''s) works');
select is(parents_of('20000000-0000-0000-0000-0000000023a4'), 'Ezhilarasi,Veeraiyan', 'Sathana now has both parents');
select is((select count(distinct union_id)::int from parent_child where child_id = '20000000-0000-0000-0000-0000000023a4'), 1,
  'and sits under the couple');
select is((select count(*)::int from parent_child where child_id = '20000000-0000-0000-0000-0000000023a4'), 2, 'no link twice');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a3', 'child', null,
  '20000000-0000-0000-0000-0000000023a4', '30000000-0000-0000-0000-0000000023a1') $$,
  'PT422', 'already_linked', 'doing it again says it is already linked');

-- 2. Parent: someone who is already the parent.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a4', 'parent', null, '20000000-0000-0000-0000-0000000023a3') $$,
  'PT422', 'already_linked', 'an existing parent cannot be added again');
-- 3. Partner twice.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a2', 'spouse', null, '20000000-0000-0000-0000-0000000023a3') $$,
  'PT422', 'already_linked', 'the same partner cannot be added twice');
-- 4. Yourself.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a2', 'child', null, '20000000-0000-0000-0000-0000000023a2') $$,
  'PT422', 'same_person', 'a person cannot be linked to themselves');
-- 5. A loop: Veeraiyan as his own son's child.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a1', 'child', null, '20000000-0000-0000-0000-0000000023a2') $$,
  'PT422', 'family_loop', 'a parent cannot become their child''s child');
-- 6. Brother or sister: same parents already.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a1', 'sibling', null, '20000000-0000-0000-0000-0000000023a4') $$,
  'PT422', 'already_linked', 'brother and sister with the same parents already');
-- 7. Brother or sister with different parents.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a1', 'sibling', null, '20000000-0000-0000-0000-0000000023a5') $$,
  'PT422', 'different_parents', 'someone with different parents is not made a brother by birth');

-- 7b. A parent cannot also be a brother or a partner.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a1', 'sibling', null, '20000000-0000-0000-0000-0000000023a2') $$,
  'PT422', 'family_loop', 'your father cannot be your brother');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a1', 'spouse', null, '20000000-0000-0000-0000-0000000023a3') $$,
  'PT422', 'family_loop', 'your mother cannot be your partner');

-- 8. Change how a parent is linked, and the two-by-birth rule.
select lives_ok($$ select link_set_kind('20000000-0000-0000-0000-0000000023a3', '20000000-0000-0000-0000-0000000023a4', 'step') $$,
  'a link can be changed to step');
select is((select kind::text from parent_child where parent_id = '20000000-0000-0000-0000-0000000023a3' and child_id = '20000000-0000-0000-0000-0000000023a4'),
  'step', 'the link is now step');
select lives_ok($$ select add_relative('20000000-0000-0000-0000-0000000023a4', 'parent', null, '20000000-0000-0000-0000-0000000023a6', null, 'adopted') $$,
  'a third parent can be added when not by birth');
select lives_ok($$ select link_set_kind('20000000-0000-0000-0000-0000000023a3', '20000000-0000-0000-0000-0000000023a4', 'birth') $$,
  'back to by birth (two by birth)');
select throws_ok($$ select link_set_kind('20000000-0000-0000-0000-0000000023a6', '20000000-0000-0000-0000-0000000023a4', 'birth') $$,
  'PT422', 'already_two_parents', 'never more than two parents by birth');

-- 9. Remove a wrong link.
select lives_ok($$ select link_remove('20000000-0000-0000-0000-0000000023a6', '20000000-0000-0000-0000-0000000023a4') $$,
  'a wrong parent link can be removed');
select is(parents_of('20000000-0000-0000-0000-0000000023a4'), 'Ezhilarasi,Veeraiyan', 'Sathana keeps her real parents');
select ok((select deleted_at is null from persons where id = '20000000-0000-0000-0000-0000000023a6'), 'the person stays in the tree');

-- 10. Partner status and removal.
select lives_ok($$ select union_set_status('30000000-0000-0000-0000-0000000023a1', 'divorced') $$, 'a marriage can be marked divorced');
select is((select status::text from unions where id = '30000000-0000-0000-0000-0000000023a1'), 'divorced', 'status saved');

-- 11. Viewers cannot change links.
reset role;
select test_login('00000000-0000-0000-0000-0000000023a2');
select throws_ok($$ select link_remove('20000000-0000-0000-0000-0000000023a2', '20000000-0000-0000-0000-0000000023a1') $$,
  'PT403', 'not_allowed', 'a viewer cannot remove links');
reset role;
select test_login('00000000-0000-0000-0000-0000000023a1');
select lives_ok($$ select union_remove('30000000-0000-0000-0000-0000000023a1') $$, 'a partner link can be removed');
reset role;
select is(parents_of('20000000-0000-0000-0000-0000000023a1'), 'Ezhilarasi,Veeraiyan', 'their son keeps both parents after it');

select * from finish();
rollback;
