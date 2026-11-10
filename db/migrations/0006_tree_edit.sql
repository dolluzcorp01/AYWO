-- Editing, sharing, approvals, undo, merges and account functions (LLD L3 to L5, L11).
-- Every function here checks auth.uid() and rights itself, and does its work in the one transaction the API opened.
-- Contact values never go into a request payload, a notification, history or a list. Waiting phone numbers live in
-- a table no client can read.
create extension if not exists pgcrypto with schema extensions;

-- ===== New columns and tables =====

-- The Co-creator or successor a waiting request was passed to under the successor rule (F-SHR-08).
alter table requests add column routed_to uuid references profiles (id);
alter table shares add column expiry_notified_at timestamptz;

-- A share to a phone number with no account yet. Server only: no grant, no policy.
create table share_waiting_phones (
  share_id uuid primary key references shares (id) on delete cascade,
  phone text not null
);
create index share_waiting_phones_phone_idx on share_waiting_phones (phone);
alter table share_waiting_phones enable row level security;

-- What a merge changed outside the audited tables, so one undo restores it. Server only.
create table merge_log (
  batch_id uuid primary key,
  tree_id uuid not null references trees (id) on delete cascade,
  request_id uuid references requests (id) on delete set null,
  kept_id uuid not null references persons (id) on delete cascade,
  dropped_id uuid not null references persons (id) on delete cascade,
  kept_claim uuid references profiles (id),
  dropped_claim uuid references profiles (id),
  comment_ids uuid[] not null default '{}',
  scope_share_ids uuid[] not null default '{}',
  grantee_share_ids uuid[] not null default '{}',
  request_ids uuid[] not null default '{}',
  was_tree_person boolean not null default false,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
alter table merge_log enable row level security;

-- When a slow job last ran, so a restart neither skips nor repeats it. Server only.
create table job_runs (
  name text primary key,
  last_run_at timestamptz not null
);
alter table job_runs enable row level security;

create policy requests_read_routed on requests for select using (routed_to = auth.uid());

-- ===== A deleted tree gives nobody any rights =====

create or replace function tree_role(p_tree uuid, p_person uuid default null) returns tree_role_t
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  best tree_role_t := 'none';
  r share_role_t;
begin
  if me is null then return 'none'; end if;
  if not exists (select 1 from trees t where t.id = p_tree and t.deleted_at is null) then return 'none'; end if;
  if exists (select 1 from trees t where t.id = p_tree and t.creator_id = me) then
    return 'creator';
  end if;
  for r in
    select s.role from shares s
    where s.tree_id = p_tree and s.grantee_profile_id = me
      and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      and (s.scope_person_id is null or (p_person is not null and in_branch(s.scope_person_id, p_person)))
  loop
    if r::text::tree_role_t > best then best := r::text::tree_role_t; end if;
  end loop;
  if best < 'editor' and p_person is not null and exists (
    select 1 from persons c join person_closure pc on pc.ancestor_id = c.id
    where c.tree_id = p_tree and c.claimed_by = me and pc.descendant_id = p_person
  ) then
    best := 'editor';
  end if;
  if best = 'none' and exists (select 1 from persons c where c.tree_id = p_tree and c.claimed_by = me) then
    best := 'viewer';
  end if;
  return best;
end $$;

create or replace function can_view_tree(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tree_role(p_tree) <> 'none' or exists (
    select 1 from shares s join trees t on t.id = s.tree_id
    where s.tree_id = p_tree and s.grantee_profile_id = auth.uid() and t.deleted_at is null
      and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
  )
$$;

-- ===== Small helpers (internal) =====

create function creator_inactive(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(pr.last_active_at, pr.created_at) < now() - interval '180 days'
  from trees t join profiles pr on pr.id = t.creator_id where t.id = p_tree
$$;

create function can_decide_request(p_tree uuid, p_routed uuid) returns boolean
language sql stable security definer set search_path = public as $$
  -- Never null: a null here would slip past 'if not ...' in the callers.
  select is_creator_or_cocreator(p_tree) or (coalesce(p_routed = auth.uid(), false) and coalesce(creator_inactive(p_tree), false))
$$;

-- Only files the person uploaded themselves: a path into someone else's folder would get signed and served back.
create function photo_path_ok(p_path text, p_owner uuid) returns boolean
language sql immutable as $$
  select p_path is null or p_path ~ ('^photos/' || p_owner::text || '/[A-Za-z0-9-]+\.[a-z0-9]{1,8}$')
$$;

-- The only person fields a change may carry. Contacts are not among them, so they can never sit in a payload.
create function clean_person_fields(p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k text;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k <> all (array['display_name', 'name_unknown', 'note_label', 'gender', 'living', 'birth_date', 'death_date',
                       'birth_precision', 'death_precision', 'birth_place', 'death_place', 'birth_order', 'notes', 'photo_path']) then
      raise exception 'bad_input' using errcode = 'PT422';
    end if;
  end loop;
  if p_fields ? 'display_name' and coalesce(trim(p_fields ->> 'display_name'), '') = '' then
    raise exception 'name_required' using errcode = 'PT422';
  end if;
  if char_length(coalesce(p_fields ->> 'display_name', '')) > 200 or char_length(coalesce(p_fields ->> 'note_label', '')) > 200
     or char_length(coalesce(p_fields ->> 'birth_place', '')) > 300 or char_length(coalesce(p_fields ->> 'death_place', '')) > 300
     or char_length(coalesce(p_fields ->> 'notes', '')) > 10000 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  begin
    perform (p_fields ->> 'name_unknown')::boolean, (p_fields ->> 'gender')::gender_t, (p_fields ->> 'living')::living_t,
            (p_fields ->> 'birth_date')::date, (p_fields ->> 'death_date')::date,
            (p_fields ->> 'birth_precision')::date_prec_t, (p_fields ->> 'death_precision')::date_prec_t,
            (p_fields ->> 'birth_order')::smallint;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'bad_input' using errcode = 'PT422';
  end;
  return p_fields;
end $$;

create function apply_person_fields(p_person uuid, p_version int, f jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  new_version int;
begin
  -- A stale version makes check_version raise version_conflict (PT409).
  update persons set
    display_name = case when f ? 'display_name' then trim(f ->> 'display_name') else display_name end,
    name_unknown = case when f ? 'name_unknown' then coalesce((f ->> 'name_unknown')::boolean, false) else name_unknown end,
    note_label = case when f ? 'note_label' then f ->> 'note_label' else note_label end,
    gender = case when f ? 'gender' then coalesce((f ->> 'gender')::gender_t, 'unknown') else gender end,
    living = case when f ? 'living' then coalesce((f ->> 'living')::living_t, 'unknown') else living end,
    birth_date = case when f ? 'birth_date' then (f ->> 'birth_date')::date else birth_date end,
    death_date = case when f ? 'death_date' then (f ->> 'death_date')::date else death_date end,
    birth_precision = case when f ? 'birth_precision' then (f ->> 'birth_precision')::date_prec_t else birth_precision end,
    death_precision = case when f ? 'death_precision' then (f ->> 'death_precision')::date_prec_t else death_precision end,
    birth_place = case when f ? 'birth_place' then f ->> 'birth_place' else birth_place end,
    death_place = case when f ? 'death_place' then f ->> 'death_place' else death_place end,
    birth_order = case when f ? 'birth_order' then (f ->> 'birth_order')::smallint else birth_order end,
    photo_path = case when f ? 'photo_path' then f ->> 'photo_path' else photo_path end,
    notes = case when f ? 'notes' then f ->> 'notes' else notes end,
    version = p_version
  where id = p_person and deleted_at is null
  returning version into new_version;
  if new_version is null then
    raise exception 'person_not_found' using errcode = 'PT404';
  end if;
  return new_version;
end $$;

-- Soft delete, with the person's links and couples removed in the same batch so one undo brings all of it back.
create function apply_person_delete(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from parent_child where parent_id = p_person or child_id = p_person;
  delete from unions where partner1_id = p_person or partner2_id = p_person;
  update persons set deleted_at = now() where id = p_person and deleted_at is null;
  if not found then
    raise exception 'person_not_found' using errcode = 'PT404';
  end if;
end $$;

-- The ordering step of set_elder_younger, without its rights check: the decider has already passed theirs.
create function apply_elder_younger(p_person uuid, p_than uuid, p_elder boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  ordered uuid[];
  pos int;
begin
  if p_person = p_than or not exists (
    select 1 from parent_child a
    join parent_child b on a.parent_id = b.parent_id
    join persons x on x.id = a.child_id and x.deleted_at is null
    join persons y on y.id = b.child_id and y.deleted_at is null
    where a.child_id = p_person and b.child_id = p_than
  ) then
    raise exception 'not_siblings' using errcode = 'PT422';
  end if;
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
  for i in 1 .. array_length(ordered, 1) loop
    update persons set birth_order = i where id = ordered[i] and birth_order is distinct from i;
  end loop;
end $$;

-- ===== Account =====

create function my_account() returns jsonb
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
    'language_code', p.language_code, 'large_text', p.large_text,
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

-- Email is contact only. Nothing here gives rights: claims and shares match the OTP-verified phone alone.
create function me_update(p_patch jsonb) returns jsonb
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
  update profiles set
    display_name = case when p_patch ? 'display_name' then trim(p_patch ->> 'display_name') else display_name end,
    email = case when p_patch ? 'email' then lower(trim(p_patch ->> 'email')) else email end,
    language_code = case when p_patch ? 'language_code' then p_patch ->> 'language_code' else language_code end,
    large_text = case when p_patch ? 'large_text' then coalesce((p_patch ->> 'large_text')::boolean, false) else large_text end
  where id = me and deleted_at is null;
  return my_account();
end $$;

create function my_trees() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  update profiles set last_active_at = now()
  where id = me and (last_active_at is null or last_active_at < now() - interval '1 hour');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'name', x.name, 'role', x.role_now, 'joined', x.joined, 'branch_only', x.whole_role = 'none',
      'people', case when x.whole_role <> 'none'
        then (select count(*) from persons p where p.tree_id = x.id and p.deleted_at is null)
        else (select count(*) from persons p where p.tree_id = x.id and p.deleted_at is null and tree_role(x.id, p.id) <> 'none')
      end
    ) order by x.joined desc)
    from (
      select t.id, t.name, tree_role(t.id) as whole_role,
        greatest(tree_role(t.id), (
          select max(s.role::text::tree_role_t) from shares s
          where s.tree_id = t.id and s.grantee_profile_id = me and s.revoked_at is null
            and (s.expires_at is null or s.expires_at > now())
        )) as role_now,
        case when t.creator_id = me then t.created_at else coalesce((
          select min(s.created_at) from shares s
          where s.tree_id = t.id and s.grantee_profile_id = me and s.revoked_at is null
        ), t.created_at) end as joined
      from trees t
      where t.deleted_at is null and (
        t.creator_id = me
        or exists (
          select 1 from shares s where s.tree_id = t.id and s.grantee_profile_id = me and s.revoked_at is null
            and (s.expires_at is null or s.expires_at > now())
        )
        or exists (select 1 from persons c where c.tree_id = t.id and c.claimed_by = me)
      )
    ) x
  ), '[]'::jsonb);
end $$;

-- A new tree starts with the Creator's own card, because add_relative needs someone to add relatives to.
create function tree_create(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_name text;
  new_tree uuid;
  new_person uuid;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if coalesce(trim(p_name), '') = '' or char_length(p_name) > 200 then
    raise exception 'name_required' using errcode = 'PT422';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  select coalesce(nullif(trim(display_name), ''), 'Name unknown') into my_name from profiles where id = me and deleted_at is null;
  if my_name is null then
    raise exception 'session_ended' using errcode = 'PT401';
  end if;
  insert into trees (name, creator_id) values (trim(p_name), me) returning id into new_tree;
  insert into persons (tree_id, display_name, name_unknown, living, claimed_by, created_by)
  values (new_tree, my_name, my_name = 'Name unknown', 'living', me, me)
  returning id into new_person;
  update trees set creator_person_id = new_person where id = new_tree;
  return jsonb_build_object('id', new_tree, 'person_id', new_person);
end $$;

-- L4.2: name and successor, Creator only. A successor must already belong to the tree.
create function tree_update(p_tree uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  heir uuid;
begin
  if not exists (select 1 from trees where id = p_tree and creator_id = auth.uid() and deleted_at is null) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_patch ? 'name' and (coalesce(trim(p_patch ->> 'name'), '') = '' or char_length(p_patch ->> 'name') > 200) then
    raise exception 'name_required' using errcode = 'PT422';
  end if;
  if p_patch ? 'successor_id' then
    heir := (p_patch ->> 'successor_id')::uuid;
    if heir is not null and (heir = auth.uid() or not (
      exists (
        select 1 from shares s where s.tree_id = p_tree and s.grantee_profile_id = heir and s.revoked_at is null
          and (s.expires_at is null or s.expires_at > now())
      )
      or exists (select 1 from persons c where c.tree_id = p_tree and c.claimed_by = heir)
    )) then
      raise exception 'successor_not_in_tree' using errcode = 'PT422';
    end if;
    update trees set successor_id = heir where id = p_tree;
    if heir is not null then
      insert into notifications (recipient_id, kind, payload)
      values (heir, 'successor_named', jsonb_build_object('tree_id', p_tree));
    end if;
  end if;
  if p_patch ? 'name' then
    update trees set name = trim(p_patch ->> 'name') where id = p_tree;
  end if;
end $$;

create function tree_delete(p_tree uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from trees where id = p_tree and creator_id = auth.uid() and deleted_at is null) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  insert into notifications (recipient_id, kind, payload)
  select distinct s.grantee_profile_id, 'tree_deleted', jsonb_build_object('tree_id', p_tree)
  from shares s
  where s.tree_id = p_tree and s.grantee_profile_id is not null and s.grantee_profile_id <> auth.uid()
    and s.revoked_at is null and (s.expires_at is null or s.expires_at > now());
  delete from share_waiting_phones w using shares s where w.share_id = s.id and s.tree_id = p_tree;
  update shares set revoked_at = now() where tree_id = p_tree and revoked_at is null;
  update trees set deleted_at = now() where id = p_tree;
end $$;

-- F-ACC-08. The account goes for good. A tree passes to the successor, then the longest-standing Co-creator;
-- with neither, it is deleted. The profile row stays, blank, because history and other people's rows point at it.
create function account_delete() returns jsonb
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
  update persons set claimed_by = null where claimed_by = me;
  update trees set successor_id = null where successor_id = me;

  update shares set revoked_at = now() where grantee_profile_id = me and revoked_at is null;
  update requests set status = 'expired', decided_at = now(), note = 'account_deleted' where requester_id = me and status = 'pending';
  delete from comments where author_id = me;
  delete from notifications where recipient_id = me;
  delete from notification_prefs where profile_id = me;
  delete from consents where profile_id = me;
  delete from family_plan_members where profile_id = me;

  update profiles set display_name = '', login_phone = null, email = null, last_active_at = null, deleted_at = now() where id = me;
  update auth.users set phone = null, email = null, phone_confirmed_at = null, raw_user_meta_data = '{}', banned_at = now() where id = me;
  update auth.refresh_tokens set revoked_at = now() where user_id = me and revoked_at is null;

  return jsonb_build_object('deleted', true, 'trees_passed_on', passed, 'trees_closed', closed);
end $$;

-- Everything held about the caller, for the 'download my data' file. Only their own contact values.
create function account_export() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  return jsonb_build_object(
    'profile', (select to_jsonb(p) from profiles p where p.id = me),
    'consents', coalesce((select jsonb_agg(to_jsonb(c)) from consents c where c.profile_id = me), '[]'::jsonb),
    'notification_prefs', coalesce((select jsonb_agg(to_jsonb(n)) from notification_prefs n where n.profile_id = me), '[]'::jsonb),
    'trees_created', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'created_at', t.created_at)) from trees t where t.creator_id = me and t.deleted_at is null), '[]'::jsonb),
    'my_entries', coalesce((
      select jsonb_agg(to_jsonb(p) || jsonb_build_object('contacts', coalesce((
        select jsonb_agg(jsonb_build_object('kind', c.kind, 'value', c.value)) from person_contacts c where c.person_id = p.id
      ), '[]'::jsonb)))
      from persons p where p.claimed_by = me and p.deleted_at is null
    ), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('person_id', c.person_id, 'body', c.body, 'created_at', c.created_at)) from comments c where c.author_id = me), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('tree_id', q.tree_id, 'kind', q.kind, 'status', q.status, 'created_at', q.created_at)) from requests q where q.requester_id = me), '[]'::jsonb),
    'shares_with_me', coalesce((select jsonb_agg(jsonb_build_object('tree_id', s.tree_id, 'role', s.role, 'created_at', s.created_at, 'revoked_at', s.revoked_at)) from shares s where s.grantee_profile_id = me), '[]'::jsonb),
    'exported_at', now()
  );
end $$;

-- ===== Persons =====

-- F-SHR-05 and T-SHR-01: everyone who can see a person can suggest a change. Nothing changes until it is decided.
-- payload: {table: 'persons', op: 'update'|'delete', row_id, before_version, data} or {action: 'add_relative', ...}.
create function request_change(p_person uuid, p_payload jsonb) returns uuid
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
      'union', p_payload ->> 'union', 'link_kind', coalesce((p_payload ->> 'link_kind')::link_kind_t, 'birth'));

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

-- PATCH /persons/:id. Writes for those who may; files a request for everyone else who can see the person.
create function person_update(p_person uuid, p_version int, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  current_photo text;
  req uuid;
  new_version int;
begin
  select tree_id, photo_path into tree, current_photo from persons where id = p_person and deleted_at is null;
  if tree is null or tree_role(tree, p_person) = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  perform clean_person_fields(p_fields);
  if p_fields ? 'photo_path' and (p_fields ->> 'photo_path') is distinct from current_photo and not photo_path_ok(p_fields ->> 'photo_path', me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if not can_edit(tree, p_person) then
    req := request_change(p_person, jsonb_build_object('table', 'persons', 'op', 'update', 'before_version', p_version, 'data', p_fields));
    return jsonb_build_object('status', 'requested', 'request_id', req);
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  new_version := apply_person_fields(p_person, p_version, p_fields);
  return jsonb_build_object('status', 'saved', 'id', p_person, 'version', new_version);
end $$;

-- DELETE /persons/:id. A branch editor cannot reach past the branch through a link, a couple or a registered person.
create function person_delete(p_person uuid, p_version int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tree uuid;
  claimed uuid;
  current_version int;
  req uuid;
begin
  select tree_id, claimed_by, version into tree, claimed, current_version from persons where id = p_person and deleted_at is null;
  if tree is null or tree_role(tree, p_person) = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if not can_edit(tree, p_person) then
    req := request_change(p_person, jsonb_build_object('table', 'persons', 'op', 'delete', 'before_version', coalesce(p_version, current_version)));
    return jsonb_build_object('status', 'requested', 'request_id', req);
  end if;
  if p_version is not null and p_version <> current_version then
    raise exception 'version_conflict' using errcode = 'PT409';
  end if;
  if claimed is not null and not is_creator_or_cocreator(tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if exists (select 1 from parent_child l where (l.parent_id = p_person or l.child_id = p_person) and not can_edit(tree, l.child_id))
     or exists (select 1 from unions u where p_person in (u.partner1_id, u.partner2_id) and not can_edit(tree, u.partner1_id)) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  perform apply_person_delete(p_person);
  return jsonb_build_object('status', 'saved', 'id', p_person);
end $$;

-- For the edit form. The form needs the rows, but editing rights do not open a locked number (F-CON-02, F-CON-03):
-- the value comes back only if the caller's contact access is open, or the caller typed it in. Otherwise value is null.
create function contacts_for_edit(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  access text := contact_access(p_person);
begin
  select tree_id into tree from persons where id = p_person and deleted_at is null;
  if tree is null or not can_edit(tree, p_person) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'kind', c.kind,
      'value', case when access in ('self', 'open') or c.created_by = me then c.value end,
      'value_normalized', case when access in ('self', 'open') or c.created_by = me then c.value_normalized end
    ))
    from person_contacts c where c.person_id = p_person
  ), '[]'::jsonb);
end $$;

create function person_comments(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tree uuid;
begin
  select tree_id into tree from persons where id = p_person and deleted_at is null;
  if tree is null or tree_role(tree, p_person) = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'person_id', c.person_id, 'author_id', c.author_id, 'author_name', a.display_name,
      'body', c.body, 'resolved_at', c.resolved_at, 'created_at', c.created_at
    ) order by c.created_at)
    from comments c join profiles a on a.id = c.author_id where c.person_id = p_person
  ), '[]'::jsonb);
end $$;

-- L11: a comment tells the Creator. The body stays out of the notification.
create function comment_add(p_person uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  tree_creator uuid;
  new_id uuid;
begin
  select tree_id into tree from persons where id = p_person and deleted_at is null;
  if tree is null or tree_role(tree, p_person) < 'commenter' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'comment_empty' using errcode = 'PT422';
  end if;
  insert into comments (tree_id, person_id, author_id, body) values (tree, p_person, me, trim(p_body)) returning id into new_id;
  select creator_id into tree_creator from trees where id = tree;
  if tree_creator <> me then
    insert into notifications (recipient_id, kind, payload)
    values (tree_creator, 'comment_added', jsonb_build_object('tree_id', tree, 'person_id', p_person, 'comment_id', new_id));
  end if;
  return jsonb_build_object('id', new_id);
end $$;

-- ===== Sharing =====

create function new_link_token() returns text
language sql volatile security definer set search_path = public as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_')
$$;

-- F-SHR-01/02/04. A link only ever opens the outsider view (view-by-link), so a named share's role reaches only the
-- named account. A phone with no account waits in share_waiting_phones until that number signs up.
-- Nothing in the answer says whether the number has an account.
create function share_create(
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

create function share_update(p_share uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  s shares;
  new_role share_role_t;
begin
  select * into s from shares where id = p_share for update;
  if s.id is null or not is_creator_or_cocreator(s.tree_id) or s.revoked_at is not null then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  new_role := case when p_patch ? 'role' then (p_patch ->> 'role')::share_role_t else s.role end;
  if p_patch ? 'expires_at' and p_patch ->> 'expires_at' is not null and (p_patch ->> 'expires_at')::timestamptz <= now() then
    raise exception 'expiry_in_past' using errcode = 'PT422';
  end if;
  update shares set
    role = new_role,
    edit_mode = case when new_role <> 'editor' then 'direct'::edit_mode_t
                     when p_patch ? 'edit_mode' then (p_patch ->> 'edit_mode')::edit_mode_t else edit_mode end,
    contacts_visible = case when p_patch ? 'contacts_visible' then coalesce((p_patch ->> 'contacts_visible')::boolean, false) else contacts_visible end,
    expires_at = case when p_patch ? 'expires_at' then (p_patch ->> 'expires_at')::timestamptz else expires_at end,
    expiry_notified_at = case when p_patch ? 'expires_at' then null else expiry_notified_at end
  where id = p_share;
end $$;

-- Those who run the tree may revoke any share. Anyone may leave a share given to them.
create function share_revoke(p_share uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  s shares;
begin
  select * into s from shares where id = p_share for update;
  if s.id is null or not (is_creator_or_cocreator(s.tree_id) or s.grantee_profile_id = auth.uid()) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if s.revoked_at is not null then return; end if;
  update shares set revoked_at = now() where id = p_share;
  delete from share_waiting_phones where share_id = p_share;
  if s.grantee_profile_id is not null and s.grantee_profile_id <> auth.uid() then
    insert into notifications (recipient_id, kind, payload)
    values (s.grantee_profile_id, 'share_revoked', jsonb_build_object('tree_id', s.tree_id, 'share_id', s.id));
  end if;
end $$;

-- A waiting number appears only with its last four digits.
create function tree_shares(p_tree uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  manages boolean := is_creator_or_cocreator(p_tree);
begin
  if not manages and not can_view_tree(p_tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'tree_id', s.tree_id, 'scope_person_id', s.scope_person_id, 'scope_name', sp.display_name,
      'grantee_profile_id', s.grantee_profile_id, 'grantee_name', g.display_name,
      'grantee_person_id', s.grantee_person_id, 'grantee_person_name', gp.display_name,
      'waiting_phone', case when w.phone is null then null else '******' || right(w.phone, 4) end,
      'link_token', case when manages then s.link_token end,
      'role', s.role, 'edit_mode', s.edit_mode, 'contacts_visible', s.contacts_visible,
      'expires_at', s.expires_at, 'created_by', s.created_by, 'created_at', s.created_at,
      'expired', s.expires_at is not null and s.expires_at <= now()
    ) order by s.created_at desc)
    from shares s
    left join persons sp on sp.id = s.scope_person_id
    left join persons gp on gp.id = s.grantee_person_id
    left join profiles g on g.id = s.grantee_profile_id
    left join share_waiting_phones w on w.share_id = s.id
    where s.tree_id = p_tree and s.revoked_at is null and (manages or s.grantee_profile_id = me)
  ), '[]'::jsonb);
end $$;

-- A number that has just signed up picks up the shares waiting for it.
create function share_resolve_waiting() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s shares;
begin
  if not exists (select 1 from auth.users u where u.id = new.id and u.phone_confirmed_at is not null) then
    return null;
  end if;
  for s in
    select x.* from shares x join share_waiting_phones w on w.share_id = x.id
    where w.phone = new.login_phone and x.revoked_at is null and (x.expires_at is null or x.expires_at > now())
      and x.grantee_profile_id is null
  loop
    update shares set grantee_profile_id = new.id where id = s.id;
    insert into notifications (recipient_id, kind, payload)
    values (new.id, 'share_received', jsonb_build_object('tree_id', s.tree_id, 'share_id', s.id, 'role', s.role));
  end loop;
  delete from share_waiting_phones where phone = new.login_phone;
  return null;
end $$;
create trigger profiles_share_waiting after insert or update of login_phone on profiles
  for each row when (new.login_phone is not null) execute function share_resolve_waiting();

-- A share meant for a person reaches whoever verifiably claims them, and leaves if that claim is undone.
create function share_follow_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.claimed_by is not null then
    update shares set grantee_profile_id = null
    where grantee_person_id = new.id and grantee_profile_id = old.claimed_by;
  end if;
  if new.claimed_by is not null then
    update shares set grantee_profile_id = new.claimed_by
    where grantee_person_id = new.id and grantee_profile_id is null and revoked_at is null;
  end if;
  return null;
end $$;
create trigger persons_share_claim after update of claimed_by on persons
  for each row when (old.claimed_by is distinct from new.claimed_by) execute function share_follow_claim();

-- ===== Requests =====

-- F-SHR-03: 'Request edit access', or a higher role. Contacts go through request_contacts. Asking twice stays one.
create function request_access(p_tree uuid, p_kind request_kind_t, p_person uuid default null, p_payload jsonb default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  existing uuid;
  wanted text;
begin
  if p_kind not in ('access_edit', 'role_upgrade') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if not can_view_tree(p_tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_person is not null and not exists (select 1 from persons where id = p_person and tree_id = p_tree and deleted_at is null) then
    raise exception 'not_in_this_tree' using errcode = 'PT422';
  end if;
  wanted := p_payload ->> 'role';
  if p_kind = 'role_upgrade' and wanted is null then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if wanted is not null then
    perform wanted::share_role_t;
  end if;
  select id into existing from requests
  where tree_id = p_tree and requester_id = me and kind = p_kind and status = 'pending'
    and target_person_id is not distinct from p_person;
  if existing is not null then return existing; end if;
  insert into requests (tree_id, kind, requester_id, target_person_id, payload)
  values (p_tree, p_kind, me, p_person, case when wanted is null then null else jsonb_build_object('role', wanted) end)
  returning id into existing;
  perform notify_tree_managers(p_tree, 'request_created', jsonb_build_object('request_id', existing, 'kind', p_kind, 'tree_id', p_tree));
  return existing;
end $$;

-- Gives the requester a share, or raises the one they have for that branch. Approving never lowers a role.
-- Edit access is 'approval' mode unless the decider says 'direct': the safer one is the one a single tap gives.
create function grant_from_request(q requests, p_role share_role_t, edited jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  scope uuid;
  mode_given edit_mode_t := (edited ->> 'edit_mode')::edit_mode_t;
  ends_at timestamptz := (edited ->> 'expires_at')::timestamptz;
  s shares;
  final_role share_role_t;
begin
  scope := case when coalesce(edited ? 'scope_person_id', false) then (edited ->> 'scope_person_id')::uuid else q.target_person_id end;
  if scope is not null and not exists (select 1 from persons where id = scope and tree_id = q.tree_id and deleted_at is null) then
    raise exception 'not_in_this_tree' using errcode = 'PT422';
  end if;
  select * into s from shares
  where tree_id = q.tree_id and grantee_profile_id = q.requester_id and scope_person_id is not distinct from scope
    and revoked_at is null and (expires_at is null or expires_at > now())
  order by created_at desc limit 1;
  if s.id is null then
    insert into shares (tree_id, scope_person_id, grantee_profile_id, role, edit_mode, expires_at, created_by)
    values (q.tree_id, scope, q.requester_id, p_role,
            case when p_role = 'editor' then coalesce(mode_given, 'approval') else 'direct' end, ends_at, me);
  else
    final_role := greatest(s.role, p_role);
    update shares set
      role = final_role,
      edit_mode = case when final_role <> 'editor' then 'direct'::edit_mode_t
                       when mode_given is not null then mode_given
                       when s.role = 'editor' then s.edit_mode
                       else 'approval' end,
      expires_at = coalesce(ends_at, expires_at)
    where id = s.id;
  end if;
end $$;

-- Applies one approved change as the decider. The rights were checked by requests_decide.
create function apply_change(q requests, edited jsonb) returns void
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
                         (p ->> 'union')::uuid, coalesce((p ->> 'link_kind')::link_kind_t, 'birth'));
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

-- POST /requests/:id/decide. Approve or decline in one transaction; a clash rolls the whole approval back.
create function requests_decide(p_request uuid, p_decision text, p_edited jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  q requests;
  new_state request_state_t;
  wanted share_role_t;
begin
  select * into q from requests where id = p_request for update;
  if q.id is null or not can_decide_request(q.tree_id, q.routed_to) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_decision not in ('approve', 'decline') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if q.status <> 'pending' then
    raise exception 'already_decided' using errcode = 'PT409';
  end if;
  -- Nobody grants themselves anything. Merge candidates are filed in the Creator's name by the scan, so they are exempt.
  if q.requester_id = me and q.kind <> 'merge' then
    raise exception 'cannot_decide_own' using errcode = 'PT403';
  end if;
  if p_edited is not null and jsonb_typeof(p_edited) <> 'object' then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;

  if p_decision = 'decline' then
    new_state := 'declined';
  else
    new_state := 'applied';
    if q.kind = 'change' then
      perform apply_change(q, p_edited);
    elsif q.kind = 'access_edit' then
      perform grant_from_request(q, 'editor', p_edited);
    elsif q.kind = 'role_upgrade' then
      wanted := coalesce(p_edited ->> 'role', q.payload ->> 'role')::share_role_t;
      if wanted is null then
        raise exception 'bad_input' using errcode = 'PT422';
      end if;
      perform grant_from_request(q, wanted, p_edited);
    elsif q.kind = 'merge' then
      perform merge_persons(q, (p_edited ->> 'keep')::uuid);
    end if;
    -- access_contacts needs no more than the state below: contact_access reads the request.
  end if;

  update requests set status = new_state, decided_by = me, decided_at = now() where id = p_request;
  if q.requester_id <> me then
    insert into notifications (recipient_id, kind, payload)
    values (q.requester_id, 'request_decided', jsonb_build_object(
      'request_id', q.id, 'kind', q.kind, 'tree_id', q.tree_id, 'decision', p_decision));
  end if;
  return jsonb_build_object('status', new_state, 'request_id', q.id);
end $$;

-- ===== History and undo =====

create function history_list(p_tree uuid, p_person uuid default null, p_limit int default 100, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tree_role(p_tree) >= 'editor' or (p_person is not null and tree_role(p_tree, p_person) >= 'editor')) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_person is not null and not exists (select 1 from persons where id = p_person and tree_id = p_tree) then
    raise exception 'not_in_this_tree' using errcode = 'PT422';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'table_name', x.table_name, 'row_id', x.row_id, 'op', x.op, 'at', x.at, 'batch_id', x.batch_id,
      'actor_id', x.actor_id, 'actor_name', a.display_name, 'reverted_by', x.reverted_by,
      'before', case when x.table_name = 'person_contacts' then null else x.before end,
      'after', case when x.table_name = 'person_contacts' then null else x.after end,
      'contact_kind', case when x.table_name = 'person_contacts' then coalesce(x.after, x.before) ->> 'kind' end,
      'can_revert', x.reverted_by is null and x.table_name <> 'person_contacts'
    ) order by x.id desc)
    from (
      select h.* from history h
      where h.tree_id = p_tree and (p_before is null or h.id < p_before)
        and (p_person is null
          or (h.table_name = 'persons' and h.row_id = p_person)
          or (h.table_name = 'person_contacts' and coalesce(h.after, h.before) ->> 'person_id' = p_person::text)
          or (h.table_name = 'unions' and p_person::text in (coalesce(h.after, h.before) ->> 'partner1_id', coalesce(h.after, h.before) ->> 'partner2_id'))
          or (h.table_name = 'parent_child' and p_person::text in (coalesce(h.after, h.before) ->> 'parent_id', coalesce(h.after, h.before) ->> 'child_id')))
      order by h.id desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) x
    left join profiles a on a.id = x.actor_id
  ), '[]'::jsonb);
end $$;

-- Which person a history row's rights hang on: the same ones the row rules use.
create function history_rights_person(h history) returns uuid
language sql immutable as $$
  select case h.table_name
    when 'persons' then h.row_id
    when 'unions' then (coalesce(h.after, h.before) ->> 'partner1_id')::uuid
    when 'parent_child' then (coalesce(h.after, h.before) ->> 'child_id')::uuid
    when 'person_contacts' then (coalesce(h.after, h.before) ->> 'person_id')::uuid
  end
$$;

create function revert_history_row(h history, p_in_merge boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  pr persons;
  un unions;
  pc parent_child;
begin
  if h.table_name = 'person_contacts' then
    -- The history holds no value, so a contact cannot come back from it. Only a merge's repoint can be undone,
    -- since that moves a row which still holds its value.
    if not p_in_merge or h.op <> 'update' then
      raise exception 'contact_history_locked' using errcode = 'PT422';
    end if;
    update person_contacts set person_id = (h.before ->> 'person_id')::uuid where id = h.row_id;

  elsif h.table_name = 'persons' then
    if h.op = 'insert' then
      if exists (select 1 from persons where id = h.row_id and claimed_by is not null and claimed_by <> auth.uid())
         or exists (select 1 from person_contacts where person_id = h.row_id)
         or exists (select 1 from comments where person_id = h.row_id) then
        raise exception 'person_in_use' using errcode = 'PT409';
      end if;
      update shares set grantee_person_id = null where grantee_person_id = h.row_id;
      delete from persons where id = h.row_id;
    else
      pr := jsonb_populate_record(null::persons, h.before);
      if h.op = 'update' then
        -- claimed_by is not restored: who a person is belongs to claim_confirm and claim_undo alone.
        update persons set display_name = pr.display_name, name_unknown = pr.name_unknown, note_label = pr.note_label,
          gender = pr.gender, living = pr.living, birth_date = pr.birth_date, death_date = pr.death_date,
          birth_precision = pr.birth_precision, death_precision = pr.death_precision, birth_place = pr.birth_place,
          death_place = pr.death_place, birth_order = pr.birth_order, photo_path = pr.photo_path, notes = pr.notes,
          deleted_at = pr.deleted_at
        where id = h.row_id;
      else
        insert into persons (id, tree_id, display_name, name_unknown, note_label, gender, living, birth_date, death_date,
                             birth_precision, death_precision, birth_place, death_place, birth_order, photo_path, notes,
                             created_by, version, created_at, updated_at, deleted_at)
        values (pr.id, pr.tree_id, pr.display_name, pr.name_unknown, pr.note_label, pr.gender, pr.living, pr.birth_date, pr.death_date,
                pr.birth_precision, pr.death_precision, pr.birth_place, pr.death_place, pr.birth_order, pr.photo_path, pr.notes,
                pr.created_by, pr.version, pr.created_at, pr.updated_at, pr.deleted_at);
      end if;
    end if;

  elsif h.table_name = 'unions' then
    if h.op = 'insert' then
      delete from unions where id = h.row_id;
    else
      un := jsonb_populate_record(null::unions, h.before);
      if h.op = 'update' then
        update unions set partner1_id = un.partner1_id, partner2_id = un.partner2_id, kind = un.kind, status = un.status,
          seq1 = un.seq1, seq2 = un.seq2, start_date = un.start_date, end_date = un.end_date
        where id = h.row_id;
      else
        insert into unions (id, tree_id, partner1_id, partner2_id, kind, status, seq1, seq2, start_date, end_date, version)
        values (un.id, un.tree_id, un.partner1_id, un.partner2_id, un.kind, un.status, un.seq1, un.seq2, un.start_date, un.end_date, un.version);
      end if;
    end if;

  elsif h.table_name = 'parent_child' then
    if h.op = 'insert' then
      delete from parent_child where id = h.row_id;
    else
      pc := jsonb_populate_record(null::parent_child, h.before);
      if h.op = 'update' then
        update parent_child set parent_id = pc.parent_id, child_id = pc.child_id, union_id = pc.union_id, kind = pc.kind where id = h.row_id;
      else
        insert into parent_child (id, tree_id, parent_id, child_id, union_id, kind)
        values (pc.id, pc.tree_id, pc.parent_id, pc.child_id, pc.union_id, pc.kind);
      end if;
    end if;

  else
    raise exception 'cannot_revert' using errcode = 'PT422';
  end if;
end $$;

-- T-SHR-04: one row or a whole batch, all or nothing. The caller must be able to write every row it touches, so an
-- approval-mode editor cannot undo at all and a branch editor cannot undo past the branch.
create function history_revert(p_history bigint default null, p_batch uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  new_batch uuid := gen_random_uuid();
  h history;
  ml merge_log;
  in_merge boolean := false;
  tree uuid;
  new_row bigint;
  n int := 0;
begin
  if (p_history is null) = (p_batch is null) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;

  if p_history is not null then
    select * into h from history where id = p_history;
    if h.id is null then
      raise exception 'history_not_found' using errcode = 'PT404';
    end if;
    if not can_edit(h.tree_id, history_rights_person(h)) then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    if h.reverted_by is not null then
      raise exception 'already_reverted' using errcode = 'PT409';
    end if;
    if h.table_name = 'person_contacts' then
      raise exception 'contact_history_locked' using errcode = 'PT422';
    end if;
    if exists (select 1 from merge_log m where m.batch_id = h.batch_id and m.undone_at is null) then
      raise exception 'revert_whole_merge' using errcode = 'PT422';
    end if;
  else
    select * into ml from merge_log where batch_id = p_batch and undone_at is null;
    in_merge := ml.batch_id is not null;
    if not exists (select 1 from history where batch_id = p_batch) then
      raise exception 'history_not_found' using errcode = 'PT404';
    end if;
  end if;

  -- All the checks first: the person rows they look at may be gone once the undo has started.
  for h in
    select * from history x
    where (x.id = p_history or x.batch_id = p_batch) and x.reverted_by is null
    order by x.id desc
  loop
    tree := h.tree_id;
    if not can_edit(h.tree_id, history_rights_person(h)) then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    if h.table_name = 'person_contacts' and not (in_merge and h.op = 'update') then
      raise exception 'contact_history_locked' using errcode = 'PT422';
    end if;
    -- Newer work on the same row would be silently lost. It has to be undone first.
    if exists (
      select 1 from history l
      where l.table_name = h.table_name and l.row_id = h.row_id and l.id > h.id and l.batch_id <> h.batch_id
        and l.reverted_by is null and not exists (select 1 from history r where r.reverted_by = l.id)
    ) then
      raise exception 'changed_since' using errcode = 'PT409';
    end if;
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'already_reverted' using errcode = 'PT409';
  end if;

  perform set_config('aywo.batch_id', new_batch::text, true);
  for h in
    select * from history x
    where (x.id = p_history or x.batch_id = p_batch) and x.reverted_by is null
    order by x.id desc
  loop
    perform revert_history_row(h, in_merge);
    select max(x.id) into new_row from history x
    where x.batch_id = new_batch and x.table_name = h.table_name and x.row_id = h.row_id;
    update history set reverted_by = new_row where id = h.id;
  end loop;

  if in_merge then
    update comments set person_id = ml.dropped_id where id = any (ml.comment_ids);
    update shares set scope_person_id = ml.dropped_id where id = any (ml.scope_share_ids);
    update shares set grantee_person_id = ml.dropped_id where id = any (ml.grantee_share_ids);
    update requests set target_person_id = ml.dropped_id where id = any (ml.request_ids);
    if ml.was_tree_person then
      update trees set creator_person_id = ml.dropped_id where id = ml.tree_id;
    end if;
    update persons set claimed_by = null where id = ml.kept_id and claimed_by is distinct from ml.kept_claim;
    update persons set claimed_by = ml.dropped_claim where id = ml.dropped_id and claimed_by is distinct from ml.dropped_claim;
    update persons set claimed_by = ml.kept_claim where id = ml.kept_id and claimed_by is distinct from ml.kept_claim;
    update merge_log set undone_at = now() where batch_id = ml.batch_id;
    update requests set note = 'undone' where id = ml.request_id;
  end if;

  -- Undoing an import leaves no people, and the empty tree should not stay on anyone's Home.
  if exists (select 1 from imports i where i.tree_id = tree and i.status = 'committed')
     and not exists (select 1 from persons p where p.tree_id = tree and p.deleted_at is null) then
    update imports set status = 'reverted' where tree_id = tree and status = 'committed';
    update trees set deleted_at = now() where id = tree;
  end if;

  return jsonb_build_object('reverted', n, 'batch_id', new_batch);
end $$;

-- ===== Merges (F-REPO-02/03) =====
-- Within one tree. Candidates come from the scan, which also runs on demand through merge_scan.

-- Name carries at most 0.6, so a name alone can never pass 0.85: something else has to agree as well.
create function merge_score(p_a uuid, p_b uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  a persons;
  b persons;
  name_part numeric;
  s numeric;
  pa uuid[];
  pb uuid[];
  sa uuid[];
  sb uuid[];
begin
  select * into a from persons where id = p_a;
  select * into b from persons where id = p_b;
  name_part := case when a.name_normalized = b.name_normalized then 1
                    else extensions.similarity(a.name_normalized, b.name_normalized) end;
  s := name_part * 0.6;

  if a.birth_date is not null and b.birth_date is not null then
    if a.birth_date = b.birth_date then s := s + 0.3;
    elsif extract(year from a.birth_date) = extract(year from b.birth_date) then s := s + 0.15;
    elsif abs(extract(year from a.birth_date) - extract(year from b.birth_date)) > 2 then s := s - 0.4;
    end if;
  end if;
  if a.death_date is not null and b.death_date is not null then
    if extract(year from a.death_date) = extract(year from b.death_date) then s := s + 0.05;
    elsif abs(extract(year from a.death_date) - extract(year from b.death_date)) > 2 then s := s - 0.4;
    end if;
  end if;

  select array_agg(parent_id) into pa from parent_child where child_id = p_a;
  select array_agg(parent_id) into pb from parent_child where child_id = p_b;
  if pa is not null and pb is not null then
    s := s + case when pa && pb then 0.3 else -0.3 end;
  end if;

  select array_agg(case when partner1_id = p_a then partner2_id else partner1_id end) into sa
  from unions where p_a in (partner1_id, partner2_id);
  select array_agg(case when partner1_id = p_b then partner2_id else partner1_id end) into sb
  from unions where p_b in (partner1_id, partner2_id);
  if sa && sb then
    s := s + 0.3;
  end if;

  return round(greatest(least(s, 1), 0), 2);
end $$;

-- Creates a request for every new pair above 0.85. A pair already asked about, in any state, is never asked again.
create function merge_scan_tree(p_tree uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  tree_creator uuid;
  r record;
  s numeric;
  req uuid;
  n int := 0;
begin
  select creator_id into tree_creator from trees where id = p_tree and deleted_at is null;
  if tree_creator is null then return 0; end if;
  for r in
    select a.id as aid, b.id as bid
    from persons a
    join persons b on b.tree_id = a.tree_id and a.id < b.id and b.deleted_at is null and not b.name_unknown
      and (a.name_normalized = b.name_normalized or a.name_normalized operator(extensions.%) b.name_normalized)
    where a.tree_id = p_tree and a.deleted_at is null and not a.name_unknown
      and not (a.gender in ('male', 'female') and b.gender in ('male', 'female') and a.gender <> b.gender)
      and not (a.claimed_by is not null and b.claimed_by is not null)
      and not exists (select 1 from person_closure c where (c.ancestor_id = a.id and c.descendant_id = b.id) or (c.ancestor_id = b.id and c.descendant_id = a.id))
      and not exists (select 1 from unions u where (u.partner1_id = a.id and u.partner2_id = b.id) or (u.partner1_id = b.id and u.partner2_id = a.id))
      and not exists (
        select 1 from requests q where q.tree_id = p_tree and q.kind = 'merge'
          and q.payload ->> 'person_a' = a.id::text and q.payload ->> 'person_b' = b.id::text
      )
  loop
    s := merge_score(r.aid, r.bid);
    if s > 0.85 then
      insert into requests (tree_id, kind, requester_id, target_person_id, payload)
      values (p_tree, 'merge', tree_creator, r.bid, jsonb_build_object('person_a', r.aid, 'person_b', r.bid, 'score', s))
      returning id into req;
      perform notify_tree_managers(p_tree, 'merge_candidate', jsonb_build_object('request_id', req, 'tree_id', p_tree));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create function merge_scan(p_tree uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_creator_or_cocreator(p_tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  return jsonb_build_object('created', merge_scan_tree(p_tree));
end $$;

-- GET /merge/:request_id, for the compare screen. Says which contact kinds exist, never their values.
create function merge_preview(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q requests;
begin
  select * into q from requests where id = p_request and kind = 'merge';
  if q.id is null or not can_decide_request(q.tree_id, q.routed_to) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  return jsonb_build_object(
    'request_id', q.id, 'tree_id', q.tree_id, 'status', q.status, 'score', q.payload -> 'score',
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'name_unknown', p.name_unknown, 'note_label', p.note_label,
        'gender', p.gender, 'living', p.living, 'birth_date', p.birth_date, 'birth_precision', p.birth_precision,
        'death_date', p.death_date, 'death_precision', p.death_precision, 'birth_place', p.birth_place,
        'death_place', p.death_place, 'photo_path', p.photo_path, 'notes', p.notes,
        'claimed', p.claimed_by is not null, 'version', p.version, 'deleted', p.deleted_at is not null,
        'added_by', (select a.display_name from profiles a where a.id = p.created_by),
        'parents', coalesce((select jsonb_agg(x.display_name) from parent_child l join persons x on x.id = l.parent_id where l.child_id = p.id), '[]'::jsonb),
        'partners', coalesce((
          select jsonb_agg(x.display_name) from unions u
          join persons x on x.id = case when u.partner1_id = p.id then u.partner2_id else u.partner1_id end
          where p.id in (u.partner1_id, u.partner2_id)
        ), '[]'::jsonb),
        'children', (select count(*) from parent_child l where l.parent_id = p.id),
        'comments', (select count(*) from comments c where c.person_id = p.id),
        'contact_kinds', coalesce((select jsonb_agg(distinct c.kind) from person_contacts c where c.person_id = p.id), '[]'::jsonb)
      ))
      from persons p where p.id in ((q.payload ->> 'person_a')::uuid, (q.payload ->> 'person_b')::uuid)
    ), '[]'::jsonb)
  );
end $$;

-- Keeps one person row; the other is soft-deleted so one batch undo can bring it back. Everything is audited or
-- written to merge_log. Rights are checked by the two callers.
create function merge_persons(q requests, p_keep uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  batch uuid := gen_random_uuid();
  a persons;
  b persons;
  kept persons;
  gone persons;
  u unions;
  other_partner uuid;
  twin uuid;
  l parent_child;
  moved_comments uuid[];
  moved_scope uuid[];
  moved_grantee uuid[];
  moved_requests uuid[];
  tree_person boolean;
begin
  select * into a from persons where id = (q.payload ->> 'person_a')::uuid and tree_id = q.tree_id and deleted_at is null for update;
  select * into b from persons where id = (q.payload ->> 'person_b')::uuid and tree_id = q.tree_id and deleted_at is null for update;
  if a.id is null or b.id is null then
    raise exception 'merge_person_gone' using errcode = 'PT409';
  end if;
  if a.claimed_by is not null and b.claimed_by is not null then
    raise exception 'merge_both_claimed' using errcode = 'PT409';
  end if;
  if exists (select 1 from person_closure c where (c.ancestor_id = a.id and c.descendant_id = b.id) or (c.ancestor_id = b.id and c.descendant_id = a.id))
     or exists (select 1 from unions x where (x.partner1_id = a.id and x.partner2_id = b.id) or (x.partner1_id = b.id and x.partner2_id = a.id)) then
    raise exception 'merge_related' using errcode = 'PT422';
  end if;
  if p_keep is not null and p_keep not in (a.id, b.id) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- A registered person's row always stays; otherwise the decider's pick; otherwise the first.
  if b.claimed_by is not null or (a.claimed_by is null and p_keep = b.id) then
    kept := b; gone := a;
  else
    kept := a; gone := b;
  end if;

  perform set_config('aywo.batch_id', batch::text, true);

  -- Couples. Both married to the same person: one couple remains and takes the children.
  for u in select * from unions x where gone.id in (x.partner1_id, x.partner2_id) loop
    other_partner := case when u.partner1_id = gone.id then u.partner2_id else u.partner1_id end;
    twin := null;
    if other_partner is not null then
      select x.id into twin from unions x
      where (x.partner1_id = kept.id and x.partner2_id = other_partner) or (x.partner1_id = other_partner and x.partner2_id = kept.id)
      limit 1;
    end if;
    if twin is not null then
      update parent_child set union_id = twin where union_id = u.id;
      delete from unions where id = u.id;
    elsif u.partner1_id = gone.id then
      update unions set partner1_id = kept.id where id = u.id;
    else
      update unions set partner2_id = kept.id where id = u.id;
    end if;
  end loop;

  -- Links. The pair (parent, child) is unique, so a link the kept person already has is dropped instead of moved.
  for l in select * from parent_child x where x.parent_id = gone.id loop
    if exists (select 1 from parent_child x where x.parent_id = kept.id and x.child_id = l.child_id) then
      delete from parent_child where id = l.id;
    else
      update parent_child set parent_id = kept.id where id = l.id;
    end if;
  end loop;
  for l in select * from parent_child x where x.child_id = gone.id loop
    if exists (select 1 from parent_child x where x.parent_id = l.parent_id and x.child_id = kept.id) then
      delete from parent_child where id = l.id;
    else
      update parent_child set child_id = kept.id where id = l.id;
    end if;
  end loop;

  -- A contact the kept person already has stays on the old row: the card shows it once, and nothing is lost on undo.
  update person_contacts c set person_id = kept.id
  where c.person_id = gone.id and not exists (
    select 1 from person_contacts o where o.person_id = kept.id and o.kind = c.kind and o.value_normalized = c.value_normalized
  );

  select coalesce(array_agg(id), '{}') into moved_comments from comments where person_id = gone.id;
  update comments set person_id = kept.id where id = any (moved_comments);
  select coalesce(array_agg(id), '{}') into moved_scope from shares where scope_person_id = gone.id;
  update shares set scope_person_id = kept.id where id = any (moved_scope);
  select coalesce(array_agg(id), '{}') into moved_grantee from shares where grantee_person_id = gone.id;
  update shares set grantee_person_id = kept.id where id = any (moved_grantee);
  select coalesce(array_agg(id), '{}') into moved_requests from requests where target_person_id = gone.id and id <> q.id;
  update requests set target_person_id = kept.id where id = any (moved_requests);
  tree_person := exists (select 1 from trees where id = q.tree_id and creator_person_id = gone.id);
  if tree_person then
    update trees set creator_person_id = kept.id where id = q.tree_id;
  end if;

  insert into merge_log (batch_id, tree_id, request_id, kept_id, dropped_id, kept_claim, dropped_claim, comment_ids,
                         scope_share_ids, grantee_share_ids, request_ids, was_tree_person)
  values (batch, q.tree_id, q.id, kept.id, gone.id, kept.claimed_by, gone.claimed_by, moved_comments,
          moved_scope, moved_grantee, moved_requests, tree_person);

  -- The old row first, because one account can hold only one person in a tree.
  update persons set claimed_by = null, deleted_at = now() where id = gone.id;
  update persons set
    display_name = case when name_unknown and not gone.name_unknown then gone.display_name else display_name end,
    name_unknown = name_unknown and gone.name_unknown,
    note_label = coalesce(note_label, gone.note_label),
    gender = case when gender = 'unknown' then gone.gender else gender end,
    living = case when living = 'unknown' then gone.living else living end,
    birth_precision = case when birth_date is null then gone.birth_precision else birth_precision end,
    birth_date = coalesce(birth_date, gone.birth_date),
    death_precision = case when death_date is null then gone.death_precision else death_precision end,
    death_date = coalesce(death_date, gone.death_date),
    birth_place = coalesce(birth_place, gone.birth_place),
    death_place = coalesce(death_place, gone.death_place),
    birth_order = coalesce(birth_order, gone.birth_order),
    photo_path = coalesce(photo_path, gone.photo_path),
    notes = coalesce(notes, gone.notes),
    claimed_by = coalesce(claimed_by, gone.claimed_by)
  where id = kept.id;

  return jsonb_build_object('kept_id', kept.id, 'dropped_id', gone.id, 'batch_id', batch);
end $$;

-- POST /merge/:request_id/apply. F-REPO-03's 'both Creators' is one decision here, since both entries are in one tree.
create function merge_apply(p_request uuid, p_keep uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  q requests;
  answer jsonb;
begin
  select * into q from requests where id = p_request and kind = 'merge' for update;
  if q.id is null or not can_decide_request(q.tree_id, q.routed_to) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if q.status <> 'pending' then
    raise exception 'already_decided' using errcode = 'PT409';
  end if;
  answer := merge_persons(q, p_keep);
  update requests set status = 'applied', decided_by = me, decided_at = now() where id = p_request;
  if q.requester_id <> me then
    insert into notifications (recipient_id, kind, payload)
    values (q.requester_id, 'request_decided', jsonb_build_object(
      'request_id', q.id, 'kind', q.kind, 'tree_id', q.tree_id, 'decision', 'approve'));
  end if;
  return answer;
end $$;

-- ===== Activity (wireframe E4) =====
-- Names of people and of changed tables only. A change payload is limited to clean_person_fields, so it holds no contact.
create function activity_feed(p_tab text default 'all', p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  max_rows int := least(greatest(coalesce(p_limit, 50), 1), 200);
  mine uuid[];
  managed uuid[];
  editing uuid[];
  items jsonb := '[]';
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if p_tab not in ('needs_you', 'changes', 'access', 'all') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  select coalesce(array_agg(t.id), '{}') into mine from trees t
  where t.deleted_at is null and (
    t.creator_id = me
    or exists (select 1 from shares s where s.tree_id = t.id and s.grantee_profile_id = me and s.revoked_at is null and (s.expires_at is null or s.expires_at > now()))
    or exists (select 1 from persons c where c.tree_id = t.id and c.claimed_by = me)
  );
  select coalesce(array_agg(x), '{}') into managed from unnest(mine) x where is_creator_or_cocreator(x);
  select coalesce(array_agg(x), '{}') into editing from unnest(mine) x where tree_role(x) >= 'editor';

  -- Waiting for this person's decision
  if p_tab in ('needs_you', 'all') then
    items := items || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'request:' || q.id, 'type', 'request', 'request_id', q.id, 'kind', q.kind, 'state', q.status, 'at', q.created_at,
        'tree_id', q.tree_id, 'tree_name', t.name, 'actor_id', q.requester_id, 'actor_name', a.display_name,
        'person_id', q.target_person_id, 'person_name', p.display_name, 'payload', q.payload, 'needs_you', true
      ))
      from (
        select * from requests r
        where r.status = 'pending' and (r.tree_id = any (managed) or (r.routed_to = me and coalesce(creator_inactive(r.tree_id), false)))
          and (r.requester_id <> me or r.kind = 'merge')
        order by r.created_at desc limit max_rows
      ) q
      join trees t on t.id = q.tree_id and t.deleted_at is null
      left join profiles a on a.id = q.requester_id
      left join persons p on p.id = q.target_person_id
    ), '[]'::jsonb);
    -- 'Joined, found by mobile number. Wrong match? Undo' (F-ACC-05)
    items := items || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'claim:' || n.id, 'type', 'claim', 'notification_id', n.id, 'at', n.created_at,
        'tree_id', p.tree_id, 'tree_name', t.name, 'actor_name', a.display_name,
        'person_id', p.id, 'person_name', p.display_name, 'needs_you', false
      ))
      from (
        select * from notifications x
        where x.recipient_id = me and x.kind = 'claim_made' and x.created_at > now() - interval '30 days'
        order by x.created_at desc limit max_rows
      ) n
      join persons p on p.id = (n.payload ->> 'person_id')::uuid and p.claimed_by is not null and p.deleted_at is null
      join trees t on t.id = p.tree_id and t.deleted_at is null
      left join profiles a on a.id = p.claimed_by
    ), '[]'::jsonb);
  end if;

  -- What changed: one row for each batch, and suggestions already decided or still waiting from me
  if p_tab in ('changes', 'all') then
    items := items || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'change:' || b.batch_id, 'type', 'change', 'batch_id', b.batch_id, 'at', b.at_time,
        'tree_id', b.tree_id, 'tree_name', t.name, 'actor_id', b.actor_id, 'actor_name', a.display_name,
        'rows', b.row_count, 'op', b.first_op, 'table_name', b.first_table,
        'person_id', p.id, 'person_name', p.display_name, 'contacts_changed', b.has_contacts,
        'reverted', b.all_reverted, 'can_revert', not b.all_reverted and not b.has_contacts and can_edit(b.tree_id)
      ))
      from (
        select h.batch_id, h.tree_id, h.actor_id, max(h.at) as at_time, count(*) as row_count,
          (array_agg(h.op order by h.id))[1] as first_op,
          (array_agg(h.table_name order by h.id))[1] as first_table,
          (array_agg(case when h.table_name = 'person_contacts' then (coalesce(h.after, h.before) ->> 'person_id')::uuid
                          when h.table_name = 'persons' then h.row_id end order by h.id)
             filter (where h.table_name in ('persons', 'person_contacts')))[1] as first_person,
          bool_or(h.table_name = 'person_contacts') as has_contacts,
          bool_and(h.reverted_by is not null) as all_reverted
        from history h
        where h.tree_id = any (editing) and h.at > now() - interval '90 days'
        group by h.batch_id, h.tree_id, h.actor_id
        order by max(h.at) desc limit max_rows
      ) b
      join trees t on t.id = b.tree_id
      left join profiles a on a.id = b.actor_id
      left join persons p on p.id = b.first_person
    ), '[]'::jsonb);
    items := items || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'request:' || q.id, 'type', 'request', 'request_id', q.id, 'kind', q.kind, 'state', q.status,
        'at', coalesce(q.decided_at, q.created_at), 'tree_id', q.tree_id, 'tree_name', t.name,
        'actor_id', q.requester_id, 'actor_name', a.display_name,
        'person_id', q.target_person_id, 'person_name', p.display_name, 'payload', q.payload, 'needs_you', false
      ))
      from (
        select * from requests r
        where r.kind in ('change', 'merge')
          and ((r.requester_id = me and r.kind = 'change') or (r.tree_id = any (managed) and r.status <> 'pending'))
        order by coalesce(r.decided_at, r.created_at) desc limit max_rows
      ) q
      join trees t on t.id = q.tree_id and t.deleted_at is null
      left join profiles a on a.id = q.requester_id
      left join persons p on p.id = q.target_person_id
    ), '[]'::jsonb);
  end if;

  -- Who can see what
  if p_tab in ('access', 'all') then
    items := items || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'request:' || q.id, 'type', 'request', 'request_id', q.id, 'kind', q.kind, 'state', q.status,
        'at', coalesce(q.decided_at, q.created_at), 'tree_id', q.tree_id, 'tree_name', t.name,
        'actor_id', q.requester_id, 'actor_name', a.display_name,
        'person_id', q.target_person_id, 'person_name', p.display_name,
        'needs_you', q.status = 'pending' and q.requester_id <> me and q.tree_id = any (managed)
      ))
      from (
        select * from requests r
        where r.kind in ('access_edit', 'access_contacts', 'role_upgrade')
          and (r.requester_id = me or (r.tree_id = any (managed) and (p_tab = 'access' or r.status <> 'pending')))
        order by coalesce(r.decided_at, r.created_at) desc limit max_rows
      ) q
      join trees t on t.id = q.tree_id and t.deleted_at is null
      left join profiles a on a.id = q.requester_id
      left join persons p on p.id = q.target_person_id
    ), '[]'::jsonb);
    items := items || coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'share:' || s.id, 'type', 'share', 'share_id', s.id, 'role', s.role, 'at', coalesce(s.revoked_at, s.created_at),
        'revoked', s.revoked_at is not null, 'expires_at', s.expires_at,
        'tree_id', s.tree_id, 'tree_name', t.name, 'actor_id', s.created_by, 'actor_name', a.display_name,
        'grantee_name', g.display_name, 'waiting_for_signup', exists (select 1 from share_waiting_phones w where w.share_id = s.id),
        'person_id', s.scope_person_id, 'person_name', p.display_name
      ))
      from (
        select * from shares x
        where (x.tree_id = any (managed) or x.grantee_profile_id = me) and x.tree_id = any (mine)
        order by coalesce(x.revoked_at, x.created_at) desc limit max_rows
      ) s
      join trees t on t.id = s.tree_id
      left join profiles a on a.id = s.created_by
      left join profiles g on g.id = s.grantee_profile_id
      left join persons p on p.id = s.scope_person_id
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(i.item order by (i.item ->> 'at')::timestamptz desc)
    from (
      select x.item from jsonb_array_elements(items) as x(item)
      order by (x.item ->> 'at')::timestamptz desc limit max_rows
    ) i
  ), '[]'::jsonb);
end $$;

-- ===== Import keeps what the file said =====
-- Same as 0004, plus the dates, places, notes and link kinds a GEDCOM preview carries. Lighten previews have none,
-- so they come out as before. It also runs the merge scan afterwards (L11).
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

  for x in select * from jsonb_array_elements(imp.preview -> 'unions') loop
    insert into unions (tree_id, partner1_id, partner2_id, kind, status, seq1, start_date, end_date)
    values (tree, (ids ->> (x ->> 'partner1Id'))::uuid, (ids ->> (x ->> 'partner2Id'))::uuid,
            coalesce(x ->> 'kind', 'unknown')::union_kind_t, coalesce(x ->> 'status', 'unknown')::union_status_t,
            (x ->> 'seq1')::smallint, (x ->> 'startDate')::date, (x ->> 'endDate')::date)
    returning id into new_id;
    union_ids := union_ids || jsonb_build_object(x ->> 'tempId', new_id);
  end loop;

  for x in select * from jsonb_array_elements(imp.preview -> 'parentLinks') loop
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    values (tree, (ids ->> (x ->> 'parentId'))::uuid, (ids ->> (x ->> 'childId'))::uuid,
            (union_ids ->> (x ->> 'unionId'))::uuid, coalesce(x ->> 'kind', 'unknown')::link_kind_t);
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
  perform merge_scan_tree(tree);
  return jsonb_build_object('tree_id', tree, 'batch_id', batch, 'people', (select count(*) from persons where tree_id = tree));
end $$;

-- ===== Scheduled jobs (L11). Run as the server, with no signed-in person =====

-- True at most once per interval, however often it is asked and however many restarts come between.
create function job_claim(p_name text, p_every interval) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  claimed text;
begin
  insert into job_runs (name, last_run_at) values (p_name, now())
  on conflict (name) do update set last_run_at = now()
    where job_runs.last_run_at <= now() - p_every
  returning name into claimed;
  return claimed is not null;
end $$;

-- Hourly. An expired share stops working by itself (tree_role); this tells the person, once. Asking expires after 30 days.
create function tree_expire_access() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  shares_done int;
  requests_done int;
begin
  with done as (
    update shares set expiry_notified_at = now()
    where expires_at <= now() and revoked_at is null and expiry_notified_at is null
    returning id, tree_id, grantee_profile_id
  ), told as (
    insert into notifications (recipient_id, kind, payload)
    select d.grantee_profile_id, 'share_expired', jsonb_build_object('tree_id', d.tree_id, 'share_id', d.id)
    from done d where d.grantee_profile_id is not null
  ), cleared as (
    delete from share_waiting_phones w using done d where w.share_id = d.id
  )
  select count(*) into shares_done from done;

  with done as (
    update requests set status = 'expired', decided_at = now()
    where status = 'pending' and kind <> 'merge' and created_at < now() - interval '30 days'
    returning id, tree_id, kind, requester_id
  ), told as (
    insert into notifications (recipient_id, kind, payload)
    select d.requester_id, 'request_expired', jsonb_build_object('request_id', d.id, 'kind', d.kind, 'tree_id', d.tree_id)
    from done d
  )
  select count(*) into requests_done from done;

  return jsonb_build_object('shares', shares_done, 'requests', requests_done);
end $$;

-- Nightly.
create function merge_scan_all() returns int
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  n int := 0;
begin
  for t in select id from trees where deleted_at is null loop
    n := n + merge_scan_tree(t);
  end loop;
  return n;
end $$;

-- Daily. F-SHR-08: when a Creator has been away 180 days, waiting requests go to the longest-standing Co-creator,
-- otherwise the named successor. A successor can only decide while the Creator stays away (can_decide_request).
create function tree_successor_rule() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  heir uuid;
  n int := 0;
begin
  for r in
    select q.id, q.tree_id, q.kind, q.requester_id, t.successor_id
    from requests q join trees t on t.id = q.tree_id and t.deleted_at is null
    where q.status = 'pending' and q.routed_to is null and creator_inactive(q.tree_id)
  loop
    heir := null;
    select s.grantee_profile_id into heir
    from shares s join profiles p on p.id = s.grantee_profile_id and p.deleted_at is null
    where s.tree_id = r.tree_id and s.role = 'co_creator' and s.scope_person_id is null and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now()) and s.grantee_profile_id <> r.requester_id
    order by s.created_at limit 1;
    if heir is null then
      select p.id into heir from profiles p
      where p.id = r.successor_id and p.deleted_at is null and p.id <> r.requester_id;
    end if;
    if heir is not null then
      update requests set routed_to = heir where id = r.id;
      insert into notifications (recipient_id, kind, payload)
      values (heir, 'request_routed', jsonb_build_object('request_id', r.id, 'kind', r.kind, 'tree_id', r.tree_id));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ===== Who may call what =====

revoke all on function creator_inactive(uuid), can_decide_request(uuid, uuid), photo_path_ok(text, uuid), clean_person_fields(jsonb),
  apply_person_fields(uuid, int, jsonb), apply_person_delete(uuid), apply_elder_younger(uuid, uuid, boolean),
  my_account(), me_update(jsonb), my_trees(), tree_create(text), tree_update(uuid, jsonb), tree_delete(uuid),
  account_delete(), account_export(), request_change(uuid, jsonb), person_update(uuid, int, jsonb), person_delete(uuid, int),
  contacts_for_edit(uuid), person_comments(uuid), comment_add(uuid, text), new_link_token(),
  share_create(uuid, share_role_t, edit_mode_t, boolean, uuid, uuid, text, timestamptz), share_update(uuid, jsonb), share_revoke(uuid),
  tree_shares(uuid), share_resolve_waiting(), share_follow_claim(),
  request_access(uuid, request_kind_t, uuid, jsonb), grant_from_request(requests, share_role_t, jsonb), apply_change(requests, jsonb),
  requests_decide(uuid, text, jsonb), history_list(uuid, uuid, int, bigint), history_rights_person(history),
  revert_history_row(history, boolean), history_revert(bigint, uuid), merge_score(uuid, uuid), merge_scan_tree(uuid), merge_scan(uuid),
  merge_preview(uuid), merge_persons(requests, uuid), merge_apply(uuid, uuid), activity_feed(text, int),
  job_claim(text, interval), tree_expire_access(), merge_scan_all(), tree_successor_rule()
  from public, anon, authenticated;

grant execute on function my_account(), me_update(jsonb), my_trees(), tree_create(text), tree_update(uuid, jsonb), tree_delete(uuid),
  account_delete(), account_export(), request_change(uuid, jsonb), person_update(uuid, int, jsonb), person_delete(uuid, int),
  contacts_for_edit(uuid), person_comments(uuid), comment_add(uuid, text),
  share_create(uuid, share_role_t, edit_mode_t, boolean, uuid, uuid, text, timestamptz), share_update(uuid, jsonb), share_revoke(uuid),
  tree_shares(uuid), request_access(uuid, request_kind_t, uuid, jsonb), requests_decide(uuid, text, jsonb),
  history_list(uuid, uuid, int, bigint), history_revert(bigint, uuid), merge_scan(uuid), merge_preview(uuid), merge_apply(uuid, uuid),
  activity_feed(text, int)
  to authenticated;
