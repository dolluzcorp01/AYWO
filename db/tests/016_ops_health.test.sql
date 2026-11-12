-- 0018: job results, alert spacing, cleanup, and App health only for the right staff.
begin;
create extension if not exists pgtap;
select plan(13);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'staff16@test.local', '+919811700001', now()),
  ('00000000-0000-0000-0000-0000000000b2', 'user16@test.local', '+919811700002', now());
insert into app_admins (profile_id, role) values ('00000000-0000-0000-0000-0000000000b1', 'aywo_admin');
create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

select is(job_record('t16', false, 'boom'), 1, 'a first failure counts 1');
select is(job_record('t16', false, 'boom again'), 2, 'a second counts 2');
select is((select last_error from job_status where name = 't16'), 'boom again', 'the last error is kept');
select is(job_record('t16', true), 0, 'a success resets the count');
select is(job_record('t16', false, repeat('x', 900)), 1, 'counting starts again after a success');
select is((select char_length(last_error) from job_status where name = 't16'), 500, 'a long error is cut to 500 characters');

select ok(ops_alert_claim('t16:alert'), 'the first alert may be sent');
select ok(not ops_alert_claim('t16:alert'), 'the same alert is not sent again within 6 hours');
update ops_alerts set last_sent_at = now() - interval '7 hours' where key = 't16:alert';
select ok(ops_alert_claim('t16:alert'), 'after 6 hours it may be sent again');

insert into server_errors (route, method, message, fingerprint, created_at) values
  ('/old', 'GET', 'Error: old', 'f-old', now() - interval '40 days'),
  ('/new', 'GET', 'Error: new', 'f-new', now());
select ops_cleanup();
select is((select array_agg(route) from server_errors where fingerprint in ('f-old', 'f-new')), array['/new'], 'server errors older than 30 days go');

select test_login('00000000-0000-0000-0000-0000000000b1');
select ok(admin_app_health(7) ?& array['job_status', 'backups', 'last_good_backup', 'server_errors', 'server_error_total'], 'App health has backups, jobs and server errors');
reset role;
select test_login('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ select admin_app_health(7) $$, 'PT403', null, 'an ordinary user cannot see App health');
select throws_ok($$ select job_record('x', true) $$, '42501', null, 'an ordinary user cannot record job results');
reset role;

select * from finish();
rollback;
