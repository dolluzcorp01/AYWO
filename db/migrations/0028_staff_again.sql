-- PR 37: adding staff without typing a number the system already has.
--  1. A removed staff member is remembered with the role and permissions they had, so "Add back" is one step.
--  2. Any existing account can be made staff by picking it (from Removed staff, or from its page under Users).
--  3. A waiting invite can be changed or renewed instead of cancelled and typed again.

create table former_staff (
  profile_id uuid primary key references profiles (id) on delete cascade,
  role app_admin_role_t not null,
  team_role_id uuid references admin_roles (id) on delete set null,
  permissions text[] not null default '{}',
  removed_by uuid references profiles (id) on delete set null,
  removed_at timestamptz not null default now()
);
alter table former_staff enable row level security;

-- Staff again, by whatever road (picked, typed number, invite used): no longer "removed".
create function former_staff_forget() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from former_staff where profile_id = new.profile_id;
  return null;
end $$;
create trigger app_admins_forget_former after insert on app_admins
  for each row execute function former_staff_forget();

create or replace function admin_staff_remove(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  was app_admins%rowtype;
begin
  perform admin_require(array['staff']);
  if p_profile = auth.uid() then
    raise exception 'admin_cannot_change_self' using errcode = 'PT422';
  end if;
  select * into was from app_admins a where a.profile_id = p_profile for update;
  if not found then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  insert into former_staff (profile_id, role, team_role_id, permissions, removed_by)
  values (p_profile, was.role, was.team_role_id,
          coalesce((select array_agg(g.permission order by g.permission) from app_admin_permissions g where g.profile_id = p_profile), '{}'),
          auth.uid())
  on conflict (profile_id) do update set role = excluded.role, team_role_id = excluded.team_role_id,
    permissions = excluded.permissions, removed_by = excluded.removed_by, removed_at = now();
  delete from app_admins where profile_id = p_profile;
  update work_items set assignee_id = null, updated_at = now() where assignee_id = p_profile and status <> 'done';
  update auth.refresh_tokens set revoked_at = now() where user_id = p_profile and revoked_at is null;
  perform admin_log('staff.removed', 'user', p_profile::text);
  return jsonb_build_object('ok', true);
end $$;

-- An account that already exists becomes staff: no phone number is typed.
create function admin_staff_add_person(p_profile uuid, p_role app_admin_role_t, p_permissions text[] default '{}', p_team_role uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  perms text[] := admin_clean_permissions(p_permissions);
begin
  perform admin_require(array['staff']);
  if p_team_role is not null and not exists (select 1 from admin_roles r where r.id = p_team_role) then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if p_role = 'sub_admin' and p_team_role is null and cardinality(perms) = 0 then
    raise exception 'admin_permission_required' using errcode = 'PT422';
  end if;
  if not exists (select 1 from profiles p where p.id = p_profile and p.deleted_at is null) then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  if exists (select 1 from app_admins a where a.profile_id = p_profile) then
    raise exception 'admin_already_staff' using errcode = 'PT409';
  end if;
  insert into app_admins (profile_id, role, added_by, team_role_id)
  values (p_profile, p_role, auth.uid(), case when p_role = 'sub_admin' then p_team_role end);
  perform admin_set_permissions(p_profile, p_role, perms);
  perform admin_log('staff.added', 'user', p_profile::text, null,
    jsonb_build_object('role', p_role, 'team_role', p_team_role, 'permissions', to_jsonb(perms)));
  return jsonb_build_object('profile_id', p_profile);
end $$;

-- Change what a waiting invite will give, or just renew it: either way it waits another 14 days.
create function admin_staff_invite_update(p_phone_key text, p_role app_admin_role_t, p_permissions text[] default '{}', p_team_role uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  perms text[] := admin_clean_permissions(p_permissions);
begin
  perform admin_require(array['staff']);
  if p_team_role is not null and not exists (select 1 from admin_roles r where r.id = p_team_role) then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if p_role = 'sub_admin' and p_team_role is null and cardinality(perms) = 0 then
    raise exception 'admin_permission_required' using errcode = 'PT422';
  end if;
  update staff_invites set role = p_role, team_role_id = case when p_role = 'sub_admin' then p_team_role end,
    permissions = perms, invited_by = auth.uid(), expires_at = now() + interval '14 days'
  where md5(phone) = p_phone_key;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_log('staff.invite_changed', 'invite', p_phone_key, null, jsonb_build_object('role', p_role));
  return jsonb_build_object('ok', true);
end $$;

-- The list now also carries what an invite will give (so it can be changed) and the people removed from staff.
create or replace function admin_staff_list(p_limit int default 100, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['staff']);
  select count(*)::int into total_rows from app_admins;
  select coalesce(jsonb_agg(jsonb_build_object(
      'profile_id', x.profile_id,
      'display_name', x.display_name,
      'phone_masked', admin_mask_phone(x.login_phone),
      'role', x.role,
      'team_role_id', x.team_role_id,
      'team_role', (select r.name from admin_roles r where r.id = x.team_role_id),
      'permissions', coalesce((select jsonb_agg(g.permission order by g.permission)
                               from app_admin_permissions g where g.profile_id = x.profile_id), '[]'::jsonb),
      'two_step', exists (select 1 from admin_mfa m where m.profile_id = x.profile_id and m.confirmed_at is not null),
      'open_work', (select count(*) from work_items w where w.assignee_id = x.profile_id and w.status <> 'done'),
      'last_active_at', x.last_active_at,
      'created_at', x.created_at,
      'blocked_at', x.banned_at,
      'is_me', x.profile_id = auth.uid()
    ) order by x.role, x.display_name, x.profile_id), '[]'::jsonb)
  into page_rows
  from (
    select a.profile_id, p.display_name, p.login_phone, a.role, a.team_role_id, a.created_at, p.last_active_at, u.banned_at
    from app_admins a
    join profiles p on p.id = a.profile_id
    join auth.users u on u.id = a.profile_id
    order by a.role, p.display_name, a.profile_id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows,
    'invites', coalesce((select jsonb_agg(jsonb_build_object(
        'phone_masked', admin_mask_phone(i.phone), 'phone_key', md5(i.phone), 'role', i.role,
        'team_role_id', i.team_role_id,
        'team_role', (select r.name from admin_roles r where r.id = i.team_role_id),
        'permissions', to_jsonb(i.permissions),
        'expires_at', i.expires_at, 'expired', i.expires_at < now()) order by i.created_at desc)
      from staff_invites i), '[]'::jsonb),
    'former', coalesce((select jsonb_agg(jsonb_build_object(
        'profile_id', f.profile_id, 'display_name', p.display_name, 'phone_masked', admin_mask_phone(p.login_phone),
        'role', f.role, 'team_role_id', f.team_role_id,
        'team_role', (select r.name from admin_roles r where r.id = f.team_role_id),
        'permissions', to_jsonb(f.permissions), 'removed_at', f.removed_at) order by f.removed_at desc)
      from (select * from former_staff order by removed_at desc limit 50) f
      join profiles p on p.id = f.profile_id and p.deleted_at is null), '[]'::jsonb));
end $$;

revoke all on function former_staff_forget(), admin_staff_add_person(uuid, app_admin_role_t, text[], uuid),
  admin_staff_invite_update(text, app_admin_role_t, text[], uuid) from public, anon, authenticated;
grant execute on function admin_staff_add_person(uuid, app_admin_role_t, text[], uuid),
  admin_staff_invite_update(text, app_admin_role_t, text[], uuid) to authenticated;
