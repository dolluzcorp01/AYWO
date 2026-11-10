-- Editing, approvals, sharing, undo, merges, jobs and account delete (0006). Run with pgTAP, inside this one transaction.
begin;
create extension if not exists pgtap;
select plan(173);

-- b1 Creator, b2 approval editor, b3 branch editor, b4 viewer, b5 outsider, b6 expiring share, b7 commenter,
-- b8 signs up later, b9 successor, ba leaves the app, bb takes over from ba.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'creator4@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'approval4@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'branch4@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 'viewer4@test.local'),
  ('00000000-0000-0000-0000-0000000000b5', 'outsider4@test.local'),
  ('00000000-0000-0000-0000-0000000000b6', 'expiring4@test.local'),
  ('00000000-0000-0000-0000-0000000000b7', 'commenter4@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'successor4@test.local'),
  ('00000000-0000-0000-0000-0000000000bb', 'takeover4@test.local');
update profiles set display_name = 'Tree Maker' where id = '00000000-0000-0000-0000-0000000000b1';

insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000000b1', 'Edit family', '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-0000000000b2', 'Second family', '00000000-0000-0000-0000-0000000000b1');

-- Elder > Branch Head > Branch Kid, and Elder > Other Child > two entries for Selvi Rao.
-- Selvi Rao b6 has a partner, a child, a comment and a contact, which the merge must carry across.
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'Elder', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b1', 'Branch Head', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-0000000000b1', 'Branch Kid', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b4', '10000000-0000-0000-0000-0000000000b1', 'Other Child', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b5', '10000000-0000-0000-0000-0000000000b1', 'Selvi Rao', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b6', '10000000-0000-0000-0000-0000000000b1', 'Selvi Rao', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b7', '10000000-0000-0000-0000-0000000000b1', 'Lone Name', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b8', '10000000-0000-0000-0000-0000000000b1', 'Lone Name', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-0000000000b1', 'Tiny Tot', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000ba', '10000000-0000-0000-0000-0000000000b1', 'Married In', '00000000-0000-0000-0000-0000000000b1'),
  ('20000000-0000-0000-0000-0000000000bb', '10000000-0000-0000-0000-0000000000b1', 'Extra Cousin', '00000000-0000-0000-0000-0000000000b1');
insert into unions (id, tree_id, partner1_id, partner2_id) values
  ('40000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b6', '20000000-0000-0000-0000-0000000000ba');
insert into parent_child (tree_id, parent_id, child_id) values
  ('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b2'),
  ('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-0000000000b3'),
  ('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b4'),
  ('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b4', '20000000-0000-0000-0000-0000000000b5'),
  ('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b4', '20000000-0000-0000-0000-0000000000b6'),
  ('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b4', '20000000-0000-0000-0000-0000000000bb'),
  ('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b6', '20000000-0000-0000-0000-0000000000b9');
insert into person_contacts (id, person_id, kind, value, value_normalized, created_by) values
  ('50000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b3', 'mobile', '98000 00031', '+919800000031', '00000000-0000-0000-0000-0000000000b1'),
  ('50000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-0000000000b6', 'mobile', '98000 00032', '+919800000032', '00000000-0000-0000-0000-0000000000b1');
insert into comments (id, tree_id, person_id, author_id, body) values
  ('60000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000b1', 'A remark');
insert into shares (tree_id, grantee_profile_id, role, edit_mode, scope_person_id, created_by) values
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'editor', 'approval', null, '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3', 'editor', 'direct', '20000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b4', 'viewer', 'direct', null, '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b7', 'commenter', 'direct', null, '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b9', 'viewer', 'direct', null, '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'viewer', 'direct', null, '00000000-0000-0000-0000-0000000000b1');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- People without history rights still need a row id to try reverting.
create function test_last_person_history(p uuid) returns bigint language sql security definer as $$
  select max(id) from history where table_name = 'persons' and row_id = p
$$;
grant execute on function test_last_person_history(uuid) to authenticated;

-- ===== Tree create =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select ok((tree_create('New tree') ->> 'person_id') is not null, 'a new tree comes with the Creator''s card to add relatives to');
reset role;
select is((select count(*)::int from persons p join trees t on t.id = p.tree_id where t.name = 'New tree' and p.claimed_by = '00000000-0000-0000-0000-0000000000b1'), 1, 'the card is claimed by the Creator');

-- ===== T-SHR-01: approval-mode editor =====
select test_login('00000000-0000-0000-0000-0000000000b2');
select is(person_update('20000000-0000-0000-0000-0000000000b2', 1, '{"display_name": "Branch Head Renamed", "notes": "first"}') ->> 'status', 'requested', 'T-SHR-01: an approval editor''s save becomes a request');
reset role;
select is((select display_name from persons where id = '20000000-0000-0000-0000-0000000000b2'), 'Branch Head', 'T-SHR-01: nothing changed yet');
select test_login('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select requests_decide((select id from requests where payload -> 'data' ->> 'notes' = 'first'), 'approve') $$, 'PT403', 'not_allowed', 'an approval editor cannot approve their own change');
select is_empty($$ update persons set notes = 'direct' where id = '20000000-0000-0000-0000-0000000000b2' returning id $$, 'T-SHR-01: the row rules stop a direct write as well');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(requests_decide((select id from requests where payload -> 'data' ->> 'notes' = 'first'), 'approve') ->> 'status', 'applied', 'the Creator approves');
reset role;
select is((select display_name from persons where id = '20000000-0000-0000-0000-0000000000b2'), 'Branch Head Renamed', 'T-SHR-01: the change is applied');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000b2' and kind = 'request_decided'), 1, 'the requester is told');

-- ===== T-SHR-03: clashes =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select person_update('20000000-0000-0000-0000-0000000000b2', 1, '{"notes": "old"}') $$, 'PT409', 'version_conflict', 'T-SHR-03: a stale save gets a clash');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b2');
select is(person_update('20000000-0000-0000-0000-0000000000b2', 2, '{"notes": "stale"}') ->> 'status', 'requested', 'a second change is filed');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(person_update('20000000-0000-0000-0000-0000000000b2', 2, '{"notes": "newer"}') ->> 'status', 'saved', 'the Creator saves first');
select throws_ok($$ select requests_decide((select id from requests where payload -> 'data' ->> 'notes' = 'stale'), 'approve') $$, 'PT409', 'version_conflict', 'approving over newer work is a clash');
select is((select status::text from requests where payload -> 'data' ->> 'notes' = 'stale'), 'pending', 'the clash leaves the request waiting');
select is(requests_decide((select id from requests where payload -> 'data' ->> 'notes' = 'stale'), 'decline') ->> 'status', 'declined', 'it can still be declined');
select throws_ok($$ select requests_decide((select id from requests where payload -> 'data' ->> 'notes' = 'stale'), 'approve') $$, 'PT409', 'already_decided', 'a decided request stays decided');

-- A change can carry person fields only, and only one's own uploads.
select throws_ok($$ select person_update('20000000-0000-0000-0000-0000000000b1', 1, '{"claimed_by": "00000000-0000-0000-0000-0000000000b5"}') $$, 'PT422', 'bad_input', 'claimed_by cannot be set through a save');
select throws_ok($$ select person_update('20000000-0000-0000-0000-0000000000b1', 1, '{"photo_path": "photos/00000000-0000-0000-0000-0000000000b5/x.jpg"}') $$, 'PT403', 'not_allowed', 'a photo path into someone else''s folder is refused');
select throws_ok($$ select person_update('20000000-0000-0000-0000-0000000000b1', 1, '{"birth_date": "2001-02-31"}') $$, 'PT422', 'bad_input', 'an impossible date is refused plainly');
reset role;

-- ===== T-SHR-02: branch editor =====
select test_login('00000000-0000-0000-0000-0000000000b3');
select is(person_update('20000000-0000-0000-0000-0000000000b3', 1, '{"notes": "inside"}') ->> 'status', 'saved', 'a branch editor saves inside the branch');
select throws_ok($$ select person_update('20000000-0000-0000-0000-0000000000b4', 1, '{"notes": "outside"}') $$, 'PT403', 'not_allowed', 'T-SHR-02: refused outside the branch');
select throws_ok($$ select person_delete('20000000-0000-0000-0000-0000000000b4') $$, 'PT403', 'not_allowed', 'T-SHR-02: no delete outside the branch');
select throws_ok($$ select request_change('20000000-0000-0000-0000-0000000000b4', '{"table": "persons", "op": "update", "before_version": 1, "data": {"notes": "x"}}') $$, 'PT403', 'not_allowed', 'no suggesting outside the branch either');
select throws_ok($$ select share_create(p_tree => '10000000-0000-0000-0000-0000000000b1', p_role => 'viewer') $$, 'PT403', 'not_allowed', 'a branch editor cannot share');
select throws_ok($$ select merge_scan('10000000-0000-0000-0000-0000000000b1') $$, 'PT403', 'not_allowed', 'a branch editor cannot run a merge scan');
select is(my_trees() -> 0 ->> 'role', 'editor', 'Home shows the branch editor''s role');
select is(my_trees() -> 0 ->> 'branch_only', 'true', 'and that it is one branch');
reset role;

-- ===== Contact values stay out of history, activity and notifications =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select set_person_contact('20000000-0000-0000-0000-0000000000b4', 'mobile', '98000 00011', '+919800000011') $$, 'a contact is saved');
select is(person_update('20000000-0000-0000-0000-0000000000b4', 1, '{"notes": "checked"}') ->> 'status', 'saved', 'the person is edited');
select throws_ok($$ select history_revert(p_history => (select max(id) from history where table_name = 'person_contacts' and after ->> 'person_id' = '20000000-0000-0000-0000-0000000000b4')) $$, 'PT422', 'contact_history_locked', 'a contact row cannot be restored from redacted history');
select ok(history_list('10000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b4')::text !~ '98000 00011|9800000011', 'history_list holds no contact value');
select ok(activity_feed('all')::text !~ '98000 00011|9800000011', 'activity holds no contact value');
select is(contacts_for_edit('20000000-0000-0000-0000-0000000000b4') -> 0 ->> 'value', '98000 00011', 'whoever typed a number can see it in the edit form');
reset role;
select is((select count(*)::int from history where coalesce(before::text, '') ~ '98000 00011|9800000011' or coalesce(after::text, '') ~ '98000 00011|9800000011'), 0, 'no history row holds the value');
select is((select count(*)::int from notifications where payload::text ~ '98000 00011|9800000011'), 0, 'no notification holds the value');

select test_login('00000000-0000-0000-0000-0000000000b3');
select ok(contacts_for_edit('20000000-0000-0000-0000-0000000000b3') -> 0 ->> 'value' is null, 'editing rights alone do not open a locked number');
select is(contacts_for_edit('20000000-0000-0000-0000-0000000000b3') -> 0 ->> 'kind', 'mobile', 'the form still sees the row');
select throws_ok($$ select contacts_for_edit('20000000-0000-0000-0000-0000000000b4') $$, 'PT403', 'not_allowed', 'not outside the branch');
select throws_ok($$ select history_revert(p_history => test_last_person_history('20000000-0000-0000-0000-0000000000b4')) $$, 'PT403', 'not_allowed', 'a branch editor cannot undo outside the branch');
reset role;

select test_login('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select history_revert(p_history => test_last_person_history('20000000-0000-0000-0000-0000000000b4')) $$, 'PT403', 'not_allowed', 'an approval editor cannot undo directly');
select throws_ok($$ select contacts_for_edit('20000000-0000-0000-0000-0000000000b4') $$, 'PT403', 'not_allowed', 'an approval editor gets no edit form values');
reset role;

-- ===== Sharing =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select matches(share_create(p_tree => '10000000-0000-0000-0000-0000000000b1', p_role => 'viewer') ->> 'link_token', '^[A-Za-z0-9_-]{43}$', 'a link token is 32 random bytes in URL-safe letters');
select lives_ok($$ select share_create(p_tree => '10000000-0000-0000-0000-0000000000b1', p_role => 'editor', p_edit_mode => 'approval', p_grantee_phone => '+919800000077') $$, 'a share to a number with no account');
select throws_ok($$ select share_create(p_tree => '10000000-0000-0000-0000-0000000000b1', p_role => 'viewer', p_grantee_phone => '98000') $$, 'PT422', 'phone_invalid', 'a bad number is refused');
select throws_ok($$ select share_create(p_tree => '10000000-0000-0000-0000-0000000000b2', p_role => 'viewer', p_scope_person => '20000000-0000-0000-0000-0000000000b1') $$, 'PT422', 'not_in_this_tree', 'a branch must be in the same tree');
select lives_ok($$ select share_create(p_tree => '10000000-0000-0000-0000-0000000000b1', p_role => 'viewer', p_grantee_phone => '+919800000066') $$, 'a second waiting number');
select ok(tree_shares('10000000-0000-0000-0000-0000000000b1')::text not like '%9800000066%', 'the list never shows a whole number');
select ok(tree_shares('10000000-0000-0000-0000-0000000000b1')::text like '%******0066%', 'the list shows the last four digits');
select throws_ok($$ select * from share_waiting_phones $$, '42501', 'permission denied for table share_waiting_phones', 'waiting numbers cannot be read by clients');
reset role;
select is((select count(*)::int from share_waiting_phones where phone = '+919800000077'), 1, 'the number waits');
insert into auth.users (id, phone, phone_confirmed_at) values ('00000000-0000-0000-0000-0000000000b8', '+919800000077', now());
select is((select count(*)::int from shares where tree_id = '10000000-0000-0000-0000-0000000000b1' and role = 'editor' and link_token is not null and grantee_profile_id = '00000000-0000-0000-0000-0000000000b8'), 1, 'signing up with the number picks up the share');
select is((select count(*)::int from share_waiting_phones where phone = '+919800000077'), 0, 'and it stops waiting');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000b8' and kind = 'share_received'), 1, 'and they are told');
select test_login('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$ select share_create(p_tree => '10000000-0000-0000-0000-0000000000b1', p_role => 'viewer') $$, 'PT403', 'not_allowed', 'a viewer cannot share');
select is(tree_shares('10000000-0000-0000-0000-0000000000b1') -> 0 ->> 'link_token', null, 'a grantee sees no links');
select is(jsonb_array_length(tree_shares('10000000-0000-0000-0000-0000000000b1')), 1, 'a grantee sees only their own share');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b5');
select throws_ok($$ select tree_shares('10000000-0000-0000-0000-0000000000b1') $$, 'PT403', 'not_allowed', 'an outsider sees no shares');
reset role;

-- ===== Access requests =====
select test_login('00000000-0000-0000-0000-0000000000b4');
select lives_ok($$ select request_access('10000000-0000-0000-0000-0000000000b1', 'access_edit') $$, 'a viewer asks for edit access');
select lives_ok($$ select request_contacts('20000000-0000-0000-0000-0000000000b3') $$, 'and for a contact');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(requests_decide((select id from requests where kind = 'access_edit' and requester_id = '00000000-0000-0000-0000-0000000000b4'), 'approve') ->> 'status', 'applied', 'edit access is approved');
select is(requests_decide((select id from requests where kind = 'access_contacts' and requester_id = '00000000-0000-0000-0000-0000000000b4'), 'approve') ->> 'status', 'applied', 'the contact request is approved');
reset role;
select is((select role::text || '/' || edit_mode::text from shares where tree_id = '10000000-0000-0000-0000-0000000000b1' and grantee_profile_id = '00000000-0000-0000-0000-0000000000b4' and revoked_at is null), 'editor/approval', 'one tap gives edit access in approval mode, on the same share');
select test_login('00000000-0000-0000-0000-0000000000b4');
select is(person_card('20000000-0000-0000-0000-0000000000b3') ->> 'access', 'plus', 'contact permission is granted, and Plus is still needed');
select ok(person_card('20000000-0000-0000-0000-0000000000b3') -> 'contacts' -> 'values' is null, 'no value without Plus');
reset role;

-- ===== set_elder_younger through approval =====
select test_login('00000000-0000-0000-0000-0000000000b2');
select is(set_elder_younger('20000000-0000-0000-0000-0000000000b5', '20000000-0000-0000-0000-0000000000b6', false) ->> 'status', 'requested', 'elder or younger goes for approval');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(requests_decide((select id from requests where payload ->> 'action' = 'set_elder_younger'), 'approve') ->> 'status', 'applied', 'the request from 0005 can be approved');
reset role;
select is((select birth_order::int from persons where id = '20000000-0000-0000-0000-0000000000b5'), 2, 'it is applied: the younger one is second');
select is((select birth_order::int from persons where id = '20000000-0000-0000-0000-0000000000b6'), 1, 'and the elder one first');

-- ===== add_relative through approval =====
select test_login('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-0000000000b1', 'child', '{"display_name": "Suggested Kid"}') $$, 'PT403', 'not_allowed', 'an approval editor cannot add directly');
select lives_ok($$ select request_change('20000000-0000-0000-0000-0000000000b1', '{"action": "add_relative", "relation": "child", "person": {"display_name": "Suggested Kid"}}') $$, 'but can ask');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(requests_decide((select id from requests where payload ->> 'action' = 'add_relative'), 'approve', '{"person": {"display_name": "Edited Kid"}}') ->> 'status', 'applied', 'the decider edits and accepts (F-SHR-05)');
reset role;
select is((select count(*)::int from parent_child l join persons p on p.id = l.child_id where l.parent_id = '20000000-0000-0000-0000-0000000000b1' and p.display_name = 'Edited Kid'), 1, 'the edited person is added');

-- ===== Successor rule =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select tree_update('10000000-0000-0000-0000-0000000000b1', '{"successor_id": "00000000-0000-0000-0000-0000000000b5"}') $$, 'PT422', 'successor_not_in_tree', 'a successor must belong to the tree');
select lives_ok($$ select tree_update('10000000-0000-0000-0000-0000000000b1', '{"successor_id": "00000000-0000-0000-0000-0000000000b9"}') $$, 'the Creator names a successor');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select tree_update('10000000-0000-0000-0000-0000000000b1', '{"name": "Mine now"}') $$, 'PT403', 'not_allowed', 'nobody else can rename the tree');
select lives_ok($$ select person_update('20000000-0000-0000-0000-0000000000bb', 1, '{"notes": "r1"}') $$, 'request one');
select lives_ok($$ select person_update('20000000-0000-0000-0000-0000000000bb', 1, '{"notes": "r2"}') $$, 'request two');
select lives_ok($$ select person_update('20000000-0000-0000-0000-0000000000bb', 1, '{"notes": "old"}') $$, 'request three');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b9');
select lives_ok($$ select request_access('10000000-0000-0000-0000-0000000000b1', 'role_upgrade', null, '{"role": "co_creator"}') $$, 'the successor asks for more');
reset role;
update profiles set last_active_at = now() - interval '200 days' where id = '00000000-0000-0000-0000-0000000000b1';
select test_login('00000000-0000-0000-0000-0000000000b5');
select throws_ok($$ select requests_decide((select id from requests limit 0), 'approve') $$, 'PT403', 'not_allowed', 'no request id, no decision');
reset role;
create function test_request_by_note(p text) returns uuid language sql security definer as $$
  select id from requests where payload -> 'data' ->> 'notes' = p
$$;
grant execute on function test_request_by_note(text) to authenticated;
select test_login('00000000-0000-0000-0000-0000000000b5');
select throws_ok($$ select requests_decide(test_request_by_note('r1'), 'approve') $$, 'PT403', 'not_allowed', 'with the Creator away and nothing routed, a stranger still cannot decide');
reset role;
select is(tree_successor_rule() > 0, true, 'L11: the daily rule moves the waiting requests');
select is((select routed_to::text from requests where id = test_request_by_note('r1')), '00000000-0000-0000-0000-0000000000b9', 'F-SHR-08: to the named successor');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000b9' and kind = 'request_routed'), 3, 'who is told about each');
select is((select routed_to::text from requests where kind = 'role_upgrade' and requester_id = '00000000-0000-0000-0000-0000000000b9'), null, 'nobody is passed their own request');
select test_login('00000000-0000-0000-0000-0000000000b9');
select is(requests_decide(test_request_by_note('r1'), 'decline') ->> 'status', 'declined', 'the successor decides while the Creator is away');
select throws_ok($$ select requests_decide((select id from requests where kind = 'role_upgrade' and requester_id = auth.uid()), 'approve') $$, 'PT403', 'not_allowed', 'and cannot grant themselves anything');
select ok(activity_feed('needs_you')::text like '%' || test_request_by_note('r2')::text || '%', 'the routed request is in the successor''s Needs you');
reset role;
update profiles set last_active_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
select test_login('00000000-0000-0000-0000-0000000000b9');
select throws_ok($$ select requests_decide(test_request_by_note('r2'), 'approve') $$, 'PT403', 'not_allowed', 'once the Creator is back, the successor can no longer decide');
reset role;

-- ===== Expiry jobs =====
insert into shares (tree_id, grantee_profile_id, role, expires_at, created_by) values
  ('10000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b6', 'viewer', now() - interval '1 hour', '00000000-0000-0000-0000-0000000000b1');
update requests set created_at = now() - interval '31 days' where id = test_request_by_note('old');
select is(tree_expire_access() ->> 'shares', '1', 'L11: an expired share is noticed');
select is((select status::text from requests where id = test_request_by_note('old')), 'expired', 'L11: an old request expires');
select is(tree_expire_access() ->> 'shares', '0', 'the job can run again without repeating');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000b6' and kind = 'share_expired'), 1, 'the grantee is told once');
select is(job_claim('test_job', interval '20 hours'), true, 'a slow job runs the first time');
select is(job_claim('test_job', interval '20 hours'), false, 'and not again within its interval');

-- ===== Comments =====
select test_login('00000000-0000-0000-0000-0000000000b9');
select throws_ok($$ select comment_add('20000000-0000-0000-0000-0000000000b1', 'hello') $$, 'PT403', 'not_allowed', 'a viewer cannot comment');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b7');
select ok((comment_add('20000000-0000-0000-0000-0000000000b1', 'a private remark') ->> 'id') is not null, 'a commenter can');
select is(person_comments('20000000-0000-0000-0000-0000000000b1') -> 0 ->> 'body', 'a private remark', 'and it can be read back');
reset role;
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'comment_added'), 1, 'L11: the Creator is told');
select is((select count(*)::int from notifications where payload::text like '%private remark%'), 0, 'the words stay out of the notification');

-- ===== Soft delete and undo =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(person_delete('20000000-0000-0000-0000-0000000000bb') ->> 'status', 'saved', 'a person is deleted');
reset role;
select is((select count(*)::int from parent_child where child_id = '20000000-0000-0000-0000-0000000000bb'), 0, 'with their links');
select isnt((select deleted_at from persons where id = '20000000-0000-0000-0000-0000000000bb'), null, 'the row stays, soft-deleted');
select test_login('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select history_revert(p_batch => (select batch_id from history where table_name = 'persons' and row_id = '20000000-0000-0000-0000-0000000000bb' and after ->> 'deleted_at' is not null)) $$, 'one undo brings them back');
reset role;
select is((select count(*)::int from parent_child where child_id = '20000000-0000-0000-0000-0000000000bb'), 1, 'with their links');
select is((select deleted_at from persons where id = '20000000-0000-0000-0000-0000000000bb'), null, 'and no longer deleted');

-- ===== F-SHR-06: one row =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(person_update('20000000-0000-0000-0000-0000000000b1', 1, '{"notes": "v1"}') ->> 'status', 'saved', 'first edit');
select is(person_update('20000000-0000-0000-0000-0000000000b1', 2, '{"notes": "v2"}') ->> 'status', 'saved', 'second edit');
select throws_ok($$ select history_revert(p_history => (select max(id) from history where row_id = '20000000-0000-0000-0000-0000000000b1' and after ->> 'notes' = 'v1')) $$, 'PT409', 'changed_since', 'an older edit cannot be undone over a newer one');
select lives_ok($$ select history_revert(p_history => (select max(id) from history where row_id = '20000000-0000-0000-0000-0000000000b1' and after ->> 'notes' = 'v2')) $$, 'the newest can');
select is((select notes from persons where id = '20000000-0000-0000-0000-0000000000b1'), 'v1', 'the value is back');
select isnt((select reverted_by from history where row_id = '20000000-0000-0000-0000-0000000000b1' and after ->> 'notes' = 'v2'), null, 'T-SHR-04: reverted_by is marked');
select throws_ok($$ select history_revert(p_history => (select max(id) from history where row_id = '20000000-0000-0000-0000-0000000000b1' and after ->> 'notes' = 'v2')) $$, 'PT409', 'already_reverted', 'not twice');
select lives_ok($$ select history_revert(p_history => (select min(id) from history where row_id = '20000000-0000-0000-0000-0000000000b1' and after ->> 'notes' = 'v1')) $$, 'then the older one can go too');
select is((select notes from persons where id = '20000000-0000-0000-0000-0000000000b1'), null, 'back to the start');
reset role;

-- ===== F-REPO-02/03: merge =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(merge_scan('10000000-0000-0000-0000-0000000000b1') ->> 'created', '1', 'F-REPO-02: same name and parents pass 0.85; the same name alone does not');
select is(merge_scan('10000000-0000-0000-0000-0000000000b1') ->> 'created', '0', 'a pair is suggested once');
select ok((select (payload ->> 'score')::numeric > 0.85 from requests where kind = 'merge'), 'the score is over 0.85');
select is(jsonb_array_length(merge_preview((select id from requests where kind = 'merge')) -> 'people'), 2, 'the compare screen gets both people');
select ok(merge_preview((select id from requests where kind = 'merge'))::text !~ '98000 00032|9800000032', 'and no contact value');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select merge_apply(test_request_by_note('r2')) $$, 'PT403', 'not_allowed', 'a branch editor cannot merge');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(merge_apply((select id from requests where kind = 'merge'), '20000000-0000-0000-0000-0000000000b5') ->> 'kept_id', '20000000-0000-0000-0000-0000000000b5', 'F-REPO-03: one person row is kept');
select throws_ok($$ select merge_apply((select id from requests where kind = 'merge')) $$, 'PT409', 'already_decided', 'a merge applies once');
reset role;
select isnt((select deleted_at from persons where id = '20000000-0000-0000-0000-0000000000b6'), null, 'the other is soft-deleted, so it can be undone');
select is((select partner1_id::text from unions where id = '40000000-0000-0000-0000-0000000000b1'), '20000000-0000-0000-0000-0000000000b5', 'the couple moves');
select is((select parent_id::text from parent_child where child_id = '20000000-0000-0000-0000-0000000000b9'), '20000000-0000-0000-0000-0000000000b5', 'the child moves');
select is((select count(*)::int from person_closure where ancestor_id = '20000000-0000-0000-0000-0000000000b5' and descendant_id = '20000000-0000-0000-0000-0000000000b9'), 1, 'and the branch follows');
select is((select person_id::text from person_contacts where id = '50000000-0000-0000-0000-0000000000b2'), '20000000-0000-0000-0000-0000000000b5', 'the contact moves');
select is((select person_id::text from comments where id = '60000000-0000-0000-0000-0000000000b1'), '20000000-0000-0000-0000-0000000000b5', 'the comment moves');
select is((select status::text from requests where kind = 'merge'), 'applied', 'the request is closed');
select is((select count(*)::int from parent_child where parent_id = '20000000-0000-0000-0000-0000000000b4' and child_id in ('20000000-0000-0000-0000-0000000000b5', '20000000-0000-0000-0000-0000000000b6')), 1, 'the shared parent link is not doubled');

select test_login('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select history_revert(p_history => (select max(id) from history where table_name = 'parent_child' and after ->> 'child_id' = '20000000-0000-0000-0000-0000000000b9')) $$, 'PT422', 'revert_whole_merge', 'a merge is undone whole or not at all');
select lives_ok($$ select history_revert(p_batch => (select batch_id from history where table_name = 'persons' and row_id = '20000000-0000-0000-0000-0000000000b6' and after ->> 'deleted_at' is not null)) $$, 'F-REPO-03: a merge can be undone');
reset role;
select is((select deleted_at from persons where id = '20000000-0000-0000-0000-0000000000b6'), null, 'the person is back');
select is((select partner1_id::text from unions where id = '40000000-0000-0000-0000-0000000000b1'), '20000000-0000-0000-0000-0000000000b6', 'the couple is back');
select is((select parent_id::text from parent_child where child_id = '20000000-0000-0000-0000-0000000000b9'), '20000000-0000-0000-0000-0000000000b6', 'the child is back');
select is((select person_id::text from person_contacts where id = '50000000-0000-0000-0000-0000000000b2'), '20000000-0000-0000-0000-0000000000b6', 'the contact is back, value untouched');
select is((select value from person_contacts where id = '50000000-0000-0000-0000-0000000000b2'), '98000 00032', 'the value itself survived');
select is((select person_id::text from comments where id = '60000000-0000-0000-0000-0000000000b1'), '20000000-0000-0000-0000-0000000000b6', 'the comment is back');
select is((select count(*)::int from parent_child where child_id = '20000000-0000-0000-0000-0000000000b6'), 1, 'the parent link is back');

-- ===== T-SHR-04: revert an import =====
insert into imports (id, created_by, source, file_path, preview) values
  ('70000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'gedcom', 'imports/x.ged', '{
    "persons": [
      {"tempId": "@A@", "displayName": "Imported Dad", "nameUnknown": false, "gender": "male", "living": "deceased", "birthDate": "1950-01-01", "birthPrecision": "year", "deathDate": "2001-05-06", "deathPrecision": "exact", "birthPlace": "Salem"},
      {"tempId": "@B@", "displayName": "Imported Mum", "nameUnknown": false, "gender": "female"},
      {"tempId": "@C@", "displayName": "Imported Kid", "nameUnknown": false, "gender": "unknown"}
    ],
    "unions": [{"tempId": "u", "partner1Id": "@A@", "partner2Id": "@B@", "seq1": 1, "kind": "marriage", "status": "divorced"}],
    "parentLinks": [
      {"parentId": "@A@", "childId": "@C@", "unionId": "u", "kind": "adopted"},
      {"parentId": "@B@", "childId": "@C@", "unionId": "u", "kind": "birth"}
    ]
  }');
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(import_commit('70000000-0000-0000-0000-0000000000b1', 'Imported tree', '{}', '@C@') ->> 'people', '3', 'F-IO-01: the import is written');
reset role;
select is((select birth_precision::text from persons where display_name = 'Imported Dad'), 'year', 'L8.1: date precision is kept');
select is((select birth_date::text from persons where display_name = 'Imported Dad'), '1950-01-01', 'the date too');
select is((select status::text from unions u join persons p on p.id = u.partner1_id where p.display_name = 'Imported Dad'), 'divorced', 'the couple''s status too');
select is((select l.kind::text from parent_child l join persons p on p.id = l.parent_id where p.display_name = 'Imported Dad'), 'adopted', 'and the kind of link');
select test_login('00000000-0000-0000-0000-0000000000b1');
select is(history_revert(p_batch => (select batch_id from history where table_name = 'persons' and before is null and after ->> 'display_name' = 'Imported Dad')) ->> 'reverted', '7', 'T-SHR-04: one undo covers every imported row, the claim included');
reset role;
select is((select count(*)::int from persons where display_name like 'Imported %'), 0, 'T-SHR-04: all imported rows are gone');
select isnt((select deleted_at from trees where name = 'Imported tree'), null, 'the empty tree goes too');
select is((select status from imports where id = '70000000-0000-0000-0000-0000000000b1'), 'reverted', 'and the import cannot be committed again');

-- ===== A deleted tree gives no rights =====
select test_login('00000000-0000-0000-0000-0000000000b2');
select is(tree_role('10000000-0000-0000-0000-0000000000b2')::text, 'viewer', 'the share works before the tree is deleted');
select throws_ok($$ select tree_delete('10000000-0000-0000-0000-0000000000b2') $$, 'PT403', 'not_allowed', 'only the Creator deletes a tree');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select tree_delete('10000000-0000-0000-0000-0000000000b2') $$, 'the Creator deletes it');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b2');
select is(tree_role('10000000-0000-0000-0000-0000000000b2')::text, 'none', 'nobody has a role any more');
select is(can_view_tree('10000000-0000-0000-0000-0000000000b2'), false, 'nobody can open it');
reset role;

-- ===== A share meant for a person follows the claim =====
select test_login('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$ select share_create(p_tree => '10000000-0000-0000-0000-0000000000b1', p_role => 'commenter', p_grantee_person => '20000000-0000-0000-0000-0000000000b7') $$, 'a share is made for a person with no account yet');
reset role;
update persons set claimed_by = '00000000-0000-0000-0000-0000000000b5' where id = '20000000-0000-0000-0000-0000000000b7';
select is((select grantee_profile_id::text from shares where grantee_person_id = '20000000-0000-0000-0000-0000000000b7'), '00000000-0000-0000-0000-0000000000b5', 'a verified claim picks it up');
update persons set claimed_by = null where id = '20000000-0000-0000-0000-0000000000b7';
select is((select grantee_profile_id::text from shares where grantee_person_id = '20000000-0000-0000-0000-0000000000b7'), null, 'undoing the claim takes it back');

-- ===== F-ACC-08: account delete =====
insert into auth.users (id, phone, phone_confirmed_at) values ('00000000-0000-0000-0000-0000000000ba', '+919800000055', now());
select test_login('00000000-0000-0000-0000-0000000000ba');
select lives_ok($$ select me_update('{"display_name": "Leaving Person", "email": "Leaving@Test.Local"}') $$, 'a profile is filled in');
select is(my_account() ->> 'email', 'leaving@test.local', 'email is stored in lower case');
select is((my_account() ->> 'plus'), 'false', 'GET /me says whether Plus is on');
select lives_ok($$ select tree_create('Passed on') $$, 'a tree to pass on');
select lives_ok($$ select tree_create('Nobody else') $$, 'a tree with nobody else');
reset role;
insert into shares (tree_id, grantee_profile_id, role, created_by)
  select id, '00000000-0000-0000-0000-0000000000bb', 'viewer', '00000000-0000-0000-0000-0000000000ba' from trees where name = 'Passed on';
insert into person_contacts (person_id, kind, value, value_normalized, created_by)
  select creator_person_id, 'mobile', '98000 00055', '+919800000055', '00000000-0000-0000-0000-0000000000ba' from trees where name = 'Passed on';
select test_login('00000000-0000-0000-0000-0000000000ba');
select lives_ok($$ select tree_update((select id from trees where name = 'Passed on'), jsonb_build_object('successor_id', '00000000-0000-0000-0000-0000000000bb')) $$, 'a successor is named');
select is(account_delete() ->> 'trees_passed_on', '1', 'F-ACC-08: the account is deleted');
reset role;
select is((select creator_id::text from trees where name = 'Passed on'), '00000000-0000-0000-0000-0000000000bb', 'the tree passes to the successor');
select isnt((select deleted_at from trees where name = 'Nobody else'), null, 'a tree with nobody else closes');
select is((select count(*)::int from person_contacts where value_normalized = '+919800000055'), 0, 'their contact values are gone');
select is((select count(*)::int from persons where claimed_by = '00000000-0000-0000-0000-0000000000ba'), 0, 'their entries are released');
select is((select login_phone from profiles where id = '00000000-0000-0000-0000-0000000000ba'), null, 'the number leaves the profile');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-0000000000ba'), '', 'and the name');
select isnt((select banned_at from auth.users where id = '00000000-0000-0000-0000-0000000000ba'), null, 'the login is closed');
select is((select count(*)::int from auth.users where phone = '+919800000055'), 0, 'and the number is free');
select lives_ok($$ insert into auth.users (phone, phone_confirmed_at) values ('+919800000055', now()) $$, 'so a new owner of that number can sign up');

select * from finish();
rollback;
