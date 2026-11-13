-- PR 21: a mother or father added later can also be linked to the brothers and sisters added before them.
begin;
create extension if not exists pgtap;
select plan(10);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000021a1', 'also1@test.local', '919800002101', now());
insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000021a1', 'Also family', '00000000-0000-0000-0000-0000000021a1');
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-0000000021a1', '10000000-0000-0000-0000-0000000021a1', 'Me', '00000000-0000-0000-0000-0000000021a1'),
  ('20000000-0000-0000-0000-0000000021a2', '10000000-0000-0000-0000-0000000021a1', 'Father', '00000000-0000-0000-0000-0000000021a1'),
  ('20000000-0000-0000-0000-0000000021a3', '10000000-0000-0000-0000-0000000021a1', 'Sister', '00000000-0000-0000-0000-0000000021a1'),
  ('20000000-0000-0000-0000-0000000021a4', '10000000-0000-0000-0000-0000000021a1', 'Half brother', '00000000-0000-0000-0000-0000000021a1'),
  ('20000000-0000-0000-0000-0000000021a5', '10000000-0000-0000-0000-0000000021a1', 'Stranger', '00000000-0000-0000-0000-0000000021a1');
-- Me, Sister and Half brother all have Father only (as when Father was added first, then the brothers and sisters).
insert into parent_child (tree_id, parent_id, child_id) values
  ('10000000-0000-0000-0000-0000000021a1', '20000000-0000-0000-0000-0000000021a2', '20000000-0000-0000-0000-0000000021a1'),
  ('10000000-0000-0000-0000-0000000021a1', '20000000-0000-0000-0000-0000000021a2', '20000000-0000-0000-0000-0000000021a3'),
  ('10000000-0000-0000-0000-0000000021a1', '20000000-0000-0000-0000-0000000021a2', '20000000-0000-0000-0000-0000000021a4');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

select test_login('00000000-0000-0000-0000-0000000021a1');

-- Someone who is not a brother or sister through Father cannot be ticked.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000021a1', 'parent', '{"display_name":"Mother"}',
  null, null, 'birth', array['20000000-0000-0000-0000-0000000021a5']::uuid[]) $$,
  'PT422', 'bad_also_child', 'a person who is not a brother or sister cannot be ticked');
-- Ticks only go with adding a parent.
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000021a1', 'child', '{"display_name":"Kid"}',
  null, null, 'birth', array['20000000-0000-0000-0000-0000000021a3']::uuid[]) $$,
  'PT422', 'bad_also_child', 'ticks only go with adding a parent');

-- Mother added with Sister ticked and Half brother not ticked.
select lives_ok($$ select add_relative('20000000-0000-0000-0000-0000000021a1', 'parent', '{"display_name":"Mother"}',
  null, null, 'birth', array['20000000-0000-0000-0000-0000000021a3']::uuid[]) $$, 'Mother is added with Sister ticked');
reset role;

select is((select count(*)::int from parent_child pc join persons p on p.id = pc.parent_id
           where p.display_name = 'Mother' and pc.child_id = '20000000-0000-0000-0000-0000000021a1'), 1, 'Mother is my mother');
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.parent_id
           where p.display_name = 'Mother' and pc.child_id = '20000000-0000-0000-0000-0000000021a3'), 1, 'Mother is also Sister''s mother');
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.parent_id
           where p.display_name = 'Mother' and pc.child_id = '20000000-0000-0000-0000-0000000021a4'), 0, 'Half brother, not ticked, keeps Father only');
select is((select count(distinct union_id)::int from parent_child
           where child_id in ('20000000-0000-0000-0000-0000000021a1', '20000000-0000-0000-0000-0000000021a3')),
          1, 'Me and Sister sit under the same Father and Mother couple');
select is((select union_id from parent_child where child_id = '20000000-0000-0000-0000-0000000021a4'), null,
          'Half brother is not put under the couple');

-- Without ticks it works as before.
select test_login('00000000-0000-0000-0000-0000000021a1');
select lives_ok($$ select add_relative('20000000-0000-0000-0000-0000000021a4', 'parent', '{"display_name":"Other mother"}') $$,
  'adding a parent with no ticks works as before');
reset role;
select is((select count(*)::int from parent_child where child_id = '20000000-0000-0000-0000-0000000021a4'), 2,
          'Half brother now has his own two parents');

select * from finish();
rollback;
