-- PR 30: an invite for a person uses the mobile saved on their card when no number is typed.
begin;
create extension if not exists pgtap;
select plan(4);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000030a1', 'us1@test.local', '919800003001', now()),
  ('00000000-0000-0000-0000-0000000030a2', 'us2@test.local', '919800003002', now());
update profiles set login_phone = '+919800003002' where id = '00000000-0000-0000-0000-0000000030a2';
insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000030a1', 'Saved numbers', '00000000-0000-0000-0000-0000000030a1');
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-0000000030a1', '10000000-0000-0000-0000-0000000030a1', 'Sister', '00000000-0000-0000-0000-0000000030a1'),
  ('20000000-0000-0000-0000-0000000030a2', '10000000-0000-0000-0000-0000000030a1', 'Cousin', '00000000-0000-0000-0000-0000000030a1'),
  ('20000000-0000-0000-0000-0000000030a3', '10000000-0000-0000-0000-0000000030a1', 'Uncle', '00000000-0000-0000-0000-0000000030a1');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-0000000030a1', 'mobile', '+919876500001', '919876500001', '00000000-0000-0000-0000-0000000030a1'),
  ('20000000-0000-0000-0000-0000000030a2', 'mobile', '+919800003002', '919800003002', '00000000-0000-0000-0000-0000000030a1');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;
select test_login('00000000-0000-0000-0000-0000000030a1');

-- No number typed, card has one, nobody signed up with it yet: the card's number waits for them.
select share_create(p_tree => '10000000-0000-0000-0000-0000000030a1', p_role => 'viewer', p_grantee_person => '20000000-0000-0000-0000-0000000030a1');
reset role;
select is((select w.phone from share_waiting_phones w join shares s on s.id = w.share_id where s.grantee_person_id = '20000000-0000-0000-0000-0000000030a1'),
  '+919876500001', 'card number used when none typed');

-- The card's number already has an account: the share goes straight to that account.
select test_login('00000000-0000-0000-0000-0000000030a1');
select share_create(p_tree => '10000000-0000-0000-0000-0000000030a1', p_role => 'viewer', p_grantee_person => '20000000-0000-0000-0000-0000000030a2');
reset role;
select is((select grantee_profile_id from shares where grantee_person_id = '20000000-0000-0000-0000-0000000030a2' and revoked_at is null),
  '00000000-0000-0000-0000-0000000030a2'::uuid, 'card number that has an account: shared to it at once');

-- A typed number wins over the card's.
select test_login('00000000-0000-0000-0000-0000000030a1');
select share_create(p_tree => '10000000-0000-0000-0000-0000000030a1', p_role => 'viewer', p_grantee_person => '20000000-0000-0000-0000-0000000030a1', p_grantee_phone => '+919876599999');
reset role;
select ok(exists (select 1 from share_waiting_phones where phone = '+919876599999'), 'typed number wins');

-- No number anywhere: still a plain link, nothing waiting.
select test_login('00000000-0000-0000-0000-0000000030a1');
select share_create(p_tree => '10000000-0000-0000-0000-0000000030a1', p_role => 'viewer', p_grantee_person => '20000000-0000-0000-0000-0000000030a3');
reset role;
select ok(not exists (select 1 from share_waiting_phones w join shares s on s.id = w.share_id where s.grantee_person_id = '20000000-0000-0000-0000-0000000030a3'), 'no number: plain link');

select * from finish();
rollback;
