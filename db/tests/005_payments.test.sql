-- AYWO Plus: webhooks' database side, family plan, orders, devices. T-PAY-01, T-PAY-02.
begin;
create extension if not exists pgtap;
select plan(48);

insert into languages (code, name_en) values ('en', 'English') on conflict do nothing;

-- A trigger makes the profiles, with login_phone from the phone here.
insert into auth.users (id, phone) values
  ('00000000-0000-0000-0000-0000000000c1', '+919800000101'),
  ('00000000-0000-0000-0000-0000000000c2', '+919800000102'),
  ('00000000-0000-0000-0000-0000000000c3', '+919800000103'),
  ('00000000-0000-0000-0000-0000000000c4', '+919800000104'),
  ('00000000-0000-0000-0000-0000000000c5', '+919800000105'),
  ('00000000-0000-0000-0000-0000000000c6', '+919800000106'),
  ('00000000-0000-0000-0000-0000000000c7', '+919800000107'),
  ('00000000-0000-0000-0000-0000000000c8', '+919800000108');
update profiles set display_name = 'Payer Kumar' where id = '00000000-0000-0000-0000-0000000000c1';

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- The app cannot reach anything that decides Plus (1-5)
select ok(not has_function_privilege('authenticated', 'apply_plan_event(store_t, text, uuid, text, plan_status_t, timestamptz, timestamptz, boolean, timestamptz)', 'execute'), 'clients cannot call apply_plan_event');
select ok(not has_function_privilege('authenticated', 'apply_order_event(store_t, uuid, text, text, bigint, text, text, jsonb)', 'execute'), 'clients cannot call apply_order_event');
select ok(not has_function_privilege('anon', 'plan_add_member(text, uuid, uuid)', 'execute'), 'visitors cannot add members');
select test_login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ insert into family_plans (payer_id, store, product_id, status, external_id)
  values (auth.uid(), 'stripe', 'aywo_plus_yearly', 'active', 'forged') $$, '42501', null, 'a client cannot write its own plan');
select throws_ok($$ select * from webhook_events $$, '42501', null, 'clients cannot read webhook events');
reset role;

-- Replays (6-7)
select is(record_webhook_event('razorpay', 'evt_1', 'subscription.charged'), true, 'the first delivery is new');
select is(record_webhook_event('razorpay', 'evt_1', 'subscription.charged'), false, 'the same event again is a replay');

-- Out-of-order events (8-16)
select is(apply_plan_event('razorpay', 'sub_1', '00000000-0000-0000-0000-0000000000c1', 'aywo_plus_yearly', 'active', null,
  '2027-01-01', true, '2026-11-02 10:00+00'), 'created', 'the first event creates the plan');
select ok(has_plus('00000000-0000-0000-0000-0000000000c1'), 'the payer has Plus');
select is((select count(*)::int from family_plan_members m join family_plans f on f.id = m.plan_id
  where f.external_id = 'sub_1' and m.profile_id = '00000000-0000-0000-0000-0000000000c1'), 1, 'the payer takes a place on the plan');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'plan_active'), 1, 'the payer is told');
select is(apply_plan_event('razorpay', 'sub_1', null, 'aywo_plus_yearly', 'cancelled', null, null, false, '2026-11-02 09:00+00'), 'stale', 'an older event is ignored');
select is((select status::text from family_plans where external_id = 'sub_1'), 'active', 'the older event changed nothing');
select is(apply_plan_event('razorpay', 'sub_1', null, 'aywo_plus_yearly', 'trial', null, null, true, '2026-11-02 10:00+00'), 'stale', 'at the same moment, an earlier stage loses');
select is(apply_plan_event('razorpay', 'sub_2', '00000000-0000-0000-0000-0000000000c8', 'aywo_plus_monthly', 'cancelled', null, null, false, '2026-11-02 12:00+00'), 'created', 'an end that arrives first is kept');
select is(apply_plan_event('razorpay', 'sub_2', '00000000-0000-0000-0000-0000000000c8', 'aywo_plus_monthly', 'active', null, null, true, '2026-11-02 11:00+00'), 'stale', 'the older start that follows cannot switch Plus on');

-- A subscription nobody here owns (17)
select is(apply_plan_event('stripe', 'sub_unknown', null, 'aywo_plus_monthly', 'active', null, null, true, now()), 'unknown_profile', 'an unknown payer creates nothing');

-- Family plan (18-36)
select test_login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select plan_add_member('+919800000102') $$, 'the payer adds by phone');
reset role;
select ok(has_plus('00000000-0000-0000-0000-0000000000c2'), 'T-PAY-01: a member has Plus from the database');
select is((select count(*)::int from notifications where recipient_id = '00000000-0000-0000-0000-0000000000c2' and kind = 'plan_member_added'), 1, 'the member is told');
select test_login('00000000-0000-0000-0000-0000000000c2');
select ok(plan_summary()::text not like '%+9198%', 'no phone number comes back in the plan');
select is(plan_summary() ->> 'is_payer', 'false', 'a member is not the payer');
select throws_ok($$ select plan_add_member('+919800000103') $$, 'PT403', 'plan_not_payer', 'a member cannot add people');
select throws_ok($$ select plan_remove_member('00000000-0000-0000-0000-0000000000c1') $$, 'PT403', 'plan_not_payer', 'a member cannot remove the payer');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select plan_add_member('+919800000101') $$, 'PT422', 'plan_member_is_you', 'the payer is already on it');
select throws_ok($$ select plan_add_member('+919800009999') $$, 'PT404', 'plan_member_not_found', 'a number not on AYWO');
select throws_ok($$ select plan_add_member('+919800000102') $$, 'PT409', 'plan_member_already_has_plus', 'adding someone twice');
select lives_ok($$ select plan_add_member(p_profile => '00000000-0000-0000-0000-0000000000c3') $$, 'the payer adds by profile');
select lives_ok($$ select plan_add_member('+919800000104') $$, 'fourth person');
select lives_ok($$ select plan_add_member('+919800000105') $$, 'fifth person');
select lives_ok($$ select plan_add_member('+919800000106') $$, 'sixth person, including the payer');
select is(jsonb_array_length(plan_summary() -> 'members'), 6, 'six people on the plan');
select throws_ok($$ select plan_add_member('+919800000107') $$, 'PT422', 'family_plan_full', 'T-PAY-02: the seventh is refused');
select lives_ok($$ select plan_remove_member('00000000-0000-0000-0000-0000000000c6') $$, 'the payer removes a member');
select throws_ok($$ select plan_remove_member('00000000-0000-0000-0000-0000000000c1') $$, 'PT422', 'plan_payer_cannot_leave', 'the payer cannot leave');
reset role;
select ok(not has_plus('00000000-0000-0000-0000-0000000000c6'), 'a removed member loses Plus');

-- When the plan ends, and when a new one starts (37-39)
select is(apply_plan_event('razorpay', 'sub_1', null, 'aywo_plus_yearly', 'expired', null, null, false, '2026-11-03 10:00+00'), 'applied', 'a newer event applies');
select ok(not has_plus('00000000-0000-0000-0000-0000000000c2'), 'members lose Plus when the plan ends');
select apply_plan_event('razorpay', 'sub_3', '00000000-0000-0000-0000-0000000000c1', 'aywo_plus_yearly', 'active', null, null, true, '2026-11-04 10:00+00');
select ok(has_plus('00000000-0000-0000-0000-0000000000c2'), 'a new subscription keeps the family');

-- Orders (40-44)
insert into one_time_orders (id, buyer_id, product, store, amount_minor, currency, external_id) values
  ('40000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'tree_poster', 'razorpay', 79900, 'INR', 'order_1');
select is(apply_order_event('razorpay', null, 'order_1', 'paid', 100, 'INR'), 'amount_mismatch', 'a different amount does not mark it paid');
select is(apply_order_event('razorpay', '40000000-0000-0000-0000-0000000000c1', null, 'paid', 79900, 'inr', 'pay_1'), 'paid', 'the right amount does');
select is(apply_order_event('razorpay', null, 'order_1', 'paid', 79900, 'INR', 'pay_1'), 'already', 'a second paid event changes nothing');
select is(apply_order_event('razorpay', null, 'order_1', 'failed'), 'ignored', 'a late failure cannot undo a payment');
select test_login('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from one_time_orders), 0, 'nobody else sees the order');
reset role;

-- Devices (45-46)
select test_login('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$ select register_device('ExponentPushToken[abc123]', 'android') $$, 'a device registers');
select throws_ok($$ select register_device('not-a-token', 'android') $$, 'PT422', 'bad_input', 'a bad token is refused');
reset role;

-- Trial ending (47-48)
update family_plans set status = 'trial', trial_ends_at = now() + interval '2 days', will_renew = true where external_id = 'sub_3';
select is(queue_trial_reminders(), 1, 'the payer is reminded three days before');
select is(queue_trial_reminders(), 0, 'and only once');

select * from finish();
rollback;
