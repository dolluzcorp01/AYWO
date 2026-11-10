-- AYWO access rules (LLD L4). Clients get only what is granted here; the service role (server functions) bypasses RLS.

-- Start from nothing. Supabase grants everything by default, which would let a client set claimed_by or creator_id.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

create type tree_role_t as enum ('none', 'viewer', 'commenter', 'editor', 'co_creator', 'creator');

-- Is this person inside the branch of scope_person (descendants, plus the partners of branch members)?
create function in_branch(scope_person uuid, person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from person_closure c where c.ancestor_id = scope_person and c.descendant_id = person)
      or exists (
        select 1 from unions u
        join person_closure c on c.ancestor_id = scope_person
          and c.descendant_id in (u.partner1_id, u.partner2_id)
        where person in (u.partner1_id, u.partner2_id)
      )
$$;

-- L4.1: the caller's highest role in a tree. Without a person, branch shares do not count: only whole-tree rights.
create function tree_role(p_tree uuid, p_person uuid default null) returns tree_role_t
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  best tree_role_t := 'none';
  r share_role_t;
begin
  if me is null then return 'none'; end if;
  if exists (select 1 from trees t where t.id = p_tree and t.creator_id = me and t.deleted_at is null) then
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

-- Can the caller see a tree at all? A branch-only share still lets them open the tree.
create function can_view_tree(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tree_role(p_tree) <> 'none' or exists (
    select 1 from shares s
    where s.tree_id = p_tree and s.grantee_profile_id = auth.uid()
      and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
  )
$$;

-- L4.2: may the caller write directly? Approval-mode editors may not: they write to requests.
-- p_person null means a new row with no branch yet: only whole-tree rights. Branch editors add people through add-relative.
create function can_edit(p_tree uuid, p_person uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  role_now tree_role_t := tree_role(p_tree, p_person);
begin
  if role_now in ('creator', 'co_creator') then return true; end if;
  if role_now <> 'editor' then return false; end if;
  -- Self-branch: their own person and their descendants, always direct (F-REPO-04).
  if p_person is not null and exists (
    select 1 from persons c join person_closure pc on pc.ancestor_id = c.id
    where c.tree_id = p_tree and c.claimed_by = me and pc.descendant_id = p_person
  ) then
    return true;
  end if;
  return exists (
    select 1 from shares s
    where s.tree_id = p_tree and s.grantee_profile_id = me and s.role = 'editor' and s.edit_mode = 'direct'
      and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      and (s.scope_person_id is null or (p_person is not null and in_branch(s.scope_person_id, p_person)))
  );
end $$;

create function is_creator_or_cocreator(p_tree uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tree_role(p_tree) in ('creator', 'co_creator')
$$;

create function is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where profile_id = auth.uid() and role = 'aywo_admin')
$$;

create function has_plus(p_profile uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_plans f
    left join family_plan_members m on m.plan_id = f.id
    where f.status in ('trial', 'active', 'grace')
      and (f.payer_id = p_profile or m.profile_id = p_profile)
  )
$$;

-- L4.3: contacts come back only through this function; everyone else sees which icons exist.
create function get_person_contacts(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  is_self boolean;
  allowed boolean;
begin
  select p.tree_id, coalesce(p.claimed_by = me, false) into tree, is_self from persons p where p.id = p_person;
  if tree is null or not (is_self or tree_role(tree, p_person) <> 'none') then
    return jsonb_build_object('has_mobile', false, 'has_whatsapp', false, 'has_email', false);
  end if;
  allowed := is_self or (
    has_plus(me) and (
      tree_role(tree) in ('creator', 'co_creator')
      or exists (
        select 1 from shares s
        where s.tree_id = tree and s.grantee_profile_id = me and s.contacts_visible
          and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      )
      or exists (
        select 1 from requests q
        where q.tree_id = tree and q.requester_id = me and q.kind = 'access_contacts'
          and q.status in ('approved', 'applied')
          and (q.target_person_id is null or q.target_person_id = p_person)
      )
    )
  );
  if allowed then
    return jsonb_build_object('values', coalesce(
      (select jsonb_agg(jsonb_build_object('kind', c.kind, 'value', c.value)) from person_contacts c where c.person_id = p_person),
      '[]'::jsonb));
  end if;
  return jsonb_build_object(
    'has_mobile', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'mobile'),
    'has_whatsapp', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'whatsapp'),
    'has_email', exists (select 1 from person_contacts c where c.person_id = p_person and c.kind = 'email')
  );
end $$;

-- Clients have no table access to person_contacts at all, so writes also go through functions.
create function set_person_contact(p_person uuid, p_kind contact_kind_t, p_value text, p_value_normalized text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tree uuid;
  new_id uuid;
begin
  select tree_id into tree from persons where id = p_person;
  if tree is null or not can_edit(tree, p_person) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  insert into person_contacts (person_id, kind, value, value_normalized, created_by)
  values (p_person, p_kind, p_value, p_value_normalized, auth.uid())
  returning id into new_id;
  return new_id;
end $$;

create function delete_person_contact(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  person uuid;
  tree uuid;
begin
  select c.person_id, p.tree_id into person, tree
  from person_contacts c join persons p on p.id = c.person_id where c.id = p_contact;
  if tree is null or not can_edit(tree, person) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  delete from person_contacts where id = p_contact;
end $$;

-- Only these functions are callable by the app. The rest are internal.
revoke all on all functions in schema public from anon, authenticated, public;
grant execute on function is_app_admin() to anon;   -- the kin_terms read rule uses it for visitors too
grant execute on function tree_role(uuid, uuid), can_view_tree(uuid), can_edit(uuid, uuid), is_creator_or_cocreator(uuid),
  is_app_admin(), has_plus(uuid), in_branch(uuid, uuid), aywo_normalize(text),
  get_person_contacts(uuid), set_person_contact(uuid, contact_kind_t, text, text), delete_person_contact(uuid)
  to authenticated;

-- ===== Column grants =====
-- Anything not listed cannot be written by a client, whatever the row rules say.
grant select on languages to anon, authenticated;
grant select, update (display_name, language_code, large_text, last_active_at), insert (id, display_name, language_code, large_text)
  on profiles to authenticated;
grant select, insert (name, creator_id, creator_person_id), update (name, successor_id, creator_person_id), delete
  on trees to authenticated;
grant select, delete,
  insert (id, tree_id, display_name, name_unknown, note_label, gender, living, birth_date, death_date, birth_precision,
          death_precision, birth_place, death_place, birth_order, photo_path, notes, created_by),
  update (display_name, name_unknown, note_label, gender, living, birth_date, death_date, birth_precision,
          death_precision, birth_place, death_place, birth_order, photo_path, notes, version, deleted_at)
  on persons to authenticated;
grant select, insert, update, delete on unions, parent_child to authenticated;
grant select, insert, update, delete on shares to authenticated;
grant select, insert (tree_id, kind, requester_id, target_person_id, payload) on requests to authenticated;
grant select, insert (tree_id, person_id, author_id, body), delete on comments to authenticated;
grant select on history to authenticated;
grant select on family_plans, family_plan_members to authenticated;
grant select, update (read_at) on notifications to authenticated;
grant select, insert, update on notification_prefs to authenticated;
grant select, insert on consents to authenticated;
grant select on imports to authenticated;

-- ===== Row rules (L4.2) =====
alter table languages enable row level security;
alter table profiles enable row level security;
alter table trees enable row level security;
alter table persons enable row level security;
alter table person_contacts enable row level security;     -- no client policy, on purpose
alter table unions enable row level security;
alter table parent_child enable row level security;
alter table person_closure enable row level security;      -- no client policy, on purpose
alter table shares enable row level security;
alter table requests enable row level security;
alter table comments enable row level security;
alter table history enable row level security;
alter table family_plans enable row level security;
alter table family_plan_members enable row level security;
alter table notifications enable row level security;
alter table notification_prefs enable row level security;
alter table consents enable row level security;
alter table takedown_requests enable row level security;   -- no client policy: server and AYWO Admin functions only
alter table app_admins enable row level security;          -- no client policy, on purpose
alter table imports enable row level security;

create policy languages_read on languages for select using (true);

create policy profiles_self on profiles for select using (id = auth.uid());
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy trees_read on trees for select using (creator_id = auth.uid() or can_view_tree(id));
create policy trees_insert on trees for insert with check (creator_id = auth.uid());
create policy trees_update on trees for update using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy trees_delete on trees for delete using (creator_id = auth.uid());

-- A branch-only share reads inside its branch; everyone else with a whole-tree role reads the whole tree.
create policy persons_read on persons for select using (tree_role(tree_id, id) <> 'none');
create policy persons_insert on persons for insert with check (created_by = auth.uid() and can_edit(tree_id));
create policy persons_update on persons for update using (can_edit(tree_id, id)) with check (can_edit(tree_id, id));
create policy persons_delete on persons for delete using (can_edit(tree_id, id));

create policy unions_read on unions for select using (tree_role(tree_id, partner1_id) <> 'none');
create policy unions_insert on unions for insert with check (can_edit(tree_id, partner1_id));
create policy unions_update on unions for update using (can_edit(tree_id, partner1_id)) with check (can_edit(tree_id, partner1_id));
create policy unions_delete on unions for delete using (can_edit(tree_id, partner1_id));

create policy parent_child_read on parent_child for select using (tree_role(tree_id, child_id) <> 'none');
create policy parent_child_insert on parent_child for insert with check (can_edit(tree_id, child_id));
create policy parent_child_update on parent_child for update using (can_edit(tree_id, child_id)) with check (can_edit(tree_id, child_id));
create policy parent_child_delete on parent_child for delete using (can_edit(tree_id, child_id));

create policy shares_read on shares for select using (grantee_profile_id = auth.uid() or is_creator_or_cocreator(tree_id));
create policy shares_write on shares for insert with check (is_creator_or_cocreator(tree_id) and created_by = auth.uid());
create policy shares_update on shares for update using (is_creator_or_cocreator(tree_id)) with check (is_creator_or_cocreator(tree_id));
create policy shares_delete on shares for delete using (is_creator_or_cocreator(tree_id));

create policy requests_read on requests for select using (requester_id = auth.uid() or is_creator_or_cocreator(tree_id));
create policy requests_insert on requests for insert with check (requester_id = auth.uid() and can_view_tree(tree_id));
-- Decisions go through requests-decide (server), which applies the change in one transaction.

create policy comments_read on comments for select using (tree_role(tree_id, person_id) <> 'none');
create policy comments_insert on comments for insert
  with check (author_id = auth.uid() and tree_role(tree_id, person_id) >= 'commenter');
create policy comments_delete on comments for delete using (author_id = auth.uid());

create policy history_read on history for select using (tree_role(tree_id) >= 'editor');

create policy family_plans_read on family_plans for select using (
  payer_id = auth.uid() or exists (
    select 1 from family_plan_members m where m.plan_id = id and m.profile_id = auth.uid()
  )
);
create function my_plan_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from family_plans where payer_id = auth.uid()
  union select plan_id from family_plan_members where profile_id = auth.uid()
$$;
revoke all on function my_plan_ids() from public, anon;
grant execute on function my_plan_ids() to authenticated;
create policy family_plan_members_read on family_plan_members for select using (plan_id in (select my_plan_ids()));

create policy notifications_own on notifications for select using (recipient_id = auth.uid());
create policy notifications_mark on notifications for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notification_prefs_own on notification_prefs for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy consents_own on consents for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy imports_own on imports for select using (created_by = auth.uid());
