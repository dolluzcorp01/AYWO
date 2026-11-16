-- PR 29: show a family member's mobile number where the person may see it: the person card and one-to-one chat.
-- The rule is the person card's own (contact_access): Creators and Co-creators, or someone given "Show contact numbers",
-- and AYWO Plus. Nothing new becomes visible; the number is only shown in more places.

-- The mobile number on a card that p_profile claimed, in a tree where the caller may open that card's contacts.
-- Null when there is none the caller may see. Newest card first, so a number fixed later wins.
create function profile_number(p_profile uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  found_number text;
begin
  if me is null or p_profile is null then return null; end if;
  if p_profile = me then
    return (select p.login_phone from profiles p where p.id = me);
  end if;
  -- A number typed on the card, else the person's own sign-in number (as get_person_contacts below).
  select coalesce(
           (select c.value from person_contacts c where c.person_id = p.id and c.kind = 'mobile' limit 1),
           nullif(pr.login_phone, ''))
    into found_number
  from persons p
  join profiles pr on pr.id = p.claimed_by and pr.deleted_at is null
  where p.claimed_by = p_profile and p.deleted_at is null
    and contact_access(p.id) = 'open'
  order by p.created_at desc
  limit 1;
  return found_number;
end $$;
revoke all on function profile_number(uuid) from public, anon, authenticated;
grant execute on function profile_number(uuid) to authenticated;

-- A card someone claimed has their sign-in number even when nobody typed it on the card. Without this, family looking
-- at a person who joined by themselves saw "No contact details saved yet". Same rule as any saved number: only shown
-- to those contact_access lets in. A number typed on the card wins.
create or replace function get_person_contacts(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  access text := contact_access(p_person);
  login text;
begin
  select pr.login_phone into login
  from persons p join profiles pr on pr.id = p.claimed_by
  where p.id = p_person and p.deleted_at is null and pr.deleted_at is null
    and not exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'mobile');
  if login = '' then login := null; end if;

  if access in ('self', 'open') then
    return jsonb_build_object('values', coalesce(
      (select jsonb_agg(v) from (
         select jsonb_build_object('kind', 'mobile', 'value', login, 'link_value', ltrim(login, '+')) as v where login is not null
         union all
         select jsonb_build_object('kind', c.kind, 'value', c.value, 'link_value', c.value_normalized)
         from person_contacts c where c.person_id = p_person
       ) all_values),
      '[]'::jsonb));
  end if;
  if access = 'none' then
    return jsonb_build_object('has_mobile', false, 'has_whatsapp', false, 'has_email', false);
  end if;
  return jsonb_build_object(
    'has_mobile', login is not null or exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'mobile'),
    'has_whatsapp', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'whatsapp'),
    'has_email', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'email')
  );
end $$;
