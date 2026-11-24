-- PR 52: the host of a Pop Party is told when someone votes on the date, the place or the menu.
--
-- An answer to an ordinary invitation already told the host (rsvp). A vote did not, so a host waiting on a Pop Party
-- had to keep opening it to see whether anyone had chosen. One notice per person per party while it is unread or
-- recent: someone voting on all three questions, or changing their mind, does not send three or six.

create or replace function poll_vote(p_poll uuid, p_option uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e events;
begin
  if not social_can_see_poll(p_poll) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if (select closed_at from polls where id = p_poll) is not null then raise exception 'poll_closed' using errcode = 'PT409'; end if;
  if not exists (select 1 from poll_options o where o.id = p_option and o.poll_id = p_poll) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  insert into poll_votes (poll_id, profile_id, option_id) values (p_poll, me, p_option)
  on conflict (poll_id, profile_id) do update set option_id = excluded.option_id, voted_at = now();

  select ev.* into e from polls p join events ev on ev.id = p.event_id where p.id = p_poll;
  if e.id is not null and not exists (
    select 1 from notifications n
    where n.recipient_id = e.host_id and n.kind = 'poll_vote'
      and n.payload ->> 'event_id' = e.id::text and n.payload ->> 'by' = me::text
      and (n.read_at is null or n.created_at > now() - interval '10 minutes')
  ) then
    perform social_notify(array[e.host_id], 'poll_vote', jsonb_build_object(
      'event_id', e.id, 'title', e.title, 'by', me, 'from_name', social_name(me)));
  end if;
end $$;
