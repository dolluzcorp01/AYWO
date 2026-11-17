-- PR 37: plain-user fixes in the social part.
-- 1. A one-to-one chat can be taken off my own chat list. It comes back when a new message arrives.
-- 2. The sender of an alert can correct its words (a wrong hospital name).
-- 3. The host can take the Canva link off an invite.
-- `create or replace` keeps a function's grants; the new functions are revoked and granted by name at the end.

-- ===== 1. Remove a one-to-one chat from my list =====
-- Leaving is for groups: in a one-to-one chat it would stop the other person's messages reaching me. Hiding only
-- takes the chat off my list. Nothing is deleted, and the other person sees no change.
alter table chat_members add column hidden_at timestamptz;

create function chat_hide(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  -- Marked as read too, so a hidden chat does not keep a "new" count on the home screen.
  update chat_members m set hidden_at = now(), last_read_at = now()
  where m.chat_id = p_chat and m.profile_id = me and m.left_at is null
    and exists (select 1 from chats c where c.id = p_chat and c.kind = 'direct');
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  update notifications set read_at = now()
  where recipient_id = me and kind = 'chat_message' and read_at is null and payload ->> 'chat_id' = p_chat::text;
end $$;

-- Same as before (0009), with one more rule: a chat I hid stays off the list until a message newer than the hiding.
create or replace function chat_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  perform social_need_plus();
  return coalesce((
    select jsonb_agg(q.item order by q.sort_at desc)
    from (
      select coalesce(c.last_message_at, c.created_at) as sort_at, jsonb_build_object(
        'id', c.id, 'kind', c.kind,
        'name', case when c.kind = 'direct' then (
            select social_name(o.profile_id) from chat_members o where o.chat_id = c.id and o.profile_id <> me limit 1)
          else c.name end,
        'other_id', case when c.kind = 'direct' then (
            select o.profile_id from chat_members o where o.chat_id = c.id and o.profile_id <> me limit 1) end,
        'last_message_at', c.last_message_at,
        'last', (select jsonb_build_object('body', left(l.body, 80), 'media_kind', l.media_kind, 'deleted', l.deleted_at is not null)
                 from messages l where l.chat_id = c.id order by l.created_at desc limit 1),
        'unread', (select count(*) from messages u
                   where u.chat_id = c.id and u.deleted_at is null and u.sender_id is distinct from me
                     and u.created_at > coalesce(m.last_read_at, m.joined_at))
      ) as item
      from chats c join chat_members m on m.chat_id = c.id and m.profile_id = me and m.left_at is null
      where m.hidden_at is null or c.last_message_at > m.hidden_at
      order by coalesce(c.last_message_at, c.created_at) desc
      limit 200
    ) q), '[]'::jsonb);
end $$;

-- Same as before (0009), with one more line: picking the person again under "New chat" puts the chat back on my list.
create or replace function chat_open_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  dkey text;
  found_id uuid;
begin
  perform social_need_plus();
  if p_other is null or p_other = me or p_other not in (select social_circle()) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  dkey := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  insert into chats (kind, direct_key, created_by) values ('direct', dkey, me) on conflict (direct_key) do nothing;
  select id into found_id from chats where direct_key = dkey;
  insert into chat_members (chat_id, profile_id) values (found_id, me), (found_id, p_other)
    on conflict (chat_id, profile_id) do update set left_at = null;
  update chat_members set hidden_at = null where chat_id = found_id and profile_id = me and hidden_at is not null;
  return found_id;
end $$;

-- ===== 2. Correct a sent alert =====
alter table alerts add column edited_at timestamptz;

-- Only the words change. Who got it, the kind and the blood group stay: a different alert is a new alert.
create function alert_update(p_alert uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_body, '')), '');
begin
  if clean is null then raise exception 'message_empty' using errcode = 'PT422'; end if;
  if char_length(clean) > 500 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update alerts set body = clean, edited_at = now() where id = p_alert and sender_id = me;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- Same as before (0022), plus 'edited', so readers can tell the words were corrected.
create or replace function alerts_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return coalesce((
    select jsonb_agg(q.item order by q.created_at desc) from (
      select a.created_at, jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'body', a.body, 'blood_group', a.blood_group, 'created_at', a.created_at,
        'sender_id', a.sender_id, 'sender_name', social_name(a.sender_id), 'is_mine', a.sender_id = me,
        'closed', a.closed_at is not null, 'edited', a.edited_at is not null,
        'recipients', case when a.sender_id = me then (select count(*) from alert_recipients r where r.alert_id = a.id) end,
        'seen', a.sender_id = me or exists (select 1 from alert_recipients r where r.alert_id = a.id and r.profile_id = me and r.seen_at is not null)
      ) as item
      from alerts a
      where a.sender_id = me or exists (select 1 from alert_recipients r where r.alert_id = a.id and r.profile_id = me)
      order by a.created_at desc limit 200
    ) q), '[]'::jsonb);
end $$;

-- ===== 3. Take the Canva link off an invite =====
-- event_update leaves the link alone when it is sent empty (0024), so removing it needs its own function.
-- Nobody is told: the invite itself has not changed.
create function event_clear_canva(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update events set canva_url = null where id = p_event and host_id = me and cancelled_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

revoke all on function chat_hide(uuid), alert_update(uuid, text), event_clear_canva(uuid) from public, anon, authenticated;
grant execute on function chat_hide(uuid), alert_update(uuid, text), event_clear_canva(uuid) to authenticated;
