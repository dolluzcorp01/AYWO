-- PR 21. Adding a mother or father can also link them to the brothers and sisters added before them.
-- Before this, adding Mother after Sister linked her to the anchor only, so the sister had no mother.
-- add_relative gets p_also_children (the ticked brothers and sisters); a sent-for-approval add keeps the list.

drop function add_relative(uuid, text, jsonb, uuid, uuid, link_kind_t);

create function add_relative(
  p_anchor uuid,
  p_relation text,
  p_person jsonb default null,
  p_existing_person uuid default null,
  p_union uuid default null,
  p_link_kind link_kind_t default 'birth',
  p_also_children uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  other uuid;
  new_union uuid;
  u unions;
  existing_parents uuid[];
  parent uuid;
  also uuid;
begin
  select tree_id into tree from persons where id = p_anchor and deleted_at is null;
  if tree is null or not can_edit(tree, p_anchor) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_relation not in ('parent', 'child', 'spouse', 'sibling') then
    raise exception 'bad_relation' using errcode = 'PT422';
  end if;
  if p_relation <> 'parent' and coalesce(array_length(p_also_children, 1), 0) > 0 then
    raise exception 'bad_also_child' using errcode = 'PT422';
  end if;
  if coalesce(array_length(p_also_children, 1), 0) > 50 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_relation in ('parent', 'sibling') and not can_edit(tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;

  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);

  if p_existing_person is not null then
    if not exists (select 1 from persons where id = p_existing_person and tree_id = tree and deleted_at is null) then
      raise exception 'not_in_this_tree' using errcode = 'PT422';
    end if;
    if not can_edit(tree, p_existing_person) then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    other := p_existing_person;
  else
    other := insert_person_from_json(tree, p_person);
  end if;

  select array_agg(parent_id) into existing_parents from parent_child where child_id = p_anchor;

  if p_relation = 'child' then
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    values (tree, p_anchor, other, p_union, p_link_kind);
    if p_union is not null then
      select * into u from unions where id = p_union and tree_id = tree and p_anchor in (partner1_id, partner2_id);
      if u.id is null then
        raise exception 'bad_union' using errcode = 'PT422';
      end if;
      if u.partner2_id is not null then
        insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
        values (tree, case when u.partner1_id = p_anchor then u.partner2_id else u.partner1_id end, other, p_union, p_link_kind);
      end if;
    end if;

  elsif p_relation = 'parent' then
    if p_link_kind = 'birth' and coalesce(array_length(existing_parents, 1), 0) >= 2 then
      raise exception 'already_two_parents' using errcode = 'PT422';
    end if;
    if p_link_kind = 'birth' and array_length(existing_parents, 1) = 1 then
      select id into new_union from unions
      where tree_id = tree and (partner1_id, partner2_id) in ((existing_parents[1], other), (other, existing_parents[1]));
      if new_union is null then
        insert into unions (tree_id, partner1_id, partner2_id) values (tree, existing_parents[1], other) returning id into new_union;
      end if;
      update parent_child set union_id = new_union where parent_id = existing_parents[1] and child_id = p_anchor;
    end if;
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    values (tree, other, p_anchor, new_union, p_link_kind);

    -- The new parent can also be the parent of the anchor's brothers and sisters added earlier (the person ticks
    -- them). Only a brother or sister through the anchor's one parent, who has that parent alone, can be ticked.
    foreach also in array coalesce(p_also_children, '{}') loop
      if also = p_anchor then
        continue;
      end if;
      if coalesce(array_length(existing_parents, 1), 0) <> 1
         or not exists (select 1 from persons where id = also and tree_id = tree and deleted_at is null)
         or (select array_agg(parent_id) from parent_child where child_id = also) is distinct from existing_parents then
        raise exception 'bad_also_child' using errcode = 'PT422';
      end if;
      if not can_edit(tree, also) then
        raise exception 'not_allowed' using errcode = 'PT403';
      end if;
      if p_link_kind = 'birth' then
        update parent_child set union_id = new_union where parent_id = existing_parents[1] and child_id = also;
      end if;
      insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
      values (tree, other, also, new_union, p_link_kind);
    end loop;

  elsif p_relation = 'spouse' then
    insert into unions (tree_id, partner1_id, partner2_id, kind, status, seq1)
    values (tree, p_anchor, other, 'marriage', 'current',
            (select count(*) + 1 from unions where p_anchor in (partner1_id, partner2_id)))
    returning id into new_union;

  else
    if existing_parents is null then
      parent := insert_person_from_json(tree, jsonb_build_object('display_name', 'Name unknown', 'name_unknown', true));
      insert into parent_child (tree_id, parent_id, child_id, kind) values (tree, parent, p_anchor, 'unknown');
      existing_parents := array[parent];
    end if;
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    select tree, pc.parent_id, other, pc.union_id, p_link_kind from parent_child pc where pc.child_id = p_anchor;
  end if;

  return jsonb_build_object('person_id', other, 'union_id', coalesce(new_union, p_union));
end $$;

revoke all on function add_relative(uuid, text, jsonb, uuid, uuid, link_kind_t, uuid[]) from public, anon, authenticated;
grant execute on function add_relative(uuid, text, jsonb, uuid, uuid, link_kind_t, uuid[]) to authenticated;

create or replace function request_change(p_person uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  current_version int;
  stored jsonb;
  req uuid;
begin
  select tree_id, version into tree, current_version from persons where id = p_person and deleted_at is null;
  if tree is null or tree_role(tree, p_person) = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 40000 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;

  if p_payload ->> 'action' = 'add_relative' then
    if coalesce(p_payload ->> 'relation', '') not in ('parent', 'child', 'spouse', 'sibling') then
      raise exception 'bad_relation' using errcode = 'PT422';
    end if;
    if p_payload ? 'also_children' and (jsonb_typeof(p_payload -> 'also_children') <> 'array'
       or jsonb_array_length(p_payload -> 'also_children') > 50 or p_payload ->> 'relation' <> 'parent') then
      raise exception 'bad_input' using errcode = 'PT422';
    end if;
    if p_payload ->> 'existing_person' is null then
      perform clean_person_fields(p_payload -> 'person');
      if coalesce(trim(p_payload -> 'person' ->> 'display_name'), '') = '' then
        raise exception 'name_required' using errcode = 'PT422';
      end if;
    elsif not exists (select 1 from persons where id = (p_payload ->> 'existing_person')::uuid and tree_id = tree and deleted_at is null) then
      raise exception 'not_in_this_tree' using errcode = 'PT422';
    end if;
    stored := jsonb_build_object('action', 'add_relative', 'anchor', p_person, 'relation', p_payload ->> 'relation',
      'person', p_payload -> 'person', 'existing_person', p_payload ->> 'existing_person',
      'union', p_payload ->> 'union', 'link_kind', coalesce((p_payload ->> 'link_kind')::link_kind_t, 'birth'),
      'also_children', coalesce(p_payload -> 'also_children', '[]'::jsonb));

  elsif p_payload ->> 'table' = 'persons' and p_payload ->> 'op' in ('update', 'delete') then
    if (p_payload ->> 'before_version')::int is distinct from current_version then
      raise exception 'version_conflict' using errcode = 'PT409';
    end if;
    stored := jsonb_build_object('table', 'persons', 'op', p_payload ->> 'op', 'row_id', p_person, 'before_version', current_version);
    if p_payload ->> 'op' = 'update' then
      perform clean_person_fields(p_payload -> 'data');
      if p_payload -> 'data' ? 'photo_path'
         and (p_payload -> 'data' ->> 'photo_path') is distinct from (select photo_path from persons where id = p_person)
         and not photo_path_ok(p_payload -> 'data' ->> 'photo_path', me) then
        raise exception 'not_allowed' using errcode = 'PT403';
      end if;
      stored := stored || jsonb_build_object('data', p_payload -> 'data');
    end if;

  else
    raise exception 'change_not_supported' using errcode = 'PT422';
  end if;

  insert into requests (tree_id, kind, requester_id, target_person_id, payload)
  values (tree, 'change', me, p_person, stored) returning id into req;
  perform notify_tree_managers(tree, 'request_created', jsonb_build_object('request_id', req, 'kind', 'change', 'tree_id', tree));
  return req;
end $$;

create or replace function apply_change(q requests, edited jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p jsonb := q.payload;
  person uuid;
  fields jsonb;
  use_version int;
  actual_version int;
  claims text;
  batch uuid;
begin
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);

  if p ->> 'action' = 'set_elder_younger' then
    person := (p ->> 'person')::uuid;
    if not exists (select 1 from persons where id = person and tree_id = q.tree_id and deleted_at is null)
       or not exists (select 1 from persons where id = (p ->> 'than')::uuid and tree_id = q.tree_id and deleted_at is null) then
      raise exception 'person_not_found' using errcode = 'PT404';
    end if;
    perform apply_elder_younger(person, (p ->> 'than')::uuid, coalesce((edited ->> 'elder')::boolean, (p ->> 'elder')::boolean));

  elsif p ->> 'action' = 'add_relative' then
    fields := coalesce(edited -> 'person', p -> 'person');
    if p ->> 'existing_person' is null then
      perform clean_person_fields(fields);
    end if;
    -- add_relative checks rights by the signed-in id. A successor deciding under the successor rule does not hold
    -- them, so it runs in the Creator's name and the history is then set back to the true actor.
    claims := current_setting('request.jwt.claims', true);
    if not is_creator_or_cocreator(q.tree_id) then
      perform set_config('request.jwt.claims',
        jsonb_build_object('sub', (select creator_id from trees where id = q.tree_id))::text, true);
    end if;
    perform add_relative((p ->> 'anchor')::uuid, p ->> 'relation', fields, (p ->> 'existing_person')::uuid,
                         (p ->> 'union')::uuid, coalesce((p ->> 'link_kind')::link_kind_t, 'birth'),
                         array(select x::uuid from jsonb_array_elements_text(coalesce(p -> 'also_children', '[]'::jsonb)) x));
    perform set_config('request.jwt.claims', coalesce(claims, ''), true);
    batch := current_setting('aywo.batch_id')::uuid;
    update history set actor_id = me where batch_id = batch;

  elsif p ->> 'table' = 'persons' and p ->> 'op' in ('update', 'delete') then
    person := (p ->> 'row_id')::uuid;
    select version into actual_version from persons where id = person and tree_id = q.tree_id and deleted_at is null;
    if actual_version is null then
      raise exception 'person_not_found' using errcode = 'PT404';
    end if;
    -- A decider who has seen the newer card may say so; otherwise a clash stops the approval (F-SHR-07).
    use_version := coalesce((edited ->> 'before_version')::int, (p ->> 'before_version')::int);
    if p ->> 'op' = 'delete' then
      if use_version <> actual_version then
        raise exception 'version_conflict' using errcode = 'PT409';
      end if;
      perform apply_person_delete(person);
    else
      if edited is null then
        fields := p -> 'data';
      elsif edited ? 'data' then
        fields := edited -> 'data';
      else
        fields := edited - 'before_version';
      end if;
      perform clean_person_fields(fields);
      if fields ? 'photo_path'
         and (fields ->> 'photo_path') is distinct from (p -> 'data' ->> 'photo_path')
         and (fields ->> 'photo_path') is distinct from (select photo_path from persons where id = person)
         and not photo_path_ok(fields ->> 'photo_path', me) then
        raise exception 'not_allowed' using errcode = 'PT403';
      end if;
      perform apply_person_fields(person, use_version, fields);
    end if;

  else
    raise exception 'change_not_supported' using errcode = 'PT422';
  end if;
end $$;
