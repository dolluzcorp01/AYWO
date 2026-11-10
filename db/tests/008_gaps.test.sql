-- Account photo, tree members, adding yourself, 'Is this you?' details, import choices, admin notices, paying accounts.
begin;
create extension if not exists pgtap;
select plan(69);

insert into languages (code, name_en) values ('en', 'English') on conflict (code) do nothing;

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'creator8@test.local', '+919811200001', now()),
  ('00000000-0000-0000-0000-0000000000f2', 'cocreator8@test.local', '+919811200002', now()),
  ('00000000-0000-0000-0000-0000000000f3', 'viewer8@test.local', '+919811200003', now()),
  ('00000000-0000-0000-0000-0000000000f4', 'stranger8@test.local', '+919811200004', now()),
  ('00000000-0000-0000-0000-0000000000f5', 'claimant8@test.local', '+919811200005', now()),
  ('00000000-0000-0000-0000-0000000000f6', 'admin8@test.local', '+919811200006', now()),
  ('00000000-0000-0000-0000-0000000000f7', 'sub8@test.local', '+919811200007', now()),
  ('00000000-0000-0000-0000-0000000000f8', 'payer8@test.local', '+919811200008', now()),
  ('00000000-0000-0000-0000-0000000000f9', 'blocked8@test.local', '+919811200009', now());
update profiles set display_name = 'Creator Eight' where id = '00000000-0000-0000-0000-0000000000f1';
update profiles set display_name = 'Cocreator Eight' where id = '00000000-0000-0000-0000-0000000000f2';
update profiles set display_name = 'Viewer Eight' where id = '00000000-0000-0000-0000-0000000000f3';
update profiles set display_name = 'Claimant Eight' where id = '00000000-0000-0000-0000-0000000000f5';
update profiles set display_name = 'Payer Eight' where id = '00000000-0000-0000-0000-0000000000f8';
update auth.users set banned_at = now() where id = '00000000-0000-0000-0000-0000000000f9';

insert into app_admins (profile_id, role) values
  ('00000000-0000-0000-0000-0000000000f6', 'aywo_admin'),
  ('00000000-0000-0000-0000-0000000000f7', 'sub_admin');
insert into app_admin_permissions (profile_id, permission) values ('00000000-0000-0000-0000-0000000000f7', 'users');

insert into trees (id, name, creator_id, successor_id) values
  ('10000000-0000-0000-0000-0000000000f1', 'Gap family', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3');
insert into persons (id, tree_id, display_name, claimed_by, created_by, photo_path) values
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'Elder Parent', null, '00000000-0000-0000-0000-0000000000f1', null),
  ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f1', 'Other Parent', null, '00000000-0000-0000-0000-0000000000f1', null),
  ('20000000-0000-0000-0000-0000000000f3', '10000000-0000-0000-0000-0000000000f1', 'Matched Child', null, '00000000-0000-0000-0000-0000000000f1', null),
  ('20000000-0000-0000-0000-0000000000f4', '10000000-0000-0000-0000-0000000000f1', 'Married Partner', null, '00000000-0000-0000-0000-0000000000f1', null);
insert into unions (id, tree_id, partner1_id, partner2_id, kind) values
  ('30000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f3', '20000000-0000-0000-0000-0000000000f4', 'marriage');
insert into parent_child (tree_id, parent_id, child_id) values
  ('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f3'),
  ('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f2', '20000000-0000-0000-0000-0000000000f3');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-0000000000f3', 'mobile', '98112 00005', '+919811200005', '00000000-0000-0000-0000-0000000000f1'),
  ('20000000-0000-0000-0000-0000000000f1', 'mobile', '98112 00077', '+919811200077', '00000000-0000-0000-0000-0000000000f1');
insert into shares (tree_id, grantee_profile_id, role, created_by) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'co_creator', '00000000-0000-0000-0000-0000000000f1'),
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3', 'viewer', '00000000-0000-0000-0000-0000000000f1');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- ===== Account photo =====
select test_login('00000000-0000-0000-0000-0000000000f5');
select throws_ok($$ select me_update('{"photo_path": "photos/00000000-0000-0000-0000-0000000000f1/a.jpg"}') $$, 'PT403', 'not_allowed', 'a photo from someone else''s folder is refused');
select throws_ok($$ select me_update('{"photo_path": "../photos/x.jpg"}') $$, 'PT403', 'not_allowed', 'a made-up path is refused');
select is(me_update('{"photo_path": "photos/00000000-0000-0000-0000-0000000000f5/a1.jpg"}') ->> 'photo_path', 'photos/00000000-0000-0000-0000-0000000000f5/a1.jpg', 'an own upload is saved');
select is(my_account() ->> 'photo_path', 'photos/00000000-0000-0000-0000-0000000000f5/a1.jpg', 'my_account gives the path back for the API to sign');
reset role;

-- ===== B2 details =====
select test_login('00000000-0000-0000-0000-0000000000f5');
select is(jsonb_array_length(claim_candidate_details()), 1, 'B2: the matched person is offered');
select is(claim_candidate_details() -> 0 -> 'parents', '["Elder Parent", "Other Parent"]'::jsonb, 'B2: both parents by name');
select is(claim_candidate_details() -> 0 -> 'partners', '["Married Partner"]'::jsonb, 'B2: the partner by name');
select is(claim_candidate_details() -> 0 ->> 'married', 'true', 'B2: says they are married');
select is((claim_candidate_details() -> 0 ->> 'people')::int, 4, 'B2: how many people are in the tree');
select is(claim_candidate_details() -> 0 ->> 'added_by', 'Creator Eight', 'B2: who added them');
select ok(position('98112' in claim_candidate_details()::text) = 0, 'B2: no contact value anywhere in the answer');
select ok(position('+919811200' in claim_candidate_details()::text) = 0, 'B2: no normalised number either');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f4');
select is(jsonb_array_length(claim_candidate_details()), 0, 'B2: a stranger gets nothing');
reset role;

-- A claimed card takes the account photo, and a wrong match takes it away again.
select test_login('00000000-0000-0000-0000-0000000000f5');
select lives_ok($$ select claim_confirm('20000000-0000-0000-0000-0000000000f3') $$, 'the claim goes through');
reset role;
select is((select photo_path from persons where id = '20000000-0000-0000-0000-0000000000f3'), 'photos/00000000-0000-0000-0000-0000000000f5/a1.jpg', 'the claimed card takes the account photo');
select test_login('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select claim_undo('20000000-0000-0000-0000-0000000000f3') $$, 'the Creator undoes a wrong match');
reset role;
select is((select photo_path from persons where id = '20000000-0000-0000-0000-0000000000f3'), null, 'the photo leaves with the wrong match');

-- ===== Members =====
select test_login('00000000-0000-0000-0000-0000000000f1');
select is(tree_members('10000000-0000-0000-0000-0000000000f1') -> 'successor' ->> 'display_name', 'Viewer Eight', 'members: the current successor');
select is(jsonb_array_length(tree_members('10000000-0000-0000-0000-0000000000f1') -> 'grantees'), 2, 'members: everyone it is shared with');
select ok(position('98112' in tree_members('10000000-0000-0000-0000-0000000000f1')::text) = 0, 'members: no contact values');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f2');
select is(tree_members('10000000-0000-0000-0000-0000000000f1') ->> 'creator_id', '00000000-0000-0000-0000-0000000000f1', 'members: a Co-creator may read them');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f3');
select throws_ok($$ select tree_members('10000000-0000-0000-0000-0000000000f1') $$, 'PT403', 'not_allowed', 'members: a Viewer may not');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f4');
select throws_ok($$ select tree_members('10000000-0000-0000-0000-0000000000f1') $$, 'PT403', 'not_allowed', 'members: a stranger may not');
reset role;

-- ===== Adding yourself =====
select test_login('00000000-0000-0000-0000-0000000000f4');
select throws_ok($$ select tree_add_me('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', 'child', 'Sneaky') $$, 'PT403', 'not_allowed', 'add me: a stranger cannot add themselves');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f3');
select throws_ok($$ select tree_add_me('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', 'child') $$, 'PT403', 'not_allowed', 'add me: nor can a Viewer');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$ select tree_add_me('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-000000000099', 'child') $$, 'PT422', 'not_in_this_tree', 'add me: the anchor must be in this tree');
select throws_ok($$ select tree_add_me('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', 'neighbour') $$, 'PT422', 'bad_relation', 'add me: only known relations');
select lives_ok($$ select tree_add_me('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', 'child', null, 'female') $$, 'add me: the Creator adds themselves as a child');
select throws_ok($$ select tree_add_me('10000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1', 'child') $$, 'PT409', 'already_in_tree', 'add me: only once');
reset role;
select is((select display_name from persons where claimed_by = '00000000-0000-0000-0000-0000000000f1' and tree_id = '10000000-0000-0000-0000-0000000000f1'), 'Creator Eight', 'add me: the card carries the account name and is claimed');
select is((select gender::text from persons where claimed_by = '00000000-0000-0000-0000-0000000000f1' and tree_id = '10000000-0000-0000-0000-0000000000f1'), 'female', 'add me: and the chosen gender');
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.child_id where p.claimed_by = '00000000-0000-0000-0000-0000000000f1' and pc.parent_id = '20000000-0000-0000-0000-0000000000f1'), 1, 'add me: linked to the anchor');
select is((select creator_person_id from trees where id = '10000000-0000-0000-0000-0000000000f1'), (select id from persons where claimed_by = '00000000-0000-0000-0000-0000000000f1' and tree_id = '10000000-0000-0000-0000-0000000000f1'), 'add me: the Creator''s place in the tree is recorded');

-- ===== Import choices =====
-- Cousin (c) was drawn twice: c under Pat, and c2 as Ravi's partner with Kid under the merged person.
insert into imports (id, created_by, source, file_path, preview)
select v.id, '00000000-0000-0000-0000-0000000000f1'::uuid, 'lighten'::import_source_t, 'x', '{
    "persons": [
      {"tempId": "a", "displayName": "Pat", "nameUnknown": false, "noteLabel": null, "gender": "male", "birthOrder": null},
      {"tempId": "c", "displayName": "Cousin", "nameUnknown": false, "noteLabel": null, "gender": "unknown", "birthOrder": null},
      {"tempId": "d", "displayName": "Ravi", "nameUnknown": false, "noteLabel": null, "gender": "male", "birthOrder": null},
      {"tempId": "k", "displayName": "Kid", "nameUnknown": false, "noteLabel": null, "gender": "unknown", "birthOrder": null}
    ],
    "unions": [{"tempId": "u", "partner1Id": "d", "partner2Id": "c", "seq1": 1}],
    "parentLinks": [
      {"parentId": "a", "childId": "c", "unionId": null},
      {"parentId": "c", "childId": "k", "unionId": "u"},
      {"parentId": "d", "childId": "k", "unionId": "u"}
    ],
    "placeholders": [{"underPerson": "Ravi", "tempId": "box", "parentIds": ["d", "c2"], "unionId": "u"}],
    "merges": [{
      "name": "Cousin", "keptId": "c", "droppedId": "c2",
      "dropped": {"tempId": "c2", "displayName": "Cousin", "nameUnknown": false, "noteLabel": null, "gender": "unknown", "birthOrder": null},
      "undo": {"unions": [{"index": 0, "field": "partner2Id"}], "links": [], "linkUnions": [1], "addedLinks": [2]}
    }]
  }'::jsonb
from (values
  ('40000000-0000-0000-0000-0000000000f1'::uuid),
  ('40000000-0000-0000-0000-0000000000f2'::uuid),
  ('40000000-0000-0000-0000-0000000000f3'::uuid)
) as v(id);

select test_login('00000000-0000-0000-0000-0000000000f4');
select throws_ok($$ select import_commit('40000000-0000-0000-0000-0000000000f1', 'Not mine', '{"_split": ["c2"]}') $$, 'PT403', 'not_allowed', 'import: only the person who uploaded it');
reset role;

-- With no choices the merge stands and the empty box is left out.
select test_login('00000000-0000-0000-0000-0000000000f1');
select is((import_commit('40000000-0000-0000-0000-0000000000f1', 'Merged', '{}') ->> 'people')::int, 4, 'import: one person by default');
reset role;
select is((select count(*)::int from persons p join trees t on t.id = p.tree_id where t.name = 'Merged' and p.display_name = 'Cousin'), 1, 'import: the merge stands');
select is((select count(*)::int from persons p join trees t on t.id = p.tree_id where t.name = 'Merged' and p.name_unknown), 0, 'import: no space kept unless asked');
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.child_id join trees t on t.id = p.tree_id where t.name = 'Merged' and p.display_name = 'Kid'), 2, 'import: Kid belongs to the couple');

-- 'No, two people' and 'Yes, add later'.
select test_login('00000000-0000-0000-0000-0000000000f1');
select is((import_commit('40000000-0000-0000-0000-0000000000f2', 'Apart', '{"_split": ["c2"], "_placeholders": ["box"], "c2": {"gender": "female"}}') ->> 'people')::int, 6, 'import: two people and a kept space');
reset role;
select is((select count(*)::int from persons p join trees t on t.id = p.tree_id where t.name = 'Apart' and p.display_name = 'Cousin'), 2, 'import: both stay');
select is((select count(*)::int from persons p join trees t on t.id = p.tree_id where t.name = 'Apart' and p.display_name = 'Cousin' and p.gender = 'female'), 1, 'import: fixes reach the separated person');
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.child_id join trees t on t.id = p.tree_id where t.name = 'Apart' and p.display_name = 'Kid'), 1, 'import: the link the merge added is gone');
select is(
  (select pa.gender::text from unions u join trees t on t.id = u.tree_id join persons pa on pa.id = u.partner2_id where t.name = 'Apart'),
  'female', 'import: Ravi''s partner is the separated person');
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.child_id join trees t on t.id = p.tree_id where t.name = 'Apart' and p.name_unknown), 2, 'import: the kept space sits under both parents');
select is((select count(*)::int from requests q join trees t on t.id = q.tree_id where t.name = 'Apart' and q.kind = 'merge' and q.status = 'pending'), 0, 'import: the scan does not ask again about two people kept apart');
select is((select count(*)::int from requests q join trees t on t.id = q.tree_id where t.name = 'Apart' and q.kind = 'merge' and q.status = 'declined'), 1, 'import: the answer is on record');

-- A kept space under someone merged follows the merge. The answer maps temp ids for tree_add_me.
select test_login('00000000-0000-0000-0000-0000000000f1');
select ok(import_commit('40000000-0000-0000-0000-0000000000f3', 'Spaced', '{"_placeholders": ["box", "unknown"]}') -> 'person_ids' ? 'k', 'import: the answer maps temp ids to people');
reset role;
select is((select count(*)::int from parent_child pc join persons p on p.id = pc.child_id join trees t on t.id = p.tree_id where t.name = 'Spaced' and p.name_unknown), 2, 'import: a kept space follows the merge');

-- ===== Admin notices =====
select test_login('00000000-0000-0000-0000-0000000000f7');
select throws_ok($$ select admin_broadcast('Planned work', 'AYWO will be down for a short while tonight.', 'Planned upgrade') $$, 'PT403', 'admin_not_allowed', 'notice: a Sub-admin may not send one');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f4');
select throws_ok($$ select admin_broadcast('Planned work', 'AYWO will be down for a short while tonight.', 'Planned upgrade') $$, 'PT403', 'admin_not_allowed', 'notice: nor may anyone else');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f6');
select throws_ok($$ select admin_broadcast('Planned work', 'AYWO will be down for a short while tonight.', 'x') $$, 'PT422', 'admin_reason_required', 'notice: needs a reason');
select throws_ok($$ select admin_broadcast('Hi', 'Short', 'Planned upgrade') $$, 'PT422', 'admin_broadcast_bad_text', 'notice: needs real words');
select lives_ok($$ select admin_broadcast('Planned work', 'AYWO will be down for a short while tonight.', 'Planned upgrade') $$, 'notice: an AYWO Admin sends one');
reset role;
select ok((select count(*) from notifications where kind = 'system_notice') > 0, 'notice: it goes out as notifications');
select is((select count(*)::int from notifications where kind = 'system_notice' and recipient_id = '00000000-0000-0000-0000-0000000000f9'), 0, 'notice: not to a blocked account');
select is((select count(*)::int from notifications where kind = 'system_notice' and recipient_id = '00000000-0000-0000-0000-0000000000f3'), 1, 'notice: once to everyone else');
select is((select count(*)::int from admin_audit_log where action = 'broadcast.sent' and actor_id = '00000000-0000-0000-0000-0000000000f6'), 1, 'notice: audited');
select test_login('00000000-0000-0000-0000-0000000000f6');
select lives_ok($$ select admin_broadcast('Second notice', 'Another short notice for everyone on AYWO.', 'Second reason') $$, 'notice: a second one');
select lives_ok($$ select admin_broadcast('Third notice', 'One more short notice for everyone on AYWO.', 'Third reason') $$, 'notice: a third one');
select throws_ok($$ select admin_broadcast('Fourth notice', 'This one is one too many for one day.', 'Fourth reason') $$, 'PT429', 'admin_broadcast_too_many', 'notice: at most three a day');
reset role;

-- ===== Deleting an account that is paying =====
insert into family_plans (id, payer_id, store, product_id, status, external_id, will_renew) values
  ('50000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f8', 'apple', 'aywo_plus_yearly', 'active', 'ext-gap-1', true);
select test_login('00000000-0000-0000-0000-0000000000f8');
select throws_ok($$ select account_delete() $$, 'PT409', 'plan_cancel_first', 'delete: a payer with a live plan is warned first');
select throws_ok($$ select account_delete(false) $$, 'PT409', 'plan_cancel_first', 'delete: not without saying they understand');
reset role;
select is((select deleted_at from profiles where id = '00000000-0000-0000-0000-0000000000f8'), null, 'delete: the refusal changes nothing');
update family_plans set will_renew = false where id = '50000000-0000-0000-0000-0000000000f1';
select test_login('00000000-0000-0000-0000-0000000000f8');
select is(account_delete() ->> 'deleted', 'true', 'delete: a plan already cancelled does not get in the way');
reset role;
select isnt((select deleted_at from profiles where id = '00000000-0000-0000-0000-0000000000f8'), null, 'delete: the account is gone');
select is((select count(*)::int from family_plans where id = '50000000-0000-0000-0000-0000000000f1'), 1, 'delete: the plan record stays for the provider''s webhooks');

insert into family_plans (id, payer_id, store, product_id, status, external_id, will_renew) values
  ('50000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f5', 'razorpay', 'aywo_plus_monthly', 'active', 'ext-gap-2', true);
insert into device_tokens (expo_push_token, profile_id, platform) values ('ExponentPushToken[gap]', '00000000-0000-0000-0000-0000000000f5', 'ios');
select test_login('00000000-0000-0000-0000-0000000000f5');
select is(account_delete(true) ->> 'deleted', 'true', 'delete: after the warning the person may still go ahead');
reset role;
select is((select photo_path from profiles where id = '00000000-0000-0000-0000-0000000000f5'), null, 'delete: the account photo leaves');
select is((select count(*)::int from device_tokens where profile_id = '00000000-0000-0000-0000-0000000000f5'), 0, 'delete: and the device tokens');

select * from finish();
rollback;
