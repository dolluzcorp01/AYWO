-- Database functions: claiming, adding relatives, importing. Run: supabase test db
begin;
create extension if not exists pgtap;
select plan(19);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'creator2@test.local', '919800000001', now()),
  ('00000000-0000-0000-0000-00000000000b', 'uncle@test.local', '919800000002', now()),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@test.local', '919800000003', now()),
  ('00000000-0000-0000-0000-00000000000d', 'unverified@test.local', '919800000004', null);

insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-00000000000a', 'Claim family', '00000000-0000-0000-0000-00000000000a');
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'Uncle', '00000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'Uncle again', '00000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'Anchor', '00000000-0000-0000-0000-00000000000a');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-00000000000a', 'mobile', '98000 00002', '+919800000002', '00000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-00000000000b', 'mobile', '98000 00002', '+919800000002', '00000000-0000-0000-0000-00000000000a'),
  ('20000000-0000-0000-0000-00000000000c', 'mobile', '98000 00004', '+919800000004', '00000000-0000-0000-0000-00000000000a');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- T-ACC-01
select is((select login_phone from profiles where id = '00000000-0000-0000-0000-00000000000b'), '+919800000002', 'T-ACC-01: signing up makes a profile with the number');

-- T-ACC-02, T-ACC-03
select test_login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from claim_candidates()), 2, 'T-ACC-02/03: both entries with the number are offered');
select lives_ok($$ select claim_confirm('20000000-0000-0000-0000-00000000000a') $$, 'T-ACC-03: the chosen one is claimed');
select is((select count(*)::int from claim_candidates()), 0, 'no second claim in the same tree');
select throws_ok($$ select claim_confirm('20000000-0000-0000-0000-00000000000b') $$, 'PT403', 'not_your_entry', 'cannot claim two people in a tree');
reset role;
select is((select count(*)::int from persons where claimed_by = '00000000-0000-0000-0000-00000000000b'), 1, 'only one entry was claimed');
select is((select count(*)::int from notifications where kind = 'claim_made' and recipient_id = '00000000-0000-0000-0000-00000000000a'), 1, 'F-ACC-05: whoever added the person is told');

-- Not someone else's number, and not an unverified one
select test_login('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select claim_confirm('20000000-0000-0000-0000-00000000000b') $$, 'PT403', 'not_your_entry', 'a stranger cannot claim');
select throws_ok($$ select claim_undo('20000000-0000-0000-0000-00000000000a') $$, 'PT403', 'not_allowed', 'a stranger cannot undo a claim');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-00000000000c', 'child', '{"display_name":"X"}') $$, 'PT403', 'not_allowed', 'a stranger cannot add people');
reset role;
select test_login('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from claim_candidates()), 0, 'an unverified number matches nobody');
reset role;

-- T-ACC-04
select test_login('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select claim_undo('20000000-0000-0000-0000-00000000000a') $$, 'T-ACC-04: the person who added them can undo');

-- F-TREE-03
select lives_ok($$ select add_relative('20000000-0000-0000-0000-00000000000c', 'spouse', '{"display_name":"Partner"}') $$, 'adds a partner');
select lives_ok($$ select add_relative('20000000-0000-0000-0000-00000000000c', 'child',
  '{"display_name":"Kid"}', null,
  (select id from unions where partner1_id = '20000000-0000-0000-0000-00000000000c')) $$, 'adds a child of the couple');
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.child_id where p.display_name = 'Kid'), 2, 'the child has both parents');
select lives_ok($$ select add_relative('20000000-0000-0000-0000-00000000000c', 'sibling', '{"display_name":"Sister"}') $$, 'adds a sibling with no parents known yet');
select is((select count(*)::int from persons where name_unknown and tree_id = '10000000-0000-0000-0000-00000000000a'), 1, 'F-TREE-04: a Name unknown parent joins them');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-00000000000c', 'child', '{"display_name":"  "}') $$, 'PT422', 'name_required', 'T-TREE-01: a name is the one required field');
reset role;

-- F-IO-01
insert into imports (id, created_by, source, file_path, preview) values
  ('40000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'lighten', 'x', '{
    "persons": [
      {"tempId": "a", "displayName": "Pa", "nameUnknown": false, "noteLabel": null, "gender": "male", "birthOrder": null},
      {"tempId": "b", "displayName": "Ma", "nameUnknown": false, "noteLabel": null, "gender": "unknown", "birthOrder": null},
      {"tempId": "c", "displayName": "Kid", "nameUnknown": false, "noteLabel": "1st Son", "gender": "male", "birthOrder": 1}
    ],
    "unions": [{"tempId": "u", "partner1Id": "a", "partner2Id": "b", "seq1": 1}],
    "parentLinks": [{"parentId": "a", "childId": "c", "unionId": "u"}, {"parentId": "b", "childId": "c", "unionId": "u"}]
  }');
select test_login('00000000-0000-0000-0000-00000000000a');
select is((import_commit('40000000-0000-0000-0000-00000000000a', 'Imported', '{"b": {"gender": "female"}}', 'c') ->> 'people')::int, 3, 'F-IO-01: import writes everyone, with fixes');
reset role;

select * from finish();
rollback;
