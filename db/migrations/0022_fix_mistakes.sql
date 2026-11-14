-- PR 25. Fix a mistake, the basic way: edit, remove, reorder, rename, leave, close.
-- Memories: edit the words and date, remove or reorder photos, untag, remove a helper, edit a comment.
-- Chat: edit a sent message, rename a group chat. Groups: rename, delete. Alerts: close (sorted) or delete.
-- Invites: remove someone invited by mistake.

alter table posts add column edited_at timestamptz;
alter table post_comments add column edited_at timestamptz;
alter table messages add column edited_at timestamptz;
alter table alerts add column closed_at timestamptz;

create or replace function social_post_json(p posts, p_full boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  return jsonb_build_object(
    'id', p.id, 'author_id', p.author_id, 'author_name', social_name(p.author_id),
    'tree_id', p.tree_id, 'group_id', p.group_id, 'body', p.body, 'happened_on', p.happened_on,
    'closed', p.closed_at is not null, 'created_at', p.created_at, 'edited', p.edited_at is not null,
    'is_mine', p.author_id = me,
    'can_edit', p.author_id = me or exists (select 1 from post_collaborators c where c.post_id = p.id and c.profile_id = me),
    'scope_name', coalesce((select t.name from trees t where t.id = p.tree_id), (select g.name from groups g where g.id = p.group_id)),
    'media', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'path', m.path,
                'can_remove', p.author_id = me or (m.added_by = me and p.closed_at is null)) order by m.position, m.id), '[]'::jsonb)
              from post_media m where m.post_id = p.id),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object(
                'person_id', t.person_id, 'profile_id', t.profile_id,
                'can_remove', p.author_id = me or t.profile_id = me
                  or exists (select 1 from persons x where x.id = t.person_id and x.claimed_by = me),
                'name', coalesce((select x.display_name from persons x where x.id = t.person_id), social_name(t.profile_id)))), '[]'::jsonb)
             from post_tags t where t.post_id = p.id),
    'collaborators', (select coalesce(jsonb_agg(jsonb_build_object('profile_id', c.profile_id, 'name', social_name(c.profile_id),
                        'can_remove', p.author_id = me or c.profile_id = me)), '[]'::jsonb)
                      from post_collaborators c where c.post_id = p.id),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n)), '[]'::jsonb)
                  from (select x.emoji, count(*) as n from reactions x
                        where x.target_type = 'post' and x.target_id = p.id group by x.emoji order by n desc) r),
    'my_reaction', (select x.emoji from reactions x where x.target_type = 'post' and x.target_id = p.id and x.profile_id = me),
    'comment_count', (select count(*) from post_comments c where c.post_id = p.id and c.deleted_at is null),
    'comments', case when p_full then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'author_id', c.author_id, 'author_name', social_name(c.author_id), 'body', c.body, 'created_at', c.created_at,
        'mine', c.author_id = me, 'edited', c.edited_at is not null,
        'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n)), '[]'::jsonb)
                      from (select x.emoji, count(*) as n from reactions x
                            where x.target_type = 'comment' and x.target_id = c.id group by x.emoji) r),
        'my_reaction', (select x.emoji from reactions x where x.target_type = 'comment' and x.target_id = c.id and x.profile_id = me)
      ) order by c.created_at), '[]'::jsonb)
      from post_comments c where c.post_id = p.id and c.deleted_at is null) end
  );
end $$;

create or replace function social_message_json(m messages) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare parent messages;
begin
  if m.deleted_at is not null then
    return jsonb_build_object('id', m.id, 'chat_id', m.chat_id, 'sender_id', m.sender_id,
      'sender_name', social_name(m.sender_id), 'created_at', m.created_at, 'deleted', true);
  end if;
  if m.reply_to is not null then select * into parent from messages where id = m.reply_to; end if;
  return jsonb_build_object(
    'id', m.id, 'chat_id', m.chat_id, 'sender_id', m.sender_id, 'sender_name', social_name(m.sender_id),
    'body', m.body, 'media_path', m.media_path, 'media_kind', m.media_kind, 'media_ms', m.media_ms,
    'client_id', m.client_id, 'created_at', m.created_at, 'deleted', false, 'edited', m.edited_at is not null,
    'reply', case when parent.id is null or parent.deleted_at is not null then null else jsonb_build_object(
      'id', parent.id, 'sender_name', social_name(parent.sender_id), 'body', left(parent.body, 120), 'media_kind', parent.media_kind) end);
end $$;

create or replace function chat_messages(p_chat uuid, p_before timestamptz default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  c chats;
begin
  perform social_need_plus();
  if not social_in_chat(p_chat) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into c from chats where id = p_chat;
  return jsonb_build_object(
    'chat', jsonb_build_object(
      'id', c.id, 'kind', c.kind,
      'name', case when c.kind = 'direct' then (
          select social_name(o.profile_id) from chat_members o where o.chat_id = c.id and o.profile_id <> me limit 1)
        else c.name end,
      'members', (select count(*) from chat_members x where x.chat_id = c.id and x.left_at is null),
      'can_rename', c.kind <> 'direct' and c.created_by = me),
    'messages', coalesce((
      select jsonb_agg(social_message_json(q) order by q.created_at desc)
      from messages q
      where q.id in (
        select x.id from messages x
        where x.chat_id = p_chat and (p_before is null or x.created_at < p_before)
        order by x.created_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 100)
      )), '[]'::jsonb));
end $$;

create or replace function alerts_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return coalesce((
    select jsonb_agg(q.item order by q.created_at desc) from (
      select a.created_at, jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'body', a.body, 'blood_group', a.blood_group, 'created_at', a.created_at,
        'sender_id', a.sender_id, 'sender_name', social_name(a.sender_id), 'is_mine', a.sender_id = me,
        'closed', a.closed_at is not null,
        'recipients', case when a.sender_id = me then (select count(*) from alert_recipients r where r.alert_id = a.id) end,
        'seen', a.sender_id = me or exists (select 1 from alert_recipients r where r.alert_id = a.id and r.profile_id = me and r.seen_at is not null)
      ) as item
      from alerts a
      where a.sender_id = me or exists (select 1 from alert_recipients r where r.alert_id = a.id and r.profile_id = me)
      order by a.created_at desc limit 200
    ) q), '[]'::jsonb);
end $$;

-- ===== Memories =====
create function post_update(p_post uuid, p_body text, p_happened_on date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_body, '')), '');
begin
  if char_length(coalesce(clean, '')) > 4000 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if clean is null and not exists (select 1 from post_media m where m.post_id = p_post) then
    raise exception 'message_empty' using errcode = 'PT422';
  end if;
  update posts set body = clean, happened_on = coalesce(p_happened_on, happened_on), edited_at = now()
  where id = p_post and author_id = me and deleted_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- The author can remove any photo; a helper only their own, while the memory is open.
create function post_remove_media(p_media uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  m post_media;
  p posts;
begin
  select * into m from post_media where id = p_media;
  select * into p from posts where id = m.post_id and deleted_at is null;
  if p.id is null or not (p.author_id = me or (m.added_by = me and p.closed_at is null)) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if nullif(trim(coalesce(p.body, '')), '') is null and (select count(*) from post_media x where x.post_id = p.id) <= 1 then
    raise exception 'last_photo' using errcode = 'PT422';
  end if;
  delete from post_media where id = p_media;
end $$;

-- New order of the photos: every photo of the memory, each once.
create function post_reorder_media(p_post uuid, p_order jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  wanted uuid[] := social_uuids(p_order);
  i int := 0;
  photo uuid;
begin
  if not exists (select 1 from posts x where x.id = p_post and x.author_id = me and x.deleted_at is null) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if (select array_agg(x order by x) from unnest(wanted) x) is distinct from
     (select array_agg(m.id order by m.id) from post_media m where m.post_id = p_post) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  foreach photo in array wanted loop
    update post_media m set position = i where m.id = photo;
    i := i + 1;
  end loop;
end $$;

-- Untag: the author, or the tagged person themselves.
create function post_remove_tag(p_post uuid, p_person uuid default null, p_profile uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if not (exists (select 1 from posts where id = p_post and author_id = me and deleted_at is null)
          or p_profile = me
          or exists (select 1 from persons x where x.id = p_person and x.claimed_by = me)) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  delete from post_tags t where t.post_id = p_post
    and ((p_person is not null and t.person_id = p_person) or (p_profile is not null and t.profile_id = p_profile));
  if not found then raise exception 'not_found' using errcode = 'PT404'; end if;
end $$;

create function post_remove_collaborator(p_post uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if not (p_profile = me or exists (select 1 from posts where id = p_post and author_id = me and deleted_at is null)) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  delete from post_collaborators where post_id = p_post and profile_id = p_profile;
end $$;

create function comment_update(p_comment uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_body, '')), '');
begin
  if clean is null then raise exception 'message_empty' using errcode = 'PT422'; end if;
  if char_length(clean) > 2000 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update post_comments set body = clean, edited_at = now() where id = p_comment and author_id = me and deleted_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- ===== Chat =====
create function message_update(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_body, '')), '');
  chat uuid;
begin
  if clean is null then raise exception 'message_empty' using errcode = 'PT422'; end if;
  if char_length(clean) > 4000 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update messages set body = clean, edited_at = now()
  where id = p_message and sender_id = me and deleted_at is null and media_path is null
  returning chat_id into chat;
  if chat is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  perform pg_notify('aywo_chat', json_build_object('chat_id', chat, 'message_id', p_message)::text);
end $$;

create function chat_rename(p_chat uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_name, '')), '');
begin
  if clean is null then raise exception 'name_required' using errcode = 'PT422'; end if;
  if char_length(clean) > 80 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update chats set name = clean where id = p_chat and kind <> 'direct' and created_by = me;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- ===== Groups =====
create function group_rename(p_group uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_name, '')), '');
begin
  if clean is null then raise exception 'name_required' using errcode = 'PT422'; end if;
  if char_length(clean) > 80 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update groups set name = clean where id = p_group and created_by = me and deleted_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

create function group_delete(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update groups set deleted_at = now() where id = p_group and created_by = me and deleted_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- ===== Alerts =====
-- 'Sorted': the alert stays in the list, marked done, so nobody keeps calling about it.
create function alert_close(p_alert uuid, p_closed boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update alerts set closed_at = case when p_closed then now() end where id = p_alert and sender_id = me;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

create function alert_delete(p_alert uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  delete from alerts where id = p_alert and sender_id = me;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- ===== Invites =====
create function event_remove_invitee(p_event uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if not exists (select 1 from events where id = p_event and host_id = me) or p_profile = me then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  delete from rsvps where event_id = p_event and profile_id = p_profile;
  delete from event_invitees where event_id = p_event and profile_id = p_profile;
end $$;

-- ===== Admin dictionary =====
create or replace function admin_kin_review(p_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  word text;
  submitter uuid;
  was term_status_t;
begin
  perform admin_require(array['dictionary']);
  if p_decision not in ('approve', 'reject') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- A word already decided can be decided again: take back an approved word that turned out wrong, or approve one
  -- rejected by mistake. Only a first decision tells the person who sent it.
  select status into was from kin_terms where id = p_id;
  update kin_terms
  set status = case when p_decision = 'approve' then 'verified'::term_status_t else 'rejected'::term_status_t end
  where id = p_id
    and status <> case when p_decision = 'approve' then 'verified'::term_status_t else 'rejected'::term_status_t end
  returning term, submitted_by into word, submitter;
  if not found then
    if exists (select 1 from kin_terms k where k.id = p_id) then
      raise exception 'admin_already_decided' using errcode = 'PT409';
    end if;
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  perform admin_log(case when p_decision = 'approve' then 'kin_term.approved' else 'kin_term.rejected' end,
    'kin_term', p_id::text);
  if submitter is not null and was = 'pending' then
    insert into notifications (recipient_id, kind, payload)
    values (submitter, 'kin_term_reviewed', jsonb_build_object('term', word, 'decision', p_decision));
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function post_update(uuid, text, date), post_remove_media(uuid), post_reorder_media(uuid, jsonb),
  post_remove_tag(uuid, uuid, uuid), post_remove_collaborator(uuid, uuid), comment_update(uuid, text),
  message_update(uuid, text), chat_rename(uuid, text), group_rename(uuid, text), group_delete(uuid),
  alert_close(uuid, boolean), alert_delete(uuid), event_remove_invitee(uuid, uuid) from public, anon;
grant execute on function post_update(uuid, text, date), post_remove_media(uuid), post_reorder_media(uuid, jsonb),
  post_remove_tag(uuid, uuid, uuid), post_remove_collaborator(uuid, uuid), comment_update(uuid, text),
  message_update(uuid, text), chat_rename(uuid, text), group_rename(uuid, text), group_delete(uuid),
  alert_close(uuid, boolean), alert_delete(uuid), event_remove_invitee(uuid, uuid) to authenticated;
