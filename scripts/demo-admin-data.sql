-- Dummy data for looking at the admin panel on a LOCAL database. Never run this on the live one.
-- Add:    docker exec -i aywo-db-1 psql -U aywo -d aywo -v ON_ERROR_STOP=1 < scripts/demo-admin-data.sql
-- Remove: docker exec -i aywo-db-1 psql -U aywo -d aywo -v ON_ERROR_STOP=1 < scripts/demo-admin-data-remove.sql
-- Every dummy row has an id starting dddddddd-, or text starting [demo], so the remove script finds exactly these.
-- All names are made up.
begin;

-- ----- Five made-up accounts (Users page) -----
insert into auth.users (id, phone, phone_confirmed_at, raw_user_meta_data, created_at) values
  ('dddddddd-0000-4000-8000-000000000101', '+919000000101', now() - interval '40 days', '{"display_name":"Arun Kumar"}',   now() - interval '40 days'),
  ('dddddddd-0000-4000-8000-000000000102', '+919000000102', now() - interval '25 days', '{"display_name":"Meena Raj"}',    now() - interval '25 days'),
  ('dddddddd-0000-4000-8000-000000000103', '+919000000103', now() - interval '12 days', '{"display_name":"Karthik S"}',    now() - interval '12 days'),
  ('dddddddd-0000-4000-8000-000000000104', '+919000000104', now() - interval '6 days',  '{"display_name":"Divya N"}',      now() - interval '6 days'),
  ('dddddddd-0000-4000-8000-000000000105', '+919000000105', now() - interval '2 days',  '{"display_name":"Ravi Shankar"}', now() - interval '2 days');
update profiles p set created_at = u.created_at, last_active_at = now() - (random() * interval '3 days'), language_code = 'en'
  from auth.users u where u.id = p.id and p.id::text like 'dddddddd-%';
update profiles set email = 'arun@example.com', email_verified_at = now() - interval '30 days' where id = 'dddddddd-0000-4000-8000-000000000101';
update profiles set plus_bonus_until = now() + interval '20 days' where id = 'dddddddd-0000-4000-8000-000000000104';
-- One blocked account.
update auth.users set banned_at = now() - interval '1 day' where id = 'dddddddd-0000-4000-8000-000000000105';

-- ----- Plus plans (Payments page) -----
insert into family_plans (id, payer_id, store, product_id, status, trial_ends_at, renews_at, external_id, will_renew, last_event_at, created_at) values
  ('dddddddd-0000-4000-8000-000000000201', 'dddddddd-0000-4000-8000-000000000101', 'razorpay', 'aywo_plus_monthly', 'active',  null,                       now() + interval '18 days', 'demo_sub_1', true,  now() - interval '12 days', now() - interval '38 days'),
  ('dddddddd-0000-4000-8000-000000000202', 'dddddddd-0000-4000-8000-000000000102', 'stripe',   'aywo_plus_yearly',  'trial',   now() + interval '5 days',  now() + interval '5 days',  'demo_sub_2', true,  now() - interval '2 days',  now() - interval '2 days'),
  ('dddddddd-0000-4000-8000-000000000203', 'dddddddd-0000-4000-8000-000000000103', 'google',   'aywo_plus_monthly', 'grace',   null,                       now() - interval '1 day',   'demo_sub_3', true,  now() - interval '1 day',   now() - interval '11 days'),
  ('dddddddd-0000-4000-8000-000000000204', 'dddddddd-0000-4000-8000-000000000105', 'apple',    'aywo_plus_yearly',  'expired', null,                       now() - interval '1 day',   'demo_sub_4', false, now() - interval '1 day',   now() - interval '2 days');

-- ----- Coupons, banners, one sent promotion (Offers page) -----
insert into coupons (id, code, title, description, kind, value, currency, products, starts_at, ends_at, max_uses, per_user_limit, new_users_only, public, active) values
  ('dddddddd-0000-4000-8000-000000000301', 'DEMOPONGAL20', '[demo] Pongal 20% off',       'Twenty percent off posters and books.', 'percent', 20,    null,  array['tree_poster','family_book'], now() - interval '3 days',  now() + interval '20 days', 500,  1, false, true,  true),
  ('dddddddd-0000-4000-8000-000000000302', 'DEMOFIRST100', '[demo] 100 rupees off, first order', 'For new members only.',          'amount',  10000, 'INR', array['tree_poster'],               now() - interval '10 days', null,                       null, 1, true,  false, true),
  ('dddddddd-0000-4000-8000-000000000303', 'DEMOOLD10',    '[demo] Old 10% coupon',       'Ended last week.',                      'percent', 10,    null,  array['premium_invite'],            now() - interval '30 days', now() - interval '7 days',  100,  1, false, true,  false);
insert into announcements (id, title, body, link_url, link_label, style, placements, audience, region, starts_at, ends_at, priority, dismissible, active) values
  ('dddddddd-0000-4000-8000-000000000311', '[demo] Print your family tree', 'Posters are 20% off this month.',     '/shop', 'See the shop', 'offer', array['app_banner','web_banner'], 'everyone', 'all',   now() - interval '2 days', now() + interval '20 days', 50, true,  true),
  ('dddddddd-0000-4000-8000-000000000312', '[demo] Maintenance on Sunday',  'AYWO will be slow from 2 am to 3 am.', null,    null,           'warning', array['home_card'],              'everyone', 'india', now() + interval '2 days', now() + interval '4 days',  80, false, true);
insert into campaigns (id, title, body, link_path, audience, language, region, recipients, sent_at) values
  ('dddddddd-0000-4000-8000-000000000321', '[demo] Pongal offer', 'Posters and family books are 20% off until the end of the month.', '/shop', 'free', null, 'india', 42, now() - interval '3 days');

-- ----- Orders (Orders page). Paying a poster or book puts it in the print queue and the work queue by itself. -----
insert into one_time_orders (id, buyer_id, product, store, amount_minor, currency, status, external_id, payment_id, details, created_at, coupon_id, discount_minor) values
  ('dddddddd-0000-4000-8000-000000000401', 'dddddddd-0000-4000-8000-000000000101', 'tree_poster',    'razorpay', 79900,  'INR', 'created', 'demo_order_1', 'demo_pay_1', '{"quantity":1,"design_id":null,"shipping":{"name":"Arun Kumar","line1":"12 Lake View Road","city":"Chennai","state":"Tamil Nadu","postal_code":"600001","country":"IN","phone":"+919000000101"}}', now() - interval '6 days', 'dddddddd-0000-4000-8000-000000000301', 20000),
  ('dddddddd-0000-4000-8000-000000000402', 'dddddddd-0000-4000-8000-000000000102', 'family_book',    'stripe',   3900,   'USD', 'created', 'demo_order_2', 'demo_pay_2', '{"quantity":1,"design_id":null,"shipping":{"name":"Meena Raj","line1":"48 Maple Street","city":"Austin","state":"Texas","postal_code":"73301","country":"US","phone":"+15550000102"}}', now() - interval '5 days', null, 0),
  ('dddddddd-0000-4000-8000-000000000403', 'dddddddd-0000-4000-8000-000000000103', 'tree_poster',    'razorpay', 99900,  'INR', 'created', 'demo_order_3', 'demo_pay_3', '{"quantity":1,"design_id":null,"shipping":{"name":"Karthik S","line1":"7 Temple Street","city":"Madurai","state":"Tamil Nadu","postal_code":"625001","country":"IN","phone":"+919000000103"}}', now() - interval '9 days', null, 0),
  ('dddddddd-0000-4000-8000-000000000404', 'dddddddd-0000-4000-8000-000000000104', 'family_book',    'razorpay', 249900, 'INR', 'created', 'demo_order_4', 'demo_pay_4', '{"quantity":1,"design_id":null,"shipping":{"name":"Divya N","line1":"3 Garden Colony","city":"Coimbatore","state":"Tamil Nadu","postal_code":"641001","country":"IN","phone":"+919000000104"}}', now() - interval '14 days', null, 0),
  ('dddddddd-0000-4000-8000-000000000405', 'dddddddd-0000-4000-8000-000000000101', 'premium_invite', 'razorpay', 4900,   'INR', 'created', 'demo_order_5', 'demo_pay_5', '{"quantity":1,"design_id":null,"shipping":null}', now() - interval '1 day', null, 0),
  ('dddddddd-0000-4000-8000-000000000406', 'dddddddd-0000-4000-8000-000000000105', 'tree_poster',    'razorpay', 99900,  'INR', 'created', 'demo_order_6', 'demo_pay_6', '{"quantity":1,"design_id":null,"shipping":{"name":"Ravi Shankar","line1":"21 Market Road","city":"Salem","state":"Tamil Nadu","postal_code":"636001","country":"IN","phone":"+919000000105"}}', now() - interval '2 days', null, 0);
update one_time_orders set status = 'paid', paid_at = created_at + interval '5 minutes' where id::text like 'dddddddd-%';
-- Move them to different steps: 401 waits to print, 402 printing, 403 shipped, 404 delivered, 406 refunded.
update one_time_orders set fulfilment = 'printing', fulfilment_at = now() - interval '3 days' where id = 'dddddddd-0000-4000-8000-000000000402';
update one_time_orders set fulfilment = 'shipped', fulfilment_at = now() - interval '4 days', carrier = 'India Post', tracking_number = 'DEMO123456IN', tracking_url = 'https://example.com/track/DEMO123456IN' where id = 'dddddddd-0000-4000-8000-000000000403';
update one_time_orders set fulfilment = 'delivered', fulfilment_at = now() - interval '8 days', carrier = 'India Post', tracking_number = 'DEMO654321IN' where id = 'dddddddd-0000-4000-8000-000000000404';
update one_time_orders set status = 'refunded', fulfilment = 'cancelled', refunded_at = now() - interval '1 day', refund_note = '[demo] Buyer ordered twice by mistake' where id = 'dddddddd-0000-4000-8000-000000000406';
select work_close('order', 'dddddddd-0000-4000-8000-000000000404');
select work_close('order', 'dddddddd-0000-4000-8000-000000000406');

-- ----- Help tickets (Help tickets page) -----
insert into support_tickets (id, profile_id, subject, category, status, created_at, updated_at, closed_at) values
  ('dddddddd-0000-4000-8000-000000000501', 'dddddddd-0000-4000-8000-000000000101', '[demo] I paid but Plus is not on',      'payment', 'open',    now() - interval '5 hours', now() - interval '5 hours', null),
  ('dddddddd-0000-4000-8000-000000000502', 'dddddddd-0000-4000-8000-000000000102', '[demo] How do I add my grandmother?',   'tree',    'waiting', now() - interval '2 days',  now() - interval '1 day',   null),
  ('dddddddd-0000-4000-8000-000000000503', 'dddddddd-0000-4000-8000-000000000103', '[demo] Where is my poster?',            'order',   'open',    now() - interval '30 hours', now() - interval '30 hours', null),
  ('dddddddd-0000-4000-8000-000000000504', 'dddddddd-0000-4000-8000-000000000104', '[demo] App closed while adding a photo', 'bug',     'closed',  now() - interval '6 days',  now() - interval '5 days',  now() - interval '5 days');
insert into support_messages (ticket_id, author_id, from_staff, body, created_at) values
  ('dddddddd-0000-4000-8000-000000000501', 'dddddddd-0000-4000-8000-000000000101', false, 'I paid 99 rupees by UPI this morning. The money left my bank but the app still says Free.', now() - interval '5 hours'),
  ('dddddddd-0000-4000-8000-000000000502', 'dddddddd-0000-4000-8000-000000000102', false, 'I can add my parents but I cannot find where to add my grandmother.', now() - interval '2 days'),
  ('dddddddd-0000-4000-8000-000000000502', null,                                   true,  'Open your mother or father''s card, then tap Add parent. Did that work?', now() - interval '1 day'),
  ('dddddddd-0000-4000-8000-000000000503', 'dddddddd-0000-4000-8000-000000000103', false, 'I ordered a poster nine days ago. When will it arrive?', now() - interval '30 hours'),
  ('dddddddd-0000-4000-8000-000000000504', 'dddddddd-0000-4000-8000-000000000104', false, 'The app closed when I picked a photo from my gallery.', now() - interval '6 days'),
  ('dddddddd-0000-4000-8000-000000000504', null,                                   true,  'Thank you. This is fixed in the newest version. Please update the app.', now() - interval '5 days');
select work_open('ticket', 'dddddddd-0000-4000-8000-000000000501', '[demo] I paid but Plus is not on', 'high');
select work_open('ticket', 'dddddddd-0000-4000-8000-000000000502', '[demo] How do I add my grandmother?');
select work_open('ticket', 'dddddddd-0000-4000-8000-000000000503', '[demo] Where is my poster?');

-- ----- Abuse reports (Abuse reports page). They point at a real memory and chat message if this database has them. -----
insert into content_reports (id, reporter_id, target_type, target_id, target_owner, reason, note, status, created_at)
  select 'dddddddd-0000-4000-8000-000000000601', 'dddddddd-0000-4000-8000-000000000102', 'post', p.id, p.author_id, 'spam', '[demo] This memory is an advert, not a family photo.', 'open', now() - interval '3 hours'
  from posts p order by p.created_at limit 1;
insert into content_reports (id, reporter_id, target_type, target_id, target_owner, reason, note, status, created_at)
  select 'dddddddd-0000-4000-8000-000000000602', 'dddddddd-0000-4000-8000-000000000103', 'message', m.id, m.sender_id, 'harassment', '[demo] Rude message in the family chat.', 'open', now() - interval '20 hours'
  from messages m order by m.created_at limit 1;
insert into content_reports (id, reporter_id, target_type, target_id, target_owner, reason, note, status, created_at) values
  ('dddddddd-0000-4000-8000-000000000603', 'dddddddd-0000-4000-8000-000000000101', 'profile', 'dddddddd-0000-4000-8000-000000000105', 'dddddddd-0000-4000-8000-000000000105', 'fake', '[demo] This account is pretending to be my uncle.', 'open', now() - interval '26 hours');
select work_open('report', r.id, 'Report: ' || r.reason, 'high') from content_reports r where r.id::text like 'dddddddd-%';

-- ----- Takedown requests (Takedowns page). The work queue rows are made by the table itself. -----
insert into takedown_requests (id, person_id, requester_contact, reason, status, subject_name, created_at) values
  ('dddddddd-0000-4000-8000-000000000701', null, 'suresh@example.com', '[demo] I am in a tree made by a cousin. I did not agree. Please remove me.', 'open', 'Suresh Babu', now() - interval '8 hours'),
  ('dddddddd-0000-4000-8000-000000000702', null, '+919000000199',      '[demo] My late father is shown with a wrong date and photo.',                 'open', 'Gopal Rao',   now() - interval '3 days');

-- ----- Dictionary: three suggested words waiting, and two "this word is wrong" reports -----
insert into kin_terms (id, path_code, language_code, term, term_native, is_default, status, submitted_by, created_at) values
  ('dddddddd-0000-4000-8000-000000000801', 'F', 'ta', 'Naina',   'நைனா',   false, 'pending', 'dddddddd-0000-4000-8000-000000000101', now() - interval '2 days'),
  ('dddddddd-0000-4000-8000-000000000802', 'M', 'ta', 'Aatha',   'ஆத்தா',  false, 'pending', 'dddddddd-0000-4000-8000-000000000102', now() - interval '1 day'),
  ('dddddddd-0000-4000-8000-000000000803', 'S', 'ta', 'Paiyan',  'பையன்',  false, 'pending', 'dddddddd-0000-4000-8000-000000000103', now() - interval '4 hours');
insert into term_reports (id, kin_term_id, reporter_id, suggestion, status, created_at)
  select 'dddddddd-0000-4000-8000-000000000811', k.id, 'dddddddd-0000-4000-8000-000000000104', '[demo] In our town we say Thagappan', 'open', now() - interval '10 hours'
  from kin_terms k where k.path_code = 'F' and k.language_code = 'ta' and k.status <> 'pending' limit 1;
insert into term_reports (id, kin_term_id, reporter_id, suggestion, status, created_at)
  select 'dddddddd-0000-4000-8000-000000000812', k.id, 'dddddddd-0000-4000-8000-000000000101', '[demo] The spelling is wrong', 'open', now() - interval '2 days'
  from kin_terms k where k.path_code = 'D' and k.language_code = 'ta' and k.status <> 'pending' limit 1;

-- ----- Work queue: make it look lived-in. One item late, one being worked on, one with notes. -----
update work_items set due_at = now() - interval '6 hours' where kind = 'ticket' and ref_id = 'dddddddd-0000-4000-8000-000000000503';
update work_items set status = 'in_progress', assignee_id = (select profile_id from app_admins order by created_at limit 1)
  where kind = 'report' and ref_id = 'dddddddd-0000-4000-8000-000000000602';
update work_items set status = 'waiting' where kind = 'ticket' and ref_id = 'dddddddd-0000-4000-8000-000000000502';
update work_items set priority = 'urgent' where kind = 'takedown' and ref_id = 'dddddddd-0000-4000-8000-000000000701';
insert into work_notes (item_id, author_id, body, created_at)
  select w.id, (select profile_id from app_admins order by created_at limit 1), '[demo] Asked the print shop. They post it tomorrow.', now() - interval '2 hours'
  from work_items w where w.kind = 'ticket' and w.ref_id = 'dddddddd-0000-4000-8000-000000000503';

-- ----- Crash reports (App settings page) -----
insert into client_errors (profile_id, platform, app_version, route, message, stack, fingerprint, created_at) values
  ('dddddddd-0000-4000-8000-000000000104', 'android', '1.0.3', '/social/memories/new', '[demo] Cannot read property uri of undefined', 'TypeError: Cannot read property uri of undefined\n    at pickPhoto (memories/new.tsx:88)\n    at onPress (ui.tsx:25)', 'demo-fp-1', now() - interval '6 days'),
  ('dddddddd-0000-4000-8000-000000000102', 'android', '1.0.3', '/social/memories/new', '[demo] Cannot read property uri of undefined', 'TypeError: Cannot read property uri of undefined\n    at pickPhoto (memories/new.tsx:88)', 'demo-fp-1', now() - interval '5 days'),
  (null,                                   'ios',     '1.0.4', '/tree/[id]',           '[demo] Maximum update depth exceeded',        'Error: Maximum update depth exceeded\n    at NamesTree (NamesTree.tsx:140)', 'demo-fp-2', now() - interval '1 day'),
  ('dddddddd-0000-4000-8000-000000000101', 'web',     '1.0.4', '/shop',                '[demo] Network request failed',               null, 'demo-fp-3', now() - interval '3 hours');
insert into server_errors (route, method, message, fingerprint, created_at) values
  ('/pay/razorpay/webhook', 'POST', '[demo] signature did not match', 'demo-srv-1', now() - interval '2 days'),
  ('/tree/:id/view',        'GET',  '[demo] statement timeout',       'demo-srv-2', now() - interval '5 hours');

-- ----- Sign-up steps (Analytics page): 60 made-up devices, fewer at each step -----
insert into app_events (device_id, event, platform, lang, created_at)
  select ('dddddddd-0000-4000-9000-' || lpad(d::text, 12, '0'))::uuid, s.event,
         (array['android','android','android','ios','web'])[1 + d % 5], (array['en','ta','ta'])[1 + d % 3],
         now() - ((d % 25) * interval '1 day') - (s.n * interval '-2 minutes')
  from generate_series(1, 60) d
  join (values (1,'app_opened',60), (2,'code_requested',48), (3,'code_verified',41), (4,'name_saved',36),
               (5,'tree_started',30), (6,'first_relative',24), (7,'five_people',13), (8,'invite_sent',8)) s(n, event, reach) on d <= s.reach;

-- ----- One member blocking another (shows on the Account page) -----
insert into user_blocks (blocker_id, blocked_id) values ('dddddddd-0000-4000-8000-000000000101', 'dddddddd-0000-4000-8000-000000000105');

commit;
