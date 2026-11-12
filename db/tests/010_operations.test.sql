-- Operations release: team roles, invites, the work queue, report and block, help tickets, orders, coupons,
-- announcements, promotional messages, app settings, referrals, emergency card and family dates.
begin;
create extension if not exists pgtap;
select * from no_plan();

-- o1 Admin, o2 Support (team role), o3 Moderator (team role), o4 Asha (Plus, tree Creator), o5 Bala (Plus, in Asha's tree),
-- o6 Chitra (new person, not in the tree).
insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'admin12@test.local', '+919822200001', now()),
  ('00000000-0000-0000-0000-0000000000f2', 'support12@test.local', '+919822200002', now()),
  ('00000000-0000-0000-0000-0000000000f3', 'mod12@test.local', '+919822200003', now()),
  ('00000000-0000-0000-0000-0000000000f4', 'asha12@test.local', '+919822200004', now()),
  ('00000000-0000-0000-0000-0000000000f5', 'bala12@test.local', '+919822200005', now()),
  ('00000000-0000-0000-0000-0000000000f6', 'chitra12@test.local', '+14155550106', now());
update profiles set display_name = 'Admin Twelve' where id = '00000000-0000-0000-0000-0000000000f1';
update profiles set display_name = 'Sam Support' where id = '00000000-0000-0000-0000-0000000000f2';
update profiles set display_name = 'Mo Moderator' where id = '00000000-0000-0000-0000-0000000000f3';
update profiles set display_name = 'Asha', plus_bonus_until = now() + interval '30 days' where id = '00000000-0000-0000-0000-0000000000f4';
update profiles set display_name = 'Bala', plus_bonus_until = now() + interval '30 days' where id = '00000000-0000-0000-0000-0000000000f5';
update profiles set display_name = 'Chitra' where id = '00000000-0000-0000-0000-0000000000f6';
insert into app_admins (profile_id, role) values ('00000000-0000-0000-0000-0000000000f1', 'aywo_admin');

insert into trees (id, name, creator_id) values ('10000000-0000-0000-0000-0000000000f1', 'Asha family', '00000000-0000-0000-0000-0000000000f4');
insert into persons (id, tree_id, display_name, created_by, living, birth_date, birth_precision) values
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'Asha', '00000000-0000-0000-0000-0000000000f4', 'living', '1990-01-01', 'exact'),
  ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f1', 'Bala', '00000000-0000-0000-0000-0000000000f4', 'living', null, null),
  ('20000000-0000-0000-0000-0000000000f3', '10000000-0000-0000-0000-0000000000f1', 'Grandma Lakshmi', '00000000-0000-0000-0000-0000000000f4', 'living',
   (current_date - interval '70 years' + interval '3 days')::date, 'exact');
update persons set claimed_by = '00000000-0000-0000-0000-0000000000f4' where id = '20000000-0000-0000-0000-0000000000f1';
update persons set claimed_by = '00000000-0000-0000-0000-0000000000f5' where id = '20000000-0000-0000-0000-0000000000f2';
insert into shares (tree_id, grantee_profile_id, role, created_by) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f5', 'editor', '00000000-0000-0000-0000-0000000000f4');

insert into posts (id, author_id, tree_id, body, happened_on) values
  ('50000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f5', '10000000-0000-0000-0000-0000000000f1', 'A rude memory', current_date),
  ('50000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f4', '10000000-0000-0000-0000-0000000000f1', 'Wedding day', (current_date - interval '5 years')::date);

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ===== Team roles and staff =====
select set_config('test.r_support', (select id::text from admin_roles where name = 'Support'), true);
select set_config('test.r_mod', (select id::text from admin_roles where name = 'Moderator'), true);
select set_config('test.r_mkt', (select id::text from admin_roles where name = 'Marketing'), true);
select test_login('00000000-0000-0000-0000-0000000000f1');
select ok(has_admin_permission('marketing') and has_admin_permission('settings'), 'an AYWO Admin holds the new areas too');
select is(jsonb_array_length(admin_roles_list()), 4, 'four starter roles exist');
select lives_ok($$ select admin_staff_add('+919822200002', 'sub_admin', '{}', current_setting('test.r_support')::uuid) $$, 'a person is added with the Support role');
select lives_ok($$ select admin_staff_add('+919822200003', 'sub_admin', '{}', current_setting('test.r_mod')::uuid) $$, 'a person is added with the Moderator role');
select throws_ok($$ select admin_role_save(null, 'Support', null, array['users']) $$, 'PT409', 'admin_role_name_taken', 'role names are unique');
select throws_ok($$ select admin_role_save(null, 'Bad', null, array['root']) $$, 'PT422', 'bad_input', 'an unknown permission cannot be put in a role');
select throws_ok($$ select admin_role_delete(current_setting('test.r_support')::uuid) $$, 'PT409', 'admin_role_in_use', 'a role with people in it cannot be deleted');
select lives_ok($$ select admin_role_save(current_setting('test.r_support')::uuid, 'Support', 'Help desk', array['support', 'users', 'orders']) $$, 'a role is changed');
select is((select admin_staff_add('+919822299999', 'sub_admin', '{}', current_setting('test.r_mkt')::uuid) ->> 'invited'), 'true', 'an unknown number is invited');
select is(jsonb_array_length(admin_staff_list() -> 'invites'), 1, 'the invite is listed');
reset role;
select is((select array_agg(permission order by permission) from app_admin_permissions where profile_id = '00000000-0000-0000-0000-0000000000f2'),
  array['orders', 'support', 'users'], 'changing the role changed the person''s permissions');
select test_login('00000000-0000-0000-0000-0000000000f2');
select ok(has_admin_permission('orders') and not has_admin_permission('moderation'), 'a Support person holds only the role''s permissions');
select throws_ok($$ select admin_roles_list() $$, 'PT403', 'admin_not_allowed', 'only an Admin manages roles');
reset role;

-- ===== Report and block =====
select test_login('00000000-0000-0000-0000-0000000000f4');
select ok(social_people()::text like '%00000000-0000-0000-0000-0000000000f5%', 'Bala is in Asha''s circle before blocking');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f4');
select lives_ok($$ select report_content('post', '50000000-0000-0000-0000-0000000000f1', 'harassment', 'Not nice') $$, 'a tree member reports a memory');
select lives_ok($$ select report_content('post', '50000000-0000-0000-0000-0000000000f1', 'harassment', 'again') $$, 'reporting the same thing twice is quietly ignored');
select throws_ok($$ select report_content('post', '50000000-0000-0000-0000-0000000000f2', 'spam') $$, 'PT403', 'not_allowed', 'nobody reports their own memory');
select throws_ok($$ select report_content('post', '50000000-0000-0000-0000-0000000000f1', 'whatever') $$, 'PT422', 'bad_input', 'an unknown reason is refused');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f6');
select throws_ok($$ select report_content('post', '50000000-0000-0000-0000-0000000000f1', 'spam') $$, 'PT403', 'not_allowed', 'someone who cannot see a memory cannot report it');
reset role;
select is((select count(*)::int from content_reports), 1, 'one report is stored');
select is((select priority from work_items where kind = 'report'), 'high', 'a harassment report is high priority in the queue');
select ok((select due_at < now() + interval '25 hours' from work_items where kind = 'report'), 'a report must be handled within a day');

select test_login('00000000-0000-0000-0000-0000000000f4');
select lives_ok($$ select block_user('00000000-0000-0000-0000-0000000000f5') $$, 'Asha blocks Bala');
select ok(not (social_people()::text like '%00000000-0000-0000-0000-0000000000f5%'), 'Bala leaves Asha''s circle');
select is(jsonb_array_length(blocked_list()), 1, 'Asha sees Bala in the blocked list');
select is((social_hidden_people() ->> 0), '00000000-0000-0000-0000-0000000000f5', 'Bala''s posts and messages are hidden for Asha');
select throws_ok($$ select chat_open_direct('00000000-0000-0000-0000-0000000000f5') $$, 'PT403', 'not_allowed', 'no new chat with a blocked person');
select throws_ok($$ select block_user('00000000-0000-0000-0000-0000000000f4') $$, 'PT422', 'bad_input', 'nobody blocks themselves');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f5');
select ok(not (social_people()::text like '%00000000-0000-0000-0000-0000000000f4%'), 'blocking works both ways');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f4');
select lives_ok($$ select unblock_user('00000000-0000-0000-0000-0000000000f5') $$, 'Asha unblocks Bala');
select is(jsonb_array_length(blocked_list()), 0, 'the blocked list is empty again');
reset role;

-- Moderation
select set_config('test.report', (select id::text from content_reports limit 1), true);
select test_login('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select admin_reports_list() $$, 'PT403', 'admin_not_allowed', 'Support cannot open abuse reports');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f3');
select is((admin_reports_list() ->> 'total')::int, 1, 'the Moderator sees the open report');
select is((admin_reports_list() -> 'rows' -> 0 -> 'target' ->> 'text'), 'A rude memory', 'the reported words are shown to decide on');
select throws_ok($$ select admin_report_decide(current_setting('test.report')::uuid, 'remove', 'no') $$, 'PT422', 'admin_reason_required', 'a decision needs a note');
select lives_ok($$ select admin_report_decide(current_setting('test.report')::uuid, 'remove', 'Breaks the family rules') $$, 'the Moderator removes the memory');
reset role;
select ok((select deleted_at is not null from posts where id = '50000000-0000-0000-0000-0000000000f1'), 'the memory is gone');
select is((select status from work_items where kind = 'report'), 'done', 'the queue item closed itself');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000f4' and kind = 'report_decided'), 1, 'the person who reported is told');

-- ===== Work queue =====
select test_login('00000000-0000-0000-0000-0000000000f6');
select lives_ok($$ select set_config('test.ticket', ticket_create('Cannot add my mother', 'tree', 'The add button does nothing.') ->> 'id', true) $$, 'a person opens a help ticket');
select is(jsonb_array_length(ticket_list()), 1, 'the person sees the ticket');
select throws_ok($$ select ticket_create('x', 'tree', 'y') $$, 'PT422', 'bad_input', 'a subject needs a few words');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f4');
select throws_ok($$ select ticket_detail(current_setting('test.ticket')::uuid) $$, 'PT404', 'not_found', 'nobody else can open the ticket');
reset role;

select set_config('test.work', (select id::text from work_items where kind = 'ticket'), true);
select test_login('00000000-0000-0000-0000-0000000000f1');
select ok((admin_work_list() -> 'counts' ->> 'open')::int >= 1, 'the Admin sees open work');
select ok(current_setting('test.work') <> '', 'the ticket is in the queue');
select throws_ok($$ select admin_work_update(current_setting('test.work')::uuid, p_assignee => '00000000-0000-0000-0000-0000000000f3') $$,
  'PT422', 'admin_assignee_not_allowed', 'a ticket cannot go to someone without Support');
select lives_ok($$ select admin_work_update(current_setting('test.work')::uuid, p_assignee => '00000000-0000-0000-0000-0000000000f2', p_priority => 'high') $$,
  'the Admin assigns the ticket to Support');
reset role;
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000f2' and kind = 'staff_assigned'), 1, 'the new owner is told');
select test_login('00000000-0000-0000-0000-0000000000f2');
select is((admin_work_list('mine') ->> 'total')::int, 1, 'Support sees it under My work');
select lives_ok($$ select admin_work_note(current_setting('test.work')::uuid, 'Asked for a screenshot') $$, 'Support adds an internal note');
select ok(jsonb_array_length(admin_work_detail(current_setting('test.work')::uuid) -> 'history') >= 2, 'the note and the change are in the history');
select lives_ok($$ select admin_ticket_reply(current_setting('test.ticket')::uuid, 'Please send a screenshot.') $$, 'Support answers');
reset role;
select is((select status from support_tickets where id = current_setting('test.ticket')::uuid), 'waiting', 'the ticket waits for the person');
select test_login('00000000-0000-0000-0000-0000000000f6');
select is((ticket_detail(current_setting('test.ticket')::uuid) -> 'messages' -> 1 ->> 'author'), 'AYWO Support', 'the answer shows as AYWO Support, not a staff name');
select lives_ok($$ select ticket_reply(current_setting('test.ticket')::uuid, 'Here it is') $$, 'the person replies');
reset role;
select is((select status from work_items where id = current_setting('test.work')::uuid), 'open', 'a reply puts the work back in the open queue');
update work_items set due_at = now() - interval '1 hour' where id = current_setting('test.work')::uuid;
select is(work_overdue_notify(), 1, 'the owner is told once when it is late');
select is(work_overdue_notify(), 0, 'and not again');

-- ===== Orders, coupons =====
insert into one_time_orders (id, buyer_id, product, store, amount_minor, currency, tree_id, details, payment_id) values
  ('60000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f4', 'tree_poster', 'razorpay', 79900, 'INR',
   '10000000-0000-0000-0000-0000000000f1', '{"quantity": 1, "shipping": {"name": "Asha", "line1": "1 Street", "city": "Chennai", "state": "TN", "postal_code": "600001", "country": "IN", "phone": "+919822200004"}}', 'pay_1');
update one_time_orders set status = 'paid', paid_at = now() where id = '60000000-0000-0000-0000-0000000000f1';
select is((select fulfilment from one_time_orders where id = '60000000-0000-0000-0000-0000000000f1'), 'queued', 'a paid poster goes to the print queue');
select is((select count(*)::int from work_items where kind = 'order'), 1, 'and to the work queue');

select test_login('00000000-0000-0000-0000-0000000000f2');
select is((admin_orders_list() -> 'rows' -> 0 ->> 'city'), 'Chennai', 'the list shows only the city');
select ok((admin_orders_list() -> 'rows' -> 0) -> 'shipping' is null, 'the full address is not in the list');
select throws_ok($$ select admin_order_update('60000000-0000-0000-0000-0000000000f1', 'shipped') $$, 'PT422', 'order_tracking_required', 'shipping needs a tracking number');
select lives_ok($$ select admin_order_update('60000000-0000-0000-0000-0000000000f1', 'printing') $$, 'the order goes to printing');
select throws_ok($$ select admin_order_update('60000000-0000-0000-0000-0000000000f1', 'queued') $$, 'PT409', 'order_bad_step', 'steps only go forward');
select lives_ok($$ select admin_order_update('60000000-0000-0000-0000-0000000000f1', 'shipped', 'India Post', 'EE123456789IN', 'https://track.example/EE123456789IN') $$, 'the order ships with tracking');
select is((admin_order_detail('60000000-0000-0000-0000-0000000000f1', 'Printing the label') -> 'shipping' ->> 'postal_code'), '600001', 'the address opens with a reason');
reset role;
select is((select count(*)::int from admin_audit_log where action = 'order.address_viewed'), 1, 'looking at the address is recorded');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000f4' and kind = 'order_update'), 2, 'the buyer is told at each step');
select test_login('00000000-0000-0000-0000-0000000000f4');
select is((my_orders() -> 0 ->> 'tracking_number'), 'EE123456789IN', 'the buyer sees the tracking number');
reset role;

select test_login('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select admin_coupon_save(null, '{"code": "FAMILY20", "title": "20% off posters", "kind": "percent", "value": 20, "products": ["tree_poster"], "public": true}') $$, 'a coupon is made');
select throws_ok($$ select admin_coupon_save(null, '{"code": "FAMILY20", "title": "Again", "kind": "percent", "value": 10, "products": ["tree_poster"]}') $$, 'PT409', 'coupon_code_taken', 'codes are unique');
select throws_ok($$ select admin_coupon_save(null, '{"code": "BIG", "title": "Too much", "kind": "percent", "value": 95, "products": ["tree_poster"]}') $$, 'PT422', 'bad_input', 'a code must be 4 to 20 letters and at most 90% off');
select throws_ok($$ select admin_coupon_save(null, '{"code": "FLAT100", "title": "Flat", "kind": "amount", "value": 10000, "products": ["tree_poster"]}') $$, 'PT422', 'bad_input', 'a fixed amount needs a currency');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f6');
select is((coupon_quote('family20', 'tree_poster', 79900, 'INR') ->> 'discount_minor')::int, 15980, 'the code takes 20% off, in any letter case');
select throws_ok($$ select coupon_quote('FAMILY20', 'family_book', 149900, 'INR') $$, 'PT422', 'coupon_not_for_product', 'a poster code does not work on a book');
select throws_ok($$ select coupon_quote('NOPE1', 'tree_poster', 79900, 'INR') $$, 'PT422', 'coupon_invalid', 'an unknown code is refused');
select is(jsonb_array_length(offers_list()), 1, 'the public offer is listed');
reset role;
insert into one_time_orders (buyer_id, product, store, amount_minor, currency, coupon_id, discount_minor, status, paid_at)
values ('00000000-0000-0000-0000-0000000000f6', 'tree_poster', 'stripe', 1599, 'USD', (select id from coupons where code = 'FAMILY20'), 400, 'paid', now());
select test_login('00000000-0000-0000-0000-0000000000f6');
select throws_ok($$ select coupon_quote('FAMILY20', 'tree_poster', 1999, 'USD') $$, 'PT422', 'coupon_already_used', 'one use per person');
reset role;
select set_config('test.coupon', (select id::text from coupons where code = 'FAMILY20'), true);
select test_login('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$ select admin_coupon_save(current_setting('test.coupon')::uuid, '{"value": 50}') $$, 'PT409', 'coupon_in_use', 'a used code''s discount stays fixed');
select lives_ok($$ select admin_coupon_save(current_setting('test.coupon')::uuid, '{"active": false}') $$, 'a used code can still be switched off');
reset role;

-- ===== Announcements and promotional messages =====
select test_login('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select admin_announcement_save(null, '{"title": "Diwali offer: 20% off posters", "style": "offer", "placements": ["app_banner", "web_banner"], "link_url": "/offers"}') $$, 'a scrolling banner is made');
select lives_ok($$ select admin_announcement_save(null, '{"title": "Plus members: new book designs", "placements": ["app_banner"], "audience": "plus"}') $$, 'a Plus-only banner is made');
select throws_ok($$ select admin_announcement_save(null, '{"title": "Bad link", "placements": ["app_banner"], "link_url": "javascript:alert(1)"}') $$, 'PT422', 'bad_input', 'only app paths and https links are allowed');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f6');
select is(jsonb_array_length(announcements_for_me('app_banner')), 1, 'a free person sees only the banner for everyone');
select lives_ok($$ select announcement_event((announcements_for_me('app_banner') -> 0 ->> 'id')::uuid, 'dismiss') $$, 'the person closes the banner');
select is(jsonb_array_length(announcements_for_me('app_banner')), 0, 'a closed banner stays closed');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f5');
select is(jsonb_array_length(announcements_for_me('app_banner')), 2, 'a Plus person sees both');
select lives_ok($$ select marketing_set(true) $$, 'Bala switches on offers and news');
reset role;
set local role anon;
select is(jsonb_array_length(announcements_public()), 1, 'a website visitor sees the public banner');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f1');
select is((admin_campaign_count('everyone') ->> 'recipients')::int, 1, 'only people who opted in can get promotional messages');
select is((admin_campaign_send('New poster designs', 'Fresh designs for your family poster.', '/offers', 'everyone', null, 'all', 'Launch of designs') ->> 'recipients')::int, 1, 'the message goes to them');
select throws_ok($$ select admin_campaign_send('x', 'Too short', null, 'everyone', null, 'all', 'test reason') $$, 'PT422', 'bad_input', 'a title needs a few letters');
reset role;
select is((select count(*)::int from notifications where kind = 'promo'), 1, 'nobody else got it');

-- ===== App settings =====
select test_login('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$ select admin_config_set('min_version', '{"ios": "1.2.0", "android": "1.2.0"}', 'Security fix needs 1.2') $$, 'a minimum version is set');
select throws_ok($$ select admin_config_set('min_version', '{"ios": "latest"}', 'bad version text') $$, 'PT422', 'bad_input', 'versions must look like 1.2.0');
select lives_ok($$ select admin_config_set('maintenance', '{"on": true, "message": "Back at 6 pm"}', 'Database upgrade') $$, 'maintenance is switched on');
reset role;
set local role anon;
select is((app_config_public() -> 'maintenance' ->> 'on'), 'true', 'everyone can read the app settings, signed in or not');
select is((app_config_public() -> 'min_version' ->> 'ios'), '1.2.0', 'the new minimum version is public');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select admin_config_set('maintenance', '{"on": false}', 'Support should not') $$, 'PT403', 'admin_not_allowed', 'Support cannot change app settings');
reset role;

-- ===== Referrals =====
select test_login('00000000-0000-0000-0000-0000000000f4');
select lives_ok($$ select set_config('test.code', referral_my() ->> 'code', true) $$, 'Asha gets a referral code');
select is(referral_my() ->> 'code', current_setting('test.code'), 'the code stays the same');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f6');
select throws_ok($$ select referral_claim('ZZZZZZZZ') $$, 'PT422', 'referral_invalid', 'an unknown code is refused');
select lives_ok($$ select referral_claim(lower(current_setting('test.code'))) $$, 'Chitra says Asha invited her');
select throws_ok($$ select referral_claim(current_setting('test.code')) $$, 'PT409', 'referral_already', 'only once');
reset role;
select is(referral_rewards(), 0, 'no reward before Chitra is in a family tree');
insert into shares (tree_id, grantee_profile_id, role, created_by) values
  ('10000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f6', 'viewer', '00000000-0000-0000-0000-0000000000f4');
select is(referral_rewards(), 1, 'the reward comes once Chitra joins a tree');
select ok((select plus_bonus_until > now() + interval '29 days' from profiles where id = '00000000-0000-0000-0000-0000000000f6'), 'Chitra gets 30 days of Plus');
select ok(has_plus('00000000-0000-0000-0000-0000000000f6'), 'and has Plus now');
select ok((select plus_bonus_until > now() + interval '59 days' from profiles where id = '00000000-0000-0000-0000-0000000000f4'), 'Asha''s free days are added on top');

-- ===== Emergency card, family dates =====
select test_login('00000000-0000-0000-0000-0000000000f4');
select lives_ok($$ select emergency_card_save('{"blood_group": "O+", "allergies": "Penicillin"}', health_notice_version()) $$, 'Asha agrees to the notice and fills in an emergency card (0019)');
select throws_ok($$ select emergency_card_save('{"blood_group": "Z+"}') $$, '23514', null, 'an unknown blood group is refused');
select is(emergency_card_get() ->> 'allergies', 'Penicillin', 'Asha reads it back');
select ok((my_extras() ->> 'has_emergency_card')::boolean, 'Me knows the card is there');
select is((upcoming_dates(30) -> 0 ->> 'name'), 'Grandma Lakshmi', 'Grandma''s birthday is coming up');
select is((upcoming_dates(30) -> 0 ->> 'turns')::int, 70, 'with the age she turns');
select is(jsonb_array_length(on_this_day()), 1, 'the wedding day memory comes back on this day');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f6');
select throws_ok($$ select sos_emergency_card(gen_random_uuid()) $$, 'PT403', 'not_allowed', 'nobody outside an SOS reads the card');
reset role;

-- ===== 360 view, staff two-step reset, analytics, health =====
select test_login('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ select admin_user_detail('00000000-0000-0000-0000-0000000000f4', 'x') $$, 'PT422', 'admin_reason_required', 'the 360 view needs a reason');
select is((admin_user_detail('00000000-0000-0000-0000-0000000000f4', 'Ticket about orders') -> 'counts' ->> 'reports_made')::int, 1, 'Support sees the account at a glance');
select ok((admin_user_detail('00000000-0000-0000-0000-0000000000f4', 'Ticket about orders') ->> 'phone_masked') like '+91*****%', 'the phone stays masked');
select throws_ok($$ select admin_analytics(30) $$, 'PT403', 'admin_not_allowed', 'Support cannot open analytics');
reset role;
select test_login('00000000-0000-0000-0000-0000000000f1');
select is(jsonb_array_length(admin_analytics(30) -> 'daily'), 30, 'analytics has a row for every day');
select ok((admin_dashboard() -> 'work') is not null, 'the dashboard shows the work queue');
select ok(admin_app_health(7) ? 'errors', 'app health opens');
reset role;

-- ===== Files of removed memories go to the cleanup list =====
insert into post_media (post_id, path, added_by) values ('50000000-0000-0000-0000-0000000000f2', 'posts/00000000-0000-0000-0000-0000000000f4/a.jpg', '00000000-0000-0000-0000-0000000000f4');
delete from post_media where post_id = '50000000-0000-0000-0000-0000000000f2';
select is((select count(*)::int from storage_trash where path = 'posts/00000000-0000-0000-0000-0000000000f4/a.jpg'), 1, 'a removed photo is queued for deletion from storage');

-- ===== Invites are used at first sign-in =====
insert into auth.users (id, phone, phone_confirmed_at) values ('00000000-0000-0000-0000-0000000000f9', '+919822299999', now());
select ok(staff_invite_claim('00000000-0000-0000-0000-0000000000f9'), 'the invited number becomes staff when it signs in');
select is((select array_agg(permission order by permission) from app_admin_permissions where profile_id = '00000000-0000-0000-0000-0000000000f9'),
  array['analytics', 'marketing'], 'with the Marketing role''s permissions');

select * from finish();
rollback;
