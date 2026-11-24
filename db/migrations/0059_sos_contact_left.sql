-- PR 65: when a number says "This text is not for me", whoever saved it as an SOS contact is told.
--
-- The number was taken off their contact list without a word (0052). They went on believing someone would get their
-- alert; with that as their only contact, the next SOS would have reached nobody. Each of them now gets a
-- notification that opens the SOS page, so they can choose someone else.

create or replace function sos_number_stop(p_stop_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare number_now text;
begin
  select c.phone into number_now from sos_event_contacts c where c.stop_token = p_stop_token;
  if number_now is null then return false; end if;
  insert into sos_number_stops (phone) values (number_now) on conflict do nothing;
  with gone as (
    delete from sos_contacts where phone = number_now returning profile_id
  )
  insert into notifications (recipient_id, kind, payload)
  select distinct g.profile_id, 'sos_contact_left', jsonb_build_object('phone', number_now) from gone g;
  return true;
end $$;

revoke all on function sos_number_stop(text) from public, anon, authenticated;
