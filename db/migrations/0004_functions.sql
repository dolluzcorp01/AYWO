-- Database functions the app calls directly (LLD L5). These write several rows, so they must be one transaction,
-- and they check the caller themselves because they run with server rights.

-- T-ACC-01: every account has a profile.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, login_phone, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''),
          case when new.phone is null or new.phone = '' then null else '+' || ltrim(new.phone, '+') end,
          nullif(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- The caller's OTP-verified number. Never taken from anything the app sends.
create function my_verified_phone() returns text
language sql stable security definer set search_path = public as $$
  select '+' || ltrim(u.phone, '+') from auth.users u
  where u.id = auth.uid() and u.phone is not null and u.phone_confirmed_at is not null
$$;

-- F-ACC-03/04: people saved with my number, in trees where I have not claimed anyone yet.
create function claim_candidates()
returns table (person_id uuid, tree_id uuid, tree_name text, display_name text, photo_path text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, t.id, t.name, p.display_name, p.photo_path
  from person_contacts c
  join persons p on p.id = c.person_id
  join trees t on t.id = p.tree_id
  where c.kind in ('mobile', 'whatsapp')
    and c.value_normalized = my_verified_phone()
    and p.claimed_by is null and p.deleted_at is null and t.deleted_at is null
    and not exists (select 1 from persons o where o.tree_id = t.id and o.claimed_by = auth.uid())
$$;

-- F-ACC-03/05: 'Yes, this is me'. Only someone whose verified number is on that person can claim them.
create function claim_confirm(p_person uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  added_by uuid;
begin
  select c.tree_id into tree from claim_candidates() c where c.person_id = p_person;
  if tree is null then
    raise exception 'not_your_entry' using errcode = 'PT403';
  end if;
  update persons set claimed_by = me where id = p_person returning created_by into added_by;
  insert into notifications (recipient_id, kind, payload)
  values (added_by, 'claim_made', jsonb_build_object('person_id', p_person, 'tree_id', tree, 'by', me));
  return tree;
end $$;

-- F-ACC-05: 'Wrong match? Undo'. Whoever added the person, or the tree's Creator.
create function claim_undo(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  row_now persons;
  tree_creator uuid;
begin
  select * into row_now from persons where id = p_person;
  select creator_id into tree_creator from trees where id = row_now.tree_id;
  if row_now.id is null or row_now.claimed_by is null or me not in (row_now.created_by, tree_creator) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  update persons set claimed_by = null where id = p_person;
  insert into notifications (recipient_id, kind, payload)
  values (row_now.claimed_by, 'claim_undone', jsonb_build_object('person_id', p_person, 'tree_id', row_now.tree_id));
end $$;

-- Contact icons or values for everyone the caller may see, in one call (L4.3).
create function tree_contacts(p_tree uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(p.id, get_person_contacts(p.id)), '{}'::jsonb)
  from persons p
  where p.tree_id = p_tree and p.deleted_at is null and tree_role(p_tree, p.id) <> 'none'
$$;

create function insert_person_from_json(p_tree uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if coalesce(trim(p ->> 'display_name'), '') = '' then
    raise exception 'name_required' using errcode = 'PT422';
  end if;
  insert into persons (tree_id, display_name, name_unknown, note_label, gender, living, birth_date, death_date,
                       birth_precision, death_precision, birth_place, death_place, birth_order, notes, created_by)
  values (p_tree, trim(p ->> 'display_name'), coalesce((p ->> 'name_unknown')::boolean, false), p ->> 'note_label',
          coalesce(p ->> 'gender', 'unknown')::gender_t, coalesce(p ->> 'living', 'unknown')::living_t,
          (p ->> 'birth_date')::date, (p ->> 'death_date')::date,
          (p ->> 'birth_precision')::date_prec_t, (p ->> 'death_precision')::date_prec_t,
          p ->> 'birth_place', p ->> 'death_place', (p ->> 'birth_order')::smallint, p ->> 'notes', auth.uid())
  returning id into new_id;
  return new_id;
end $$;

-- F-TREE-03: adds a person, or links someone already in the tree, in one transaction with one undo.
-- p_relation: parent, child, spouse, sibling. Editors who need approval are refused and must file a request.
-- Parents and siblings sit outside a branch, so branch-only editors may add only partners and children.
create function add_relative(
  p_anchor uuid,
  p_relation text,
  p_person jsonb default null,
  p_existing_person uuid default null,
  p_union uuid default null,
  p_link_kind link_kind_t default 'birth'
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
begin
  select tree_id into tree from persons where id = p_anchor and deleted_at is null;
  if tree is null or not can_edit(tree, p_anchor) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_relation not in ('parent', 'child', 'spouse', 'sibling') then
    raise exception 'bad_relation' using errcode = 'PT422';
  end if;
  if p_relation in ('parent', 'sibling') and not can_edit(tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;

  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);

  if p_existing_person is not null then
    if not exists (select 1 from persons where id = p_existing_person and tree_id = tree and deleted_at is null) then
      raise exception 'not_in_this_tree' using errcode = 'PT422';
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
    -- A second birth parent forms a couple with the first.
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

  elsif p_relation = 'spouse' then
    insert into unions (tree_id, partner1_id, partner2_id, kind, status, seq1)
    values (tree, p_anchor, other, 'marriage', 'current',
            (select count(*) + 1 from unions where p_anchor in (partner1_id, partner2_id)))
    returning id into new_union;

  else -- sibling: same parents as the anchor. With none known yet, a 'Name unknown' parent joins them (F-TREE-04).
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

-- F-IO-01/03: writes the corrected preview as a new tree, with one batch so one undo removes it all (T-SHR-04).
-- p_fixes: {"<tempId>": {"gender": "male", "display_name": "..."}}. p_me_temp: 'Which one is you?'.
create function import_commit(p_import uuid, p_tree_name text, p_fixes jsonb default '{}', p_me_temp text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  imp imports;
  batch uuid := gen_random_uuid();
  tree uuid;
  ids jsonb := '{}';
  union_ids jsonb := '{}';
  x jsonb;
  fix jsonb;
  new_id uuid;
begin
  select * into imp from imports where id = p_import and created_by = me;
  if imp.id is null then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if imp.status <> 'preview' then
    raise exception 'already_imported' using errcode = 'PT422';
  end if;
  if coalesce(trim(p_tree_name), '') = '' then
    raise exception 'name_required' using errcode = 'PT422';
  end if;

  perform set_config('aywo.batch_id', batch::text, true);
  insert into trees (name, creator_id) values (trim(p_tree_name), me) returning id into tree;

  for x in select * from jsonb_array_elements(imp.preview -> 'persons') loop
    fix := coalesce(p_fixes -> (x ->> 'tempId'), '{}');
    insert into persons (tree_id, display_name, name_unknown, note_label, gender, birth_order, created_by)
    values (tree, coalesce(fix ->> 'display_name', x ->> 'displayName'), (x ->> 'nameUnknown')::boolean, x ->> 'noteLabel',
            coalesce(fix ->> 'gender', x ->> 'gender')::gender_t, (x ->> 'birthOrder')::smallint, me)
    returning id into new_id;
    ids := ids || jsonb_build_object(x ->> 'tempId', new_id);
  end loop;

  for x in select * from jsonb_array_elements(imp.preview -> 'unions') loop
    insert into unions (tree_id, partner1_id, partner2_id, kind, seq1)
    values (tree, (ids ->> (x ->> 'partner1Id'))::uuid, (ids ->> (x ->> 'partner2Id'))::uuid, 'unknown', (x ->> 'seq1')::smallint)
    returning id into new_id;
    union_ids := union_ids || jsonb_build_object(x ->> 'tempId', new_id);
  end loop;

  for x in select * from jsonb_array_elements(imp.preview -> 'parentLinks') loop
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    values (tree, (ids ->> (x ->> 'parentId'))::uuid, (ids ->> (x ->> 'childId'))::uuid,
            (union_ids ->> (x ->> 'unionId'))::uuid, 'unknown');
  end loop;

  if p_me_temp is not null then
    new_id := (ids ->> p_me_temp)::uuid;
    if new_id is null then
      raise exception 'bad_person' using errcode = 'PT422';
    end if;
    update persons set claimed_by = me where id = new_id;
    update trees set creator_person_id = new_id where id = tree;
  end if;

  update imports set status = 'committed', tree_id = tree where id = p_import;
  return jsonb_build_object('tree_id', tree, 'batch_id', batch, 'people', (select count(*) from persons where tree_id = tree));
end $$;

revoke all on function handle_new_user(), my_verified_phone(), claim_candidates(), claim_confirm(uuid), claim_undo(uuid),
  tree_contacts(uuid), insert_person_from_json(uuid, jsonb),
  add_relative(uuid, text, jsonb, uuid, uuid, link_kind_t), import_commit(uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function claim_candidates(), claim_confirm(uuid), claim_undo(uuid), tree_contacts(uuid),
  add_relative(uuid, text, jsonb, uuid, uuid, link_kind_t), import_commit(uuid, text, jsonb, text)
  to authenticated;
