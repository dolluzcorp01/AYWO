-- Social rules: chat, memories, alerts and SOS. Run with pgTAP inside one transaction.
begin;
create extension if not exists pgtap;
select plan(47);

-- c1 Meera (Plus, tree Creator), c2 Arun (Plus, tree member), c3 Kavi (no Plus, tree member),
-- c4 Devi (Plus, outsider), c5 Rahim (friend in Meera's group only).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'meera@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'arun@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'kavi@test.local'),
  ('00000000-0000-0000-0000-0000000000c4', 'devi@test.local'),
  ('00000000-0000-0000-0000-0000000000c5', 'rahim@test.local');
update profiles set display_name = 'Meera' where id = '00000000-0000-0000-0000-0000000000c1';
update profiles set display_name = 'Arun', login_phone = '+919800000021' where id = '00000000-0000-0000-0000-0000000000c2';
update profiles set display_name = 'Kavi' where id = '00000000-0000-0000-0000-0000000000c3';
update profiles set display_name = 'Devi' where id = '00000000-0000-0000-0000-0000000000c4';
update profiles set display_name = 'Rahim' where id = '00000000-0000-0000-0000-0000000000c5';

insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000000c1', 'Meera family', '00000000-0000-0000-0000-0000000000c1'),
  ('10000000-0000-0000-0000-0000000000c2', 'Devi family', '00000000-0000-0000-0000-0000000000c4');
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'Meera', '00000000-0000-0000-0000-0000000000c1'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c1', 'Arun', '00000000-0000-0000-0000-0000000000c1'),
  ('20000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000c1', 'Kavi', '00000000-0000-0000-0000-0000000000c1');
update persons set claimed_by = '00000000-0000-0000-0000-0000000000c2' where id = '20000000-0000-0000-0000-0000000000c2';
update persons set claimed_by = '00000000-0000-0000-0000-0000000000c3' where id = '20000000-0000-0000-0000-0000000000c3';

insert into family_plans (id, payer_id, store, product_id, status, external_id) values
  ('30000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'razorpay', 'aywo_plus_yearly', 'active', 'x1'),
  ('30000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'razorpay', 'aywo_plus_yearly', 'active', 'x2'),
  ('30000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c4', 'razorpay', 'aywo_plus_yearly', 'active', 'x4');

insert into groups (id, name, invite_token, created_by) values
  ('40000000-0000-0000-0000-0000000000c1', 'College gang', 'test-group-token', '00000000-0000-0000-0000-0000000000c1');
insert into group_members (group_id, profile_id) values
  ('40000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1'),
  ('40000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c5');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ===== Chat =====
select test_login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select chat_open_direct('00000000-0000-0000-0000-0000000000c1') $$, 'PT402', 'plus_required', 'F-CHAT-01: without Plus a chat cannot be opened');
select throws_ok($$ select chat_list() $$, 'PT402', 'plus_required', 'F-CHAT-01: without Plus the chat list is refused');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select chat_open_direct('00000000-0000-0000-0000-0000000000c4') $$, 'PT403', 'not_allowed', 'a 1-to-1 only opens with family or friends');
select lives_ok($$ select set_config('test.chat', chat_open_direct('00000000-0000-0000-0000-0000000000c2')::text, true) $$, 'a 1-to-1 opens with family');
select is(chat_open_direct('00000000-0000-0000-0000-0000000000c2')::text, current_setting('test.chat'), 'the same two people get the same chat');
select lives_ok($$ select send_message(current_setting('test.chat')::uuid, 'Hello Arun') $$, 'a member with Plus can send');
select lives_ok($$ select set_config('test.group_chat', chat_create_group('Family', jsonb_build_object('type', 'tree', 'tree_id', '10000000-0000-0000-0000-0000000000c1'))::text, true) $$, 'a family group is made from the tree');
select throws_ok($$ select send_message(current_setting('test.chat')::uuid, null) $$, 'PT422', 'message_empty', 'an empty message is refused');
select throws_ok($$ select send_message(current_setting('test.chat')::uuid, 'x', 'chat/00000000-0000-0000-0000-0000000000c4/a.jpg', 'photo') $$, 'PT403', 'not_allowed', 'a photo from someone else''s folder is refused');
reset role;
select is((select count(*)::int from chat_members where chat_id = current_setting('test.group_chat')::uuid), 3, 'the family group holds the three tree members');
select is((select count(*)::int from notifications where kind = 'chat_message' and recipient_id = '00000000-0000-0000-0000-0000000000c2'), 1, 'the other person gets one chat notification');
select ok((select payload ->> 'body' from notifications where kind = 'chat_message' limit 1) is null, 'message text does not travel in the notification');

select test_login('00000000-0000-0000-0000-0000000000c4');
select throws_ok($$ select send_message(current_setting('test.chat')::uuid, 'Let me in') $$, 'PT403', 'not_allowed', 'a non-member with Plus cannot send');
select throws_ok($$ select chat_messages(current_setting('test.chat')::uuid) $$, 'PT403', 'not_allowed', 'a non-member cannot read through the function');
select is((select count(*)::int from messages), 0, 'row rules hide messages from a non-member');
reset role;

-- A member whose Plus has run out sees nothing.
select test_login('00000000-0000-0000-0000-0000000000c3');
select is((select count(*)::int from messages where chat_id = current_setting('test.group_chat')::uuid), 0, 'row rules hide chat from a member without Plus');
select throws_ok($$ select send_message(current_setting('test.group_chat')::uuid, 'Hi') $$, 'PT402', 'plus_required', 'a member without Plus cannot send');
reset role;

-- ===== Memories =====
select test_login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select set_config('test.post', post_create(
  p_tree => '10000000-0000-0000-0000-0000000000c1', p_body => 'Temple trip', p_happened_on => (current_date - interval '1 year')::date,
  p_tag_people => '["20000000-0000-0000-0000-0000000000c3"]'::jsonb)::text, true) $$, 'a memory is posted with a tag');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select react('post', current_setting('test.post')::uuid, ':)') $$, 'PT402', 'plus_required', 'posting a reaction needs Plus');
select is(jsonb_typeof(post_detail(current_setting('test.post')::uuid) -> 'reactions'), 'array', 'seeing reactions is free');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c2');
select lives_ok($$ select react('post', current_setting('test.post')::uuid, ':)') $$, 'a family member with Plus can react');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select post_set_closed(current_setting('test.post')::uuid, true) $$, 'the author closes the thread');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$ select post_comment(current_setting('test.post')::uuid, 'One more') $$, 'PT409', 'thread_closed', 'a closed thread takes no more comments');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c4');
select throws_ok($$ select post_detail(current_setting('test.post')::uuid) $$, 'PT403', 'not_allowed', 'an outsider cannot see the memory');
select is((select count(*)::int from posts where id = current_setting('test.post')::uuid), 0, 'row rules hide the memory from an outsider');
reset role;

-- F-MEM-02: make the reminder due, then run the job.
update reminders set run_on = current_date where post_id = current_setting('test.post')::uuid;
select is(run_memory_reminders(), 1, 'the yearly job finds the memory');
select is((select count(*)::int from notifications where kind = 'memory_reminder' and recipient_id = '00000000-0000-0000-0000-0000000000c3'), 1, 'the tagged person gets this day last year');

-- ===== Alerts =====
select test_login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select send_alert('news', 'Hello', '{"type":"tree","tree_id":"10000000-0000-0000-0000-0000000000c2"}'::jsonb) $$, 'PT403', 'not_allowed', 'F-NOT-01: not to a tree that is not the sender''s');
select throws_ok($$ select send_alert('news', 'Hello', '{"type":"people","profile_ids":["00000000-0000-0000-0000-0000000000c4"]}'::jsonb) $$, 'PT403', 'not_allowed', 'F-NOT-01: not to a stranger');
select throws_ok($$ select send_alert('news', 'Hello', '{"type":"everyone"}'::jsonb) $$, 'PT422', 'bad_input', 'F-NOT-01: there is no blast');
select throws_ok($$ select send_alert('blood', 'Need blood', '{"type":"group","group_id":"40000000-0000-0000-0000-0000000000c1"}'::jsonb) $$, 'PT422', 'blood_group_required', 'a blood alert must say the group');
select is(send_alert('blood', 'Need blood', '{"type":"group","group_id":"40000000-0000-0000-0000-0000000000c1"}'::jsonb, 'O-') ->> 'recipients', '1', 'a group alert reaches its members only');
reset role;

-- ===== SOS =====
select test_login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select sos_start(30) $$, 'PT422', 'sos_no_contacts', 'SOS needs a chosen contact');
select lives_ok($$ select sos_contact_add(p_contact_profile => '00000000-0000-0000-0000-0000000000c2') $$, 'a family member is chosen');
select set_config('test.sos', sos_start(30, 13.0, 80.2)::text, true);
select is((sos_contacts_list() -> 0 ->> 'phone'), null, 'the list never shows a family member''s number');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from sos_locations where event_id = (current_setting('test.sos')::jsonb ->> 'id')::uuid), 1, 'the chosen contact sees the location');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c3');
select is((select count(*)::int from sos_locations where event_id = (current_setting('test.sos')::jsonb ->> 'id')::uuid), 0, 'someone else in the family does not');
select throws_ok($$ select sos_view((current_setting('test.sos')::jsonb ->> 'id')::uuid) $$, 'PT403', 'not_allowed', 'nor through the function');
reset role;

-- The page opens with the token only, and stops when the event ends.
set local role anon;
select ok((sos_page(current_setting('test.sos')::jsonb ->> 'token') ->> 'lat') is not null, 'the page token shows the location');
select is(sos_location(current_setting('test.sos')::jsonb ->> 'write_token', 13.1, 80.3), true, 'the phone''s own key adds a location without a sign-in');
select throws_ok($$ select sos_location('not-the-key', 1, 1) $$, 'PT403', 'not_allowed', 'a wrong key adds nothing');
select throws_ok($$ select sos_location(current_setting('test.sos')::jsonb ->> 'token', 1, 1) $$, 'PT403', 'not_allowed', 'the page link cannot add a location');
select is(sos_page('not-the-token'), null, 'a wrong token shows nothing');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c1');
select is(sos_stop((current_setting('test.sos')::jsonb ->> 'id')::uuid), true, 'the person stops the SOS');
reset role;

set local role anon;
select is(sos_page(current_setting('test.sos')::jsonb ->> 'token') ->> 'lat', null, 'after the end the page shows no location');
reset role;

-- Deleted 7 days after the end.
update sos_events set ended_at = now() - interval '8 days' where id = (current_setting('test.sos')::jsonb ->> 'id')::uuid;
select is(sos_close_and_purge(), 1, 'the job removes the old event');
select is((select count(*)::int from sos_locations where event_id = (current_setting('test.sos')::jsonb ->> 'id')::uuid), 0, 'its locations are gone');

select * from finish();
rollback;
