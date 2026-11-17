-- PR 37: the family can ring the person who pressed SOS.
-- While an SOS is running, the people it alerted get the sender's own sign-in number, for a Call button. The sender
-- asked these people for help, so their number is theirs to give. It ends with the SOS, like the place does.
-- Nothing changes the other way: a contact's number is still never handed to the sender.
create or replace function sos_view(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e sos_events;
  running boolean;
  may_see_place boolean;
begin
  perform social_me();
  if not social_can_see_sos(p_event) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into e from sos_events where id = p_event;
  running := e.ended_at is null and e.ends_at > now();
  may_see_place := running or e.profile_id = auth.uid();
  return jsonb_build_object(
    'id', e.id, 'name', social_name(e.profile_id), 'started_at', e.started_at, 'ends_at', e.ends_at, 'ended_at', e.ended_at,
    'active', running,
    'call_phone', case when running and e.profile_id <> auth.uid()
                       then (select p.login_phone from profiles p where p.id = e.profile_id) end,
    'last', case when e.last_lat is null or not may_see_place then null else jsonb_build_object('lat', e.last_lat, 'lng', e.last_lng, 'at', e.last_at) end,
    'trail', case when not may_see_place then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('lat', q.lat, 'lng', q.lng, 'at', q.at)), '[]'::jsonb)
      from (select l.lat, l.lng, l.at from sos_locations l where l.event_id = e.id order by l.at desc limit 30) q) end);
end $$;
