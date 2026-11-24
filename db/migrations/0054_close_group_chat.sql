-- PR 60: whoever made a group chat can close it for everyone.
--
-- A group chat could be renamed and left, but never ended: a chat made by mistake, or one whose reason has passed,
-- stayed on everyone's list until each person left by themselves. Closing takes it off every member's list. The
-- messages are kept as they are, like any chat a person has left.

create function chat_close(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if not exists (select 1 from chats c where c.id = p_chat and c.kind <> 'direct' and c.created_by = me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  update chat_members set left_at = now() where chat_id = p_chat and left_at is null;
end $$;

revoke all on function chat_close(uuid) from public, anon;
grant execute on function chat_close(uuid) to authenticated;
