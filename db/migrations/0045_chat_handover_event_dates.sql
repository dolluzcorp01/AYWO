-- PR 53: two small rules found in the full test.
--
-- 1. A group chat's maker could leave, and then nobody could rename it or remove anyone: the chat belonged to
--    someone no longer in it. Now it passes to the member who has been in it longest.
-- 2. An invitation could be saved for a day that has already passed (a slip to 2020 went straight out to the family).

create or replace function chat_leave(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  heir uuid;
begin
  update chat_members set left_at = now() where chat_id = p_chat and profile_id = me and left_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;

  if exists (select 1 from chats c where c.id = p_chat and c.kind <> 'direct' and c.created_by = me) then
    select m.profile_id into heir from chat_members m
    where m.chat_id = p_chat and m.left_at is null
    order by m.joined_at, m.profile_id limit 1;
    if heir is not null then
      update chats set created_by = heir where id = p_chat;
    end if;
  end if;
end $$;

-- A day of grace: an invitation for "this evening" typed a little late, or sent from another time zone, still saves.
create function events_not_in_past() returns trigger
language plpgsql as $$
begin
  if new.starts_at is not null and new.starts_at < now() - interval '1 day'
     and (tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at) then
    raise exception 'event_in_past' using errcode = 'PT422';
  end if;
  return new;
end $$;
create trigger events_not_in_past before insert or update of starts_at on events
  for each row execute function events_not_in_past();
