-- Closing the known gaps after the five areas finished: account photo, tree members, adding yourself after an import,
-- the details on 'Is this you?', the choices on the import preview, admin notices, and deleting a paying account.
-- Every function checks auth.uid() and rights itself. Nothing here returns a contact value.

-- ===== Account photo =====

alter table profiles add column photo_path text;

-- Same as 0006, plus photo_path. The API swaps the path for a signed link before it leaves the server.
create or replace function my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  answer jsonb;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  -- The successor rule reads this. An hour's accuracy is plenty.
  update profiles set last_active_at = now()
  where id = me and (last_active_at is null or last_active_at < now() - interval '1 hour');
  select jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'login_phone', p.login_phone, 'email', p.email,
    'language_code', p.language_code, 'large_text', p.large_text, 'photo_path', p.photo_path,
    'plus', has_plus(me),
    'plus_until', (
      select max(coalesce(f.renews_at, f.trial_ends_at)) from family_plans f
      left join family_plan_members m on m.plan_id = f.id
      where f.status in ('trial', 'active', 'grace') and (f.payer_id = me or m.profile_id = me)
    ),
    'admin_role', (select a.role::text from app_admins a where a.profile_id = me)
  ) into answer
  from profiles p where p.id = me and p.deleted_at is null;
  if answer is null then
    raise exception 'session_ended' using errcode = 'PT401';
  end if;
  return answer;
end $$;

-- Same as 0006, plus photo_path, which must be a file this person uploaded. A card of theirs with no photo takes it too.
create or replace function me_update(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if p_patch ? 'display_name' and (coalesce(trim(p_patch ->> 'display_name'), '') = '' or char_length(p_patch ->> 'display_name') > 200) then
    raise exception 'name_required' using errcode = 'PT422';
  end if;
  if p_patch ? 'email' and p_patch ->> 'email' is not null and p_patch ->> 'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'email_invalid' using errcode = 'PT422';
  end if;
  if p_patch ? 'photo_path' and not photo_path_ok(p_patch ->> 'photo_path', me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  update profiles set
    display_name = case when p_patch ? 'display_name' then trim(p_patch ->> 'display_name') else display_name end,
    email = case when p_patch ? 'email' then lower(trim(p_patch ->> 'email')) else email end,
    language_code = case when p_patch ? 'language_code' then p_patch ->> 'language_code' else language_code end,
    large_text = case when p_patch ? 'large_text' then coalesce((p_patch ->> 'large_text')::boolean, false) else large_text end,
    photo_path = case when p_patch ? 'photo_path' then p_patch ->> 'photo_path' else photo_path end
  where id = me and deleted_at is null;
  if p_patch ->> 'photo_path' is not null then
    perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
    update persons set photo_path = p_patch ->> 'photo_path'
    where claimed_by = me and deleted_at is null and photo_path is null;
  end if;
  return my_account();
end $$;

-- A card someone claims or creates for themselves takes their account photo when it has none.
create function persons_use_profile_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.claimed_by is not null and new.photo_path is null
     and (tg_op = 'INSERT' or old.claimed_by is distinct from new.claimed_by) then
    select p.photo_path into new.photo_path from profiles p where p.id = new.claimed_by;
  end if;
  return new;
end $$;
create trigger persons_profile_photo before insert or update of claimed_by on persons
  for each row execute function persons_use_profile_photo();

-- Same as 0004, except that a wrong match takes the claimant's photo away with it.
create or replace function claim_undo(p_person uuid) returns void
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
  update persons set
    claimed_by = null,
    photo_path = case when photo_path = (select p.photo_path from profiles p where p.id = row_now.claimed_by) then null else photo_path end
  where id = p_person;
  insert into notifications (recipient_id, kind, payload)
  values (row_now.claimed_by, 'claim_undone', jsonb_build_object('person_id', p_person, 'tree_id', row_now.tree_id));
end $$;

-- ===== Members of a tree =====

-- GET /trees/:id/members, for those who run the tree. Names and profile ids only.
create function tree_members(p_tree uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_creator_or_cocreator(p_tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  return (
    select jsonb_build_object(
      'creator_id', t.creator_id,
      'claimed', coalesce((
        select jsonb_agg(jsonb_build_object(
          'person_id', c.id, 'person_name', c.display_name, 'profile_id', c.claimed_by, 'display_name', pr.display_name
        ) order by c.display_name)
        from persons c join profiles pr on pr.id = c.claimed_by and pr.deleted_at is null
        where c.tree_id = t.id and c.deleted_at is null
      ), '[]'::jsonb),
      'grantees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'profile_id', g.grantee_profile_id, 'display_name', g.display_name, 'role', g.role, 'branch_only', g.branch_only
        ) order by g.display_name)
        from (
          select distinct on (s.grantee_profile_id) s.grantee_profile_id, pr.display_name, s.role, s.scope_person_id is not null as branch_only
          from shares s join profiles pr on pr.id = s.grantee_profile_id and pr.deleted_at is null
          where s.tree_id = t.id and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
          order by s.grantee_profile_id, s.role desc
        ) g
      ), '[]'::jsonb),
      'successor', (
        select jsonb_build_object('profile_id', pr.id, 'display_name', pr.display_name)
        from profiles pr where pr.id = t.successor_id and pr.deleted_at is null
      )
    )
    from trees t where t.id = p_tree and t.deleted_at is null
  );
end $$;

-- ===== Adding yourself to a tree =====

-- A7 'I'm not in this tree yet': one card, its relation to someone already there, and the claim, in one transaction.
-- p_relation is what the new card is to p_anchor: parent, child, spouse or sibling. add_relative checks it again.
create function tree_add_me(
  p_tree uuid,
  p_anchor uuid,
  p_relation text,
  p_name text default null,
  p_gender gender_t default 'unknown'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_name text;
  added jsonb;
  new_person uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not is_creator_or_cocreator(p_tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if exists (select 1 from persons c where c.tree_id = p_tree and c.claimed_by = me) then
    raise exception 'already_in_tree' using errcode = 'PT409';
  end if;
  if not exists (select 1 from persons a where a.id = p_anchor and a.tree_id = p_tree and a.deleted_at is null) then
    raise exception 'not_in_this_tree' using errcode = 'PT422';
  end if;
  my_name := coalesce(nullif(trim(p_name), ''), (select nullif(trim(pr.display_name), '') from profiles pr where pr.id = me));
  if my_name is null or char_length(my_name) > 200 then
    raise exception 'name_required' using errcode = 'PT422';
  end if;
  added := add_relative(p_anchor, p_relation, jsonb_build_object('display_name', my_name, 'gender', p_gender, 'living', 'living'));
  new_person := (added ->> 'person_id')::uuid;
  update persons set claimed_by = me where id = new_person;
  update trees set creator_person_id = new_person where id = p_tree and creator_id = me and creator_person_id is null;
  return jsonb_build_object('tree_id', p_tree, 'person_id', new_person);
end $$;

-- ===== B2 'Is this you?' =====

-- Wireframe B2: enough to recognise yourself, only for entries your verified number already matched. No contact values.
create function claim_candidate_details() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'person_id', c.person_id,
    'tree_id', c.tree_id,
    'tree_name', c.tree_name,
    'display_name', c.display_name,
    'photo_path', c.photo_path,
    'parents', coalesce((
      select jsonb_agg(par.display_name order by par.display_name)
      from parent_child pc
      join persons par on par.id = pc.parent_id and par.deleted_at is null and not par.name_unknown
      where pc.child_id = c.person_id
    ), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(o.display_name order by o.display_name)
      from unions u
      join persons o on o.id = case when u.partner1_id = c.person_id then u.partner2_id else u.partner1_id end
        and o.deleted_at is null and not o.name_unknown
      where c.person_id in (u.partner1_id, u.partner2_id)
    ), '[]'::jsonb),
    'married', exists (
      select 1 from unions u where c.person_id in (u.partner1_id, u.partner2_id) and u.kind = 'marriage'
    ),
    'people', (select count(*) from persons x where x.tree_id = c.tree_id and x.deleted_at is null),
    'added_by', (
      select nullif(pr.display_name, '') from persons e
      join profiles pr on pr.id = e.created_by and pr.deleted_at is null
      where e.id = c.person_id
    )
  )), '[]'::jsonb)
  from claim_candidates() c
$$;

-- ===== Import: what the person chose on A6 =====

-- Same as 0006, plus two reserved keys in p_fixes, which cannot clash with a tempId:
--   "_split": ["<droppedId>", ...]   these merged people stay two people (A6 'No, two people'). The parser's undo list
--                                    says exactly which unions and links to give back. It runs newest merge first,
--                                    because a later merge can move what an earlier one moved.
--   "_placeholders": ["<tempId>"]    keep a 'Name unknown' child in these empty boxes (A6 'Yes, add later').
-- The answer also gives person_ids (tempId to id), so the app can name an anchor for tree_add_me.
create or replace function import_commit(p_import uuid, p_tree_name text, p_fixes jsonb default '{}', p_me_temp text default null) returns jsonb
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
  parent_id_now uuid;
  persons_in jsonb;
  unions_in jsonb;
  links_in jsonb;
  merges jsonb;
  split_ids jsonb;
  spaces jsonb;
  merged_into jsonb := '{}';
  m jsonb;
  dropped text;
  back jsonb;
  parent_temp text;
  kept_now uuid;
  dropped_now uuid;
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

  persons_in := coalesce(imp.preview -> 'persons', '[]');
  unions_in := coalesce(imp.preview -> 'unions', '[]');
  links_in := coalesce(imp.preview -> 'parentLinks', '[]');
  merges := coalesce(imp.preview -> 'merges', '[]');
  split_ids := case when jsonb_typeof(p_fixes -> '_split') = 'array' then p_fixes -> '_split' else '[]' end;
  spaces := case when jsonb_typeof(p_fixes -> '_placeholders') = 'array' then p_fixes -> '_placeholders' else '[]' end;

  for i in reverse jsonb_array_length(merges) - 1 .. 0 loop
    m := merges -> i;
    dropped := m ->> 'droppedId';
    if not (split_ids ? dropped) or m -> 'dropped' is null or m -> 'undo' is null then
      merged_into := merged_into || jsonb_build_object(dropped, m ->> 'keptId');
      continue;
    end if;
    persons_in := persons_in || jsonb_build_array(m -> 'dropped');
    for back in select * from jsonb_array_elements(m -> 'undo' -> 'unions') loop
      unions_in := jsonb_set(unions_in, array[back ->> 'index', back ->> 'field'], to_jsonb(dropped));
    end loop;
    for back in select * from jsonb_array_elements(m -> 'undo' -> 'links') loop
      links_in := jsonb_set(links_in, array[back ->> 'index', back ->> 'field'], to_jsonb(dropped));
    end loop;
    for back in select * from jsonb_array_elements(m -> 'undo' -> 'linkUnions') loop
      links_in := jsonb_set(links_in, array[back #>> '{}', 'unionId'], 'null'::jsonb);
    end loop;
    -- A link the merge added is blanked, not removed, so the positions above stay right.
    for back in select * from jsonb_array_elements(m -> 'undo' -> 'addedLinks') loop
      links_in := jsonb_set(links_in, array[back #>> '{}'], 'null'::jsonb);
    end loop;
  end loop;

  perform set_config('aywo.batch_id', batch::text, true);
  insert into trees (name, creator_id) values (trim(p_tree_name), me) returning id into tree;

  for x in select * from jsonb_array_elements(persons_in) loop
    fix := coalesce(p_fixes -> (x ->> 'tempId'), '{}');
    insert into persons (tree_id, display_name, name_unknown, note_label, gender, birth_order, living, birth_date, death_date,
                         birth_precision, death_precision, birth_place, death_place, notes, created_by)
    values (tree, coalesce(fix ->> 'display_name', x ->> 'displayName'), (x ->> 'nameUnknown')::boolean, x ->> 'noteLabel',
            coalesce(fix ->> 'gender', x ->> 'gender')::gender_t, (x ->> 'birthOrder')::smallint,
            coalesce(x ->> 'living', 'unknown')::living_t, (x ->> 'birthDate')::date, (x ->> 'deathDate')::date,
            (x ->> 'birthPrecision')::date_prec_t, (x ->> 'deathPrecision')::date_prec_t,
            x ->> 'birthPlace', x ->> 'deathPlace', x ->> 'notes', me)
    returning id into new_id;
    ids := ids || jsonb_build_object(x ->> 'tempId', new_id);
  end loop;

  for x in select * from jsonb_array_elements(unions_in) loop
    insert into unions (tree_id, partner1_id, partner2_id, kind, status, seq1, start_date, end_date)
    values (tree, (ids ->> (x ->> 'partner1Id'))::uuid, (ids ->> (x ->> 'partner2Id'))::uuid,
            coalesce(x ->> 'kind', 'unknown')::union_kind_t, coalesce(x ->> 'status', 'unknown')::union_status_t,
            (x ->> 'seq1')::smallint, (x ->> 'startDate')::date, (x ->> 'endDate')::date)
    returning id into new_id;
    union_ids := union_ids || jsonb_build_object(x ->> 'tempId', new_id);
  end loop;

  for x in select l.item from jsonb_array_elements(links_in) as l(item) where jsonb_typeof(l.item) = 'object' loop
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    values (tree, (ids ->> (x ->> 'parentId'))::uuid, (ids ->> (x ->> 'childId'))::uuid,
            (union_ids ->> (x ->> 'unionId'))::uuid, coalesce(x ->> 'kind', 'unknown')::link_kind_t)
    on conflict (parent_id, child_id) do nothing;
  end loop;

  -- The parents an empty box was drawn under, followed through any merges that stayed merged.
  for x in select * from jsonb_array_elements(coalesce(imp.preview -> 'placeholders', '[]')) loop
    if not (spaces ? coalesce(x ->> 'tempId', '')) or jsonb_array_length(coalesce(x -> 'parentIds', '[]')) = 0 then
      continue;
    end if;
    insert into persons (tree_id, display_name, name_unknown, created_by)
    values (tree, 'Name unknown', true, me)
    returning id into new_id;
    for parent_temp in select * from jsonb_array_elements_text(x -> 'parentIds') loop
      while merged_into ? parent_temp loop
        parent_temp := merged_into ->> parent_temp;
      end loop;
      parent_id_now := (ids ->> parent_temp)::uuid;
      if parent_id_now is not null then
        insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
        values (tree, parent_id_now, new_id, (union_ids ->> (x ->> 'unionId'))::uuid, 'unknown')
        on conflict (parent_id, child_id) do nothing;
      end if;
    end loop;
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

  -- 'No, two people' is an answer: the scan must not ask the same question again.
  for i in 0 .. jsonb_array_length(merges) - 1 loop
    m := merges -> i;
    dropped := m ->> 'droppedId';
    dropped_now := (ids ->> dropped)::uuid;
    if dropped_now is null then
      continue;
    end if;
    parent_temp := m ->> 'keptId';
    while merged_into ? parent_temp loop
      parent_temp := merged_into ->> parent_temp;
    end loop;
    kept_now := (ids ->> parent_temp)::uuid;
    if kept_now is not null then
      insert into requests (tree_id, kind, requester_id, target_person_id, payload, status, decided_by, decided_at, note)
      values (tree, 'merge', me, greatest(kept_now, dropped_now),
              jsonb_build_object('person_a', least(kept_now, dropped_now), 'person_b', greatest(kept_now, dropped_now)),
              'declined', me, now(), 'kept_apart_at_import');
    end if;
  end loop;

  perform merge_scan_tree(tree);
  return jsonb_build_object('tree_id', tree, 'batch_id', batch, 'person_ids', ids,
    'people', (select count(*) from persons where tree_id = tree));
end $$;

-- ===== Admin notices =====

-- PRD 'Broadcast system notices (never marketing blasts to families)'. AYWO Admin only ('staff' is never given to a
-- Sub-admin), with a written reason, at most three a day, audited, and delivered as ordinary notifications.
create function admin_broadcast(p_title text, p_body text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  notice_title text := trim(coalesce(p_title, ''));
  notice_body text := trim(coalesce(p_body, ''));
  why text;
  sent int;
  notice uuid := gen_random_uuid();
begin
  perform admin_require(array['staff']);
  why := admin_clean_reason(p_reason);
  if char_length(notice_title) not between 3 and 80 or char_length(notice_body) not between 10 and 500 then
    raise exception 'admin_broadcast_bad_text' using errcode = 'PT422';
  end if;
  if (select count(*) from admin_audit_log l where l.action = 'broadcast.sent' and l.created_at > now() - interval '1 day') >= 3 then
    raise exception 'admin_broadcast_too_many' using errcode = 'PT429';
  end if;
  insert into notifications (recipient_id, kind, payload)
  select p.id, 'system_notice', jsonb_build_object('title', notice_title, 'body', notice_body, 'broadcast_id', notice)
  from profiles p join auth.users u on u.id = p.id
  where p.deleted_at is null and u.banned_at is null;
  get diagnostics sent = row_count;
  perform admin_log('broadcast.sent', 'broadcast', notice::text, why,
    jsonb_build_object('title', notice_title, 'body', notice_body, 'recipients', sent));
  return jsonb_build_object('id', notice, 'recipients', sent);
end $$;

-- ===== Deleting an account that is paying =====

-- Same as 0006, with two additions. family_plans has no cascade and the store goes on charging whatever AYWO does, so a
-- payer whose plan will renew is refused until they have seen the warning and said they understand. Their account
-- photo and device tokens also leave with the account. The plan row stays: the payment provider's webhooks end it.
drop function account_delete();
create function account_delete(p_plan_acknowledged boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  t trees;
  heir uuid;
  passed int := 0;
  closed int := 0;
begin
  if me is null or not exists (select 1 from profiles where id = me and deleted_at is null) then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not coalesce(p_plan_acknowledged, false) and exists (
    select 1 from family_plans f
    where f.payer_id = me and f.status in ('trial', 'active', 'grace') and f.will_renew
  ) then
    raise exception 'plan_cancel_first' using errcode = 'PT409';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);

  for t in select * from trees where creator_id = me and deleted_at is null loop
    heir := null;
    select p.id into heir from profiles p where p.id = t.successor_id and p.deleted_at is null;
    if heir is null then
      select s.grantee_profile_id into heir
      from shares s join profiles p on p.id = s.grantee_profile_id and p.deleted_at is null
      where s.tree_id = t.id and s.role = 'co_creator' and s.scope_person_id is null
        and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      order by s.created_at limit 1;
    end if;
    if heir is null then
      perform tree_delete(t.id);
      closed := closed + 1;
    else
      update shares set revoked_at = now() where tree_id = t.id and grantee_profile_id = heir and revoked_at is null;
      update trees set creator_id = heir, successor_id = null where id = t.id;
      insert into notifications (recipient_id, kind, payload)
      values (heir, 'tree_passed_to_you', jsonb_build_object('tree_id', t.id));
      passed := passed + 1;
    end if;
  end loop;

  -- Own contact values leave with the account. Their history rows never held the values.
  delete from person_contacts c using persons p where c.person_id = p.id and p.claimed_by = me;
  update trees set creator_person_id = null
  where creator_person_id in (select id from persons where claimed_by = me);
  update persons c set photo_path = null
  from profiles pr
  where pr.id = me and c.claimed_by = me and c.photo_path = pr.photo_path;
  update persons set claimed_by = null where claimed_by = me;
  update trees set successor_id = null where successor_id = me;

  update shares set revoked_at = now() where grantee_profile_id = me and revoked_at is null;
  update requests set status = 'expired', decided_at = now(), note = 'account_deleted' where requester_id = me and status = 'pending';
  delete from comments where author_id = me;
  delete from notifications where recipient_id = me;
  delete from notification_prefs where profile_id = me;
  delete from consents where profile_id = me;
  delete from family_plan_members where profile_id = me;
  delete from device_tokens where profile_id = me;

  update profiles set display_name = '', login_phone = null, email = null, photo_path = null, last_active_at = null, deleted_at = now() where id = me;
  update auth.users set phone = null, email = null, phone_confirmed_at = null, raw_user_meta_data = '{}', banned_at = now() where id = me;
  update auth.refresh_tokens set revoked_at = now() where user_id = me and revoked_at is null;

  return jsonb_build_object('deleted', true, 'trees_passed_on', passed, 'trees_closed', closed);
end $$;

-- ===== Grants =====

revoke all on function persons_use_profile_photo(), tree_members(uuid), tree_add_me(uuid, uuid, text, text, gender_t),
  claim_candidate_details(), admin_broadcast(text, text, text), account_delete(boolean)
  from public, anon, authenticated;
grant execute on function tree_members(uuid), tree_add_me(uuid, uuid, text, text, gender_t),
  claim_candidate_details(), admin_broadcast(text, text, text), account_delete(boolean)
  to authenticated;
