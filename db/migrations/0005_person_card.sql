-- Person card (wireframes D1, D2, D4).

-- L4.3 in one place. Permission first, then Plus, so the card can say which one is missing.
-- Also fixes the first version, which let a branch-only contacts_visible share open contacts outside its branch.
create function contact_access(p_person uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  claimed uuid;
begin
  select p.tree_id, p.claimed_by into tree, claimed from persons p where p.id = p_person and p.deleted_at is null;
  if tree is null or me is null then return 'none'; end if;
  if claimed = me then return 'self'; end if;
  if tree_role(tree, p_person) = 'none' then return 'none'; end if;
  if not (
    tree_role(tree) in ('creator', 'co_creator')
    or exists (
      select 1 from shares s
      where s.tree_id = tree and s.grantee_profile_id = me and s.contacts_visible
        and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
        and (s.scope_person_id is null or in_branch(s.scope_person_id, p_person))
    )
    or exists (
      select 1 from requests q
      where q.tree_id = tree and q.requester_id = me and q.kind = 'access_contacts'
        and q.status in ('approved', 'applied')
        and (q.target_person_id is null or q.target_person_id = p_person)
    )
  ) then
    return 'ask';
  end if;
  return case when has_plus(me) then 'open' else 'plus' end;
end $$;

create or replace function get_person_contacts(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  access text := contact_access(p_person);
begin
  if access in ('self', 'open') then
    return jsonb_build_object('values', coalesce(
      (select jsonb_agg(jsonb_build_object('kind', c.kind, 'value', c.value, 'link_value', c.value_normalized))
       from person_contacts c where c.person_id = p_person),
      '[]'::jsonb));
  end if;
  if access = 'none' then
    return jsonb_build_object('has_mobile', false, 'has_whatsapp', false, 'has_email', false);
  end if;
  return jsonb_build_object(
    'has_mobile', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'mobile'),
    'has_whatsapp', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'whatsapp'),
    'has_email', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'email')
  );
end $$;

-- Everything the card needs that is not in the tree view.
create function person_card(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  access text := contact_access(p_person);
  ask_from text;
begin
  select tree_id into tree from persons where id = p_person and deleted_at is null;
  if tree is null or access = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  -- Ask whoever shared with me; if nobody did (found by mobile number), the tree's Creator.
  select pr.display_name into ask_from
  from shares s join profiles pr on pr.id = s.created_by
  where s.tree_id = tree and s.grantee_profile_id = me and s.revoked_at is null
  order by s.created_at desc limit 1;
  if ask_from is null then
    select pr.display_name into ask_from from trees t join profiles pr on pr.id = t.creator_id where t.id = tree;
  end if;
  return jsonb_build_object(
    'access', access,
    'contacts', get_person_contacts(p_person),
    'ask_from', ask_from,
    'request_pending', exists (
      select 1 from requests q
      where q.tree_id = tree and q.requester_id = me and q.kind = 'access_contacts' and q.status = 'pending'
        and (q.target_person_id is null or q.target_person_id = p_person)
    )
  );
end $$;

create function notify_tree_managers(p_tree uuid, p_kind text, p_payload jsonb) returns void
language sql security definer set search_path = public as $$
  insert into notifications (recipient_id, kind, payload)
  select t.creator_id, p_kind, p_payload from trees t where t.id = p_tree
  union
  select s.grantee_profile_id, p_kind, p_payload from shares s
  where s.tree_id = p_tree and s.role = 'co_creator' and s.grantee_profile_id is not null
    and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
$$;

-- 'Ask for contacts' (F-SHR-03). Asking twice stays one request.
create function request_contacts(p_person uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  existing uuid;
begin
  select tree_id into tree from persons where id = p_person and deleted_at is null;
  if tree is null or tree_role(tree, p_person) = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  select id into existing from requests
  where tree_id = tree and requester_id = me and kind = 'access_contacts' and status = 'pending'
    and target_person_id = p_person;
  if existing is not null then return existing; end if;
  insert into requests (tree_id, kind, requester_id, target_person_id)
  values (tree, 'access_contacts', me, p_person) returning id into existing;
  perform notify_tree_managers(tree, 'request_created', jsonb_build_object('request_id', existing, 'kind', 'access_contacts'));
  return existing;
end $$;

-- D4: 'Younger than Amma'. Places the person right before or after the sibling in the shared birth order,
-- so every cousin sees the right word (F-TREE-06). Those who cannot edit directly send it for approval (T-SHR-01).
create function set_elder_younger(p_person uuid, p_than uuid, p_elder boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tree uuid;
  ordered uuid[];
  pos int;
  req uuid;
begin
  select tree_id into tree from persons where id = p_person and deleted_at is null;
  if tree is null or tree_role(tree, p_person) = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_person = p_than or not exists (
    select 1 from parent_child a join parent_child b on a.parent_id = b.parent_id
    where a.child_id = p_person and b.child_id = p_than
  ) then
    raise exception 'not_siblings' using errcode = 'PT422';
  end if;

  if not can_edit(tree, p_person) then
    insert into requests (tree_id, kind, requester_id, target_person_id, payload)
    values (tree, 'change', auth.uid(), p_person,
            jsonb_build_object('action', 'set_elder_younger', 'person', p_person, 'than', p_than, 'elder', p_elder))
    returning id into req;
    perform notify_tree_managers(tree, 'request_created', jsonb_build_object('request_id', req, 'kind', 'change'));
    return jsonb_build_object('status', 'requested', 'request_id', req);
  end if;

  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);

  -- Siblings whose order is known, without the person being moved.
  select coalesce(array_agg(x.id order by x.birth_order), '{}') into ordered
  from (
    select distinct p.id, p.birth_order
    from parent_child a
    join parent_child b on a.parent_id = b.parent_id
    join persons p on p.id = b.child_id
    where a.child_id = p_than and p.id <> p_person and p.birth_order is not null and p.deleted_at is null
  ) x;
  if not p_than = any (ordered) then
    ordered := ordered || p_than;
  end if;
  pos := array_position(ordered, p_than);
  if p_elder then
    ordered := ordered[1:pos - 1] || p_person || ordered[pos:];
  else
    ordered := ordered[1:pos] || p_person || ordered[pos + 1:];
  end if;

  for pos in 1 .. array_length(ordered, 1) loop
    update persons set birth_order = pos where id = ordered[pos] and birth_order is distinct from pos;
  end loop;
  return jsonb_build_object('status', 'saved');
end $$;

revoke all on function contact_access(uuid), person_card(uuid), notify_tree_managers(uuid, text, jsonb),
  request_contacts(uuid), set_elder_younger(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function person_card(uuid), request_contacts(uuid), set_elder_younger(uuid, uuid, boolean) to authenticated;
