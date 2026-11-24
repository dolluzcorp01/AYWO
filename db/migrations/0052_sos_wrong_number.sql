-- PR 59: someone who gets an SOS text by mistake can stop them.
--
-- Anyone can type any phone number as an emergency contact. A stranger whose number was typed (by a slip, or on
-- purpose) got "needs help" texts and had no way to make them stop. The text's page now has "This is not for me",
-- and a number that says so gets no more SOS texts from AYWO: it is taken off every contact list and cannot be
-- added again. Only numbers that are not AYWO accounts are affected; family on AYWO manage this in the app.

create table sos_number_stops (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  stopped_at timestamptz not null default now()
);
alter table sos_number_stops enable row level security;

alter table sos_event_contacts add column stop_token text;
create unique index sos_event_contacts_stop_token_idx on sos_event_contacts (stop_token) where stop_token is not null;

-- Each texted number gets its own key for "This is not for me". A number that has said stop is left out of the alarm.
create function sos_event_contact_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null and new.contact_profile_id is null then
    if exists (select 1 from sos_number_stops s where s.phone = new.phone) then return null; end if;
    new.stop_token := social_random_token();
  end if;
  return new;
end $$;
create trigger sos_event_contact_prepare before insert on sos_event_contacts
  for each row execute function sos_event_contact_prepare();

create function sos_contact_not_stopped() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null and exists (select 1 from sos_number_stops s where s.phone = new.phone) then
    raise exception 'sos_number_stopped' using errcode = 'PT422';
  end if;
  return new;
end $$;
create trigger sos_contact_not_stopped before insert or update of phone on sos_contacts
  for each row execute function sos_contact_not_stopped();

-- Server only: the "not for me" key for each texted contact of one event.
create function sos_stop_tokens(p_event uuid) returns table (position_no smallint, stop_token text)
language sql stable security definer set search_path = public as $$
  select c.position, c.stop_token from sos_event_contacts c where c.event_id = p_event and c.stop_token is not null
$$;

-- Server only: the person holding that key says the texts are not for them. True when the key was known.
create function sos_number_stop(p_stop_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare number_now text;
begin
  select c.phone into number_now from sos_event_contacts c where c.stop_token = p_stop_token;
  if number_now is null then return false; end if;
  insert into sos_number_stops (phone) values (number_now) on conflict do nothing;
  delete from sos_contacts where phone = number_now;
  return true;
end $$;

revoke all on function sos_event_contact_prepare(), sos_contact_not_stopped(), sos_stop_tokens(uuid), sos_number_stop(text)
  from public, anon, authenticated;
