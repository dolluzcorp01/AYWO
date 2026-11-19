-- PR 42: shop pictures and prices set from the admin panel. Who may do what, the checks on the values, and the audit.
begin;
create extension if not exists pgtap;
select plan(14);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000042a1', 'sa1@test.local', '919800004201', now()),
  ('00000000-0000-0000-0000-0000000042a2', 'sa2@test.local', '919800004202', now()),
  ('00000000-0000-0000-0000-0000000042a3', 'sa3@test.local', '919800004203', now()),
  ('00000000-0000-0000-0000-0000000042a4', 'sa4@test.local', '919800004204', now());
insert into app_admins (profile_id, role) values
  ('00000000-0000-0000-0000-0000000042a1', 'aywo_admin'),
  ('00000000-0000-0000-0000-0000000042a2', 'sub_admin'),
  ('00000000-0000-0000-0000-0000000042a3', 'sub_admin');
insert into app_admin_permissions (profile_id, permission) values
  ('00000000-0000-0000-0000-0000000042a2', 'marketing'),
  ('00000000-0000-0000-0000-0000000042a3', 'payments');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- Prices: Marketing may look, only Payments may change, and a member none of it.
select test_login('00000000-0000-0000-0000-0000000042a2');
select is(jsonb_array_length(admin_shop_prices_list()), 3, 'Marketing sees the three prices');
select throws_ok($$ select admin_shop_price_set('tree_poster', 89900, 1999, 'Festival price') $$, 'PT403', null, 'Marketing cannot change a price');
reset role;
select test_login('00000000-0000-0000-0000-0000000042a4');
select throws_ok($$ select admin_shop_prices_list() $$, 'PT403', null, 'a member cannot see the admin price list');
reset role;

select test_login('00000000-0000-0000-0000-0000000042a3');
select throws_ok($$ select admin_shop_price_set('tree_poster', 89900, 1999, 'no') $$, 'PT422', null, 'a price change needs a real reason');
select throws_ok($$ select admin_shop_price_set('tree_poster', 50, 1999, 'Festival price') $$, 'PT422', null, 'under one rupee is refused');
select throws_ok($$ select admin_shop_price_set('tree_poster', 79900, 1999, 'Festival price') $$, 'PT422', null, 'the same price again is not a change');
select throws_ok($$ select admin_shop_price_set('mug', 79900, 1999, 'Festival price') $$, 'PT404', null, 'a product that is not sold');
select lives_ok($$ select admin_shop_price_set('tree_poster', 89900, 2199, 'Festival price') $$, 'Payments changes the poster price');
reset role;
select is((select inr_minor from shop_prices where product = 'tree_poster'), 89900, 'the new price is saved');
select is((select details->>'rupees_before' from admin_audit_log where action = 'shop_price.changed' order by created_at desc limit 1), '799.00',
  'the audit log keeps the old price');

-- Pictures: only Marketing (or AYWO Admin), at most six, and only paths under shop/.
select test_login('00000000-0000-0000-0000-0000000042a3');
select throws_ok($$ select admin_shop_image_add('tree_poster', 'shop/11111111-1111-1111-1111-111111111111.jpg') $$, 'PT403', null, 'Payments cannot add a picture');
reset role;
select test_login('00000000-0000-0000-0000-0000000042a2');
select throws_ok($$ select admin_shop_image_add('tree_poster', 'photos/11111111-1111-1111-1111-111111111111.jpg') $$, 'PT422', null, 'a path outside shop/ is refused');
select admin_shop_image_add('tree_poster', 'shop/' || gen_random_uuid() || '.jpg') from generate_series(1, 6);
select throws_ok($$ select admin_shop_image_add('tree_poster', 'shop/22222222-2222-2222-2222-222222222222.jpg') $$, 'PT422', null, 'a seventh picture is refused');
reset role;
-- Making the last one the main picture puts it first. (Its id is looked up first: members may not read the table.)
create temp table last_pic as select id from shop_images where product = 'tree_poster' order by position desc limit 1;
grant select on last_pic to authenticated;
select test_login('00000000-0000-0000-0000-0000000042a2');
select admin_shop_image_first((select id from last_pic));
reset role;
select is((select id from shop_images where product = 'tree_poster' order by position limit 1), (select id from last_pic), 'the chosen picture is now first');

select * from finish();
rollback;
