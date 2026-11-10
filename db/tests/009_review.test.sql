-- Security review: each hole closed in 0011, who may call what, and the statements routes run as role authenticated.
begin;
create extension if not exists pgtap;
select plan(76);

insert into languages (code, name_en) values ('en', 'English') on conflict (code) do nothing;

insert into auth.users (id, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-000000000a91', '+919811900001', now()),   -- Creator
  ('00000000-0000-0000-0000-000000000a92', '+919811900002', now()),   -- branch-limited editor
  ('00000000-0000-0000-0000-000000000a93', '+919811900003', now()),   -- whole-tree direct editor
  ('00000000-0000-0000-0000-000000000a94', '+919811900004', now()),   -- approval-mode editor
  ('00000000-0000-0000-0000-000000000a95', '+919811900005', now()),   -- payer, a stranger to the tree
  ('00000000-0000-0000-0000-000000000a96', '+919811900006', now()),   -- viewer, an SOS contact
  ('00000000-0000-0000-0000-000000000a97', '+919811900007', now()),   -- the account that gets deleted
  ('00000000-0000-0000-0000-000000000a98', '+919811900008', now()),   -- an editor who was removed
  ('00000000-0000-0000-0000-000000000a99', '+919811900009', now());   -- a stranger
update profiles set display_name = 'Creator Nine' where id = '00000000-0000-0000-0000-000000000a91';
update profiles set display_name = 'Viewer Nine' where id = '00000000-0000-0000-0000-000000000a96';
update profiles set display_name = 'Hidden Stranger' where id = '00000000-0000-0000-0000-000000000a99';
update profiles set display_name = 'Leaving Nine', email = 'leaving9@test.local', photo_path = 'photos/x/y.jpg' where id = '00000000-0000-0000-0000-000000000a97';

insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-000000000a91', 'Review family', '00000000-0000-0000-0000-000000000a91');
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-000000000a91', '10000000-0000-0000-0000-000000000a91', 'Root Elder', '00000000-0000-0000-0000-000000000a91'),
  ('20000000-0000-0000-0000-000000000a92', '10000000-0000-0000-0000-000000000a91', 'Branch Head', '00000000-0000-0000-0000-000000000a91'),
  ('20000000-0000-0000-0000-000000000a93', '10000000-0000-0000-0000-000000000a91', 'Outside Sibling', '00000000-0000-0000-0000-000000000a91'),
  ('20000000-0000-0000-0000-000000000a94', '10000000-0000-0000-0000-000000000a91', 'Elder With Number', '00000000-0000-0000-0000-000000000a91'),
  ('20000000-0000-0000-0000-000000000a95', '10000000-0000-0000-0000-000000000a91', 'Rightly Matched', '00000000-0000-0000-0000-000000000a91'),
  ('20000000-0000-0000-0000-000000000a96', '10000000-0000-0000-0000-000000000a91', 'Added By Removed', '00000000-0000-0000-0000-000000000a98');
update persons set claimed_by = '00000000-0000-0000-0000-000000000a96' where id = '20000000-0000-0000-0000-000000000a96';
insert into parent_child (tree_id, parent_id, child_id) values
  ('10000000-0000-0000-0000-000000000a91', '20000000-0000-0000-0000-000000000a91', '20000000-0000-0000-0000-000000000a92'),
  ('10000000-0000-0000-0000-000000000a91', '20000000-0000-0000-0000-000000000a91', '20000000-0000-0000-0000-000000000a93');
insert into shares (tree_id, scope_person_id, grantee_profile_id, role, edit_mode, created_by) values
  ('10000000-0000-0000-0000-000000000a91', '20000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a92', 'editor', 'direct', '00000000-0000-0000-0000-000000000a91'),
  ('10000000-0000-0000-0000-000000000a91', null, '00000000-0000-0000-0000-000000000a93', 'editor', 'direct', '00000000-0000-0000-0000-000000000a91'),
  ('10000000-0000-0000-0000-000000000a91', null, '00000000-0000-0000-0000-000000000a94', 'editor', 'approval', '00000000-0000-0000-0000-000000000a91'),
  ('10000000-0000-0000-0000-000000000a91', null, '00000000-0000-0000-0000-000000000a97', 'viewer', 'direct', '00000000-0000-0000-0000-000000000a91');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- ===== Branch editor: no pulling outsiders into the branch =====
select test_login('00000000-0000-0000-0000-000000000a92');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-000000000a92', 'child', null, '20000000-0000-0000-0000-000000000a93') $$,
  'PT403', 'not_allowed', 'a branch editor cannot link an outsider in as a child');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-000000000a92', 'spouse', null, '20000000-0000-0000-0000-000000000a93') $$,
  'PT403', 'not_allowed', 'nor as a partner');
select lives_ok($$ select add_relative('20000000-0000-0000-0000-000000000a92', 'child', '{"display_name": "New Child"}') $$,
  'a branch editor still adds a new child');
select is(tree_role('10000000-0000-0000-0000-000000000a91', '20000000-0000-0000-0000-000000000a93'), 'none'::tree_role_t, 'the outsider stays out of reach');
reset role;
select test_login('00000000-0000-0000-0000-000000000a93');
select lives_ok($$ select add_relative('20000000-0000-0000-0000-000000000a93', 'spouse', null, '20000000-0000-0000-0000-000000000a95') $$,
  'a whole-tree editor can link two existing people');
reset role;
select test_login('00000000-0000-0000-0000-000000000a94');
select throws_ok($$ select add_relative('20000000-0000-0000-0000-000000000a92', 'child', '{"display_name": "No"}') $$,
  'PT403', 'not_allowed', 'an approval-mode editor cannot add directly');
select throws_ok($$ select set_person_contact('20000000-0000-0000-0000-000000000a94', 'mobile', '98119 00004', '+919811900004') $$,
  'PT403', 'not_allowed', 'nor write a contact');
reset role;

-- ===== Claiming =====
select test_login('00000000-0000-0000-0000-000000000a93');
select throws_ok($$ select set_person_contact('20000000-0000-0000-0000-000000000a94', 'mobile', '98000 12345', '+919811900003') $$,
  'PT422', 'bad_input', 'the match value must be the number shown');
select throws_ok($$ select set_person_contact('20000000-0000-0000-0000-000000000a94', 'email', 'a@b.co', 'other@b.co') $$,
  'PT422', 'bad_input', 'for an email too');
select throws_ok($$ select set_person_contact('20000000-0000-0000-0000-000000000a94', 'mobile', '', '+919811900003') $$,
  'PT422', 'bad_input', 'an empty value is refused');
select lives_ok($$ select set_person_contact('20000000-0000-0000-0000-000000000a94', 'mobile', '098119 00003', '+919811900003') $$,
  'a national number with a trunk zero is accepted');
select lives_ok($$ select set_person_contact('20000000-0000-0000-0000-000000000a94', 'email', 'Elder@Test.local', 'elder@test.local') $$,
  'an email is accepted');
select is((select count(*)::int from claim_candidates()), 0, 'a number the editor typed in is not offered to that editor');
select throws_ok($$ select claim_confirm('20000000-0000-0000-0000-000000000a94') $$, 'PT403', 'not_your_entry', 'and cannot be claimed');
select is(person_card('20000000-0000-0000-0000-000000000a94') ->> 'access', 'ask', 'so the elder''s contacts stay locked');
reset role;
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-000000000a95', 'mobile', '98119 00009', '+919811900009', '00000000-0000-0000-0000-000000000a91');
select test_login('00000000-0000-0000-0000-000000000a99');
select is((select count(*)::int from claim_candidates()), 1, 'a number someone else saved is still offered');
reset role;
select test_login('00000000-0000-0000-0000-000000000a98');
select throws_ok($$ select claim_undo('20000000-0000-0000-0000-000000000a96') $$, 'PT403', 'not_allowed', 'someone no longer in the tree cannot undo a claim');
reset role;
select test_login('00000000-0000-0000-0000-000000000a91');
select lives_ok($$ select claim_undo('20000000-0000-0000-0000-000000000a96') $$, 'the Creator can');
reset role;
update persons set claimed_by = '00000000-0000-0000-0000-000000000a96' where id = '20000000-0000-0000-0000-000000000a96';

-- ===== SOS =====
select test_login('00000000-0000-0000-0000-000000000a91');
select lives_ok($$ select sos_contact_add(p_contact_profile => '00000000-0000-0000-0000-000000000a96') $$, 'a family member is chosen as SOS contact');
select set_config('test.sos', sos_start(30, 13.05, 80.25)::text, true);
reset role;
select test_login('00000000-0000-0000-0000-000000000a96');
select isnt(sos_view((current_setting('test.sos')::jsonb ->> 'id')::uuid) -> 'last', 'null'::jsonb, 'while it runs the contact sees the place');
reset role;
select test_login('00000000-0000-0000-0000-000000000a91');
select ok(sos_stop((current_setting('test.sos')::jsonb ->> 'id')::uuid), 'the SOS is stopped');
select isnt(sos_view((current_setting('test.sos')::jsonb ->> 'id')::uuid) -> 'last', 'null'::jsonb, 'the person themselves still sees their own trail');
reset role;
select test_login('00000000-0000-0000-0000-000000000a96');
select is(sos_view((current_setting('test.sos')::jsonb ->> 'id')::uuid) -> 'last', 'null'::jsonb, 'after it ends the contact no longer sees the place');
select is(sos_view((current_setting('test.sos')::jsonb ->> 'id')::uuid) -> 'trail', '[]'::jsonb, 'nor the trail');
reset role;
select is(sos_page(current_setting('test.sos')::jsonb ->> 'token') ->> 'lat', null, 'the public page shows no place after the end');
select ok(sos_location(current_setting('test.sos')::jsonb ->> 'write_token', 1, 1) = false, 'the write key stops working after the end');

insert into sos_events (profile_id, ends_at, ended_at, token_hash, write_hash)
select '00000000-0000-0000-0000-000000000a94', now(), now(), 'lim-t' || g, 'lim-w' || g from generate_series(1, 6) g;
select throws_ok($$ insert into sos_events (profile_id, ends_at, token_hash, write_hash)
  values ('00000000-0000-0000-0000-000000000a94', now() + interval '1 hour', 'lim-t7', 'lim-w7') $$,
  'PT429', 'too_many_requests', 'the seventh SOS in a day is refused, so it cannot be a free SMS sender');

-- Anyone without an account gets exactly what the tokens allow.
set local role anon;
select is(sos_page('wrong'), null, 'a visitor with a wrong token gets nothing');
select throws_ok($$ select sos_location('wrong', 1, 1) $$, 'PT403', 'not_allowed', 'and cannot add a location');
select throws_ok($$ select sos_targets('00000000-0000-0000-0000-000000000000') $$, '42501', null, 'nor read the numbers of an event');
reset role;

-- ===== Live chat =====
insert into chats (id, kind, name) values ('40000000-0000-0000-0000-000000000a91', 'group', 'Review chat');
insert into family_plans (id, payer_id, store, product_id, status, external_id) values
  ('50000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a98', 'stripe', 'aywo_plus_yearly', 'active', 'sub_review_1');
insert into chat_members (chat_id, profile_id) values ('40000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a98');
select is((select count(*)::int from social_chat_recipients('40000000-0000-0000-0000-000000000a91')), 1, 'a member with Plus receives a message');
update auth.users set banned_at = now() where id = '00000000-0000-0000-0000-000000000a98';
select is((select count(*)::int from social_chat_recipients('40000000-0000-0000-0000-000000000a91')), 0, 'a blocked member stops receiving at once');
update auth.users set banned_at = null where id = '00000000-0000-0000-0000-000000000a98';

-- ===== Family plan =====
insert into family_plans (id, payer_id, store, product_id, status, external_id) values
  ('50000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a95', 'stripe', 'aywo_plus_yearly', 'active', 'sub_review_2');
insert into family_plan_members (plan_id, profile_id) values ('50000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a95');
select test_login('00000000-0000-0000-0000-000000000a95');
select is(plan_add_member('+919811900009') ->> 'display_name', '******0009', 'adding a number does not reveal the name behind it');
select ok(position('Hidden Stranger' in plan_summary()::text) = 0, 'nor does the plan screen');
select ok(position('******0009' in plan_summary()::text) > 0, 'the payer sees the digits they typed');
reset role;
select test_login('00000000-0000-0000-0000-000000000a99');
select ok(position('Hidden Stranger' in plan_summary()::text) > 0, 'a member sees their own name');
select throws_ok($$ select plan_add_member('+919811900001') $$, 'PT403', 'plan_not_payer', 'a member cannot add anyone');
select throws_ok($$ select apply_plan_event('stripe', 'x', auth.uid(), 'aywo_plus_yearly', 'active', null, null, true, now()) $$,
  '42501', null, 'nobody grants themselves Plus through the webhook function');
reset role;
select is((select count(*)::int from generate_series(1, 35) g where plan_member_try('00000000-0000-0000-0000-000000000a95')), 30, 'thirty tries at adding someone a day');
select is(plan_member_try('00000000-0000-0000-0000-000000000a95'), false, 'then no more');

-- ===== Undo of an import =====
insert into imports (id, created_by, source, file_path, preview) values
  ('60000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a91', 'gedcom', 'imports/x/y.ged',
   '{"persons": [{"tempId": "p1", "displayName": "Imported One", "nameUnknown": false, "gender": "unknown"}], "unions": [], "parentLinks": []}');
select test_login('00000000-0000-0000-0000-000000000a91');
select set_config('test.import', import_commit('60000000-0000-0000-0000-000000000a91', 'Imported family')::text, true);
reset role;
insert into shares (tree_id, grantee_profile_id, role, edit_mode, created_by) values
  ((current_setting('test.import')::jsonb ->> 'tree_id')::uuid, '00000000-0000-0000-0000-000000000a93', 'editor', 'direct', '00000000-0000-0000-0000-000000000a91');
select test_login('00000000-0000-0000-0000-000000000a93');
select throws_ok($$ select history_revert(p_batch => (current_setting('test.import')::jsonb ->> 'batch_id')::uuid) $$,
  'PT403', 'not_allowed', 'an editor cannot wipe out a tree by undoing its import');
reset role;
select is((select deleted_at from trees where id = (current_setting('test.import')::jsonb ->> 'tree_id')::uuid), null, 'the tree is still there');
select test_login('00000000-0000-0000-0000-000000000a91');
select lives_ok($$ select history_revert(p_batch => (current_setting('test.import')::jsonb ->> 'batch_id')::uuid) $$, 'the Creator can');
reset role;

-- ===== Deleting an account =====
insert into groups (id, name, invite_token, created_by) values
  ('41000000-0000-0000-0000-000000000a91', 'Kept group', 'tok-kept', '00000000-0000-0000-0000-000000000a97'),
  ('41000000-0000-0000-0000-000000000a92', 'Empty group', 'tok-empty', '00000000-0000-0000-0000-000000000a97');
insert into group_members (group_id, profile_id) values
  ('41000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97'),
  ('41000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a96'),
  ('41000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97');
insert into chats (id, kind, name, created_by) values
  ('40000000-0000-0000-0000-000000000a92', 'group', 'Shared chat', '00000000-0000-0000-0000-000000000a97'),
  ('40000000-0000-0000-0000-000000000a93', 'group', 'Lonely chat', '00000000-0000-0000-0000-000000000a97');
insert into chat_members (chat_id, profile_id) values
  ('40000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97'),
  ('40000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a96'),
  ('40000000-0000-0000-0000-000000000a93', '00000000-0000-0000-0000-000000000a97');
insert into messages (id, chat_id, sender_id, body, media_path, media_kind, client_id) values
  ('42000000-0000-0000-0000-000000000a91', '40000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97', 'private words', 'chat/x/y.jpg', 'photo', '42000000-0000-0000-0000-000000000a99');
insert into posts (id, author_id, tree_id, body) values
  ('43000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97', '10000000-0000-0000-0000-000000000a91', 'my memory'),
  ('43000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a91', '10000000-0000-0000-0000-000000000a91', 'someone else''s memory');
insert into post_media (post_id, path, added_by) values
  ('43000000-0000-0000-0000-000000000a92', 'posts/x/y.jpg', '00000000-0000-0000-0000-000000000a97');
insert into post_comments (id, post_id, author_id, body) values
  ('44000000-0000-0000-0000-000000000a91', '43000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97', 'my comment');
insert into post_collaborators (post_id, profile_id) values ('43000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97');
insert into post_tags (post_id, profile_id) values ('43000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97');
insert into reactions (target_type, target_id, profile_id, emoji) values
  ('post', '43000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97', 'x'),
  ('post', '43000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a91', 'y'),
  ('comment', '44000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a91', 'z');
insert into events (id, host_id, kind, title, starts_at) values
  ('45000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97', 'birthday', 'My party', now() + interval '1 day'),
  ('45000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a91', 'birthday', 'Other party', now() + interval '1 day');
insert into event_invitees (event_id, profile_id) values
  ('45000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a96'),
  ('45000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97');
insert into rsvps (event_id, profile_id, answer) values ('45000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97', 'yes');
insert into polls (id, event_id, topic) values ('46000000-0000-0000-0000-000000000a91', '45000000-0000-0000-0000-000000000a92', 'menu');
insert into poll_options (id, poll_id, label) values ('47000000-0000-0000-0000-000000000a91', '46000000-0000-0000-0000-000000000a91', 'Rice');
insert into poll_votes (poll_id, profile_id, option_id) values ('46000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97', '47000000-0000-0000-0000-000000000a91');
insert into alerts (id, sender_id, kind, body, audience_type) values
  ('48000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97', 'news', 'my alert', 'people'),
  ('48000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a91', 'news', 'other alert', 'people');
insert into alert_recipients (alert_id, profile_id) values ('48000000-0000-0000-0000-000000000a92', '00000000-0000-0000-0000-000000000a97');
insert into sos_contacts (profile_id, phone, name) values ('00000000-0000-0000-0000-000000000a97', '+919800000001', 'A friend');
insert into sos_contacts (profile_id, contact_profile_id) values ('00000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97');
insert into sos_events (id, profile_id, ends_at, last_lat, last_lng, token_hash, write_hash) values
  ('49000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97', now() + interval '1 hour', 13, 80, 'del-t', 'del-w');
insert into sos_locations (event_id, lat, lng) values ('49000000-0000-0000-0000-000000000a91', 13, 80);
insert into sos_event_contacts (event_id, position, phone) values ('49000000-0000-0000-0000-000000000a91', 0, '+919800000001');
insert into imports (created_by, source, file_path, preview) values
  ('00000000-0000-0000-0000-000000000a97', 'gedcom', 'imports/x/z.ged', '{"persons": [{"displayName": "Private Name"}]}');
insert into one_time_orders (id, buyer_id, product, store, amount_minor, currency, details) values
  ('4a000000-0000-0000-0000-000000000a91', '00000000-0000-0000-0000-000000000a97', 'tree_poster', 'razorpay', 79900, 'INR', '{"quantity": 1, "shipping": {"phone": "+919800000002"}}');
insert into app_admins (profile_id, role) values ('00000000-0000-0000-0000-000000000a97', 'sub_admin');
insert into app_admin_permissions (profile_id, permission) values ('00000000-0000-0000-0000-000000000a97', 'support');
insert into auth.otp_codes (phone, code_hash, expires_at) values ('+919811900007', 'h', now());
insert into notifications (recipient_id, kind, payload) values
  ('00000000-0000-0000-0000-000000000a96', 'alert', '{"by": "00000000-0000-0000-0000-000000000a97", "from_name": "Leaving Nine", "body": "words"}');

select test_login('00000000-0000-0000-0000-000000000a97');
select lives_ok($$ select account_delete() $$, 'the account is deleted');
reset role;
select is((select array_agg(x.name order by x.name) from (values
    ('group_members', (select count(*) from group_members where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('chat_members', (select count(*) from chat_members where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('messages', (select count(*) from messages where sender_id = '00000000-0000-0000-0000-000000000a97')),
    ('posts', (select count(*) from posts where author_id = '00000000-0000-0000-0000-000000000a97')),
    ('post_media', (select count(*) from post_media where added_by = '00000000-0000-0000-0000-000000000a97')),
    ('post_comments', (select count(*) from post_comments where author_id = '00000000-0000-0000-0000-000000000a97')),
    ('post_collaborators', (select count(*) from post_collaborators where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('post_tags', (select count(*) from post_tags where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('reactions', (select count(*) from reactions where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('events', (select count(*) from events where host_id = '00000000-0000-0000-0000-000000000a97')),
    ('event_invitees', (select count(*) from event_invitees where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('rsvps', (select count(*) from rsvps where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('poll_votes', (select count(*) from poll_votes where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('alerts', (select count(*) from alerts where sender_id = '00000000-0000-0000-0000-000000000a97')),
    ('alert_recipients', (select count(*) from alert_recipients where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('sos_contacts', (select count(*) from sos_contacts where profile_id = '00000000-0000-0000-0000-000000000a97' or contact_profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('sos_events', (select count(*) from sos_events where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('sos_locations', (select count(*) from sos_locations where event_id = '49000000-0000-0000-0000-000000000a91')),
    ('sos_event_contacts', (select count(*) from sos_event_contacts where event_id = '49000000-0000-0000-0000-000000000a91')),
    ('imports', (select count(*) from imports where created_by = '00000000-0000-0000-0000-000000000a97')),
    ('one_time_orders', (select count(*) from one_time_orders where buyer_id = '00000000-0000-0000-0000-000000000a97')),
    ('app_admins', (select count(*) from app_admins where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('app_admin_permissions', (select count(*) from app_admin_permissions where profile_id = '00000000-0000-0000-0000-000000000a97')),
    ('otp_codes', (select count(*) from auth.otp_codes where phone = '+919811900007'))
  ) as x(name, n) where x.n > 0), null, 'nothing of theirs is left in any of these tables');
select is((select body from messages where id = '42000000-0000-0000-0000-000000000a91'), null, 'their message text is gone');
select is((select media_path from messages where id = '42000000-0000-0000-0000-000000000a91'), null, 'and its file');
select ok((select deleted_at is not null from messages where id = '42000000-0000-0000-0000-000000000a91'), 'the thread keeps a deleted marker');
select is((select count(*)::int from chats where id = '40000000-0000-0000-0000-000000000a93'), 0, 'a chat nobody is left in goes');
select is((select count(*)::int from chats where id = '40000000-0000-0000-0000-000000000a92'), 1, 'a chat others are in stays');
select is((select created_by from groups where id = '41000000-0000-0000-0000-000000000a91'), '00000000-0000-0000-0000-000000000a96'::uuid, 'a group passes to a remaining member');
select is((select count(*)::int from groups where id = '41000000-0000-0000-0000-000000000a92'), 0, 'an empty group goes');
select is((select count(*)::int from reactions where target_id in ('43000000-0000-0000-0000-000000000a91', '44000000-0000-0000-0000-000000000a91')), 0, 'reactions to their posts and comments go, though no foreign key says so');
select is((select count(*)::int from posts where id = '43000000-0000-0000-0000-000000000a92'), 1, 'other people''s memories stay');
select is((select details ? 'shipping' from one_time_orders where id = '4a000000-0000-0000-0000-000000000a91'), false, 'the order keeps no delivery address or phone');
select is((select amount_minor from one_time_orders where id = '4a000000-0000-0000-0000-000000000a91'), 79900::bigint, 'but the money record stays');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-000000000a96' and kind = 'invite_cancelled'), 1, 'guests hear the party is off');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-000000000a96' and kind = 'alert' and (payload ? 'from_name' or payload ? 'body')), 0, 'other inboxes lose their name and words');

-- ===== Who may call what =====
select is((
  select string_agg(p.proname, ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
), 'announcements_public,app_config_public,is_app_admin,sos_location,sos_page,takedown_submit', 'visitors can run these database functions and no others');
select is((
  select string_agg(p.proname, ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname = any (array[
      'apply_plan_event', 'apply_plan_transfer', 'apply_order_event', 'record_store_order', 'record_webhook_event', 'queue_trial_reminders',
      'sos_targets', 'sos_close_and_purge', 'social_chat_recipients', 'social_notify', 'social_audience', 'social_circle', 'run_memory_reminders',
      'history_revert_inner', 'revert_history_row', 'apply_change', 'grant_from_request', 'merge_persons', 'merge_scan_tree', 'merge_scan_all',
      'tree_successor_rule', 'tree_expire_access', 'job_claim', 'notify_tree_managers', 'contact_access', 'my_verified_phone', 'insert_person_from_json',
      'admin_log', 'admin_set_permissions', 'admin_require', 'takedown_guard', 'plan_member_try', 'plan_member_label', 'clean_person_fields',
      'apply_person_fields', 'apply_person_delete', 'apply_elder_younger', 'new_link_token', 'share_resolve_waiting', 'share_follow_claim'
    ])
), null, 'signed-in people cannot run the internal functions');
select is((
  select string_agg(p.proname, ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('public', p.oid, 'execute')
), null, 'nothing with server rights is open to everyone by default');

-- ===== What the routes really run as role authenticated =====
select test_login('00000000-0000-0000-0000-000000000a93');
select lives_ok($$ insert into consents (profile_id, kind, version) values (auth.uid(), 'terms', 'v1') on conflict do nothing $$, 'POST /me/consents');
select lives_ok($$ select id, display_name, name_unknown, note_label, gender, living, birth_date, death_date, birth_precision, death_precision,
  birth_place, death_place, birth_order, photo_path, notes, claimed_by, version from persons where tree_id = '10000000-0000-0000-0000-000000000a91' and deleted_at is null $$, 'POST /tree-view: persons');
select lives_ok($$ select id, partner1_id, partner2_id, seq1, kind, status, version from unions where tree_id = '10000000-0000-0000-0000-000000000a91' $$, 'POST /tree-view: unions');
select lives_ok($$ select parent_id, child_id, union_id, kind from parent_child where tree_id = '10000000-0000-0000-0000-000000000a91' $$, 'POST /tree-view: links');
select lives_ok($$ select id, name, creator_person_id from trees where id = '10000000-0000-0000-0000-000000000a91' $$, 'POST /tree-view: tree');
select lives_ok($$ with term as (select aywo_normalize('root') as t) select p.id, p.display_name as name from persons p, term
  where p.tree_id = '10000000-0000-0000-0000-000000000a91' and extensions.similarity(p.name_normalized, term.t) > 0.3 $$, 'GET /trees/:id/search');
select lives_ok($$ select id, path_code, language_code, term, term_native, status, is_default from kin_terms where status <> 'rejected' limit 1 $$, 'GET /kin/suggest');
select lives_ok($$ insert into kin_terms (path_code, language_code, term, submitted_by)
  select code, 'en', 'review word nine', auth.uid() from kin_paths limit 1 returning id, status $$, 'POST /kin/terms');
select lives_ok($$ insert into term_reports (kin_term_id, reporter_id, suggestion)
  select id, auth.uid(), 'better word' from kin_terms where submitted_by = auth.uid() limit 1 returning id $$, 'POST /kin/reports');
select lives_ok($$ update notifications set read_at = coalesce(read_at, now()) where id = '00000000-0000-0000-0000-000000000000' $$, 'POST /notifications/:id/read');
select lives_ok($$ insert into notification_prefs (profile_id, kind, push, sms, email) values (auth.uid(), 'alert', true, false, true)
  on conflict (profile_id, kind) do update set push = notification_prefs.push $$, 'PATCH /notification-prefs');
select lives_ok($$ select p.login_phone, p.email, has_plus(p.id) as plus,
  exists (select 1 from family_plans f where f.payer_id = p.id and f.trial_ends_at is not null) as had_trial from profiles p where p.id = auth.uid() $$, 'buying: loadBuyer');
select lives_ok($$ select store, external_id, status from family_plans where payer_id = auth.uid() order by last_event_at desc nulls last limit 1 $$, 'cancelling: payersLivePlan');
select lives_ok($$ select phone from sos_contacts where profile_id = auth.uid() order by position, created_at limit 1 $$, 'POST /sos/start: first contact');
select lives_ok($$ select bool_or(has_admin_permission(g)) as ok from unnest(array['users']) g $$, 'admin routes: the gate');
reset role;

select * from finish();
rollback;
