-- PR 51: a number you saved yourself is shown to you on the person's page.
--
-- Someone who may add people but has not been given the family's contact numbers (a viewer, say) could save a
-- mobile number for a relative they added, see it again in Edit, and then be told on that person's page that
-- "contact numbers are hidden, ask the owner". The Edit form already showed a person the numbers they wrote
-- (contacts_for_edit); the page now follows the same rule.
--
-- Only when every saved number on that person was written by the caller. If anyone else added one, or the person
-- has joined with their own sign-in number, the page stays locked as before: nothing new is revealed.

create or replace function get_person_contacts(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
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

  -- Locked for this caller, but every number here is one they typed in themselves.
  if me is not null and login is null
     and exists (select 1 from person_contacts c where c.person_id = p_person)
     and not exists (select 1 from person_contacts c where c.person_id = p_person and c.created_by is distinct from me) then
    return jsonb_build_object('values', (
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'value', c.value, 'link_value', c.value_normalized))
      from person_contacts c where c.person_id = p_person));
  end if;

  return jsonb_build_object(
    'has_mobile', login is not null or exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'mobile'),
    'has_whatsapp', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'whatsapp'),
    'has_email', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'email')
  );
end $$;
