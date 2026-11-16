-- PR 28: a removed card keeps nobody in the tree, account delete clears the later tables, untag only your own,
-- ticket close, clearing an invite's place, picking an SOS back up, and a subscription moved to another account.
begin;
create extension if not exists pgtap;
select plan(31);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000028a1', 'ub1@test.local', '919800002801', now()),
  ('00000000-0000-0000-0000-0000000028a2', 'ub2@test.local', '919800002802', now()),
  ('00000000-0000-0000-0000-0000000028a3', 'ub3@test.local', '919800002803', now()),
  ('00000000-0000-0000-0000-0000000028a4', 'ub4@test.local', '919800002804', now());
insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000028a1', 'Basics family', '00000000-0000-0000-0000-0000000028a1');
insert into persons (id, tree_id, display_name, created_by, claimed_by) values
  ('20000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028a1', 'Meena', '00000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a2'),
  ('20000000-0000-0000-0000-0000000028a2', '10000000-0000-0000-0000-0000000028a1', 'Gopal', '00000000-0000-0000-0000-0000000028a1', null);
insert into posts (id, author_id, tree_id, body) values
  ('40000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a1', '10000000-0000-0000-0000-0000000028a1', 'temple visit');
insert into post_tags (post_id, person_id) values ('40000000-0000-0000-0000-0000000028a1', '20000000-0000-0000-0000-0000000028a2');
insert into post_tags (post_id, profile_id) values
  ('40000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a2'),
  ('40000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a3');
insert into support_tickets (id, profile_id, subject, category) values
  ('50000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a1', 'Cannot add photo', 'bug'),
  ('50000000-0000-0000-0000-0000000028a4', '00000000-0000-0000-0000-0000000028a4', 'Please help', 'account');
insert into work_items (kind, ref_id, title, due_at) values
  ('ticket', '50000000-0000-0000-0000-0000000028a1', 'Cannot add photo', now() + interval '1 day'),
  ('ticket', '50000000-0000-0000-0000-0000000028a4', 'Please help', now() + interval '1 day');
insert into events (id, host_id, kind, title, starts_at, place, note) values
  ('47000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a1', 'birthday', 'Party', now() + interval '7 days', 'Town hall', 'Bring sweets');
insert into sos_events (id, profile_id, ends_at, token_hash, write_hash) values
  ('60000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a1', now() + interval '1 hour',
   social_hash_token('page-token-28'), social_hash_token('old-write-token-28'));

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- ===== 1. A deleted card gives its account no rights =====
select test_login('00000000-0000-0000-0000-0000000028a2');
select is(tree_role('10000000-0000-0000-0000-0000000028a1')::text, 'viewer', 'a claimed card makes its account a viewer of the tree');
select is(jsonb_array_length(my_trees()), 1, 'and the tree is in their list');
reset role;
update persons set deleted_at = now() where id = '20000000-0000-0000-0000-0000000028a1';
select test_login('00000000-0000-0000-0000-0000000028a2');
select is(tree_role('10000000-0000-0000-0000-0000000028a1')::text, 'none', 'once the card is deleted, the account has no role');
select is(tree_role('10000000-0000-0000-0000-0000000028a1', '20000000-0000-0000-0000-0000000028a2')::text, 'none', 'nor on any person in the tree');
select is((select count(*) from persons where tree_id = '10000000-0000-0000-0000-0000000028a1'), 0::bigint, 'and can read nobody');
select is(my_trees(), '[]'::jsonb, 'and the tree is gone from their list');
select is(can_edit('10000000-0000-0000-0000-0000000028a1', '20000000-0000-0000-0000-0000000028a1'), false, 'and cannot edit their old card');

-- ===== 2. Untag: only your own, unless you wrote the memory =====
select test_login('00000000-0000-0000-0000-0000000028a3');
select throws_ok($$ select post_remove_tag('40000000-0000-0000-0000-0000000028a1', '20000000-0000-0000-0000-0000000028a2', null) $$,
  'PT403', 'not_allowed', 'someone else''s person tag cannot be removed');
select throws_ok($$ select post_remove_tag('40000000-0000-0000-0000-0000000028a1', null, '00000000-0000-0000-0000-0000000028a2') $$,
  'PT403', 'not_allowed', 'someone else''s account tag cannot be removed');
select lives_ok($$ select post_remove_tag('40000000-0000-0000-0000-0000000028a1', '20000000-0000-0000-0000-0000000028a2', '00000000-0000-0000-0000-0000000028a3') $$,
  'naming your own account removes your own tag');
reset role;
select is((select count(*) from post_tags where post_id = '40000000-0000-0000-0000-0000000028a1' and person_id = '20000000-0000-0000-0000-0000000028a2'),
  1::bigint, 'but the other person''s tag sent along with it is still there');
select is((select count(*) from post_tags where post_id = '40000000-0000-0000-0000-0000000028a1' and profile_id = '00000000-0000-0000-0000-0000000028a3'),
  0::bigint, 'and your own is gone');
select test_login('00000000-0000-0000-0000-0000000028a1');
select lives_ok($$ select post_remove_tag('40000000-0000-0000-0000-0000000028a1', '20000000-0000-0000-0000-0000000028a2', null) $$,
  'the author can remove any tag');

-- ===== 3. Closing a ticket that is not yours does not close its staff task =====
select test_login('00000000-0000-0000-0000-0000000028a2');
select lives_ok($$ select ticket_close('50000000-0000-0000-0000-0000000028a1') $$, 'closing someone else''s ticket does nothing');
reset role;
select is((select status from work_items where kind = 'ticket' and ref_id = '50000000-0000-0000-0000-0000000028a1'), 'open', 'its staff task stays open');
select test_login('00000000-0000-0000-0000-0000000028a1');
select lives_ok($$ select ticket_close('50000000-0000-0000-0000-0000000028a1') $$, 'the person who opened it can close it');
reset role;
select is((select status from work_items where kind = 'ticket' and ref_id = '50000000-0000-0000-0000-0000000028a1'), 'done', 'and then the staff task is done');

-- ===== 4. An invite's place can be cleared =====
select test_login('00000000-0000-0000-0000-0000000028a1');
select lives_ok($$ select event_update('47000000-0000-0000-0000-0000000028a1', p_title => 'Big party') $$, 'changing only the title');
reset role;
select is((select place from events where id = '47000000-0000-0000-0000-0000000028a1'), 'Town hall', 'leaves the place as it was');
select test_login('00000000-0000-0000-0000-0000000028a1');
select lives_ok($$ select event_update('47000000-0000-0000-0000-0000000028a1', p_place => '') $$, 'an empty place');
reset role;
select is((select place from events where id = '47000000-0000-0000-0000-0000000028a1'), null, 'clears it');
select is((select note from events where id = '47000000-0000-0000-0000-0000000028a1'), 'Bring sweets', 'and the note is untouched');

-- ===== 5. Picking an SOS back up =====
select test_login('00000000-0000-0000-0000-0000000028a2');
select is(sos_resume('60000000-0000-0000-0000-0000000028a1'), null, 'someone else cannot take over an SOS');
select test_login('00000000-0000-0000-0000-0000000028a1');
create temp table resumed on commit drop as select sos_resume('60000000-0000-0000-0000-0000000028a1') ->> 'write_token' as token;
select isnt((select token from resumed), null, 'the owner gets a new location key');
select is(sos_location((select token from resumed), 13.08, 80.27), true, 'the new key sends location');
select throws_ok($$ select sos_location('old-write-token-28', 13.08, 80.27) $$, 'PT403', 'not_allowed', 'the old key no longer works');

-- ===== 6. A subscription moved to an account that had an old, ended one =====
reset role;
insert into family_plans (id, payer_id, store, product_id, status, external_id, renews_at, last_event_at) values
  ('70000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a1', 'apple', 'aywo_plus_yearly', 'active',
   '00000000-0000-0000-0000-0000000028a1', now() + interval '300 days', now() - interval '1 day'),
  ('70000000-0000-0000-0000-0000000028a2', '00000000-0000-0000-0000-0000000028a2', 'apple', 'aywo_plus_monthly', 'expired',
   '00000000-0000-0000-0000-0000000028a2', null, now() - interval '200 days');
insert into family_plan_members (plan_id, profile_id) values
  ('70000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a1'),
  ('70000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a3'),
  ('70000000-0000-0000-0000-0000000028a2', '00000000-0000-0000-0000-0000000028a2');
select is(apply_plan_transfer('00000000-0000-0000-0000-0000000028a1', '00000000-0000-0000-0000-0000000028a2', now()), 1, 'the plan moves');
select is(has_plus('00000000-0000-0000-0000-0000000028a2'), true, 'the account it moved to has AYWO Plus');
select is(has_plus('00000000-0000-0000-0000-0000000028a3'), true, 'and so does the family that was on the plan');

-- ===== 7. Deleting an account clears the later tables =====
insert into emergency_cards (profile_id, blood_group, allergies) values ('00000000-0000-0000-0000-0000000028a4', 'O+', 'peanuts');
insert into user_blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000028a4', '00000000-0000-0000-0000-0000000028a1');
insert into email_codes (profile_id, email, code_hash, expires_at) values ('00000000-0000-0000-0000-0000000028a4', 'ub4@test.local', 'x', now() + interval '10 minutes');
update profiles set plus_bonus_until = now() + interval '30 days', marketing_opt_in = true where id = '00000000-0000-0000-0000-0000000028a4';
select test_login('00000000-0000-0000-0000-0000000028a4');
select lives_ok($$ select account_delete(true) $$, 'the account is deleted');
reset role;
select is(
  (select count(*) from emergency_cards where profile_id = '00000000-0000-0000-0000-0000000028a4')
  + (select count(*) from support_tickets where profile_id = '00000000-0000-0000-0000-0000000028a4')
  + (select count(*) from work_items where ref_id = '50000000-0000-0000-0000-0000000028a4')
  + (select count(*) from user_blocks where blocker_id = '00000000-0000-0000-0000-0000000028a4')
  + (select count(*) from email_codes where profile_id = '00000000-0000-0000-0000-0000000028a4')
  + (select count(*) from profiles where id = '00000000-0000-0000-0000-0000000028a4' and (plus_bonus_until is not null or marketing_opt_in)),
  0::bigint, 'and the health card, tickets, blocks, email code and gifted Plus go with it');

select * from finish();
rollback;
