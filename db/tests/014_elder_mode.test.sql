-- 0016: Elder mode is saved on the account and comes back with it, and nobody else can change it.
begin;
create extension if not exists pgtap;
select plan(5);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'elder14@test.local', '+919811500001', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'other14@test.local', '+919811500002', now());

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

select test_login('00000000-0000-0000-0000-0000000000e1');
select is((my_account() ->> 'simple_mode')::boolean, false, 'off for a new account');
select is((me_update('{"simple_mode": true, "large_text": true}') ->> 'simple_mode')::boolean, true, 'turning it on is saved');
select is((my_account() ->> 'large_text')::boolean, true, 'large text comes with it');
select is((me_update('{"display_name": "Paati"}') ->> 'simple_mode')::boolean, true, 'other changes leave it alone');
reset role;
select test_login('00000000-0000-0000-0000-0000000000e2');
select is((my_account() ->> 'simple_mode')::boolean, false, 'it is only for that one account');
reset role;

select * from finish();
rollback;
