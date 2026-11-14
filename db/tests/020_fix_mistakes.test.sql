-- PR 25: the basic 'fix a mistake' actions: edit, remove, reorder, rename, close, leave.
begin;
create extension if not exists pgtap;
select plan(30);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000025a1', 'fix1@test.local', '919800002501', now()),
  ('00000000-0000-0000-0000-0000000025a2', 'fix2@test.local', '919800002502', now());
insert into trees (id, name, creator_id) values
  ('10000000-0000-0000-0000-0000000025a1', 'Fix family', '00000000-0000-0000-0000-0000000025a1');
insert into posts (id, author_id, tree_id, body) values
  ('40000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a1', '10000000-0000-0000-0000-0000000025a1', 'just a car');
insert into post_media (id, post_id, path, position, added_by) values
  ('41000000-0000-0000-0000-0000000025a1', '40000000-0000-0000-0000-0000000025a1', 'posts/a.jpg', 0, '00000000-0000-0000-0000-0000000025a1'),
  ('41000000-0000-0000-0000-0000000025a2', '40000000-0000-0000-0000-0000000025a1', 'posts/b.jpg', 1, '00000000-0000-0000-0000-0000000025a1'),
  ('41000000-0000-0000-0000-0000000025a3', '40000000-0000-0000-0000-0000000025a1', 'posts/c.jpg', 2, '00000000-0000-0000-0000-0000000025a2');
insert into post_collaborators (post_id, profile_id) values ('40000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2');
insert into post_tags (post_id, profile_id) values ('40000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2');
insert into post_comments (id, post_id, author_id, body) values
  ('42000000-0000-0000-0000-0000000025a1', '40000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2', 'nice');
insert into groups (id, name, invite_token, created_by) values
  ('43000000-0000-0000-0000-0000000025a1', 'Cousins', 'tok-fix-25', '00000000-0000-0000-0000-0000000025a1');
insert into group_members (group_id, profile_id) values
  ('43000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a1'),
  ('43000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2');
insert into chats (id, kind, name, created_by) values ('44000000-0000-0000-0000-0000000025a1', 'group', 'Family chat', '00000000-0000-0000-0000-0000000025a1');
insert into chat_members (chat_id, profile_id) values
  ('44000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a1'),
  ('44000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2');
insert into messages (id, chat_id, sender_id, body) values
  ('45000000-0000-0000-0000-0000000025a1', '44000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a1', 'helo');
insert into alerts (id, sender_id, kind, body, audience_type) values
  ('46000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a1', 'help', 'Need help', 'people');
insert into events (id, host_id, kind, title, starts_at) values
  ('47000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a1', 'birthday', 'Party', now() + interval '7 days');
insert into event_invitees (event_id, profile_id) values ('47000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2');

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;

-- ===== The helper (not the author) =====
select test_login('00000000-0000-0000-0000-0000000025a2');
select throws_ok($$ select post_update('40000000-0000-0000-0000-0000000025a1', 'mine now') $$, 'PT403', 'not_allowed', 'only the author edits the words');
select throws_ok($$ select post_remove_media('41000000-0000-0000-0000-0000000025a1') $$, 'PT403', 'not_allowed', 'a helper cannot remove the author''s photo');
select lives_ok($$ select post_remove_media('41000000-0000-0000-0000-0000000025a3') $$, 'a helper can remove their own photo');
select lives_ok($$ select comment_update('42000000-0000-0000-0000-0000000025a1', 'very nice') $$, 'a comment author can edit it');
select lives_ok($$ select post_remove_tag('40000000-0000-0000-0000-0000000025a1', null, '00000000-0000-0000-0000-0000000025a2') $$, 'a tagged person can untag themselves');
select throws_ok($$ select message_update('45000000-0000-0000-0000-0000000025a1', 'hijack') $$, 'PT403', 'not_allowed', 'nobody edits someone else''s message');
select throws_ok($$ select chat_rename('44000000-0000-0000-0000-0000000025a1', 'Mine') $$, 'PT403', 'not_allowed', 'only who started a group chat renames it');
select throws_ok($$ select group_delete('43000000-0000-0000-0000-0000000025a1') $$, 'PT403', 'not_allowed', 'only who started a group deletes it');
select throws_ok($$ select alert_delete('46000000-0000-0000-0000-0000000025a1') $$, 'PT403', 'not_allowed', 'only the sender deletes an alert');
select lives_ok($$ select post_remove_collaborator('40000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2') $$, 'a helper can step down');
reset role;
select is((select body || '|' || (edited_at is not null) from post_comments where id = '42000000-0000-0000-0000-0000000025a1'), 'very nice|true', 'comment edited and marked');
select is((select count(*)::int from post_tags where post_id = '40000000-0000-0000-0000-0000000025a1'), 0, 'tag gone');

-- ===== The author =====
select test_login('00000000-0000-0000-0000-0000000025a1');
select lives_ok($$ select post_update('40000000-0000-0000-0000-0000000025a1', 'just a car, edited', '2024-05-01') $$, 'the author edits words and date');
select lives_ok($$ select post_reorder_media('40000000-0000-0000-0000-0000000025a1',
  '["41000000-0000-0000-0000-0000000025a2", "41000000-0000-0000-0000-0000000025a1"]') $$, 'the author reorders photos');
select throws_ok($$ select post_reorder_media('40000000-0000-0000-0000-0000000025a1', '["41000000-0000-0000-0000-0000000025a2"]') $$,
  'PT422', 'bad_input', 'a new order must list every photo once');
select lives_ok($$ select post_remove_media('41000000-0000-0000-0000-0000000025a1') $$, 'the author removes a photo');
select lives_ok($$ select post_update('40000000-0000-0000-0000-0000000025a1', '') $$, 'words can be cleared while a photo is left');
select throws_ok($$ select post_remove_media('41000000-0000-0000-0000-0000000025a2') $$, 'PT422', 'last_photo', 'the last photo stays when there are no words');
select lives_ok($$ select message_update('45000000-0000-0000-0000-0000000025a1', 'hello') $$, 'the sender fixes a typo');
select lives_ok($$ select chat_rename('44000000-0000-0000-0000-0000000025a1', 'Family') $$, 'the group chat is renamed');
select lives_ok($$ select group_rename('43000000-0000-0000-0000-0000000025a1', 'Cousins 2026') $$, 'the group is renamed');
select lives_ok($$ select alert_close('46000000-0000-0000-0000-0000000025a1') $$, 'the alert is marked sorted');
select lives_ok($$ select event_remove_invitee('47000000-0000-0000-0000-0000000025a1', '00000000-0000-0000-0000-0000000025a2') $$, 'someone invited by mistake is removed');
select lives_ok($$ select group_delete('43000000-0000-0000-0000-0000000025a1') $$, 'the group is deleted');
select lives_ok($$ select alert_delete('46000000-0000-0000-0000-0000000025a1') $$, 'the alert is deleted');
reset role;

select is((select body is null and happened_on = '2024-05-01' and edited_at is not null from posts where id = '40000000-0000-0000-0000-0000000025a1'), true, 'memory saved as edited');
select is((select string_agg(path, ',' order by position) from post_media where post_id = '40000000-0000-0000-0000-0000000025a1'), 'posts/b.jpg', 'one photo left');
select is((select body || '|' || (edited_at is not null) from messages where id = '45000000-0000-0000-0000-0000000025a1'), 'hello|true', 'message edited and marked');
select is((select name from chats where id = '44000000-0000-0000-0000-0000000025a1') || '/' || (select name from groups where id = '43000000-0000-0000-0000-0000000025a1'),
  'Family/Cousins 2026', 'renamed');
select is((select count(*)::int from event_invitees where event_id = '47000000-0000-0000-0000-0000000025a1'), 0, 'invitee removed');

select * from finish();
rollback;
