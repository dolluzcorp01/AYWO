-- PR 30: numbers already saved are used, not asked for again.
-- An invite for a person uses the mobile saved on their card when no number is typed (the invite screen also fills it in).

create or replace function share_create(
  p_tree uuid,
  p_role share_role_t,
  p_edit_mode edit_mode_t default 'direct',
  p_contacts_visible boolean default false,
  p_scope_person uuid default null,
  p_grantee_person uuid default null,
  p_grantee_phone text default null,
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  grantee uuid;
  new_id uuid;
  token text := new_link_token();
begin
  if not is_creator_or_cocreator(p_tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_grantee_phone is not null and p_grantee_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'phone_invalid' using errcode = 'PT422';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expiry_in_past' using errcode = 'PT422';
  end if;
  if p_scope_person is not null and not exists (select 1 from persons where id = p_scope_person and tree_id = p_tree and deleted_at is null) then
    raise exception 'not_in_this_tree' using errcode = 'PT422';
  end if;
  if p_grantee_person is not null then
    select claimed_by into grantee from persons where id = p_grantee_person and tree_id = p_tree and deleted_at is null;
    if not found then
      raise exception 'not_in_this_tree' using errcode = 'PT422';
    end if;
  end if;
  -- Inviting a person whose card already has a mobile: that number, unless another was typed. Before this the
  -- invite screen asked for a number the family had already saved on the card.
  if grantee is null and p_grantee_phone is null and p_grantee_person is not null then
    select c.value into p_grantee_phone
    from person_contacts c
    where c.person_id = p_grantee_person and c.kind = 'mobile' and c.value ~ '^\+[1-9][0-9]{6,14}$'
    order by c.id
    limit 1;
  end if;
  if grantee is null and p_grantee_phone is not null then
    select p.id into grantee from profiles p where p.login_phone = p_grantee_phone and p.deleted_at is null;
  end if;
  if grantee = (select creator_id from trees where id = p_tree) then
    raise exception 'already_the_creator' using errcode = 'PT422';
  end if;

  -- A new share for the same person and branch replaces the old one, so lowering a role really lowers it.
  if grantee is not null then
    update shares set revoked_at = now()
    where tree_id = p_tree and grantee_profile_id = grantee and scope_person_id is not distinct from p_scope_person and revoked_at is null;
  end if;

  insert into shares (tree_id, scope_person_id, grantee_profile_id, grantee_person_id, link_token, role, edit_mode,
                      contacts_visible, expires_at, created_by)
  values (p_tree, p_scope_person, grantee, p_grantee_person, token, p_role,
          case when p_role = 'editor' then coalesce(p_edit_mode, 'direct') else 'direct' end,
          coalesce(p_contacts_visible, false), p_expires_at, me)
  returning id into new_id;

  if grantee is not null then
    insert into notifications (recipient_id, kind, payload)
    values (grantee, 'share_received', jsonb_build_object('tree_id', p_tree, 'share_id', new_id, 'role', p_role));
  elsif p_grantee_phone is not null then
    insert into share_waiting_phones (share_id, phone) values (new_id, p_grantee_phone);
  end if;
  return jsonb_build_object('id', new_id, 'link_token', token);
end $$;
