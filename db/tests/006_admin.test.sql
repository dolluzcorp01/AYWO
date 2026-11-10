-- AYWO Admin and Sub-admin: permissions, privacy and the audit log. Run: supabase test db
begin;
create extension if not exists pgtap;
select plan(108);

insert into languages (code, name_en) values ('en', 'English') on conflict (code) do nothing;
insert into kin_paths (code, description_en, generation, blood) values ('T_ADMIN', 'test path', 0, true) on conflict (code) do nothing;

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'admin6@test.local', '+919811100001', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'words6@test.local', '+919811100002', now()),
  ('00000000-0000-0000-0000-0000000000e3', 'cases6@test.local', '+919811100003', now()),
  ('00000000-0000-0000-0000-0000000000e4', 'plain6@test.local', '+919811100004', now()),
  ('00000000-0000-0000-0000-0000000000e5', 'target6@test.local', '+919811100005', now());
update profiles set display_name = 'Target Person' where id = '00000000-0000-0000-0000-0000000000e5';

insert into app_admins (profile_id, role) values ('00000000-0000-0000-0000-0000000000e1', 'aywo_admin');

insert into auth.refresh_tokens (token_hash, user_id, expires_at) values
  ('admin-test-hash', '00000000-0000-0000-0000-0000000000e5', now() + interval '1 day');

insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000000e1', 'Audit family', '00000000-0000-0000-0000-0000000000e5');
insert into persons (id, tree_id, display_name, created_by) values
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'Asked To Go', '00000000-0000-0000-0000-0000000000e5'),
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e1', 'Stays One', '00000000-0000-0000-0000-0000000000e5'),
  ('20000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-0000000000e1', 'Stays Two', '00000000-0000-0000-0000-0000000000e5');
insert into person_contacts (person_id, kind, value, value_normalized, created_by) values
  ('20000000-0000-0000-0000-0000000000e1', 'mobile', '98111 00091', '+919811100091', '00000000-0000-0000-0000-0000000000e5'),
  ('20000000-0000-0000-0000-0000000000e2', 'mobile', '98111 00092', '+919811100092', '00000000-0000-0000-0000-0000000000e5');

insert into kin_terms (id, path_code, language_code, term, status, submitted_by) values
  ('30000000-0000-0000-0000-0000000000e1', 'T_ADMIN', 'en', 'testwordone', 'pending', '00000000-0000-0000-0000-0000000000e4'),
  ('30000000-0000-0000-0000-0000000000e2', 'T_ADMIN', 'en', 'testwordtwo', 'verified', null);
insert into term_reports (id, kin_term_id, reporter_id, suggestion) values
  ('40000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e4', 'testwordfixed');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- ===== AYWO Admin =====
select test_login('00000000-0000-0000-0000-0000000000e1');
select ok(has_admin_permission('staff'), 'an Admin manages staff');
select ok(has_admin_permission('payments'), 'an Admin holds every permission');
select ok(not has_admin_permission('nonsense'), 'an unknown permission is held by nobody');
select lives_ok($$ select admin_staff_add('+919811100002', 'sub_admin', array['dictionary']) $$, 'an Admin adds a dictionary Sub-admin');
select lives_ok($$ select admin_staff_add('+919811100003', 'sub_admin', array['takedowns', 'users']) $$, 'an Admin adds a takedowns and users Sub-admin');
select throws_ok($$ select admin_staff_add('+919811100003', 'sub_admin', array['users']) $$, 'PT409', 'admin_already_staff', 'nobody is added twice');
select is((select admin_staff_add('+919811199999', 'sub_admin', array['users']) ->> 'invited'), 'true', 'an unknown number gets an invite for its first sign-in');
select throws_ok($$ select admin_staff_add('+919811100004', 'sub_admin', array[]::text[]) $$, 'PT422', 'admin_permission_required', 'a Sub-admin needs at least one permission');
select throws_ok($$ select admin_staff_remove('00000000-0000-0000-0000-0000000000e1') $$, 'PT422', 'admin_cannot_change_self', 'an Admin cannot remove their own place');
select throws_ok($$ select admin_staff_update('00000000-0000-0000-0000-0000000000e1', 'sub_admin', array['users']) $$, 'PT422', 'admin_cannot_change_self', 'an Admin cannot demote themselves');
reset role;
select is((select count(*)::int from admin_audit_log where action = 'staff.added'), 2, 'adding staff is audited');
select is((select count(*)::int from app_admin_permissions where profile_id = '00000000-0000-0000-0000-0000000000e4'), 0, 'a refused add leaves no permissions behind');

-- ===== Sub-admin with dictionary only =====
select test_login('00000000-0000-0000-0000-0000000000e2');
select ok(has_admin_permission('dictionary'), 'Sub-admin holds what was granted');
select ok(not has_admin_permission('users'), 'Sub-admin does not hold users');
select ok(not has_admin_permission('staff'), 'Sub-admin never manages staff');
select ok(not is_app_admin(), 'is_app_admin still means AYWO Admin only');
select is(admin_me() ->> 'role', 'sub_admin', 'admin_me gives the role');
select is(jsonb_array_length(admin_me() -> 'permissions'), 1, 'admin_me lists only what was granted');
select lives_ok($$ select admin_kin_terms_list('pending') $$, 'Sub-admin reads the word queue');
select lives_ok($$ select admin_kin_review('30000000-0000-0000-0000-0000000000e1', 'approve') $$, 'Sub-admin approves a word');
select throws_ok($$ select admin_kin_review('30000000-0000-0000-0000-0000000000e1', 'reject') $$, 'PT409', 'admin_already_decided', 'a word is decided once');
select lives_ok($$ select admin_term_report_decide('40000000-0000-0000-0000-0000000000e1', 'accept', 'testwordfixed', null) $$, 'Sub-admin accepts a report with a corrected word');
select throws_ok($$ select admin_users_list() $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: users refused');
select throws_ok($$ select admin_user_block('00000000-0000-0000-0000-0000000000e5', 'because of testing') $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: block refused');
select throws_ok($$ select admin_trees_list() $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: trees refused');
select throws_ok($$ select admin_tree_people('10000000-0000-0000-0000-0000000000e1', 'because of testing') $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: tree people refused');
select throws_ok($$ select admin_takedowns_list() $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: takedowns refused');
select throws_ok($$ select admin_payments_overview() $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: payments refused');
select throws_ok($$ select admin_staff_list() $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: staff list refused');
select throws_ok($$ select admin_staff_add('+919811100004', 'aywo_admin') $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: adding staff refused');
select throws_ok($$ select admin_audit_list() $$, 'PT403', 'admin_not_allowed', 'dictionary Sub-admin: audit list refused');
select ok(admin_dashboard() ? 'dictionary' and not admin_dashboard() ? 'users' and not admin_dashboard() ? 'payments', 'the dashboard shows only granted counts');
select is((select count(*)::int from admin_audit_log), 0, 'the audit table is hidden from a Sub-admin');
reset role;
select is((select status::text from kin_terms where id = '30000000-0000-0000-0000-0000000000e1'), 'verified', 'L5 no. 20: approved word is verified');
select is((select count(*)::int from admin_audit_log where action = 'kin_term.approved' and actor_id = '00000000-0000-0000-0000-0000000000e2'), 1, 'approving a word is audited with who did it');
select is((select term from kin_terms where id = '30000000-0000-0000-0000-0000000000e2'), 'testwordfixed', 'an accepted report replaces the word');
select is((select count(*)::int from admin_audit_log where action = 'term_report.accepted'), 1, 'deciding a report is audited');
select is((select count(*)::int from notifications where kind = 'kin_term_reviewed' and recipient_id = '00000000-0000-0000-0000-0000000000e4'), 1, 'the person who sent the word is told');

-- ===== Sub-admin with takedowns and users =====
select test_login('00000000-0000-0000-0000-0000000000e3');
select lives_ok($$ select admin_users_list('Target Person') $$, 'Sub-admin searches users');
select is((admin_users_list('Target Person') ->> 'total')::int, 1, 'the search finds the account');
select ok(admin_users_list('Target Person')::text not like '%9811100005%', 'no full phone number in the list');
select ok(admin_users_list('Target Person')::text not like '%target6@%', 'no full email in the list');
select is((admin_users_list('9811100005') ->> 'total')::int, 1, 'search works by the full number');
select is((admin_users_list('0005') ->> 'total')::int, 0, 'a few digits are not enough to search by number');
select throws_ok($$ select admin_user_block('00000000-0000-0000-0000-0000000000e2', 'because of testing') $$, 'PT403', 'admin_staff_only', 'only an Admin blocks staff');
select throws_ok($$ select admin_user_block('00000000-0000-0000-0000-0000000000e3', 'because of testing') $$, 'PT422', 'admin_cannot_block_self', 'nobody blocks themselves');
select throws_ok($$ select admin_user_block('00000000-0000-0000-0000-0000000000e5', ' ') $$, 'PT422', 'admin_reason_required', 'blocking needs a reason');
select lives_ok($$ select admin_user_block('00000000-0000-0000-0000-0000000000e5', 'because of testing') $$, 'Sub-admin blocks an ordinary user');
select throws_ok($$ select admin_trees_list() $$, 'PT403', 'admin_not_allowed', 'takedowns Sub-admin: trees refused');
reset role;
select ok((select banned_at is not null from auth.users where id = '00000000-0000-0000-0000-0000000000e5'), 'blocking sets banned_at');
select is((select count(*)::int from auth.refresh_tokens where user_id = '00000000-0000-0000-0000-0000000000e5' and revoked_at is null), 0, 'blocking revokes refresh tokens');
select is((select reason from admin_audit_log where action = 'user.blocked'), 'because of testing', 'blocking is audited with its reason');

select test_login('00000000-0000-0000-0000-0000000000e3');
select lives_ok($$ select admin_user_unblock('00000000-0000-0000-0000-0000000000e5', 'because of testing') $$, 'Sub-admin unblocks');
reset role;
select ok((select banned_at is null from auth.users where id = '00000000-0000-0000-0000-0000000000e5'), 'unblocking clears banned_at');

-- ===== Public takedown request, then the decision =====
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select lives_ok($$ select takedown_submit('20000000-0000-0000-0000-0000000000e1', null, 'asker@example.test', 'Please remove this person from the tree.') $$, 'a visitor can ask for a takedown');
select lives_ok($$ select takedown_submit('20000000-0000-0000-0000-00000000dead', 'Some Name', 'asker@example.test', 'An id that does not exist is accepted too.') $$, 'an unknown person id gives nothing away');
select throws_ok($$ select takedown_submit(null, null, 'asker@example.test', 'No person and no name at all here.') $$, 'PT422', 'bad_input', 'a request must name someone');
select throws_ok($$ select count(*) from takedown_requests $$, '42501', null, 'a visitor cannot read takedown requests');
reset role;
select is((select count(*)::int from takedown_requests where person_id is null and subject_name = 'Some Name'), 1, 'the unknown id is stored as null');

select test_login('00000000-0000-0000-0000-0000000000e3');
select is((admin_takedowns_list('open') ->> 'total')::int, 2, 'Sub-admin sees open takedowns');
select lives_ok($$ select admin_takedown_decide((select (r ->> 'id')::uuid from jsonb_array_elements(admin_takedowns_list('open') -> 'rows') r where r ->> 'person_id' is not null), 'remove', 'Confirmed with the person asking.') $$, 'Sub-admin removes the person');
select throws_ok($$ select admin_takedown_decide((select (r ->> 'id')::uuid from jsonb_array_elements(admin_takedowns_list('open') -> 'rows') r), 'remove', 'No person linked to this request.') $$, 'PT422', 'admin_takedown_needs_person', 'removing needs a person');
reset role;
select ok((select deleted_at is not null and taken_down_at is not null from persons where id = '20000000-0000-0000-0000-0000000000e1'), 'the person is soft-deleted');
select is((select count(*)::int from person_contacts where person_id = '20000000-0000-0000-0000-0000000000e1'), 0, 'their contact values are gone');
select is((select count(*)::int from notifications where kind = 'person_taken_down' and recipient_id = '00000000-0000-0000-0000-0000000000e5'), 1, 'the Creator is told');
select is((select count(*)::int from admin_audit_log where action = 'takedown.removed'), 1, 'the decision is audited');
select ok(not exists (select 1 from admin_audit_log where details::text like '%asker@%' or coalesce(reason, '') like '%asker@%'), 'the contact of the person asking stays out of the audit log');
select throws_ok($$ update persons set deleted_at = null where id = '20000000-0000-0000-0000-0000000000e1' $$, 'PT409', 'person_taken_down', 'a removed person cannot be brought back');

-- ===== Looking at a tree's people =====
select test_login('00000000-0000-0000-0000-0000000000e1');
select is((admin_trees_list('Audit family') -> 'rows' -> 0 ->> 'people')::int, 2, 'the tree list gives counts');
select throws_ok($$ select admin_tree_people('10000000-0000-0000-0000-0000000000e1', '') $$, 'PT422', 'admin_reason_required', 'a look needs a reason');
select is((admin_tree_people('10000000-0000-0000-0000-0000000000e1', 'support ticket 42') ->> 'total')::int, 2, 'the look returns the people');
select ok(admin_tree_people('10000000-0000-0000-0000-0000000000e1', 'support ticket 42')::text not like '%98111%', 'no contact values in the look');
select is((select count(*)::int from admin_audit_log where action = 'tree.people_viewed' and reason = 'support ticket 42' and target_id = '10000000-0000-0000-0000-0000000000e1'), 2, 'every look is audited with its reason');
reset role;
select throws_ok($$ delete from admin_audit_log $$, 'PT403', 'admin_audit_append_only', 'the audit log cannot be deleted');
select throws_ok($$ update admin_audit_log set reason = 'changed' $$, 'PT403', 'admin_audit_append_only', 'the audit log cannot be changed');

-- ===== An ordinary user =====
select test_login('00000000-0000-0000-0000-0000000000e4');
select is((select count(*)::int from unnest(array['dictionary', 'takedowns', 'users', 'trees', 'payments', 'support', 'staff', 'audit']) g where has_admin_permission(g)), 0, 'an ordinary user holds no permission');
select is((select count(*)::int from admin_audit_log), 0, 'an ordinary user sees no audit log');
select is((select count(*)::int from app_admin_permissions), 0, 'an ordinary user sees no permissions');
select is((select count(*)::int from app_admins), 0, 'an ordinary user sees no staff');
select throws_ok($$ select count(*) from takedown_requests $$, '42501', null, 'an ordinary user cannot read takedown requests');
select throws_ok($$ insert into admin_audit_log (action) values ('forged') $$, '42501', null, 'an ordinary user cannot write the audit log');
select throws_ok($$ select admin_me() $$, 'PT403', 'admin_not_allowed', 'ordinary user: admin_me refused');
select throws_ok($$ select admin_dashboard() $$, 'PT403', 'admin_not_allowed', 'ordinary user: dashboard refused');
select throws_ok($$ select admin_users_list() $$, 'PT403', 'admin_not_allowed', 'ordinary user: users list refused');
select throws_ok($$ select admin_user_block('00000000-0000-0000-0000-0000000000e5', 'because of testing') $$, 'PT403', 'admin_not_allowed', 'ordinary user: block refused');
select throws_ok($$ select admin_user_unblock('00000000-0000-0000-0000-0000000000e5', 'because of testing') $$, 'PT403', 'admin_not_allowed', 'ordinary user: unblock refused');
select throws_ok($$ select admin_trees_list() $$, 'PT403', 'admin_not_allowed', 'ordinary user: trees list refused');
select throws_ok($$ select admin_tree_people('10000000-0000-0000-0000-0000000000e1', 'because of testing') $$, 'PT403', 'admin_not_allowed', 'ordinary user: tree people refused');
select throws_ok($$ select admin_kin_terms_list() $$, 'PT403', 'admin_not_allowed', 'ordinary user: word queue refused');
select throws_ok($$ select admin_kin_review('30000000-0000-0000-0000-0000000000e1', 'approve') $$, 'PT403', 'admin_not_allowed', 'ordinary user: word review refused');
select throws_ok($$ select admin_term_reports_list() $$, 'PT403', 'admin_not_allowed', 'ordinary user: reports list refused');
select throws_ok($$ select admin_term_report_decide('40000000-0000-0000-0000-0000000000e1', 'dismiss') $$, 'PT403', 'admin_not_allowed', 'ordinary user: report decision refused');
select throws_ok($$ select admin_takedowns_list() $$, 'PT403', 'admin_not_allowed', 'ordinary user: takedowns list refused');
select throws_ok($$ select admin_takedown_decide('50000000-0000-0000-0000-0000000000e1', 'dismiss', 'because of testing') $$, 'PT403', 'admin_not_allowed', 'ordinary user: takedown decision refused');
select throws_ok($$ select admin_payments_overview() $$, 'PT403', 'admin_not_allowed', 'ordinary user: payments refused');
select throws_ok($$ select admin_staff_list() $$, 'PT403', 'admin_not_allowed', 'ordinary user: staff list refused');
select throws_ok($$ select admin_staff_add('+919811100004', 'aywo_admin') $$, 'PT403', 'admin_not_allowed', 'ordinary user: adding staff refused');
select throws_ok($$ select admin_staff_update('00000000-0000-0000-0000-0000000000e2', 'aywo_admin') $$, 'PT403', 'admin_not_allowed', 'ordinary user: changing staff refused');
select throws_ok($$ select admin_staff_remove('00000000-0000-0000-0000-0000000000e2') $$, 'PT403', 'admin_not_allowed', 'ordinary user: removing staff refused');
select throws_ok($$ select admin_audit_list() $$, 'PT403', 'admin_not_allowed', 'ordinary user: audit list refused');
reset role;

-- ===== Losing access =====
select test_login('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$ select admin_staff_update('00000000-0000-0000-0000-0000000000e3', 'sub_admin', array['users']) $$, 'an Admin changes a Sub-admin''s permissions');
select lives_ok($$ select admin_user_block('00000000-0000-0000-0000-0000000000e2', 'because of testing') $$, 'an Admin may block staff');
select lives_ok($$ select admin_staff_remove('00000000-0000-0000-0000-0000000000e3') $$, 'an Admin removes a Sub-admin');
reset role;
select is((select count(*)::int from admin_audit_log where action in ('staff.updated', 'staff.removed')), 2, 'changing and removing staff are audited');
select is((select count(*)::int from app_admin_permissions where profile_id = '00000000-0000-0000-0000-0000000000e3'), 0, 'removal clears the permissions');

select test_login('00000000-0000-0000-0000-0000000000e3');
select ok(not has_admin_permission('users'), 'a removed Sub-admin holds nothing');
select throws_ok($$ select admin_me() $$, 'PT403', 'admin_not_allowed', 'a removed Sub-admin is not staff');
reset role;

select test_login('00000000-0000-0000-0000-0000000000e2');
select ok(not has_admin_permission('dictionary'), 'blocked staff lose their powers at once');
reset role;

select * from finish();
rollback;
