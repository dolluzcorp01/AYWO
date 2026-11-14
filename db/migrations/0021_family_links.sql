-- PR 23. Family links you can fix.
-- 1. Adding someone already in the tree adds only the links that are missing. Before, adding Sathana as
--    Ezhilarasi's child (with Veeraiyan) failed with 'already on the list' because she was already his child.
--    Same care for parent, partner and brother or sister: never a link twice, clear answers when it cannot be.
-- 2. New: change how a parent is linked (by birth, adopted, step, foster), remove a wrong link, change or remove
--    a partner link. Before, the only fix was deleting the person.

create or replace function add_relative(
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
  partner uuid;
  other_parents uuid[];
  changed int := 0;
  n int;
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
    if other = p_anchor then
      raise exception 'same_person' using errcode = 'PT422';
    end if;
    -- A brother, sister or partner cannot be your own parent, grandparent, child or grandchild.
    if p_relation in ('sibling', 'spouse') and exists (
      select 1 from person_closure
      where (ancestor_id = other and descendant_id = p_anchor) or (ancestor_id = p_anchor and descendant_id = other)
    ) then
      raise exception 'family_loop' using errcode = 'PT422';
    end if;
  else
    other := insert_person_from_json(tree, p_person);
  end if;

  select array_agg(parent_id) into existing_parents from parent_child where child_id = p_anchor;

  if p_relation = 'child' then
    if p_union is not null then
      select * into u from unions where id = p_union and tree_id = tree and p_anchor in (partner1_id, partner2_id);
      if u.id is null then
        raise exception 'bad_union' using errcode = 'PT422';
      end if;
      if u.partner2_id is not null then
        partner := case when u.partner1_id = p_anchor then u.partner2_id else u.partner1_id end;
      end if;
    end if;
    -- Someone already in the tree may already be linked to one of the two parents (Sathana is already
    -- Veeraiyan's child when she is added as Ezhilarasi's): only the missing link is added, and an existing one
    -- is put under the couple. Nothing is ever linked twice.
    if exists (select 1 from parent_child where parent_id = p_anchor and child_id = other) then
      update parent_child set union_id = p_union
      where parent_id = p_anchor and child_id = other and union_id is distinct from p_union and p_union is not null;
      get diagnostics changed = row_count;
    else
      insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
      values (tree, p_anchor, other, p_union, p_link_kind);
      changed := 1;
    end if;
    if partner is not null then
      if exists (select 1 from parent_child where parent_id = partner and child_id = other) then
        update parent_child set union_id = p_union
        where parent_id = partner and child_id = other and union_id is distinct from p_union;
        get diagnostics n = row_count;
        changed := changed + n;
      else
        insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
        values (tree, partner, other, p_union, p_link_kind);
        changed := changed + 1;
      end if;
    end if;
    if changed = 0 then
      raise exception 'already_linked' using errcode = 'PT422';
    end if;
    if (select count(*) from parent_child where child_id = other and kind = 'birth') > 2 then
      raise exception 'already_two_parents' using errcode = 'PT422';
    end if;

  elsif p_relation = 'parent' then
    if other = any(coalesce(existing_parents, '{}')) then
      raise exception 'already_linked' using errcode = 'PT422';
    end if;
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
      if also = p_anchor or exists (select 1 from parent_child where parent_id = other and child_id = also) then
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
    if exists (select 1 from unions where (partner1_id, partner2_id) in ((p_anchor, other), (other, p_anchor))) then
      raise exception 'already_linked' using errcode = 'PT422';
    end if;
    insert into unions (tree_id, partner1_id, partner2_id, kind, status, seq1)
    values (tree, p_anchor, other, 'marriage', 'current',
            (select count(*) + 1 from unions where p_anchor in (partner1_id, partner2_id)))
    returning id into new_union;

  else
    -- Brother or sister. Someone already in the tree with their own parents: the anchor joins those parents
    -- (if the anchor has none), it is already done (same parents), or they cannot be brother and sister by birth.
    if p_existing_person is not null then
      select array_agg(parent_id order by parent_id) into other_parents from parent_child where child_id = other;
    end if;
    if other_parents is not null then
      if existing_parents is null then
        insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
        select tree, pc.parent_id, p_anchor, pc.union_id, p_link_kind from parent_child pc where pc.child_id = other;
      elsif (select array_agg(x order by x) from unnest(existing_parents) x) = other_parents then
        raise exception 'already_linked' using errcode = 'PT422';
      else
        raise exception 'different_parents' using errcode = 'PT422';
      end if;
    else
      if existing_parents is null then
        parent := insert_person_from_json(tree, jsonb_build_object('display_name', 'Name unknown', 'name_unknown', true));
        insert into parent_child (tree_id, parent_id, child_id, kind) values (tree, parent, p_anchor, 'unknown');
        existing_parents := array[parent];
      end if;
      insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
      select tree, pc.parent_id, other, pc.union_id, p_link_kind from parent_child pc where pc.child_id = p_anchor;
    end if;
  end if;

  return jsonb_build_object('person_id', other, 'union_id', coalesce(new_union, p_union));
end $$;

-- Family links: fix a wrong link without deleting anyone. Tree editors only (like adding a parent).
create function link_set_kind(p_parent uuid, p_child uuid, p_kind link_kind_t) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l parent_child;
begin
  select * into l from parent_child where parent_id = p_parent and child_id = p_child;
  if l.id is null or not can_edit(l.tree_id) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_kind = 'birth' and l.kind <> 'birth'
     and (select count(*) from parent_child where child_id = p_child and kind = 'birth') >= 2 then
    raise exception 'already_two_parents' using errcode = 'PT422';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  update parent_child set kind = p_kind where id = l.id;
  return jsonb_build_object('status', 'saved');
end $$;

create function link_remove(p_parent uuid, p_child uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l parent_child;
begin
  select * into l from parent_child where parent_id = p_parent and child_id = p_child;
  if l.id is null or not can_edit(l.tree_id) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  delete from parent_child where id = l.id;
  -- A 'Name unknown' stand-in parent left with nobody is not kept.
  update persons p set deleted_at = now()
  where p.id = p_parent and p.name_unknown and p.deleted_at is null
    and not exists (select 1 from parent_child where parent_id = p.id or child_id = p.id)
    and not exists (select 1 from unions where p.id in (partner1_id, partner2_id));
  return jsonb_build_object('status', 'removed');
end $$;

create function union_set_status(p_union uuid, p_status union_status_t) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u unions;
begin
  select * into u from unions where id = p_union;
  if u.id is null or not can_edit(u.tree_id, u.partner1_id)
     or (u.partner2_id is not null and not can_edit(u.tree_id, u.partner2_id)) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  update unions set status = p_status, version = u.version where id = p_union;
  return jsonb_build_object('status', 'saved');
end $$;

-- Remove a partner link. Their children keep both parents; they are just no longer shown under the couple.
create function union_remove(p_union uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u unions;
begin
  select * into u from unions where id = p_union;
  if u.id is null or not can_edit(u.tree_id) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  delete from unions where id = p_union;
  return jsonb_build_object('status', 'removed');
end $$;

revoke all on function link_set_kind(uuid, uuid, link_kind_t), link_remove(uuid, uuid),
  union_set_status(uuid, union_status_t), union_remove(uuid) from public, anon, authenticated;
grant execute on function link_set_kind(uuid, uuid, link_kind_t), link_remove(uuid, uuid),
  union_set_status(uuid, union_status_t), union_remove(uuid) to authenticated;
