-- 0014: deleting an account waits 30 days, can be cancelled, and the job deletes only accounts that are due.
begin;
create extension if not exists pgtap;
select plan(15);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'leaver@test.local', '+919811300001', now()),
  ('00000000-0000-0000-0000-0000000000d2', 'payer12@test.local', '+919811300002', now()),
  ('00000000-0000-0000-0000-0000000000d3', 'stayer@test.local', '+919811300003', now());
update profiles set display_name = 'Leaver' where id = '00000000-0000-0000-0000-0000000000d1';
insert into auth.refresh_tokens (user_id, token_hash, expires_at)
  values ('00000000-0000-0000-0000-0000000000d1', 'hash-d1', now() + interval '60 days');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- Asking books the date, signs out everywhere, and deletes nothing yet.
select test_login('00000000-0000-0000-0000-0000000000d1');
select ok((account_delete_request() ->> 'delete_after')::timestamptz between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour', 'request: deletion booked 30 days ahead');
select isnt(my_account() ->> 'delete_after', null, 'request: the app is told the date');
reset role;
select is((select deleted_at from profiles where id = '00000000-0000-0000-0000-0000000000d1'), null, 'request: nothing is deleted yet');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-0000000000d1'), 'Leaver', 'request: the name is still there');
select isnt((select revoked_at from auth.refresh_tokens where token_hash = 'hash-d1'), null, 'request: signed out on every phone');

-- Asking again keeps the first date.
update profiles set delete_after = now() + interval '10 days' where id = '00000000-0000-0000-0000-0000000000d1';
select test_login('00000000-0000-0000-0000-0000000000d1');
select ok((account_delete_request() ->> 'delete_after')::timestamptz < now() + interval '11 days', 'request again: the 30 days do not restart');
-- Keep my account.
select is(account_delete_cancel() ->> 'delete_after', null, 'keep: the booking is cancelled');
reset role;
select is((select delete_after from profiles where id = '00000000-0000-0000-0000-0000000000d1'), null, 'keep: nothing left booked');

-- The paying-plan warning still comes first.
insert into family_plans (id, payer_id, store, product_id, status, external_id, will_renew) values
  ('50000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d2', 'razorpay', 'aywo_plus_monthly', 'active', 'ext-grace-2', true);
select test_login('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$ select account_delete_request() $$, 'PT409', 'plan_cancel_first', 'request: a payer is warned first');
select lives_ok($$ select account_delete_request(true) $$, 'request: after the warning they may go ahead');

-- Only the job may list due accounts.
select throws_ok($$ select * from accounts_due_for_deletion() $$, '42501', null, 'job list: not for a signed-in person');
reset role;

-- The job's list: only accounts whose date has passed.
update profiles set delete_after = now() - interval '1 minute' where id = '00000000-0000-0000-0000-0000000000d1';
select is(array(select * from accounts_due_for_deletion()), array['00000000-0000-0000-0000-0000000000d1']::uuid[], 'job list: only the account that is due (not the one booked for later, not one never booked)');

-- What the job then runs, as that person.
select test_login('00000000-0000-0000-0000-0000000000d1');
select is(account_delete(true) ->> 'deleted', 'true', 'job: the full delete runs');
reset role;
select isnt((select deleted_at from profiles where id = '00000000-0000-0000-0000-0000000000d1'), null, 'job: the account is gone');
select is(array(select * from accounts_due_for_deletion()), '{}'::uuid[], 'job list: a deleted account is not listed again');

select * from finish();
rollback;
