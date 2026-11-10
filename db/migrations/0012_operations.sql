-- Operations release (Nov 2026 review): the staff panel becomes an operations console, and the apps gain safety,
-- support and growth features.
--
-- Staff:  custom team roles, invites before first sign-in, two-step sign-in records, one work queue with assignment and
--         deadlines, abuse reports, support tickets, a 360 view of one account, order fulfilment and refunds,
--         coupons, announcements (the scrolling banners), opt-in promotional messages, analytics, app settings
--         (forced update, maintenance, feature switches) and app crash reports.
-- People: report and block, help centre tickets, emergency card for SOS, birthdays and anniversaries, on this day,
--         referrals with free Plus days, marketing opt-in, email verification, removal of people from group chats.
-- Housekeeping: files of deleted accounts and memories are removed from storage; oversized uploads are removed.
--
-- Same rules as before: every staff function checks the caller's permission itself and writes admin_audit_log;
-- clients get no table writes; contact values never leave a function.

-- ===== Permissions: new areas a role can be given =====

alter table app_admin_permissions drop constraint app_admin_permissions_permission_check;
alter table app_admin_permissions add constraint app_admin_permissions_permission_check check (permission in
  ('dictionary', 'takedowns', 'users', 'trees', 'payments', 'support', 'moderation', 'orders', 'marketing', 'analytics', 'settings'));

create function admin_grantable() returns text[]
language sql immutable as $$
  select array['dictionary', 'takedowns', 'users', 'trees', 'payments', 'support', 'moderation', 'orders', 'marketing', 'analytics', 'settings']
$$;

create or replace function has_admin_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_admins a
    join auth.users u on u.id = a.profile_id
    where a.profile_id = auth.uid() and u.banned_at is null
      and (
        (a.role = 'aywo_admin' and (p_permission = any (admin_grantable()) or p_permission in ('staff', 'audit')))
        or (a.role = 'sub_admin' and exists (
          select 1 from app_admin_permissions g where g.profile_id = a.profile_id and g.permission = p_permission
        ))
      )
  )
$$;

-- Team roles: a named set of permissions ("Support", "Moderator"). Staff given a role get exactly its permissions,
-- and changing the role changes everyone in it.
create table admin_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 40),
  description text check (char_length(description) <= 200),
  permissions text[] not null check (cardinality(permissions) > 0),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_admins add column team_role_id uuid references admin_roles (id) on delete set null;

insert into admin_roles (name, description, permissions) values
  ('Support', 'Answers help tickets and looks up accounts.', array['support', 'users']),
  ('Moderator', 'Handles abuse reports, takedowns and relationship words.', array['moderation', 'takedowns', 'dictionary']),
  ('Operations', 'Prints and ships orders, handles refunds.', array['orders', 'payments']),
  ('Marketing', 'Offers, coupons, announcements and analytics.', array['marketing', 'analytics']);

create or replace function admin_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a app_admins;
begin
  perform admin_require_staff();
  select * into a from app_admins where profile_id = auth.uid();
  return jsonb_build_object(
    'role', a.role,
    'team_role', (select r.name from admin_roles r where r.id = a.team_role_id),
    'permissions', case when a.role = 'aywo_admin'
      then to_jsonb(admin_grantable() || array['staff', 'audit'])
      else coalesce((select jsonb_agg(g.permission order by g.permission)
                     from app_admin_permissions g where g.profile_id = auth.uid()), '[]'::jsonb)
    end,
    'open_work', (select count(*) from work_items w where w.assignee_id = auth.uid() and w.status <> 'done'));
end $$;

create function admin_clean_permissions(p_permissions text[]) returns text[]
language plpgsql immutable set search_path = public as $$
declare cleaned text[] := array(select distinct x from unnest(coalesce(p_permissions, '{}')) x order by x);
begin
  if not cleaned <@ admin_grantable() then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  return cleaned;
end $$;

create function admin_roles_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['staff']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'description', r.description, 'permissions', to_jsonb(r.permissions),
      'members', (select count(*) from app_admins a where a.team_role_id = r.id), 'updated_at', r.updated_at
    ) order by r.name)
    from admin_roles r), '[]'::jsonb);
end $$;

create function admin_role_save(p_id uuid, p_name text, p_description text, p_permissions text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  role_id uuid := p_id;
  perms text[] := admin_clean_permissions(p_permissions);
  clean_name text := trim(coalesce(p_name, ''));
begin
  perform admin_require(array['staff']);
  if cardinality(perms) = 0 or char_length(clean_name) not between 2 and 40 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if exists (select 1 from admin_roles r where lower(r.name) = lower(clean_name) and r.id is distinct from p_id) then
    raise exception 'admin_role_name_taken' using errcode = 'PT409';
  end if;
  if role_id is null then
    insert into admin_roles (name, description, permissions, created_by)
    values (clean_name, nullif(trim(coalesce(p_description, '')), ''), perms, auth.uid()) returning id into role_id;
  else
    update admin_roles set name = clean_name, description = nullif(trim(coalesce(p_description, '')), ''),
      permissions = perms, updated_at = now() where id = role_id;
    if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
    -- Everyone in the role gets the new set at once.
    delete from app_admin_permissions g using app_admins a
    where g.profile_id = a.profile_id and a.team_role_id = role_id and a.role = 'sub_admin';
    insert into app_admin_permissions (profile_id, permission, granted_by)
    select a.profile_id, x, auth.uid() from app_admins a, unnest(perms) x
    where a.team_role_id = role_id and a.role = 'sub_admin';
  end if;
  perform admin_log(case when p_id is null then 'role.created' else 'role.updated' end, 'role', role_id::text, null,
    jsonb_build_object('name', clean_name, 'permissions', to_jsonb(perms)));
  return jsonb_build_object('id', role_id);
end $$;

create function admin_role_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform admin_require(array['staff']);
  if exists (select 1 from app_admins a where a.team_role_id = p_id) then
    raise exception 'admin_role_in_use' using errcode = 'PT409';
  end if;
  delete from admin_roles where id = p_id;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_log('role.deleted', 'role', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- Puts one person's permissions in place: an AYWO Admin needs none; a Sub-admin takes the team role's set, or the
-- list given when there is no team role.
create or replace function admin_set_permissions(p_profile uuid, p_role app_admin_role_t, p_permissions text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  team uuid := (select a.team_role_id from app_admins a where a.profile_id = p_profile);
  perms text[];
begin
  delete from app_admin_permissions where profile_id = p_profile;
  if p_role = 'sub_admin' then
    perms := coalesce((select r.permissions from admin_roles r where r.id = team), admin_clean_permissions(p_permissions));
    if coalesce(cardinality(perms), 0) = 0 then
      raise exception 'admin_permission_required' using errcode = 'PT422';
    end if;
    insert into app_admin_permissions (profile_id, permission, granted_by)
    select distinct p_profile, x, auth.uid() from unnest(perms) x;
  end if;
end $$;

-- Staff can now be added before their first sign-in. The invite waits for that number and is used once.
create table staff_invites (
  phone text primary key,
  role app_admin_role_t not null,
  team_role_id uuid references admin_roles (id) on delete set null,
  permissions text[] not null default '{}',
  invited_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
alter table staff_invites enable row level security;

drop function admin_staff_add(text, app_admin_role_t, text[]);
create function admin_staff_add(p_phone text, p_role app_admin_role_t, p_permissions text[] default '{}', p_team_role uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  person uuid;
  perms text[] := admin_clean_permissions(p_permissions);
begin
  perform admin_require(array['staff']);
  if p_team_role is not null and not exists (select 1 from admin_roles r where r.id = p_team_role) then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if p_role = 'sub_admin' and p_team_role is null and cardinality(perms) = 0 then
    raise exception 'admin_permission_required' using errcode = 'PT422';
  end if;
  select p.id into person from profiles p where p.login_phone = p_phone and p.deleted_at is null;
  if person is null then
    insert into staff_invites (phone, role, team_role_id, permissions, invited_by)
    values (p_phone, p_role, case when p_role = 'sub_admin' then p_team_role end, perms, auth.uid())
    on conflict (phone) do update set role = excluded.role, team_role_id = excluded.team_role_id,
      permissions = excluded.permissions, invited_by = excluded.invited_by, created_at = now(),
      expires_at = now() + interval '14 days';
    perform admin_log('staff.invited', 'invite', admin_mask_phone(p_phone), null, jsonb_build_object('role', p_role));
    return jsonb_build_object('invited', true);
  end if;
  if exists (select 1 from app_admins a where a.profile_id = person) then
    raise exception 'admin_already_staff' using errcode = 'PT409';
  end if;
  insert into app_admins (profile_id, role, added_by, team_role_id)
  values (person, p_role, auth.uid(), case when p_role = 'sub_admin' then p_team_role end);
  perform admin_set_permissions(person, p_role, perms);
  perform admin_log('staff.added', 'user', person::text, null,
    jsonb_build_object('role', p_role, 'team_role', p_team_role, 'permissions', to_jsonb(perms)));
  return jsonb_build_object('profile_id', person);
end $$;

drop function admin_staff_update(uuid, app_admin_role_t, text[]);
create function admin_staff_update(p_profile uuid, p_role app_admin_role_t, p_permissions text[] default '{}', p_team_role uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform admin_require(array['staff']);
  if p_profile = auth.uid() then
    raise exception 'admin_cannot_change_self' using errcode = 'PT422';
  end if;
  if p_team_role is not null and not exists (select 1 from admin_roles r where r.id = p_team_role) then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  update app_admins set role = p_role, team_role_id = case when p_role = 'sub_admin' then p_team_role end
  where profile_id = p_profile;
  if not found then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  perform admin_set_permissions(p_profile, p_role, p_permissions);
  -- Work they can no longer open goes back to the queue.
  update work_items w set assignee_id = null, updated_at = now()
  where w.assignee_id = p_profile and w.status <> 'done' and p_role = 'sub_admin'
    and not exists (select 1 from app_admin_permissions g where g.profile_id = p_profile and g.permission = work_permission(w.kind));
  perform admin_log('staff.updated', 'user', p_profile::text, null,
    jsonb_build_object('role', p_role, 'team_role', p_team_role, 'permissions', to_jsonb(coalesce(p_permissions, '{}'))));
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_staff_remove(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform admin_require(array['staff']);
  if p_profile = auth.uid() then
    raise exception 'admin_cannot_change_self' using errcode = 'PT422';
  end if;
  delete from app_admins where profile_id = p_profile;
  if not found then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  update work_items set assignee_id = null, updated_at = now() where assignee_id = p_profile and status <> 'done';
  update auth.refresh_tokens set revoked_at = now() where user_id = p_profile and revoked_at is null;
  perform admin_log('staff.removed', 'user', p_profile::text);
  return jsonb_build_object('ok', true);
end $$;

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
        'team_role', (select r.name from admin_roles r where r.id = i.team_role_id),
        'expires_at', i.expires_at, 'expired', i.expires_at < now()) order by i.created_at desc)
      from staff_invites i), '[]'::jsonb));
end $$;

create function admin_staff_invite_cancel(p_phone_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform admin_require(array['staff']);
  delete from staff_invites where md5(phone) = p_phone_key;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_log('staff.invite_cancelled', 'invite', p_phone_key);
  return jsonb_build_object('ok', true);
end $$;

-- Server only: the sign-in route calls this after a code is accepted. The reviewers' number is refused by the route.
create function staff_invite_claim(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  inv staff_invites;
  my_phone text := (select p.login_phone from profiles p where p.id = p_user);
begin
  select * into inv from staff_invites where phone = my_phone and expires_at > now() for update;
  if not found or exists (select 1 from app_admins a where a.profile_id = p_user) then return false; end if;
  insert into app_admins (profile_id, role, added_by, team_role_id) values (p_user, inv.role, inv.invited_by, inv.team_role_id);
  delete from app_admin_permissions where profile_id = p_user;
  if inv.role = 'sub_admin' then
    insert into app_admin_permissions (profile_id, permission, granted_by)
    select distinct p_user, x, inv.invited_by
    from unnest(coalesce((select r.permissions from admin_roles r where r.id = inv.team_role_id), inv.permissions)) x;
  end if;
  delete from staff_invites where phone = my_phone;
  insert into admin_audit_log (actor_id, action, target_type, target_id, details)
  values (inv.invited_by, 'staff.invite_used', 'user', p_user::text, jsonb_build_object('role', inv.role));
  return true;
end $$;

-- ===== Two-step sign-in for staff (authenticator app). The API checks the codes; nothing here is granted to clients. =====

create table admin_mfa (
  profile_id uuid primary key references app_admins (profile_id) on delete cascade,
  secret text not null,
  confirmed_at timestamptz,
  last_step bigint not null default 0,
  created_at timestamptz not null default now()
);
alter table admin_mfa enable row level security;

create function admin_mfa_reset(p_profile uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cleaned text := admin_clean_reason(p_reason);
begin
  perform admin_require(array['staff']);
  if p_profile = auth.uid() then
    raise exception 'admin_cannot_change_self' using errcode = 'PT422';
  end if;
  delete from admin_mfa where profile_id = p_profile;
  update auth.refresh_tokens set revoked_at = now() where user_id = p_profile and revoked_at is null;
  perform admin_log('staff.two_step_reset', 'user', p_profile::text, cleaned);
  return jsonb_build_object('ok', true);
end $$;

-- ===== One work queue: everything staff must act on, with an owner and a deadline =====

create table work_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('takedown', 'report', 'ticket', 'order', 'term_report')),
  ref_id uuid not null,
  title text not null check (char_length(title) <= 160),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references profiles (id) on delete set null,
  due_at timestamptz not null,
  overdue_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  unique (kind, ref_id)
);
create index work_items_open_idx on work_items (status, due_at) where status <> 'done';
create index work_items_assignee_idx on work_items (assignee_id) where status <> 'done';

create table work_notes (
  id bigint generated always as identity primary key,
  item_id uuid not null references work_items (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index work_notes_item_idx on work_notes (item_id, id);
alter table work_items enable row level security;
alter table work_notes enable row level security;

-- Which permission opens each kind of work.
create function work_permission(p_kind text) returns text
language sql immutable as $$
  select case p_kind when 'takedown' then 'takedowns' when 'report' then 'moderation' when 'ticket' then 'support'
                     when 'order' then 'orders' when 'term_report' then 'dictionary' end
$$;

-- How long each kind may wait. Abuse reports: 24 hours (App Store and IT Rules expect quick action).
create function work_sla(p_kind text) returns interval
language sql immutable as $$
  select case p_kind when 'report' then interval '24 hours' when 'takedown' then interval '72 hours'
                     when 'ticket' then interval '48 hours' when 'order' then interval '72 hours'
                     else interval '7 days' end
$$;

create function work_open(p_kind text, p_ref uuid, p_title text, p_priority text default 'normal') returns void
language sql security definer set search_path = public as $$
  insert into work_items (kind, ref_id, title, priority, due_at)
  values (p_kind, p_ref, left(coalesce(nullif(trim(p_title), ''), p_kind), 160), p_priority, now() + work_sla(p_kind))
  on conflict (kind, ref_id) do update set status = case when work_items.status = 'done' then 'open' else work_items.status end,
    done_at = null, updated_at = now()
$$;

create function work_close(p_kind text, p_ref uuid) returns void
language sql security definer set search_path = public as $$
  update work_items set status = 'done', done_at = now(), updated_at = now()
  where kind = p_kind and ref_id = p_ref and status <> 'done'
$$;

create function work_track_takedown() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform work_open('takedown', new.id, coalesce(new.subject_name, 'Takedown request'), 'high');
  elsif new.status <> 'open' and old.status = 'open' then
    perform work_close('takedown', new.id);
  end if;
  return null;
end $$;
create trigger takedown_requests_work after insert or update of status on takedown_requests
  for each row execute function work_track_takedown();

create function work_track_term_report() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform work_open('term_report', new.id, 'Wrong word report', 'low');
  elsif new.status <> 'open' and old.status = 'open' then
    perform work_close('term_report', new.id);
  end if;
  return null;
end $$;
create trigger term_reports_work after insert or update of status on term_reports
  for each row execute function work_track_term_report();

-- Existing open items join the queue.
insert into work_items (kind, ref_id, title, priority, due_at, created_at)
select 'takedown', d.id, coalesce(d.subject_name, 'Takedown request'), 'high', d.created_at + interval '72 hours', d.created_at
from takedown_requests d where d.status = 'open';
insert into work_items (kind, ref_id, title, priority, due_at, created_at)
select 'term_report', r.id, 'Wrong word report', 'low', r.created_at + interval '7 days', r.created_at
from term_reports r where r.status = 'open';

create function admin_work_kinds() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(k), '{}') from unnest(array['takedown', 'report', 'ticket', 'order', 'term_report']) k
  where has_admin_permission(work_permission(k))
$$;

create function admin_work_json(w work_items) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', w.id, 'kind', w.kind, 'ref_id', w.ref_id, 'title', w.title, 'status', w.status, 'priority', w.priority,
    'assignee_id', w.assignee_id, 'assignee_name', (select p.display_name from profiles p where p.id = w.assignee_id),
    'due_at', w.due_at, 'overdue', w.status <> 'done' and w.due_at < now(),
    'created_at', w.created_at, 'updated_at', w.updated_at, 'done_at', w.done_at,
    'notes', (select count(*) from work_notes n where n.item_id = w.id))
$$;

-- p_view: 'open' (not done), 'mine', 'unassigned', 'overdue', 'done'.
create function admin_work_list(p_view text default 'open', p_kind text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  kinds text[] := admin_work_kinds();
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require_staff();
  if p_kind is not null then kinds := array(select k from unnest(kinds) k where k = p_kind); end if;
  -- Done work: newest first. Open work: most urgent, then the nearest deadline.
  with hits as (
    select w as item,
           case when coalesce(p_view, 'open') = 'done' then -extract(epoch from w.done_at)
                else case w.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end end as rank_key,
           w.due_at, w.id
    from work_items w
    where w.kind = any (kinds)
      and case coalesce(p_view, 'open')
            when 'mine' then w.assignee_id = auth.uid() and w.status <> 'done'
            when 'unassigned' then w.assignee_id is null and w.status <> 'done'
            when 'overdue' then w.status <> 'done' and w.due_at < now()
            when 'done' then w.status = 'done'
            else w.status <> 'done' end
  )
  select (select count(*)::int from hits),
         (select coalesce(jsonb_agg(admin_work_json(y.item) order by y.rank_key, y.due_at, y.id), '[]'::jsonb)
          from (select * from hits h order by h.rank_key, h.due_at, h.id
                limit admin_limit(p_limit) offset admin_offset(p_offset)) y)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows,
    'counts', jsonb_build_object(
      'open', (select count(*) from work_items w where w.kind = any (admin_work_kinds()) and w.status <> 'done'),
      'mine', (select count(*) from work_items w where w.kind = any (admin_work_kinds()) and w.status <> 'done' and w.assignee_id = auth.uid()),
      'unassigned', (select count(*) from work_items w where w.kind = any (admin_work_kinds()) and w.status <> 'done' and w.assignee_id is null),
      'overdue', (select count(*) from work_items w where w.kind = any (admin_work_kinds()) and w.status <> 'done' and w.due_at < now())));
end $$;

create function admin_work_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w work_items;
begin
  perform admin_require_staff();
  select * into w from work_items where id = p_id;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_require(array[work_permission(w.kind)]);
  return admin_work_json(w) || jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'author_name', p.display_name, 'body', n.body, 'created_at', n.created_at) order by n.id)
                         from work_notes n left join profiles p on p.id = n.author_id where n.item_id = w.id), '[]'::jsonb),
    'assignable', coalesce((select jsonb_agg(jsonb_build_object('profile_id', a.profile_id, 'name', p.display_name) order by p.display_name)
                            from app_admins a join profiles p on p.id = a.profile_id join auth.users u on u.id = a.profile_id
                            where u.banned_at is null and (a.role = 'aywo_admin' or exists (
                              select 1 from app_admin_permissions g where g.profile_id = a.profile_id and g.permission = work_permission(w.kind)))), '[]'::jsonb));
end $$;

-- Changes owner, status, priority or deadline. A new owner is told at once (push and the admin queue).
create function admin_work_update(p_id uuid, p_status text default null, p_priority text default null,
  p_assignee uuid default null, p_unassign boolean default false, p_due_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w work_items;
  changes jsonb := '{}';
begin
  perform admin_require_staff();
  select * into w from work_items where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_require(array[work_permission(w.kind)]);
  if p_status is not null and p_status not in ('open', 'in_progress', 'waiting', 'done') then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_assignee is not null and not exists (
    select 1 from app_admins a join auth.users u on u.id = a.profile_id
    where a.profile_id = p_assignee and u.banned_at is null and (a.role = 'aywo_admin' or exists (
      select 1 from app_admin_permissions g where g.profile_id = a.profile_id and g.permission = work_permission(w.kind)))) then
    raise exception 'admin_assignee_not_allowed' using errcode = 'PT422';
  end if;
  if p_due_at is not null and p_due_at < now() - interval '1 minute' then raise exception 'bad_input' using errcode = 'PT422'; end if;

  update work_items set
    status = coalesce(p_status, status),
    done_at = case when coalesce(p_status, status) = 'done' then coalesce(done_at, now()) else null end,
    priority = coalesce(p_priority, priority),
    assignee_id = case when p_unassign then null else coalesce(p_assignee, assignee_id) end,
    due_at = coalesce(p_due_at, due_at),
    overdue_notified_at = case when p_due_at is not null then null else overdue_notified_at end,
    updated_at = now()
  where id = p_id;

  if p_status is not null and p_status <> w.status then changes := changes || jsonb_build_object('status', p_status); end if;
  if p_priority is not null and p_priority <> w.priority then changes := changes || jsonb_build_object('priority', p_priority); end if;
  if p_due_at is not null then changes := changes || jsonb_build_object('due_at', p_due_at); end if;
  if p_unassign and w.assignee_id is not null then changes := changes || jsonb_build_object('assignee', null); end if;
  if p_assignee is not null and p_assignee is distinct from w.assignee_id then
    changes := changes || jsonb_build_object('assignee', p_assignee);
    if p_assignee <> auth.uid() then
      insert into notifications (recipient_id, kind, payload)
      values (p_assignee, 'staff_assigned', jsonb_build_object('item_id', w.id, 'title', w.title, 'by', auth.uid()));
    end if;
  end if;
  if changes <> '{}' then
    insert into work_notes (item_id, author_id, body)
    values (p_id, auth.uid(), 'Changed: ' || (select string_agg(k || ' ' || coalesce(v #>> '{}', 'none'), ', ') from jsonb_each(changes) e(k, v)));
    perform admin_log('work.updated', 'work_item', p_id::text, null, changes);
  end if;
  return admin_work_json((select x from work_items x where x.id = p_id));
end $$;

create function admin_work_note(p_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w work_items;
begin
  perform admin_require_staff();
  select * into w from work_items where id = p_id;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_require(array[work_permission(w.kind)]);
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  insert into work_notes (item_id, author_id, body) values (p_id, auth.uid(), trim(p_body));
  update work_items set updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Job: tell the owner (or every AYWO Admin when nobody owns it) once when an item passes its deadline.
create function work_overdue_notify() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with late as (
    update work_items set overdue_notified_at = now()
    where status <> 'done' and due_at < now() and overdue_notified_at is null
    returning id, title, assignee_id
  ), targets as (
    select l.id, l.title, l.assignee_id as who from late l where l.assignee_id is not null
    union all
    select l.id, l.title, a.profile_id from late l cross join app_admins a where l.assignee_id is null and a.role = 'aywo_admin'
  )
  insert into notifications (recipient_id, kind, payload)
  select t.who, 'staff_overdue', jsonb_build_object('item_id', t.id, 'title', t.title) from targets t;
  get diagnostics n = row_count;
  return n;
end $$;

-- ===== Report and block (App Store guideline 1.2, Google Play UGC policy, IT Rules 2021) =====

create table content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references profiles (id) on delete set null,
  target_type text not null check (target_type in ('post', 'post_comment', 'message', 'person_comment', 'profile')),
  target_id uuid not null,
  target_owner uuid references profiles (id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'fake', 'other')),
  note text check (char_length(note) <= 1000),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  decided_by uuid references profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create unique index content_reports_once on content_reports (reporter_id, target_type, target_id) where status = 'open';
create index content_reports_status_idx on content_reports (status, created_at);
alter table content_reports enable row level security;

create table user_blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on user_blocks (blocked_id);
alter table user_blocks enable row level security;

-- Everyone the caller blocked, and everyone who blocked the caller. Neither side sees the other's posts or messages.
create function social_blocked_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select blocked_id from user_blocks where blocker_id = auth.uid()
  union
  select blocker_id from user_blocks where blocked_id = auth.uid()
$$;

create function social_hidden_people() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from social_blocked_ids() x
$$;

-- Blocked people leave each other's circle: no new chats, invites, alerts or tags between them.
create or replace function social_circle() returns setof uuid
language sql stable security definer set search_path = public as $$
  select x from (
    select v as x from social_my_tree_ids() t, lateral social_visible_tree_members(t) v
    union
    select m.profile_id from group_members m
    join group_members mine on mine.group_id = m.group_id and mine.profile_id = auth.uid()
    join groups g on g.id = m.group_id and g.deleted_at is null
  ) c
  where x not in (select social_blocked_ids())
$$;

-- A blocked person cannot write in a one-to-one chat with the person who blocked them, or the other way round.
create function messages_block_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sender_id is not null and exists (
    select 1 from chats c join chat_members o on o.chat_id = c.id and o.profile_id <> new.sender_id
    join user_blocks b on (b.blocker_id = o.profile_id and b.blocked_id = new.sender_id)
                       or (b.blocker_id = new.sender_id and b.blocked_id = o.profile_id)
    where c.id = new.chat_id and c.kind = 'direct'
  ) then
    raise exception 'chat_blocked' using errcode = 'PT403';
  end if;
  return new;
end $$;
create trigger messages_no_blocked before insert on messages for each row execute function messages_block_guard();

create function block_user(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if p_profile is null or p_profile = me or not exists (select 1 from profiles where id = p_profile) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if (select count(*) from user_blocks where blocker_id = me) >= 500 then
    raise exception 'too_many_requests' using errcode = 'PT429';
  end if;
  insert into user_blocks (blocker_id, blocked_id) values (me, p_profile) on conflict do nothing;
  -- Their SOS contact link to me ends too: someone I blocked should not follow my location.
  delete from sos_contacts where profile_id = me and contact_profile_id = p_profile;
  return jsonb_build_object('ok', true);
end $$;

create function unblock_user(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from user_blocks where blocker_id = social_me() and blocked_id = p_profile;
  return jsonb_build_object('ok', true);
end $$;

create function blocked_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', b.blocked_id, 'name', social_name(b.blocked_id), 'since', b.created_at)
                            order by b.created_at desc), '[]'::jsonb)
  from user_blocks b where b.blocker_id = social_me()
$$;

-- Anyone who can see a thing can report it. The owner is stored so staff can act on the person, not only the item.
create function report_content(p_type text, p_id uuid, p_reason text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  owner uuid;
  visible boolean := false;
  title text;
  report_id uuid;
begin
  if p_reason not in ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'fake', 'other')
     or char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if (select count(*) from content_reports r where r.reporter_id = me and r.created_at > now() - interval '1 day') >= 30 then
    raise exception 'too_many_requests' using errcode = 'PT429';
  end if;
  if p_type = 'post' then
    select p.author_id into owner from posts p where p.id = p_id and p.deleted_at is null;
    visible := owner is not null and social_can_view_post(p_id);
  elsif p_type = 'post_comment' then
    select c.author_id into owner from post_comments c where c.id = p_id and c.deleted_at is null;
    visible := owner is not null and social_can_view_post((select c.post_id from post_comments c where c.id = p_id));
  elsif p_type = 'message' then
    select m.sender_id into owner from messages m where m.id = p_id and m.deleted_at is null;
    visible := owner is not null and social_in_chat((select m.chat_id from messages m where m.id = p_id));
  elsif p_type = 'person_comment' then
    select c.author_id into owner from comments c where c.id = p_id;
    visible := owner is not null and tree_role((select c.tree_id from comments c where c.id = p_id)) <> 'none';
  elsif p_type = 'profile' then
    owner := p_id;
    visible := exists (select 1 from profiles where id = p_id and deleted_at is null) and p_id <> me;
  else
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if not visible or owner = me then raise exception 'not_allowed' using errcode = 'PT403'; end if;

  insert into content_reports (reporter_id, target_type, target_id, target_owner, reason, note)
  values (me, p_type, p_id, owner, p_reason, nullif(trim(coalesce(p_note, '')), ''))
  on conflict do nothing returning id into report_id;
  if report_id is not null then
    title := 'Report: ' || p_reason || ' (' || replace(p_type, '_', ' ') || ')';
    perform work_open('report', report_id, title,
      case when p_reason in ('self_harm', 'violence', 'nudity') then 'urgent' when p_reason in ('harassment', 'hate') then 'high' else 'normal' end);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function admin_report_target(r content_reports) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return case r.target_type
    when 'post' then (select jsonb_build_object('text', left(p.body, 600), 'photos', (select count(*) from post_media m where m.post_id = p.id),
                       'gone', p.deleted_at is not null) from posts p where p.id = r.target_id)
    when 'post_comment' then (select jsonb_build_object('text', left(c.body, 600), 'gone', c.deleted_at is not null)
                       from post_comments c where c.id = r.target_id)
    when 'message' then (select jsonb_build_object('text', left(m.body, 600), 'media', m.media_kind, 'gone', m.deleted_at is not null)
                       from messages m where m.id = r.target_id)
    when 'person_comment' then (select jsonb_build_object('text', left(c.body, 600), 'gone', false) from comments c where c.id = r.target_id)
    else jsonb_build_object('text', null, 'gone', false)
  end;
end $$;

create function admin_reports_list(p_status text default 'open', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['moderation']);
  select count(*)::int into total_rows from content_reports r where r.status = wanted;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'target_type', x.target_type, 'target_id', x.target_id, 'reason', x.reason, 'note', x.note,
      'status', x.status, 'created_at', x.created_at,
      'reporter_name', (select p.display_name from profiles p where p.id = x.reporter_id),
      'owner_id', x.target_owner,
      'owner_name', (select p.display_name from profiles p where p.id = x.target_owner),
      'owner_reports', (select count(*) from content_reports o where o.target_owner = x.target_owner and o.status = 'removed'),
      'owner_blocked', (select u.banned_at is not null from auth.users u where u.id = x.target_owner),
      'same_target', (select count(*) from content_reports o where o.target_type = x.target_type and o.target_id = x.target_id),
      'target', admin_report_target(x),
      'decision_note', x.decision_note, 'decided_at', x.decided_at,
      'decided_by_name', (select p.display_name from profiles p where p.id = x.decided_by),
      'work_id', (select w.id from work_items w where w.kind = 'report' and w.ref_id = x.id)
    ) order by x.created_at, x.id), '[]'::jsonb)
  into page_rows
  from (select * from content_reports r where r.status = wanted
        order by r.created_at, r.id limit admin_limit(p_limit) offset admin_offset(p_offset)) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- 'remove' takes the item down (a profile report blocks the account) and closes every open report on the same item.
create function admin_report_decide(p_id uuid, p_decision text, p_note text, p_block_owner boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r content_reports;
  cleaned text;
  closed_ids uuid[];
begin
  perform admin_require(array['moderation']);
  if p_decision not in ('remove', 'dismiss') then raise exception 'bad_input' using errcode = 'PT422'; end if;
  cleaned := admin_clean_reason(p_note);
  select * into r from content_reports where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if r.status <> 'open' then raise exception 'admin_already_decided' using errcode = 'PT409'; end if;

  if p_decision = 'remove' then
    if r.target_type = 'post' then update posts set deleted_at = coalesce(deleted_at, now()) where id = r.target_id;
    elsif r.target_type = 'post_comment' then update post_comments set deleted_at = coalesce(deleted_at, now()) where id = r.target_id;
    elsif r.target_type = 'message' then update messages set deleted_at = coalesce(deleted_at, now()), body = null where id = r.target_id;
    elsif r.target_type = 'person_comment' then delete from comments where id = r.target_id;
    end if;
  end if;
  if (p_block_owner or (p_decision = 'remove' and r.target_type = 'profile')) and r.target_owner is not null then
    if exists (select 1 from app_admins a where a.profile_id = r.target_owner) then
      raise exception 'admin_staff_only' using errcode = 'PT403';
    end if;
    update auth.users set banned_at = now() where id = r.target_owner and banned_at is null;
    update auth.refresh_tokens set revoked_at = now() where user_id = r.target_owner and revoked_at is null;
    perform admin_log('user.blocked', 'user', r.target_owner::text, cleaned, jsonb_build_object('report_id', p_id));
  end if;

  with done as (
    update content_reports set status = case when p_decision = 'remove' then 'removed' else 'dismissed' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = cleaned
    where status = 'open' and (id = p_id or (p_decision = 'remove' and target_type = r.target_type and target_id = r.target_id))
    returning id, reporter_id
  ), told as (
    insert into notifications (recipient_id, kind, payload)
    select d.reporter_id, 'report_decided', jsonb_build_object('decision', p_decision) from done d where d.reporter_id is not null
  )
  select array_agg(id) into closed_ids from done;
  update work_items set status = 'done', done_at = now(), updated_at = now()
  where kind = 'report' and ref_id = any (closed_ids) and status <> 'done';
  perform admin_log('report.' || p_decision, 'report', p_id::text, cleaned,
    jsonb_build_object('target_type', r.target_type, 'target_id', r.target_id, 'closed', cardinality(closed_ids), 'blocked_owner', p_block_owner));
  return jsonb_build_object('ok', true, 'closed', cardinality(closed_ids));
end $$;

-- ===== Help centre: tickets between a person and AYWO support =====

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 3 and 120),
  category text not null check (category in ('account', 'payment', 'order', 'tree', 'privacy', 'safety', 'bug', 'other')),
  status text not null default 'open' check (status in ('open', 'waiting', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index support_tickets_profile_idx on support_tickets (profile_id, updated_at desc);
create index support_tickets_status_idx on support_tickets (status, updated_at);

create table support_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references support_tickets (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  from_staff boolean not null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on support_messages (ticket_id, id);
alter table support_tickets enable row level security;
alter table support_messages enable row level security;

create function ticket_json(t support_tickets, p_full boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'subject', t.subject, 'category', t.category, 'status', t.status,
    'created_at', t.created_at, 'updated_at', t.updated_at, 'closed_at', t.closed_at,
    'last', (select jsonb_build_object('from_staff', m.from_staff, 'body', left(m.body, 140), 'at', m.created_at)
             from support_messages m where m.ticket_id = t.id order by m.id desc limit 1))
  || case when p_full then jsonb_build_object('messages', coalesce((
       select jsonb_agg(jsonb_build_object('id', m.id, 'from_staff', m.from_staff, 'body', m.body, 'created_at', m.created_at,
                                           'author', case when m.from_staff then 'AYWO Support' else social_name(m.author_id) end) order by m.id)
       from support_messages m where m.ticket_id = t.id), '[]'::jsonb)) else '{}'::jsonb end
$$;

create function ticket_create(p_subject text, p_category text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  t support_tickets;
begin
  if char_length(trim(coalesce(p_subject, ''))) not between 3 and 120 or char_length(trim(coalesce(p_body, ''))) not between 1 and 4000
     or p_category not in ('account', 'payment', 'order', 'tree', 'privacy', 'safety', 'bug', 'other') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if (select count(*) from support_tickets x where x.profile_id = me and x.created_at > now() - interval '1 day') >= 5
     or (select count(*) from support_tickets x where x.profile_id = me and x.status <> 'closed') >= 5 then
    raise exception 'too_many_requests' using errcode = 'PT429';
  end if;
  insert into support_tickets (profile_id, subject, category) values (me, trim(p_subject), p_category) returning * into t;
  insert into support_messages (ticket_id, author_id, from_staff, body) values (t.id, me, false, trim(p_body));
  perform work_open('ticket', t.id, t.subject, case when p_category in ('safety', 'privacy', 'payment') then 'high' else 'normal' end);
  return ticket_json(t, true);
end $$;

create function ticket_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(ticket_json(t, false) order by t.updated_at desc), '[]'::jsonb)
  from support_tickets t where t.profile_id = social_me()
$$;

create function ticket_detail(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t support_tickets;
begin
  select * into t from support_tickets where id = p_ticket and profile_id = social_me();
  if not found then raise exception 'not_found' using errcode = 'PT404'; end if;
  return ticket_json(t, true);
end $$;

create function ticket_reply(p_ticket uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  t support_tickets;
begin
  select * into t from support_tickets where id = p_ticket and profile_id = me for update;
  if not found then raise exception 'not_found' using errcode = 'PT404'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if (select count(*) from support_messages m where m.author_id = me and m.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_requests' using errcode = 'PT429';
  end if;
  insert into support_messages (ticket_id, author_id, from_staff, body) values (t.id, me, false, trim(p_body));
  update support_tickets set status = 'open', closed_at = null, updated_at = now() where id = t.id returning * into t;
  perform work_open('ticket', t.id, t.subject);
  update work_items set status = 'open', updated_at = now() where kind = 'ticket' and ref_id = t.id and status = 'waiting';
  return ticket_json(t, true);
end $$;

create function ticket_close(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update support_tickets set status = 'closed', closed_at = now(), updated_at = now()
  where id = p_ticket and profile_id = social_me() and status <> 'closed';
  perform work_close('ticket', p_ticket);
  return jsonb_build_object('ok', true);
end $$;

create function admin_tickets_list(p_status text default 'open', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['support']);
  select count(*)::int into total_rows from support_tickets t where t.status = wanted;
  select coalesce(jsonb_agg(ticket_json(x, false) || jsonb_build_object(
      'profile_id', x.profile_id, 'name', (select p.display_name from profiles p where p.id = x.profile_id),
      'work_id', (select w.id from work_items w where w.kind = 'ticket' and w.ref_id = x.id),
      'assignee_name', (select p.display_name from work_items w join profiles p on p.id = w.assignee_id where w.kind = 'ticket' and w.ref_id = x.id))
    order by x.updated_at, x.id), '[]'::jsonb)
  into page_rows
  from (select * from support_tickets t where t.status = wanted
        order by t.updated_at, t.id limit admin_limit(p_limit) offset admin_offset(p_offset)) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

create function admin_ticket_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t support_tickets;
begin
  perform admin_require(array['support']);
  select * into t from support_tickets where id = p_id;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  return ticket_json(t, true) || jsonb_build_object(
    'profile_id', t.profile_id, 'name', (select p.display_name from profiles p where p.id = t.profile_id),
    'plus', has_plus(t.profile_id), 'language', (select p.language_code from profiles p where p.id = t.profile_id),
    'work_id', (select w.id from work_items w where w.kind = 'ticket' and w.ref_id = t.id));
end $$;

-- A staff answer goes to the person as a notification. p_close ends the ticket; otherwise it waits for their reply.
create function admin_ticket_reply(p_id uuid, p_body text, p_close boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t support_tickets;
begin
  perform admin_require(array['support']);
  select * into t from support_tickets where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  insert into support_messages (ticket_id, author_id, from_staff, body) values (t.id, auth.uid(), true, trim(p_body));
  update support_tickets set status = case when p_close then 'closed' else 'waiting' end,
    closed_at = case when p_close then now() end, updated_at = now() where id = t.id;
  if p_close then
    perform work_close('ticket', t.id);
  else
    update work_items set status = 'waiting', updated_at = now() where kind = 'ticket' and ref_id = t.id and status <> 'done';
  end if;
  insert into notifications (recipient_id, kind, payload)
  values (t.profile_id, 'ticket_reply', jsonb_build_object('ticket_id', t.id, 'title', t.subject));
  perform admin_log(case when p_close then 'ticket.answered_closed' else 'ticket.answered' end, 'ticket', t.id::text);
  return jsonb_build_object('ok', true);
end $$;

-- ===== Plus given free: referral rewards and goodwill days from support =====

alter table profiles
  add column plus_bonus_until timestamptz,
  add column referral_code text unique,
  add column marketing_opt_in boolean not null default false,
  add column marketing_opt_in_at timestamptz,
  add column email_verified_at timestamptz;

create or replace function has_plus(p_profile uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_plans f
    left join family_plan_members m on m.plan_id = f.id
    where f.status in ('trial', 'active', 'grace')
      and (f.payer_id = p_profile or m.profile_id = p_profile)
  ) or exists (select 1 from profiles p where p.id = p_profile and p.plus_bonus_until > now())
$$;

-- A changed email is unverified again.
create function profiles_email_unverify() returns trigger language plpgsql as $$
begin
  if new.email is distinct from old.email then new.email_verified_at := null; end if;
  return new;
end $$;
create trigger profiles_email_changed before update of email on profiles for each row execute function profiles_email_unverify();

create function admin_user_give_plus(p_user uuid, p_days int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := admin_clean_reason(p_reason);
  until_at timestamptz;
begin
  perform admin_require(array['payments', 'support']);
  if p_days not between 1 and 365 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update profiles set plus_bonus_until = greatest(coalesce(plus_bonus_until, now()), now()) + make_interval(days => p_days)
  where id = p_user and deleted_at is null returning plus_bonus_until into until_at;
  if not found then raise exception 'admin_user_not_found' using errcode = 'PT404'; end if;
  insert into notifications (recipient_id, kind, payload) values (p_user, 'plus_gift', jsonb_build_object('ends_at', until_at));
  perform admin_log('user.plus_given', 'user', p_user::text, cleaned, jsonb_build_object('days', p_days));
  return jsonb_build_object('plus_bonus_until', until_at);
end $$;

create function admin_user_end_sessions(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cleaned text := admin_clean_reason(p_reason);
begin
  perform admin_require(array['users']);
  if exists (select 1 from app_admins a where a.profile_id = p_user) and not has_admin_permission('staff') then
    raise exception 'admin_staff_only' using errcode = 'PT403';
  end if;
  update auth.refresh_tokens set revoked_at = now() where user_id = p_user and revoked_at is null;
  perform admin_log('user.sessions_ended', 'user', p_user::text, cleaned);
  return jsonb_build_object('ok', true);
end $$;

-- ===== Referrals: invite someone new; when they join a family tree, both get 30 days of Plus =====

create table referrals (
  referred_id uuid primary key references profiles (id) on delete cascade,
  referrer_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  check (referred_id <> referrer_id)
);
create index referrals_referrer_idx on referrals (referrer_id);
alter table referrals enable row level security;

create function referral_my() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  code text := (select p.referral_code from profiles p where p.id = me);
begin
  while code is null loop
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      update profiles set referral_code = code where id = me;
    exception when unique_violation then code := null;
    end;
  end loop;
  return jsonb_build_object(
    'code', code,
    'joined', (select count(*) from referrals r where r.referrer_id = me),
    'rewarded', (select count(*) from referrals r where r.referrer_id = me and r.rewarded_at is not null),
    'bonus_until', (select p.plus_bonus_until from profiles p where p.id = me),
    'reward_days', 30);
end $$;

-- Only a new account (14 days) can say who invited it, once.
create function referral_claim(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  inviter uuid;
begin
  select p.id into inviter from profiles p join auth.users u on u.id = p.id
  where p.referral_code = upper(trim(coalesce(p_code, ''))) and p.deleted_at is null and u.banned_at is null;
  if inviter is null or inviter = me then raise exception 'referral_invalid' using errcode = 'PT422'; end if;
  if (select p.created_at from profiles p where p.id = me) < now() - interval '14 days' then
    raise exception 'referral_too_late' using errcode = 'PT409';
  end if;
  if exists (select 1 from referrals r where r.referred_id = me) then
    raise exception 'referral_already' using errcode = 'PT409';
  end if;
  insert into referrals (referred_id, referrer_id) values (me, inviter);
  return jsonb_build_object('ok', true, 'by', social_name(inviter));
end $$;

-- Job. Rewards come when the new person is really in a family tree, so empty sign-ups earn nothing.
-- An inviter earns at most 12 rewards a year.
create function referral_rewards() returns int
language plpgsql security definer set search_path = public as $$
declare
  r referrals;
  n int := 0;
begin
  for r in
    select x.* from referrals x
    join profiles np on np.id = x.referred_id and np.deleted_at is null
    where x.rewarded_at is null
      and (exists (select 1 from trees t where t.creator_id = x.referred_id and t.deleted_at is null
                   and (select count(*) from persons p where p.tree_id = t.id and p.deleted_at is null) >= 3)
           or exists (select 1 from shares s where s.grantee_profile_id = x.referred_id and s.revoked_at is null))
    for update of x skip locked
  loop
    update referrals set rewarded_at = now() where referred_id = r.referred_id;
    update profiles set plus_bonus_until = greatest(coalesce(plus_bonus_until, now()), now()) + interval '30 days' where id = r.referred_id;
    insert into notifications (recipient_id, kind, payload) values (r.referred_id, 'referral_reward', jsonb_build_object('days', 30));
    if (select count(*) from referrals x where x.referrer_id = r.referrer_id and x.rewarded_at > now() - interval '365 days') <= 12 then
      update profiles set plus_bonus_until = greatest(coalesce(plus_bonus_until, now()), now()) + interval '30 days' where id = r.referrer_id;
      insert into notifications (recipient_id, kind, payload)
      values (r.referrer_id, 'referral_reward', jsonb_build_object('days', 30, 'by', r.referred_id));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===== Marketing opt-in and the person's extra settings =====

create function my_extras() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return (select jsonb_build_object(
    'marketing_opt_in', p.marketing_opt_in,
    'email_verified', p.email is not null and p.email_verified_at is not null,
    'plus_bonus_until', p.plus_bonus_until,
    'has_emergency_card', exists (select 1 from emergency_cards e where e.profile_id = p.id),
    'blocked', (select count(*) from user_blocks b where b.blocker_id = p.id),
    'open_tickets', (select count(*) from support_tickets t where t.profile_id = p.id and t.status = 'waiting'))
  from profiles p where p.id = social_me());
end $$;

create function marketing_set(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update profiles set marketing_opt_in = coalesce(p_on, false), marketing_opt_in_at = now() where id = social_me();
  return jsonb_build_object('marketing_opt_in', coalesce(p_on, false));
end $$;

-- ===== Emergency card: shown to the people an SOS reaches =====

create table emergency_cards (
  profile_id uuid primary key references profiles (id) on delete cascade,
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text check (char_length(allergies) <= 300),
  conditions text check (char_length(conditions) <= 300),
  medications text check (char_length(medications) <= 300),
  note text check (char_length(note) <= 300),
  updated_at timestamptz not null default now()
);
alter table emergency_cards enable row level security;

create function emergency_card_json(e emergency_cards) returns jsonb
language sql immutable as $$
  select case when e.profile_id is null then null else jsonb_build_object(
    'blood_group', e.blood_group, 'allergies', e.allergies, 'conditions', e.conditions,
    'medications', e.medications, 'note', e.note, 'updated_at', e.updated_at) end
$$;

create function emergency_card_get() returns jsonb
language sql stable security definer set search_path = public as $$
  select emergency_card_json(e) from emergency_cards e where e.profile_id = social_me()
$$;

create function emergency_card_save(p_card jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e emergency_cards;
  clean jsonb := coalesce(p_card, '{}');
begin
  if exists (select 1 from jsonb_object_keys(clean) k where k not in ('blood_group', 'allergies', 'conditions', 'medications', 'note')) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  insert into emergency_cards (profile_id, blood_group, allergies, conditions, medications, note, updated_at)
  values (me, nullif(clean ->> 'blood_group', ''), nullif(trim(clean ->> 'allergies'), ''), nullif(trim(clean ->> 'conditions'), ''),
          nullif(trim(clean ->> 'medications'), ''), nullif(trim(clean ->> 'note'), ''), now())
  on conflict (profile_id) do update set blood_group = excluded.blood_group, allergies = excluded.allergies,
    conditions = excluded.conditions, medications = excluded.medications, note = excluded.note, updated_at = now()
  returning * into e;
  return emergency_card_json(e);
end $$;

create function emergency_card_delete() returns jsonb
language sql security definer set search_path = public as $$
  delete from emergency_cards where profile_id = social_me();
  select jsonb_build_object('ok', true)
$$;

-- Only to people the SOS reached, while it runs and for a day after.
create function sos_emergency_card(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e sos_events;
begin
  perform social_me();
  if not social_can_see_sos(p_event) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into e from sos_events where id = p_event;
  if e.ended_at is not null and e.ended_at < now() - interval '1 day' then return null; end if;
  return (select emergency_card_json(c) from emergency_cards c where c.profile_id = e.profile_id);
end $$;

-- ===== Birthdays, anniversaries and on this day =====

create function next_occurrence(p_date date) returns date
language sql stable as $$
  select case when make_date(extract(year from current_date)::int, extract(month from p_date)::int,
                             least(extract(day from p_date)::int, case when extract(month from p_date) = 2 then 28 else 31 end)) >= current_date
              then make_date(extract(year from current_date)::int, extract(month from p_date)::int,
                             least(extract(day from p_date)::int, case when extract(month from p_date) = 2 then 28 else 31 end))
              else make_date(extract(year from current_date)::int + 1, extract(month from p_date)::int,
                             least(extract(day from p_date)::int, case when extract(month from p_date) = 2 then 28 else 31 end)) end
$$;

-- Living people with a known day and month, in trees the caller can see. Ages only when the year is known exactly.
create function upcoming_dates(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  span int := least(greatest(coalesce(p_days, 30), 1), 60);
begin
  return coalesce((
    select jsonb_agg(x order by x ->> 'date', x ->> 'name') from (
      select distinct on (coalesce(p.claimed_by::text, p.id::text)) jsonb_build_object(
        'kind', 'birthday', 'person_id', p.id, 'tree_id', p.tree_id, 'name', p.display_name,
        'date', next_occurrence(p.birth_date), 'days', next_occurrence(p.birth_date) - current_date,
        'turns', case when p.birth_precision = 'exact' then extract(year from next_occurrence(p.birth_date))::int - extract(year from p.birth_date)::int end,
        'photo_path', p.photo_path) as x
      from persons p
      where p.tree_id in (select social_my_tree_ids()) and tree_role(p.tree_id) <> 'none'
        and p.deleted_at is null and p.living = 'living' and p.birth_date is not null
        and coalesce(p.birth_precision, 'exact') in ('exact', 'month')
        and p.claimed_by is distinct from me
        and next_occurrence(p.birth_date) <= current_date + span
      union all
      select jsonb_build_object(
        'kind', 'anniversary', 'person_id', u.partner1_id, 'tree_id', u.tree_id,
        'name', a.display_name || ' & ' || b.display_name,
        'date', next_occurrence(u.start_date), 'days', next_occurrence(u.start_date) - current_date,
        'turns', extract(year from next_occurrence(u.start_date))::int - extract(year from u.start_date)::int,
        'photo_path', null)
      from unions u join persons a on a.id = u.partner1_id join persons b on b.id = u.partner2_id
      where u.tree_id in (select social_my_tree_ids()) and tree_role(u.tree_id) <> 'none'
        and u.kind = 'marriage' and u.status = 'current' and u.start_date is not null
        and a.deleted_at is null and b.deleted_at is null and a.living = 'living' and b.living = 'living'
        and next_occurrence(u.start_date) <= current_date + span
    ) q), '[]'::jsonb);
end $$;

create function on_this_day() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'body', left(x.body, 160), 'happened_on', x.happened_on,
      'years', extract(year from current_date)::int - extract(year from x.happened_on)::int,
      'author_name', social_name(x.author_id),
      'photo_path', (select m.path from post_media m where m.post_id = x.id order by m.position limit 1)) order by x.happened_on desc)
    from (select p.* from posts p
          where p.deleted_at is null
            and extract(month from p.happened_on) = extract(month from current_date)
            and extract(day from p.happened_on) = extract(day from current_date)
            and p.happened_on < current_date - 300
            and p.author_id not in (select social_blocked_ids())
            and (p.author_id = me
                 or (p.tree_id in (select social_my_tree_ids()) and tree_role(p.tree_id) <> 'none')
                 or p.group_id in (select m.group_id from group_members m where m.profile_id = me))
          order by p.happened_on desc limit 5) x), '[]'::jsonb);
end $$;

-- Job, once a day after 8 in the morning India time: one note per person per tree, naming up to three people.
create table date_reminders_sent (
  profile_id uuid not null references profiles (id) on delete cascade,
  tree_id uuid not null references trees (id) on delete cascade,
  day date not null,
  primary key (profile_id, tree_id, day)
);
alter table date_reminders_sent enable row level security;

create function birthday_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n int;
begin
  if extract(hour from now() at time zone 'Asia/Kolkata') < 8 then return 0; end if;
  with celebrating as (
    select p.tree_id, p.display_name, p.claimed_by from persons p
    where p.deleted_at is null and p.living = 'living' and p.birth_date is not null
      and coalesce(p.birth_precision, 'exact') in ('exact', 'month')
      and extract(month from p.birth_date) = extract(month from today) and extract(day from p.birth_date) = extract(day from today)
  ), members as (
    select t.id as tree_id, t.creator_id as profile_id from trees t where t.deleted_at is null
    union
    select s.tree_id, s.grantee_profile_id from shares s where s.grantee_profile_id is not null and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  ), digest as (
    select m.profile_id, c.tree_id, string_agg(c.display_name, ', ' order by c.display_name) filter (where true) as names, count(*) as n
    from celebrating c join members m on m.tree_id = c.tree_id and m.profile_id is distinct from c.claimed_by
    join profiles pr on pr.id = m.profile_id and pr.deleted_at is null
    where not exists (select 1 from date_reminders_sent d where d.profile_id = m.profile_id and d.tree_id = c.tree_id and d.day = today)
    group by m.profile_id, c.tree_id
  ), marked as (
    insert into date_reminders_sent (profile_id, tree_id, day) select d.profile_id, d.tree_id, today from digest d
    on conflict do nothing returning profile_id, tree_id
  )
  insert into notifications (recipient_id, kind, payload)
  select d.profile_id, 'birthdays_today', jsonb_build_object('tree_id', d.tree_id, 'body',
    case when d.n > 3 then split_part(d.names, ', ', 1) || ', ' || split_part(d.names, ', ', 2) || ', ' || split_part(d.names, ', ', 3)
                            || ' +' || (d.n - 3) else d.names end)
  from digest d join marked k on k.profile_id = d.profile_id and k.tree_id = d.tree_id;
  get diagnostics n = row_count;
  delete from date_reminders_sent where day < today - 7;
  return n;
end $$;

-- ===== Orders: printing, shipping, tracking, refunds, coupons =====

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,20}$'),
  title text not null check (char_length(title) between 3 and 80),
  description text check (char_length(description) <= 300),
  kind text not null check (kind in ('percent', 'amount')),
  value int not null check (value > 0),
  currency text check (currency is null or currency in ('INR', 'USD')),
  products text[] not null check (cardinality(products) > 0 and products <@ array['tree_poster', 'family_book', 'premium_invite']),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  max_uses int check (max_uses is null or max_uses > 0),
  per_user_limit int not null default 1 check (per_user_limit between 1 and 100),
  new_users_only boolean not null default false,
  min_amount_minor bigint not null default 0 check (min_amount_minor >= 0),
  public boolean not null default false,
  active boolean not null default true,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value between 1 and 90),
  check (kind <> 'amount' or currency is not null),
  check (ends_at is null or ends_at > starts_at)
);
alter table coupons enable row level security;

alter table one_time_orders
  add column fulfilment text not null default 'none' check (fulfilment in ('none', 'queued', 'printing', 'shipped', 'delivered', 'cancelled')),
  add column carrier text check (char_length(carrier) <= 60),
  add column tracking_number text check (char_length(tracking_number) <= 80),
  add column tracking_url text check (tracking_url is null or tracking_url ~ '^https://'),
  add column fulfilment_at timestamptz,
  add column coupon_id uuid references coupons (id) on delete set null,
  add column discount_minor bigint not null default 0 check (discount_minor >= 0),
  add column refunded_at timestamptz,
  add column refund_note text;
grant select (fulfilment, carrier, tracking_number, tracking_url, fulfilment_at, discount_minor) on one_time_orders to authenticated;

alter table family_plans add column created_at timestamptz not null default now();

-- A paid poster or book goes to the print queue by itself.
create function orders_to_fulfilment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.product in ('tree_poster', 'family_book') and new.fulfilment = 'none' then
    new.fulfilment := 'queued';
    new.fulfilment_at := now();
    perform work_open('order', new.id, case new.product when 'tree_poster' then 'Print poster' else 'Print family book' end);
  end if;
  return new;
end $$;
create trigger one_time_orders_fulfilment before update of status on one_time_orders
  for each row execute function orders_to_fulfilment();

-- What a code takes off. Uses count paid orders, and orders started in the last hour (payment still open).
create function coupon_quote(p_code text, p_product text, p_amount_minor bigint, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c coupons;
  used int;
  mine int;
  off bigint;
begin
  select * into c from coupons where code = upper(trim(coalesce(p_code, '')));
  if not found or not c.active then raise exception 'coupon_invalid' using errcode = 'PT422'; end if;
  if c.starts_at > now() or (c.ends_at is not null and c.ends_at < now()) then raise exception 'coupon_expired' using errcode = 'PT422'; end if;
  if not (p_product = any (c.products)) then raise exception 'coupon_not_for_product' using errcode = 'PT422'; end if;
  if c.kind = 'amount' and c.currency <> p_currency then raise exception 'coupon_not_for_product' using errcode = 'PT422'; end if;
  if p_amount_minor < c.min_amount_minor then raise exception 'coupon_min_amount' using errcode = 'PT422'; end if;
  if c.new_users_only and (me is null or exists (select 1 from one_time_orders o where o.buyer_id = me and o.status = 'paid')) then
    raise exception 'coupon_new_users_only' using errcode = 'PT422';
  end if;
  select count(*) filter (where true), count(*) filter (where o.buyer_id = me) into used, mine
  from one_time_orders o where o.coupon_id = c.id and (o.status = 'paid' or (o.status = 'created' and o.created_at > now() - interval '1 hour'));
  if c.max_uses is not null and used >= c.max_uses then raise exception 'coupon_used_up' using errcode = 'PT422'; end if;
  if mine >= c.per_user_limit then raise exception 'coupon_already_used' using errcode = 'PT422'; end if;
  off := case when c.kind = 'percent' then (p_amount_minor * c.value) / 100 else c.value end;
  -- Payment providers need at least one rupee or one cent.
  off := least(off, greatest(p_amount_minor - 100, 0));
  return jsonb_build_object('coupon_id', c.id, 'code', c.code, 'title', c.title, 'discount_minor', off, 'final_minor', p_amount_minor - off);
end $$;

-- Offers a person can see: public codes still running, and offer banners aimed at them.
create function offers_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'title', c.title, 'description', c.description, 'kind', c.kind,
      'value', c.value, 'currency', c.currency, 'products', to_jsonb(c.products), 'ends_at', c.ends_at) order by c.ends_at nulls last, c.created_at desc), '[]'::jsonb)
  from coupons c
  where c.active and c.public and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
    and (c.max_uses is null or c.max_uses > (select count(*) from one_time_orders o where o.coupon_id = c.id and o.status = 'paid'))
$$;

create function my_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'product', o.product, 'amount_minor', o.amount_minor, 'currency', o.currency,
      'discount_minor', o.discount_minor, 'status', o.status, 'fulfilment', o.fulfilment, 'carrier', o.carrier,
      'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url, 'created_at', o.created_at, 'paid_at', o.paid_at,
      'quantity', coalesce((o.details ->> 'quantity')::int, 1)) order by o.created_at desc), '[]'::jsonb)
  from one_time_orders o where o.buyer_id = social_me() and o.status in ('paid', 'refunded')
$$;

create function admin_coupons_list(p_view text default 'active') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['marketing']);
  return coalesce((
    select jsonb_agg(to_jsonb(c) - 'created_by' || jsonb_build_object(
      'uses', (select count(*) from one_time_orders o where o.coupon_id = c.id and o.status = 'paid'),
      'discount_given_minor', (select coalesce(sum(o.discount_minor), 0) from one_time_orders o where o.coupon_id = c.id and o.status = 'paid'),
      'running', c.active and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())) order by c.created_at desc)
    from coupons c
    where case coalesce(p_view, 'active') when 'all' then true
            when 'ended' then not c.active or (c.ends_at is not null and c.ends_at <= now())
            else c.active and (c.ends_at is null or c.ends_at > now()) end), '[]'::jsonb);
end $$;

create function admin_coupon_save(p_id uuid, p_coupon jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  saved coupons;
  allowed text[] := array['code', 'title', 'description', 'kind', 'value', 'currency', 'products', 'starts_at', 'ends_at',
                          'max_uses', 'per_user_limit', 'new_users_only', 'min_amount_minor', 'public', 'active'];
begin
  perform admin_require(array['marketing']);
  if exists (select 1 from jsonb_object_keys(p_coupon) k where not (k = any (allowed))) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  begin
    if p_id is null then
      insert into coupons (code, title, description, kind, value, currency, products, starts_at, ends_at, max_uses, per_user_limit,
                           new_users_only, min_amount_minor, public, active, created_by)
      values (upper(trim(p_coupon ->> 'code')), trim(p_coupon ->> 'title'), nullif(trim(p_coupon ->> 'description'), ''),
              p_coupon ->> 'kind', (p_coupon ->> 'value')::int, nullif(p_coupon ->> 'currency', ''),
              array(select jsonb_array_elements_text(p_coupon -> 'products')),
              coalesce((p_coupon ->> 'starts_at')::timestamptz, now()), (p_coupon ->> 'ends_at')::timestamptz,
              (p_coupon ->> 'max_uses')::int, coalesce((p_coupon ->> 'per_user_limit')::int, 1),
              coalesce((p_coupon ->> 'new_users_only')::boolean, false), coalesce((p_coupon ->> 'min_amount_minor')::bigint, 0),
              coalesce((p_coupon ->> 'public')::boolean, false), coalesce((p_coupon ->> 'active')::boolean, true), auth.uid())
      returning * into saved;
    else
      -- The code and the discount stay fixed once anyone has used it, so past orders still read true.
      if exists (select 1 from one_time_orders o where o.coupon_id = p_id and o.status = 'paid')
         and (p_coupon ? 'code' or p_coupon ? 'kind' or p_coupon ? 'value' or p_coupon ? 'currency') then
        raise exception 'coupon_in_use' using errcode = 'PT409';
      end if;
      update coupons c set
        code = coalesce(upper(trim(p_coupon ->> 'code')), c.code),
        title = coalesce(trim(p_coupon ->> 'title'), c.title),
        description = case when p_coupon ? 'description' then nullif(trim(p_coupon ->> 'description'), '') else c.description end,
        kind = coalesce(p_coupon ->> 'kind', c.kind),
        value = coalesce((p_coupon ->> 'value')::int, c.value),
        currency = case when p_coupon ? 'currency' then nullif(p_coupon ->> 'currency', '') else c.currency end,
        products = case when p_coupon ? 'products' then array(select jsonb_array_elements_text(p_coupon -> 'products')) else c.products end,
        starts_at = coalesce((p_coupon ->> 'starts_at')::timestamptz, c.starts_at),
        ends_at = case when p_coupon ? 'ends_at' then (p_coupon ->> 'ends_at')::timestamptz else c.ends_at end,
        max_uses = case when p_coupon ? 'max_uses' then (p_coupon ->> 'max_uses')::int else c.max_uses end,
        per_user_limit = coalesce((p_coupon ->> 'per_user_limit')::int, c.per_user_limit),
        new_users_only = coalesce((p_coupon ->> 'new_users_only')::boolean, c.new_users_only),
        min_amount_minor = coalesce((p_coupon ->> 'min_amount_minor')::bigint, c.min_amount_minor),
        public = coalesce((p_coupon ->> 'public')::boolean, c.public),
        active = coalesce((p_coupon ->> 'active')::boolean, c.active),
        updated_at = now()
      where c.id = p_id returning * into saved;
      if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
    end if;
  exception
    when unique_violation then raise exception 'coupon_code_taken' using errcode = 'PT409';
    when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
      raise exception 'bad_input' using errcode = 'PT422';
  end;
  perform admin_log(case when p_id is null then 'coupon.created' else 'coupon.updated' end, 'coupon', saved.id::text, null,
    jsonb_build_object('code', saved.code, 'kind', saved.kind, 'value', saved.value, 'active', saved.active));
  return to_jsonb(saved) - 'created_by';
end $$;

-- Who is waiting for what. Shipping addresses are shown only in the detail, which is logged.
create function admin_orders_list(p_fulfilment text default null, p_q text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(p_fulfilment, '');
  q text := nullif(trim(coalesce(p_q, '')), '');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['orders', 'payments']);
  with hits as (
    select o.* from one_time_orders o
    where o.status in ('paid', 'refunded')
      and (wanted is null or o.fulfilment = wanted)
      and (q is null or o.id::text = lower(q) or o.tracking_number = q or o.buyer_id::text = lower(q))
  )
  select (select count(*)::int from hits),
         (select coalesce(jsonb_agg(jsonb_build_object(
            'id', x.id, 'product', x.product, 'store', x.store, 'amount_minor', x.amount_minor, 'currency', x.currency,
            'discount_minor', x.discount_minor, 'coupon', (select c.code from coupons c where c.id = x.coupon_id),
            'status', x.status, 'fulfilment', x.fulfilment, 'carrier', x.carrier, 'tracking_number', x.tracking_number,
            'quantity', coalesce((x.details ->> 'quantity')::int, 1),
            'city', x.details #>> '{shipping,city}', 'country', x.details #>> '{shipping,country}',
            'buyer_id', x.buyer_id, 'buyer_name', (select p.display_name from profiles p where p.id = x.buyer_id),
            'created_at', x.created_at, 'paid_at', x.paid_at, 'fulfilment_at', x.fulfilment_at, 'refunded_at', x.refunded_at,
            'can_refund', x.status = 'paid' and x.payment_id is not null,
            'work_id', (select w.id from work_items w where w.kind = 'order' and w.ref_id = x.id)
          ) order by x.paid_at desc nulls last, x.id), '[]'::jsonb)
          from (select * from hits order by paid_at desc nulls last, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows,
    'counts', (select jsonb_object_agg(f, (select count(*) from one_time_orders o where o.status = 'paid' and o.fulfilment = f))
               from unnest(array['queued', 'printing', 'shipped', 'delivered', 'cancelled']) f));
end $$;

create function admin_order_detail(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := admin_clean_reason(p_reason);
  o one_time_orders;
begin
  perform admin_require(array['orders']);
  select * into o from one_time_orders where id = p_id;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_log('order.address_viewed', 'order', p_id::text, cleaned);
  return jsonb_build_object('id', o.id, 'product', o.product, 'quantity', coalesce((o.details ->> 'quantity')::int, 1),
    'design_id', o.details ->> 'design_id', 'tree_id', o.tree_id, 'shipping', o.details -> 'shipping',
    'fulfilment', o.fulfilment, 'carrier', o.carrier, 'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url);
end $$;

-- Steps go forward only: queued, printing, shipped (needs a tracking number), delivered. Cancelled from any step before delivery.
create function admin_order_update(p_id uuid, p_fulfilment text, p_carrier text default null, p_tracking text default null,
  p_tracking_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o one_time_orders;
  steps text[] := array['queued', 'printing', 'shipped', 'delivered'];
begin
  perform admin_require(array['orders']);
  select * into o from one_time_orders where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if o.status <> 'paid' or o.product not in ('tree_poster', 'family_book') then raise exception 'order_not_shippable' using errcode = 'PT409'; end if;
  if p_fulfilment = 'cancelled' then
    if o.fulfilment in ('delivered', 'cancelled') then raise exception 'order_bad_step' using errcode = 'PT409'; end if;
  elsif not (p_fulfilment = any (steps)) or array_position(steps, p_fulfilment) <= coalesce(array_position(steps, o.fulfilment), 0) then
    raise exception 'order_bad_step' using errcode = 'PT409';
  end if;
  if p_fulfilment = 'shipped' and nullif(trim(coalesce(p_tracking, o.tracking_number, '')), '') is null then
    raise exception 'order_tracking_required' using errcode = 'PT422';
  end if;
  if p_tracking_url is not null and p_tracking_url !~ '^https://' then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update one_time_orders set fulfilment = p_fulfilment, fulfilment_at = now(),
    carrier = coalesce(nullif(trim(p_carrier), ''), carrier),
    tracking_number = coalesce(nullif(trim(p_tracking), ''), tracking_number),
    tracking_url = coalesce(nullif(trim(p_tracking_url), ''), tracking_url)
  where id = p_id;
  if p_fulfilment in ('delivered', 'cancelled') then
    perform work_close('order', p_id);
  else
    update work_items set status = 'in_progress', updated_at = now() where kind = 'order' and ref_id = p_id and status = 'open';
  end if;
  if o.buyer_id is not null then
    insert into notifications (recipient_id, kind, payload)
    values (o.buyer_id, 'order_update', jsonb_build_object('order_id', p_id, 'step', p_fulfilment, 'product', o.product));
  end if;
  perform admin_log('order.' || p_fulfilment, 'order', p_id::text, null,
    jsonb_build_object('carrier', p_carrier, 'tracking', p_tracking is not null));
  return jsonb_build_object('ok', true);
end $$;

-- Called by the refund route after the payment provider accepted the refund.
create function admin_order_refunded(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := admin_clean_reason(p_note);
  o one_time_orders;
begin
  perform admin_require(array['payments']);
  select * into o from one_time_orders where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  update one_time_orders set status = 'refunded', refunded_at = now(), refund_note = cleaned,
    fulfilment = case when fulfilment in ('queued', 'printing') then 'cancelled' else fulfilment end
  where id = p_id;
  perform work_close('order', p_id);
  if o.buyer_id is not null then
    insert into notifications (recipient_id, kind, payload)
    values (o.buyer_id, 'order_refunded', jsonb_build_object('order_id', p_id, 'product', o.product));
  end if;
  perform admin_log('order.refunded', 'order', p_id::text, cleaned, jsonb_build_object('amount_minor', o.amount_minor, 'currency', o.currency));
  return jsonb_build_object('ok', true);
end $$;

-- ===== Announcements: scrolling banners in the app and on the website =====

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  body text check (char_length(body) <= 200),
  link_url text check (link_url is null or link_url ~ '^(/[A-Za-z0-9/_?=&.-]*|https://[^\s]+)$'),
  link_label text check (char_length(link_label) <= 30),
  style text not null default 'info' check (style in ('info', 'offer', 'celebration', 'warning')),
  placements text[] not null check (cardinality(placements) > 0 and placements <@ array['app_banner', 'web_banner', 'home_card']),
  audience text not null default 'everyone' check (audience in ('everyone', 'plus', 'free', 'visitors')),
  languages text[],
  region text not null default 'all' check (region in ('all', 'india', 'overseas')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  priority int not null default 0 check (priority between 0 and 100),
  dismissible boolean not null default true,
  active boolean not null default true,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create table announcement_views (
  announcement_id uuid not null references announcements (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  clicked_at timestamptz,
  dismissed_at timestamptz,
  primary key (announcement_id, profile_id)
);
alter table announcements add column visitor_views int not null default 0;
alter table announcements enable row level security;
alter table announcement_views enable row level security;

create function announcement_json(a announcements) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'link_url', a.link_url, 'link_label', a.link_label,
    'style', a.style, 'dismissible', a.dismissible, 'placements', to_jsonb(a.placements))
$$;

-- What the signed-in person should see now. Looking counts as seen.
create function announcements_for_me(p_placement text default 'app_banner') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  pr profiles;
  plus boolean := has_plus(me);
  shown jsonb;
begin
  select * into pr from profiles where id = me;
  with picked as (
    select a.* from announcements a
    where a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
      and p_placement = any (a.placements)
      and (a.audience = 'everyone' or (a.audience = 'plus' and plus) or (a.audience = 'free' and not plus))
      and (a.languages is null or split_part(pr.language_code, '-', 1) = any (a.languages) or pr.language_code = any (a.languages))
      and (a.region = 'all' or (a.region = 'india') = (coalesce(pr.login_phone, '') like '+91%'))
      and not exists (select 1 from announcement_views v where v.announcement_id = a.id and v.profile_id = me and v.dismissed_at is not null)
    order by a.priority desc, a.starts_at desc limit 5
  ), seen as (
    insert into announcement_views (announcement_id, profile_id) select p.id, me from picked p on conflict do nothing
  )
  select coalesce(jsonb_agg(announcement_json(p) order by p.priority desc, p.starts_at desc), '[]'::jsonb) into shown from picked p;
  return shown;
end $$;

-- The public website: no sign-in, so only 'everyone' and 'visitors' banners. Counted, never tracked.
create function announcements_public() returns jsonb
language plpgsql security definer set search_path = public as $$
declare shown jsonb;
begin
  with picked as (
    select a.* from announcements a
    where a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
      and 'web_banner' = any (a.placements) and a.audience in ('everyone', 'visitors') and a.region = 'all' and a.languages is null
    order by a.priority desc, a.starts_at desc limit 3
  ), counted as (
    update announcements x set visitor_views = x.visitor_views + 1 from picked p where x.id = p.id
  )
  select coalesce(jsonb_agg(announcement_json(p) order by p.priority desc, p.starts_at desc), '[]'::jsonb) into shown from picked p;
  return shown;
end $$;

create function announcement_event(p_id uuid, p_event text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if p_event not in ('click', 'dismiss') then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_event = 'dismiss' and not coalesce((select a.dismissible from announcements a where a.id = p_id), false) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  insert into announcement_views (announcement_id, profile_id, clicked_at, dismissed_at)
  select p_id, me, case when p_event = 'click' then now() end, case when p_event = 'dismiss' then now() end
  where exists (select 1 from announcements a where a.id = p_id)
  on conflict (announcement_id, profile_id) do update set
    clicked_at = coalesce(announcement_views.clicked_at, excluded.clicked_at),
    dismissed_at = coalesce(announcement_views.dismissed_at, excluded.dismissed_at);
  return jsonb_build_object('ok', true);
end $$;

create function admin_announcements_list(p_view text default 'active') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['marketing']);
  return coalesce((
    select jsonb_agg(to_jsonb(a) - 'created_by' || jsonb_build_object(
      'seen', (select count(*) from announcement_views v where v.announcement_id = a.id),
      'clicked', (select count(*) from announcement_views v where v.announcement_id = a.id and v.clicked_at is not null),
      'dismissed', (select count(*) from announcement_views v where v.announcement_id = a.id and v.dismissed_at is not null),
      'running', a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())) order by a.priority desc, a.created_at desc)
    from announcements a
    where case coalesce(p_view, 'active') when 'all' then true
            when 'ended' then not a.active or (a.ends_at is not null and a.ends_at <= now())
            else a.active and (a.ends_at is null or a.ends_at > now()) end), '[]'::jsonb);
end $$;

create function admin_announcement_save(p_id uuid, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  saved announcements;
  allowed text[] := array['title', 'body', 'link_url', 'link_label', 'style', 'placements', 'audience', 'languages', 'region',
                          'starts_at', 'ends_at', 'priority', 'dismissible', 'active'];
begin
  perform admin_require(array['marketing']);
  if exists (select 1 from jsonb_object_keys(p_item) k where not (k = any (allowed))) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  begin
    if p_id is null then
      insert into announcements (title, body, link_url, link_label, style, placements, audience, languages, region, starts_at, ends_at,
                                 priority, dismissible, active, created_by)
      values (trim(p_item ->> 'title'), nullif(trim(p_item ->> 'body'), ''), nullif(trim(p_item ->> 'link_url'), ''),
              nullif(trim(p_item ->> 'link_label'), ''), coalesce(p_item ->> 'style', 'info'),
              array(select jsonb_array_elements_text(p_item -> 'placements')), coalesce(p_item ->> 'audience', 'everyone'),
              case when jsonb_typeof(p_item -> 'languages') = 'array' and jsonb_array_length(p_item -> 'languages') > 0
                   then array(select jsonb_array_elements_text(p_item -> 'languages')) end,
              coalesce(p_item ->> 'region', 'all'), coalesce((p_item ->> 'starts_at')::timestamptz, now()), (p_item ->> 'ends_at')::timestamptz,
              coalesce((p_item ->> 'priority')::int, 0), coalesce((p_item ->> 'dismissible')::boolean, true),
              coalesce((p_item ->> 'active')::boolean, true), auth.uid())
      returning * into saved;
    else
      update announcements a set
        title = coalesce(trim(p_item ->> 'title'), a.title),
        body = case when p_item ? 'body' then nullif(trim(p_item ->> 'body'), '') else a.body end,
        link_url = case when p_item ? 'link_url' then nullif(trim(p_item ->> 'link_url'), '') else a.link_url end,
        link_label = case when p_item ? 'link_label' then nullif(trim(p_item ->> 'link_label'), '') else a.link_label end,
        style = coalesce(p_item ->> 'style', a.style),
        placements = case when p_item ? 'placements' then array(select jsonb_array_elements_text(p_item -> 'placements')) else a.placements end,
        audience = coalesce(p_item ->> 'audience', a.audience),
        languages = case when p_item ? 'languages' then
                      case when jsonb_typeof(p_item -> 'languages') = 'array' and jsonb_array_length(p_item -> 'languages') > 0
                           then array(select jsonb_array_elements_text(p_item -> 'languages')) end
                    else a.languages end,
        region = coalesce(p_item ->> 'region', a.region),
        starts_at = coalesce((p_item ->> 'starts_at')::timestamptz, a.starts_at),
        ends_at = case when p_item ? 'ends_at' then (p_item ->> 'ends_at')::timestamptz else a.ends_at end,
        priority = coalesce((p_item ->> 'priority')::int, a.priority),
        dismissible = coalesce((p_item ->> 'dismissible')::boolean, a.dismissible),
        active = coalesce((p_item ->> 'active')::boolean, a.active),
        updated_at = now()
      where a.id = p_id returning * into saved;
      if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
      raise exception 'bad_input' using errcode = 'PT422';
  end;
  perform admin_log(case when p_id is null then 'announcement.created' else 'announcement.updated' end, 'announcement', saved.id::text, null,
    jsonb_build_object('title', saved.title, 'audience', saved.audience, 'active', saved.active));
  return to_jsonb(saved) - 'created_by';
end $$;

-- ===== Promotional messages: only to people who switched them on (DPDP Act consent) =====

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 60),
  body text not null check (char_length(body) between 5 and 180),
  link_path text check (link_path is null or link_path ~ '^/[A-Za-z0-9/_-]*$'),
  audience text not null check (audience in ('everyone', 'plus', 'free')),
  language text,
  region text not null default 'all' check (region in ('all', 'india', 'overseas')),
  recipients int not null,
  sent_by uuid references profiles (id) on delete set null,
  sent_at timestamptz not null default now()
);
alter table campaigns enable row level security;

create function campaign_targets(p_audience text, p_language text, p_region text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p join auth.users u on u.id = p.id
  where p.deleted_at is null and u.banned_at is null and p.marketing_opt_in and not p.is_minor
    and (p_audience = 'everyone' or (p_audience = 'plus') = has_plus(p.id))
    and (p_language is null or split_part(p.language_code, '-', 1) = p_language)
    and (coalesce(p_region, 'all') = 'all' or (p_region = 'india') = (coalesce(p.login_phone, '') like '+91%'))
$$;

create function admin_campaign_count(p_audience text, p_language text default null, p_region text default 'all') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['marketing']);
  if p_audience not in ('everyone', 'plus', 'free') then raise exception 'bad_input' using errcode = 'PT422'; end if;
  return jsonb_build_object('recipients', (select count(*) from campaign_targets(p_audience, nullif(p_language, ''), p_region)),
    'opted_in', (select count(*) from profiles p where p.marketing_opt_in and p.deleted_at is null));
end $$;

-- At most two a day across all staff, so families are never flooded.
create function admin_campaign_send(p_title text, p_body text, p_link text, p_audience text, p_language text, p_region text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cleaned text := admin_clean_reason(p_reason);
  c campaigns;
begin
  perform admin_require(array['marketing']);
  if (select count(*) from campaigns x where x.sent_at > now() - interval '1 day') >= 2 then
    raise exception 'admin_campaign_too_many' using errcode = 'PT429';
  end if;
  begin
    insert into campaigns (title, body, link_path, audience, language, region, recipients, sent_by)
    values (trim(p_title), trim(p_body), nullif(trim(coalesce(p_link, '')), ''), p_audience, nullif(p_language, ''), coalesce(p_region, 'all'), 0, auth.uid())
    returning * into c;
  exception when check_violation or not_null_violation then
    raise exception 'bad_input' using errcode = 'PT422';
  end;
  insert into notifications (recipient_id, kind, payload)
  select t, 'promo', jsonb_build_object('title', c.title, 'body', c.body, 'path', c.link_path, 'campaign_id', c.id)
  from campaign_targets(c.audience, c.language, c.region) t;
  get diagnostics c.recipients = row_count;
  update campaigns set recipients = c.recipients where id = c.id;
  perform admin_log('campaign.sent', 'campaign', c.id::text, cleaned, jsonb_build_object('recipients', c.recipients, 'audience', c.audience));
  return jsonb_build_object('id', c.id, 'recipients', c.recipients);
end $$;

create function admin_campaigns_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['marketing']);
  return coalesce((select jsonb_agg(to_jsonb(c) - 'sent_by' || jsonb_build_object(
      'sent_by_name', (select p.display_name from profiles p where p.id = c.sent_by),
      'opened', (select count(*) from notifications n where n.kind = 'promo' and n.payload ->> 'campaign_id' = c.id::text and n.read_at is not null))
    order by c.sent_at desc) from (select * from campaigns order by sent_at desc limit 50) c), '[]'::jsonb);
end $$;

-- ===== App settings: forced update, maintenance, feature switches, what's new =====

create table app_config (
  key text primary key check (key in ('min_version', 'latest_version', 'maintenance', 'features', 'whats_new', 'support')),
  value jsonb not null,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;
insert into app_config (key, value) values
  ('min_version', '{"ios": "0.1.0", "android": "0.1.0"}'),
  ('latest_version', '{"ios": "0.1.0", "android": "0.1.0"}'),
  ('maintenance', '{"on": false, "message": ""}'),
  ('features', '{"chat": true, "memories": true, "invites": true, "pop_party": true, "alerts": true, "sos": true, "orders": true, "referrals": true, "offers": true}'),
  ('whats_new', '{"version": "0.1.0", "items": []}'),
  ('support', '{"hours": "XXX", "email": "XXX"}');

create function app_config_public() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb) from app_config c
$$;

create function admin_config_set(p_key text, p_value jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cleaned text := admin_clean_reason(p_reason);
begin
  perform admin_require(array['settings']);
  if jsonb_typeof(p_value) <> 'object' then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_key in ('min_version', 'latest_version') and exists (
      select 1 from jsonb_each_text(p_value) e where e.key not in ('ios', 'android') or e.value !~ '^\d{1,3}\.\d{1,3}\.\d{1,3}$') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_key = 'maintenance' and (jsonb_typeof(p_value -> 'on') <> 'boolean' or char_length(coalesce(p_value ->> 'message', '')) > 300) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_key = 'features' and exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  update app_config set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_log('config.changed', 'config', p_key, cleaned, jsonb_build_object('value', p_value));
  return jsonb_build_object('ok', true);
end $$;

create function admin_config_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['settings']);
  return coalesce((select jsonb_object_agg(c.key, jsonb_build_object('value', c.value, 'updated_at', c.updated_at,
    'updated_by_name', (select p.display_name from profiles p where p.id = c.updated_by))) from app_config c), '{}'::jsonb);
end $$;

-- ===== App crash reports (own collector: nothing goes to an outside company) =====

create table client_errors (
  id bigint generated always as identity primary key,
  profile_id uuid references profiles (id) on delete set null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  app_version text check (char_length(app_version) <= 20),
  route text check (char_length(route) <= 200),
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 4000),
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create index client_errors_fp_idx on client_errors (fingerprint, created_at desc);
create index client_errors_time_idx on client_errors (created_at);
alter table client_errors enable row level security;

create function admin_app_health(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30));
begin
  perform admin_require(array['settings', 'analytics']);
  return jsonb_build_object(
    'errors', coalesce((select jsonb_agg(g order by g ->> 'count' desc) from (
      select jsonb_build_object('fingerprint', e.fingerprint, 'message', max(e.message), 'count', count(*),
        'people', count(distinct e.profile_id), 'last_seen', max(e.created_at), 'first_seen', min(e.created_at),
        'platforms', to_jsonb(array_agg(distinct e.platform)), 'versions', to_jsonb(array_agg(distinct e.app_version)),
        'routes', to_jsonb((array_agg(distinct e.route))[1:5]),
        'stack', (select x.stack from client_errors x where x.fingerprint = e.fingerprint order by x.id desc limit 1)) as g
      from client_errors e where e.created_at > since group by e.fingerprint order by count(*) desc limit 50) q), '[]'::jsonb),
    'total', (select count(*) from client_errors e where e.created_at > since),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j)) from (select * from job_runs order by 1 desc limit 20) j), '[]'::jsonb));
end $$;

-- ===== Analytics =====

create function admin_analytics(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  span int := least(greatest(coalesce(p_days, 30), 7), 180);
  users_total int;
  plus_now int;
begin
  perform admin_require(array['analytics']);
  select count(*) into users_total from profiles p where p.deleted_at is null;
  select count(*) into plus_now from profiles p where p.deleted_at is null and has_plus(p.id);
  return jsonb_build_object(
    'days', span,
    'daily', (select jsonb_agg(jsonb_build_object(
        'day', d::date,
        'signups', (select count(*) from profiles p where p.created_at::date = d::date),
        'trees', (select count(*) from trees t where t.created_at::date = d::date),
        'people', (select count(*) from persons p where p.created_at::date = d::date),
        'memories', (select count(*) from posts p where p.created_at::date = d::date),
        'messages', (select count(*) from messages m where m.created_at::date = d::date),
        'plus_started', (select count(*) from family_plans f where f.created_at::date = d::date),
        'orders', (select count(*) from one_time_orders o where o.status = 'paid' and o.paid_at::date = d::date),
        'sos', (select count(*) from sos_events s where s.started_at::date = d::date)) order by d)
      from generate_series((current_date - (span - 1))::timestamp, current_date::timestamp, interval '1 day') d),
    'totals', jsonb_build_object(
      'users', users_total,
      'active_1d', (select count(*) from profiles p where p.deleted_at is null and p.last_active_at > now() - interval '1 day'),
      'active_7d', (select count(*) from profiles p where p.deleted_at is null and p.last_active_at > now() - interval '7 days'),
      'active_30d', (select count(*) from profiles p where p.deleted_at is null and p.last_active_at > now() - interval '30 days'),
      'plus', plus_now,
      'plus_rate', case when users_total = 0 then 0 else round(100.0 * plus_now / users_total, 1) end,
      'trees', (select count(*) from trees t where t.deleted_at is null),
      'people', (select count(*) from persons p where p.deleted_at is null),
      'marketing_opt_in', (select count(*) from profiles p where p.deleted_at is null and p.marketing_opt_in),
      'referrals', (select count(*) from referrals),
      'revenue_minor', coalesce((select jsonb_object_agg(x.currency, x.n) from (
          select o.currency, sum(o.amount_minor) as n from one_time_orders o
          where o.status = 'paid' and o.paid_at > now() - make_interval(days => span) group by 1) x), '{}'::jsonb)),
    'funnel', jsonb_build_object(
      'signed_up', users_total,
      'built_tree', (select count(distinct t.creator_id) from trees t where t.deleted_at is null),
      'added_5', (select count(*) from (select t.creator_id from trees t join persons p on p.tree_id = t.id and p.deleted_at is null
                   where t.deleted_at is null group by t.creator_id having count(*) >= 5) x),
      'shared', (select count(distinct s.created_by) from shares s),
      'plus', plus_now),
    'plans', coalesce((select jsonb_object_agg(x.store, x.n) from (
        select f.store::text as store, count(*) as n from family_plans f where f.status in ('trial', 'active', 'grace') group by 1) x), '{}'::jsonb),
    'languages', coalesce((select jsonb_object_agg(x.language_code, x.n) from (
        select p.language_code, count(*) as n from profiles p where p.deleted_at is null group by 1 order by 2 desc limit 8) x), '{}'::jsonb),
    'devices', coalesce((select jsonb_object_agg(x.platform, x.n) from (
        select d.platform, count(distinct d.profile_id) as n from device_tokens d group by 1) x), '{}'::jsonb));
end $$;

-- ===== One account, everything staff may see about it (logged with a reason) =====

create function admin_user_detail(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := admin_clean_reason(p_reason);
  p profiles;
  banned timestamptz;
begin
  perform admin_require(array['users', 'support']);
  select * into p from profiles where id = p_user;
  if not found then raise exception 'admin_user_not_found' using errcode = 'PT404'; end if;
  select u.banned_at into banned from auth.users u where u.id = p_user;
  perform admin_log('user.viewed', 'user', p_user::text, cleaned);
  return jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'phone_masked', admin_mask_phone(p.login_phone), 'email_masked', admin_mask_email(p.email),
    'email_verified', p.email_verified_at is not null, 'language', p.language_code, 'large_text', p.large_text, 'is_minor', p.is_minor,
    'created_at', p.created_at, 'last_active_at', p.last_active_at, 'deleted', p.deleted_at is not null, 'blocked_at', banned,
    'staff_role', (select a.role from app_admins a where a.profile_id = p.id),
    'plus', has_plus(p.id), 'plus_bonus_until', p.plus_bonus_until, 'marketing_opt_in', p.marketing_opt_in,
    'plans', coalesce((select jsonb_agg(jsonb_build_object('store', f.store, 'product_id', f.product_id, 'status', f.status,
        'renews_at', f.renews_at, 'trial_ends_at', f.trial_ends_at, 'payer', f.payer_id = p.id) order by f.created_at desc)
      from family_plans f where f.payer_id = p.id or exists (select 1 from family_plan_members m where m.plan_id = f.id and m.profile_id = p.id)), '[]'::jsonb),
    'trees', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'creator', t.creator_id = p.id,
        'people', (select count(*) from persons x where x.tree_id = t.id and x.deleted_at is null)) order by t.created_at)
      from trees t where t.deleted_at is null and (t.creator_id = p.id
        or exists (select 1 from shares s where s.tree_id = t.id and s.grantee_profile_id = p.id and s.revoked_at is null))), '[]'::jsonb),
    'counts', jsonb_build_object(
      'memories', (select count(*) from posts x where x.author_id = p.id and x.deleted_at is null),
      'messages', (select count(*) from messages x where x.sender_id = p.id),
      'devices', (select count(*) from device_tokens d where d.profile_id = p.id),
      'sessions', (select count(*) from auth.refresh_tokens r where r.user_id = p.id and r.revoked_at is null and r.expires_at > now()),
      'reports_against', (select count(*) from content_reports r where r.target_owner = p.id),
      'reports_upheld', (select count(*) from content_reports r where r.target_owner = p.id and r.status = 'removed'),
      'reports_made', (select count(*) from content_reports r where r.reporter_id = p.id),
      'blocked_by', (select count(*) from user_blocks b where b.blocked_id = p.id),
      'referred', (select count(*) from referrals r where r.referrer_id = p.id),
      'sos_contacts', (select count(*) from sos_contacts s where s.profile_id = p.id)),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('platform', d.platform, 'last_seen_at', d.last_seen_at) order by d.last_seen_at desc)
      from device_tokens d where d.profile_id = p.id), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'product', o.product, 'status', o.status, 'fulfilment', o.fulfilment,
        'amount_minor', o.amount_minor, 'currency', o.currency, 'created_at', o.created_at) order by o.created_at desc)
      from (select * from one_time_orders o where o.buyer_id = p.id order by o.created_at desc limit 20) o), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'subject', t.subject, 'status', t.status, 'updated_at', t.updated_at)
        order by t.updated_at desc) from support_tickets t where t.profile_id = p.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'actor_name', a.display_name, 'reason', l.reason, 'at', l.created_at) order by l.id desc)
      from (select * from admin_audit_log l where l.target_type = 'user' and l.target_id = p.id::text order by l.id desc limit 15) l
      left join profiles a on a.id = l.actor_id), '[]'::jsonb));
end $$;

-- ===== Dashboard: the work queue and the new areas =====

create or replace function admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare answer jsonb := '{}';
begin
  perform admin_require_staff();
  answer := answer || jsonb_build_object('work', jsonb_build_object(
    'open', (select count(*) from work_items w where w.kind = any (admin_work_kinds()) and w.status <> 'done'),
    'mine', (select count(*) from work_items w where w.assignee_id = auth.uid() and w.status <> 'done'),
    'unassigned', (select count(*) from work_items w where w.kind = any (admin_work_kinds()) and w.status <> 'done' and w.assignee_id is null),
    'overdue', (select count(*) from work_items w where w.kind = any (admin_work_kinds()) and w.status <> 'done' and w.due_at < now())));
  if has_admin_permission('users') or has_admin_permission('support') then
    answer := answer || jsonb_build_object('users', (
      select jsonb_build_object(
        'total', count(*),
        'active_30d', count(*) filter (where p.last_active_at > now() - interval '30 days'),
        'new_7d', count(*) filter (where p.created_at > now() - interval '7 days'),
        'blocked', count(*) filter (where u.banned_at is not null))
      from profiles p join auth.users u on u.id = p.id where p.deleted_at is null));
  end if;
  if has_admin_permission('support') then
    answer := answer || jsonb_build_object('support', jsonb_build_object(
      'open', (select count(*) from support_tickets t where t.status = 'open'),
      'waiting', (select count(*) from support_tickets t where t.status = 'waiting')));
  end if;
  if has_admin_permission('moderation') then
    answer := answer || jsonb_build_object('moderation', jsonb_build_object(
      'open', (select count(*) from content_reports r where r.status = 'open'),
      'urgent', (select count(*) from work_items w where w.kind = 'report' and w.status <> 'done' and w.priority = 'urgent')));
  end if;
  if has_admin_permission('orders') then
    answer := answer || jsonb_build_object('orders', jsonb_build_object(
      'queued', (select count(*) from one_time_orders o where o.status = 'paid' and o.fulfilment = 'queued'),
      'printing', (select count(*) from one_time_orders o where o.status = 'paid' and o.fulfilment = 'printing'),
      'shipped', (select count(*) from one_time_orders o where o.status = 'paid' and o.fulfilment = 'shipped')));
  end if;
  if has_admin_permission('trees') then
    answer := answer || jsonb_build_object('trees', jsonb_build_object(
      'total', (select count(*) from trees t where t.deleted_at is null),
      'people', (select count(*) from persons p where p.deleted_at is null)));
  end if;
  if has_admin_permission('dictionary') then
    answer := answer || jsonb_build_object('dictionary', jsonb_build_object(
      'pending_terms', (select count(*) from kin_terms k where k.status = 'pending'),
      'open_reports', (select count(*) from term_reports r where r.status = 'open')));
  end if;
  if has_admin_permission('takedowns') then
    answer := answer || jsonb_build_object('takedowns', jsonb_build_object(
      'open', (select count(*) from takedown_requests d where d.status = 'open')));
  end if;
  if has_admin_permission('payments') then
    answer := answer || jsonb_build_object('payments', (
      select jsonb_build_object(
        'active', count(*) filter (where f.status = 'active'),
        'trial', count(*) filter (where f.status = 'trial'),
        'grace', count(*) filter (where f.status = 'grace'))
      from family_plans f));
  end if;
  if has_admin_permission('marketing') then
    answer := answer || jsonb_build_object('marketing', jsonb_build_object(
      'coupons_running', (select count(*) from coupons c where c.active and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())),
      'banners_running', (select count(*) from announcements a where a.active and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())),
      'opted_in', (select count(*) from profiles p where p.marketing_opt_in and p.deleted_at is null)));
  end if;
  if has_admin_permission('settings') or has_admin_permission('analytics') then
    answer := answer || jsonb_build_object('health', jsonb_build_object(
      'errors_24h', (select count(*) from client_errors e where e.created_at > now() - interval '1 day'),
      'maintenance', (select (c.value ->> 'on')::boolean from app_config c where c.key = 'maintenance')));
  end if;
  if has_admin_permission('staff') then
    answer := answer || jsonb_build_object('staff', (
      select jsonb_build_object(
        'admins', count(*) filter (where a.role = 'aywo_admin'),
        'sub_admins', count(*) filter (where a.role = 'sub_admin'),
        'without_two_step', count(*) filter (where not exists (select 1 from admin_mfa m where m.profile_id = a.profile_id and m.confirmed_at is not null)))
      from app_admins a));
  end if;
  return answer;
end $$;

-- ===== Group chats: the person who made the chat can remove someone =====

create function chat_remove_member(p_chat uuid, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  c chats;
begin
  perform social_need_plus();
  select * into c from chats where id = p_chat;
  if not found or c.kind <> 'group' or c.created_by is distinct from me or p_profile = me then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  update chat_members set left_at = now() where chat_id = p_chat and profile_id = p_profile and left_at is null;
  if not found then raise exception 'not_found' using errcode = 'PT404'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- The member list says who made the chat, so the app can offer removal to that person only.
create or replace function chat_members_list(p_chat uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare maker uuid;
begin
  perform social_me();
  perform social_need_plus();
  if not social_in_chat(p_chat) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select c.created_by into maker from chats c where c.id = p_chat;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'name', social_name(m.profile_id), 'creator', m.profile_id = maker) order by m.joined_at)
    from chat_members m where m.chat_id = p_chat and m.left_at is null), '[]'::jsonb);
end $$;

-- ===== Email verification codes (the API sends and checks them) =====

create table email_codes (
  profile_id uuid primary key references profiles (id) on delete cascade,
  email text not null,
  code_hash text not null,
  attempts smallint not null default 0,
  sent_count smallint not null default 1,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table email_codes enable row level security;

-- ===== Storage housekeeping =====

-- Files no longer used anywhere wait here for the cleanup job, which deletes them from Spaces.
create table storage_trash (
  path text primary key,
  reason text not null,
  created_at timestamptz not null default now()
);
-- Every signed upload is listed so the size check can find files bigger than allowed.
create table upload_log (
  path text primary key,
  profile_id uuid,
  kind text not null,
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
create index upload_log_unchecked_idx on upload_log (created_at) where checked_at is null;
alter table storage_trash enable row level security;
alter table upload_log enable row level security;

create function storage_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where photo_path = p_path)
      or exists (select 1 from persons where photo_path = p_path)
      or exists (select 1 from post_media where path = p_path)
      or exists (select 1 from messages where media_path = p_path)
$$;

create function storage_forget(p_path text, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into storage_trash (path, reason) select p_path, p_reason where p_path is not null on conflict do nothing
$$;

create function storage_track_post_media() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform storage_forget(old.path, 'memory photo removed');
  return null;
end $$;
create trigger post_media_files after delete on post_media for each row execute function storage_track_post_media();

create function storage_track_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.media_path is not null and new.media_path is distinct from old.media_path then
    perform storage_forget(old.media_path, 'chat file removed');
  end if;
  return null;
end $$;
create trigger messages_files after update of media_path on messages for each row execute function storage_track_message();

create function storage_track_photo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.photo_path is not null and new.photo_path is distinct from old.photo_path then
    perform storage_forget(old.photo_path, 'photo replaced or removed');
  end if;
  return null;
end $$;
create trigger profiles_photo_files after update of photo_path on profiles for each row execute function storage_track_photo();
create trigger persons_photo_files after update of photo_path on persons for each row execute function storage_track_photo();

-- A deleted account's own photo goes too.
create function storage_track_deleted_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and old.photo_path is not null then
    perform storage_forget(old.photo_path, 'account deleted');
  end if;
  return null;
end $$;
create trigger profiles_deleted_files after update of deleted_at on profiles for each row execute function storage_track_deleted_profile();

-- ===== Grants =====

revoke all on function admin_grantable(), admin_clean_permissions(text[]), admin_roles_list(), admin_role_save(uuid, text, text, text[]),
  admin_role_delete(uuid), admin_staff_add(text, app_admin_role_t, text[], uuid), admin_staff_update(uuid, app_admin_role_t, text[], uuid),
  admin_staff_invite_cancel(text), staff_invite_claim(uuid), admin_mfa_reset(uuid, text),
  work_permission(text), work_sla(text), work_open(text, uuid, text, text), work_close(text, uuid),
  work_track_takedown(), work_track_term_report(), admin_work_kinds(), admin_work_json(work_items),
  admin_work_list(text, text, int, int), admin_work_detail(uuid), admin_work_update(uuid, text, text, uuid, boolean, timestamptz),
  admin_work_note(uuid, text), work_overdue_notify(),
  social_blocked_ids(), social_hidden_people(), messages_block_guard(), block_user(uuid), unblock_user(uuid), blocked_list(),
  report_content(text, uuid, text, text), admin_report_target(content_reports), admin_reports_list(text, int, int),
  admin_report_decide(uuid, text, text, boolean),
  ticket_json(support_tickets, boolean), ticket_create(text, text, text), ticket_list(), ticket_detail(uuid), ticket_reply(uuid, text),
  ticket_close(uuid), admin_tickets_list(text, int, int), admin_ticket_detail(uuid), admin_ticket_reply(uuid, text, boolean),
  profiles_email_unverify(), admin_user_give_plus(uuid, int, text), admin_user_end_sessions(uuid, text),
  referral_my(), referral_claim(text), referral_rewards(), my_extras(), marketing_set(boolean),
  emergency_card_json(emergency_cards), emergency_card_get(), emergency_card_save(jsonb), emergency_card_delete(), sos_emergency_card(uuid),
  next_occurrence(date), upcoming_dates(int), on_this_day(), birthday_reminders(),
  orders_to_fulfilment(), coupon_quote(text, text, bigint, text), offers_list(), my_orders(),
  admin_coupons_list(text), admin_coupon_save(uuid, jsonb), admin_orders_list(text, text, int, int), admin_order_detail(uuid, text),
  admin_order_update(uuid, text, text, text, text), admin_order_refunded(uuid, text),
  announcement_json(announcements), announcements_for_me(text), announcements_public(), announcement_event(uuid, text),
  admin_announcements_list(text), admin_announcement_save(uuid, jsonb),
  campaign_targets(text, text, text), admin_campaign_count(text, text, text), admin_campaign_send(text, text, text, text, text, text, text),
  admin_campaigns_list(), app_config_public(), admin_config_set(text, jsonb, text), admin_config_get(),
  admin_app_health(int), admin_analytics(int), admin_user_detail(uuid, text), chat_remove_member(uuid, uuid),
  storage_in_use(text), storage_forget(text, text), storage_track_post_media(), storage_track_message(), storage_track_photo(),
  storage_track_deleted_profile()
  from public, anon, authenticated;

-- People.
grant execute on function social_hidden_people(), block_user(uuid), unblock_user(uuid), blocked_list(), report_content(text, uuid, text, text),
  ticket_create(text, text, text), ticket_list(), ticket_detail(uuid), ticket_reply(uuid, text), ticket_close(uuid),
  referral_my(), referral_claim(text), my_extras(), marketing_set(boolean),
  emergency_card_get(), emergency_card_save(jsonb), emergency_card_delete(), sos_emergency_card(uuid),
  upcoming_dates(int), on_this_day(), coupon_quote(text, text, bigint, text), offers_list(), my_orders(),
  announcements_for_me(text), announcement_event(uuid, text), chat_remove_member(uuid, uuid)
  to authenticated;
grant execute on function app_config_public(), announcements_public() to anon, authenticated;

-- Staff: each checks the caller's permission itself.
grant execute on function admin_roles_list(), admin_role_save(uuid, text, text, text[]), admin_role_delete(uuid),
  admin_staff_add(text, app_admin_role_t, text[], uuid), admin_staff_update(uuid, app_admin_role_t, text[], uuid),
  admin_staff_invite_cancel(text), admin_mfa_reset(uuid, text),
  admin_work_list(text, text, int, int), admin_work_detail(uuid), admin_work_update(uuid, text, text, uuid, boolean, timestamptz),
  admin_work_note(uuid, text), admin_reports_list(text, int, int), admin_report_decide(uuid, text, text, boolean),
  admin_tickets_list(text, int, int), admin_ticket_detail(uuid), admin_ticket_reply(uuid, text, boolean),
  admin_user_give_plus(uuid, int, text), admin_user_end_sessions(uuid, text),
  admin_coupons_list(text), admin_coupon_save(uuid, jsonb), admin_orders_list(text, text, int, int), admin_order_detail(uuid, text),
  admin_order_update(uuid, text, text, text, text), admin_order_refunded(uuid, text),
  admin_announcements_list(text), admin_announcement_save(uuid, jsonb),
  admin_campaign_count(text, text, text), admin_campaign_send(text, text, text, text, text, text, text), admin_campaigns_list(),
  admin_config_set(text, jsonb, text), admin_config_get(), admin_app_health(int), admin_analytics(int), admin_user_detail(uuid, text)
  to authenticated;
