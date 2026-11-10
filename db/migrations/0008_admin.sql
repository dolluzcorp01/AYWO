-- AYWO Admin and Sub-admin: the app's own staff, unrelated to a tree's Creator (LLD S-19 to S-21, L5 nos. 19 and 20).
--
-- An AYWO Admin holds every permission and alone manages staff and reads the audit log.
-- A Sub-admin holds only the permissions listed in app_admin_permissions.
--   dictionary  new relationship words and wrong-word reports
--   takedowns   takedown requests
--   users       find accounts, block and unblock them
--   support     find accounts, read only
--   trees       find trees (name and counts); looking at a tree's people needs a reason and is audited
--   payments    plans and orders overview
-- Tree contents and contact values stay private: no function here ever returns person_contacts values,
-- dates, notes or photos. Login phone numbers and emails only leave these functions masked.
-- Staff work goes through the functions below. Clients get no table writes, and every change writes admin_audit_log.

alter table app_admins
  add column created_at timestamptz not null default now(),
  add column added_by uuid references profiles (id) on delete set null;

create table app_admin_permissions (
  profile_id uuid not null references app_admins (profile_id) on delete cascade,
  permission text not null check (permission in ('dictionary', 'takedowns', 'users', 'trees', 'payments', 'support')),
  granted_by uuid references profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, permission)
);

-- actor_id has no foreign key so the record outlives the account. Null means a server script (create-admin).
create table admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  reason text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_audit_log_time_idx on admin_audit_log (created_at desc);
create index admin_audit_log_action_idx on admin_audit_log (action, created_at desc);

-- Nobody edits the record, whatever their rights.
create function admin_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'admin_audit_append_only' using errcode = 'PT403';
end $$;
create trigger admin_audit_log_no_change before update or delete on admin_audit_log
  for each row execute function admin_audit_append_only();
create trigger admin_audit_log_no_truncate before truncate on admin_audit_log
  for each statement execute function admin_audit_append_only();

alter table takedown_requests
  add column subject_name text,
  add column decided_by uuid references profiles (id) on delete set null,
  add column decided_at timestamptz,
  add column decision_note text,
  add constraint takedown_requests_status_check check (status in ('open', 'removed', 'dismissed'));
create index takedown_requests_status_idx on takedown_requests (status, created_at desc);
create index takedown_requests_contact_idx on takedown_requests (lower(requester_contact), created_at desc);

alter table term_reports
  add constraint term_reports_status_check check (status in ('open', 'accepted', 'dismissed'));

-- A person removed by a takedown cannot come back through history revert or an edit.
alter table persons add column taken_down_at timestamptz;

create function persons_takedown_guard() returns trigger language plpgsql as $$
begin
  if old.taken_down_at is not null and (new.deleted_at is null or new.taken_down_at is null) then
    raise exception 'person_taken_down' using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger persons_keep_taken_down before update on persons
  for each row execute function persons_takedown_guard();

-- ===== Checks =====

-- Blocked staff lose their powers at once, even while their short-lived access token still works.
create function has_admin_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_admins a
    join auth.users u on u.id = a.profile_id
    where a.profile_id = auth.uid() and u.banned_at is null
      and (
        (a.role = 'aywo_admin' and p_permission in
          ('dictionary', 'takedowns', 'users', 'trees', 'payments', 'support', 'staff', 'audit'))
        or (a.role = 'sub_admin' and exists (
          select 1 from app_admin_permissions g where g.profile_id = a.profile_id and g.permission = p_permission
        ))
      )
  )
$$;

create function admin_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_admins a join auth.users u on u.id = a.profile_id
    where a.profile_id = auth.uid() and u.banned_at is null
  )
$$;

create function admin_require(p_permissions text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from unnest(p_permissions) g(name) where has_admin_permission(g.name)) then
    raise exception 'admin_not_allowed' using errcode = 'PT403';
  end if;
end $$;

create function admin_require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not admin_is_staff() then
    raise exception 'admin_not_allowed' using errcode = 'PT403';
  end if;
end $$;

create function admin_clean_reason(p_reason text) returns text
language plpgsql immutable set search_path = public as $$
declare cleaned text := trim(coalesce(p_reason, ''));
begin
  if char_length(cleaned) < 5 or char_length(cleaned) > 500 then
    raise exception 'admin_reason_required' using errcode = 'PT422';
  end if;
  return cleaned;
end $$;

-- Never pass contact values or phone numbers in p_details.
create function admin_log(p_action text, p_target_type text, p_target_id text, p_reason text default null, p_details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into admin_audit_log (actor_id, action, target_type, target_id, reason, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_reason, coalesce(p_details, '{}'))
$$;

-- ===== Small helpers =====

create function admin_mask_phone(p_phone text) returns text
language sql immutable set search_path = public as $$
  select case when p_phone is null or p_phone = '' then null
              else left(p_phone, 3) || '*****' || right(p_phone, 4) end
$$;

create function admin_mask_email(p_email text) returns text
language sql immutable set search_path = public as $$
  select case when p_email is null or p_email = '' then null
              else left(p_email, 1) || '***@' || split_part(p_email, '@', 2) end
$$;

create function admin_like(p_text text) returns text
language sql immutable set search_path = public as $$
  select '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

create function admin_limit(p_limit int) returns int
language sql immutable set search_path = public as $$
  select least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

create function admin_offset(p_offset int) returns int
language sql immutable set search_path = public as $$
  select greatest(coalesce(p_offset, 0), 0)
$$;

-- ===== Who am I, and the dashboard =====

create function admin_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare my_role app_admin_role_t;
begin
  perform admin_require_staff();
  select a.role into my_role from app_admins a where a.profile_id = auth.uid();
  return jsonb_build_object('role', my_role, 'permissions',
    case when my_role = 'aywo_admin'
      then '["dictionary","takedowns","users","trees","payments","support","staff","audit"]'::jsonb
      else coalesce((select jsonb_agg(g.permission order by g.permission)
                     from app_admin_permissions g where g.profile_id = auth.uid()), '[]'::jsonb)
    end);
end $$;

-- Only the groups the caller is granted appear in the answer.
create function admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare answer jsonb := '{}';
begin
  perform admin_require_staff();
  if has_admin_permission('users') or has_admin_permission('support') then
    answer := answer || jsonb_build_object('users', (
      select jsonb_build_object(
        'total', count(*),
        'active_30d', count(*) filter (where p.last_active_at > now() - interval '30 days'),
        'new_7d', count(*) filter (where p.created_at > now() - interval '7 days'),
        'blocked', count(*) filter (where u.banned_at is not null))
      from profiles p join auth.users u on u.id = p.id where p.deleted_at is null));
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
  if has_admin_permission('staff') then
    answer := answer || jsonb_build_object('staff', (
      select jsonb_build_object(
        'admins', count(*) filter (where a.role = 'aywo_admin'),
        'sub_admins', count(*) filter (where a.role = 'sub_admin'))
      from app_admins a));
  end if;
  return answer;
end $$;

-- ===== Users =====

-- Search by name, exact id, exact email, or at least 7 digits of the phone number. Phones and emails come back masked.
create function admin_users_list(p_q text default null, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(trim(coalesce(p_q, '')), '');
  digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['users', 'support']);
  with hits as (
    select p.id, p.display_name, p.login_phone, p.email, p.created_at, p.last_active_at, p.deleted_at, u.banned_at
    from profiles p join auth.users u on u.id = p.id
    where q is null
       or p.display_name ilike admin_like(q)
       or p.id::text = lower(q)
       or lower(p.email) = lower(q)
       or (char_length(digits) >= 7 and regexp_replace(coalesce(p.login_phone, ''), '\D', '', 'g') like '%' || digits)
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'display_name', x.display_name,
        'phone_masked', admin_mask_phone(x.login_phone),
        'email_masked', admin_mask_email(x.email),
        'created_at', x.created_at,
        'last_active_at', x.last_active_at,
        'deleted', x.deleted_at is not null,
        'blocked_at', x.banned_at,
        'trees_created', (select count(*) from trees t where t.creator_id = x.id and t.deleted_at is null),
        'plus', has_plus(x.id),
        'staff_role', (select a.role from app_admins a where a.profile_id = x.id)
      ) order by x.created_at desc, x.id), '[]'::jsonb)
     from (select * from hits order by created_at desc, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- Blocking stops new logins and refreshes (auth routes check banned_at) and ends every session.
create function admin_user_block(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cleaned text;
begin
  perform admin_require(array['users']);
  if p_user = auth.uid() then
    raise exception 'admin_cannot_block_self' using errcode = 'PT422';
  end if;
  if exists (select 1 from app_admins a where a.profile_id = p_user) and not has_admin_permission('staff') then
    raise exception 'admin_staff_only' using errcode = 'PT403';
  end if;
  cleaned := admin_clean_reason(p_reason);
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  update auth.users set banned_at = now() where id = p_user and banned_at is null;
  if found then
    update auth.refresh_tokens set revoked_at = now() where user_id = p_user and revoked_at is null;
    perform admin_log('user.blocked', 'user', p_user::text, cleaned);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function admin_user_unblock(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cleaned text;
begin
  perform admin_require(array['users']);
  if exists (select 1 from app_admins a where a.profile_id = p_user) and not has_admin_permission('staff') then
    raise exception 'admin_staff_only' using errcode = 'PT403';
  end if;
  cleaned := admin_clean_reason(p_reason);
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  update auth.users set banned_at = null where id = p_user and banned_at is not null;
  if found then
    perform admin_log('user.unblocked', 'user', p_user::text, cleaned);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ===== Trees: name and counts only =====

create function admin_trees_list(p_q text default null, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(trim(coalesce(p_q, '')), '');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['trees']);
  with hits as (
    select t.id, t.name, t.creator_id, t.created_at, t.updated_at, t.deleted_at
    from trees t
    where q is null or t.name ilike admin_like(q) or t.id::text = lower(q) or t.creator_id::text = lower(q)
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'name', x.name,
        'creator_id', x.creator_id,
        'creator_name', (select p.display_name from profiles p where p.id = x.creator_id),
        'created_at', x.created_at,
        'updated_at', x.updated_at,
        'deleted', x.deleted_at is not null,
        'people', (select count(*) from persons p where p.tree_id = x.id and p.deleted_at is null),
        'shares', (select count(*) from shares s where s.tree_id = x.id and s.revoked_at is null)
      ) order by x.created_at desc, x.id), '[]'::jsonb)
     from (select * from hits order by created_at desc, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- Every look is recorded with its reason. Names and living state only: never contacts, dates, notes or photos.
create function admin_tree_people(p_tree uuid, p_reason text, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text;
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['trees']);
  cleaned := admin_clean_reason(p_reason);
  if not exists (select 1 from trees t where t.id = p_tree) then
    raise exception 'admin_tree_not_found' using errcode = 'PT404';
  end if;
  perform admin_log('tree.people_viewed', 'tree', p_tree::text, cleaned,
    jsonb_build_object('limit', admin_limit(p_limit), 'offset', admin_offset(p_offset)));
  select count(*)::int into total_rows from persons p where p.tree_id = p_tree and p.deleted_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'display_name', x.display_name,
      'name_unknown', x.name_unknown,
      'living', x.living,
      'has_account', x.claimed_by is not null
    ) order by x.display_name, x.id), '[]'::jsonb)
  into page_rows
  from (
    select p.id, p.display_name, p.name_unknown, p.living, p.claimed_by
    from persons p where p.tree_id = p_tree and p.deleted_at is null
    order by p.display_name, p.id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- ===== Dictionary (L5 no. 20) =====

create function admin_kin_terms_list(p_status text default 'pending', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'pending');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['dictionary']);
  select count(*)::int into total_rows from kin_terms k where k.status::text = wanted;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'term', x.term,
      'term_native', x.term_native,
      'path_code', x.path_code,
      'path_description', x.description_en,
      'language_code', x.language_code,
      'language_name', x.name_en,
      'speaker_gender', x.speaker_gender,
      'status', x.status,
      'submitted_by_name', x.submitted_by_name,
      'created_at', x.created_at
    ) order by x.created_at, x.id), '[]'::jsonb)
  into page_rows
  from (
    select k.id, k.term, k.term_native, k.path_code, kp.description_en, k.language_code, l.name_en,
           k.speaker_gender, k.status, p.display_name as submitted_by_name, k.created_at
    from kin_terms k
    join kin_paths kp on kp.code = k.path_code
    join languages l on l.code = k.language_code
    left join profiles p on p.id = k.submitted_by
    where k.status::text = wanted
    order by k.created_at, k.id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

create function admin_kin_review(p_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  word text;
  submitter uuid;
begin
  perform admin_require(array['dictionary']);
  if p_decision not in ('approve', 'reject') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  update kin_terms
  set status = case when p_decision = 'approve' then 'verified'::term_status_t else 'rejected'::term_status_t end
  where id = p_id and status = 'pending'
  returning term, submitted_by into word, submitter;
  if not found then
    if exists (select 1 from kin_terms k where k.id = p_id) then
      raise exception 'admin_already_decided' using errcode = 'PT409';
    end if;
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  perform admin_log(case when p_decision = 'approve' then 'kin_term.approved' else 'kin_term.rejected' end,
    'kin_term', p_id::text);
  if submitter is not null then
    insert into notifications (recipient_id, kind, payload)
    values (submitter, 'kin_term_reviewed', jsonb_build_object('term', word, 'decision', p_decision));
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function admin_term_reports_list(p_status text default 'open', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['dictionary']);
  select count(*)::int into total_rows from term_reports r where r.status = wanted;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'kin_term_id', x.kin_term_id,
      'term', x.term,
      'term_native', x.term_native,
      'path_description', x.description_en,
      'language_name', x.name_en,
      'suggestion', x.suggestion,
      'status', x.status,
      'reporter_name', x.reporter_name,
      'created_at', x.created_at
    ) order by x.created_at, x.id), '[]'::jsonb)
  into page_rows
  from (
    select r.id, r.kin_term_id, k.term, k.term_native, kp.description_en, l.name_en, r.suggestion, r.status,
           p.display_name as reporter_name, r.created_at
    from term_reports r
    join kin_terms k on k.id = r.kin_term_id
    join kin_paths kp on kp.code = k.path_code
    join languages l on l.code = k.language_code
    left join profiles p on p.id = r.reporter_id
    where r.status = wanted
    order by r.created_at, r.id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- Accept with a corrected word replaces it and marks it verified. Accept with no word withdraws the reported word.
-- Dismiss leaves the word as it is.
create function admin_term_report_decide(p_id uuid, p_decision text, p_new_term text default null, p_new_native text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  term_id uuid;
  state text;
  new_word text := nullif(trim(coalesce(p_new_term, '')), '');
begin
  perform admin_require(array['dictionary']);
  if p_decision not in ('accept', 'dismiss') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  select r.kin_term_id, r.status into term_id, state from term_reports r where r.id = p_id for update;
  if term_id is null then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if state <> 'open' then
    raise exception 'admin_already_decided' using errcode = 'PT409';
  end if;
  if p_decision = 'accept' then
    if new_word is not null then
      update kin_terms set term = new_word, term_native = nullif(trim(coalesce(p_new_native, '')), ''), status = 'verified'
      where id = term_id;
    else
      update kin_terms set status = 'rejected' where id = term_id;
    end if;
  end if;
  update term_reports set status = case when p_decision = 'accept' then 'accepted' else 'dismissed' end where id = p_id;
  perform admin_log(case when p_decision = 'accept' then 'term_report.accepted' else 'term_report.dismissed' end,
    'term_report', p_id::text, null,
    jsonb_build_object('kin_term_id', term_id, 'word_replaced', p_decision = 'accept' and new_word is not null));
  return jsonb_build_object('ok', true);
end $$;

-- ===== Takedown requests =====

-- Public: POST /takedown, no sign-in, rate limited by the route. Deliberately not in the /rpc list.
-- An unknown person id is stored as null, so this cannot be used to test whether an id exists.
create function takedown_submit(p_person uuid, p_subject_name text, p_contact text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  contact text := trim(coalesce(p_contact, ''));
  why text := trim(coalesce(p_reason, ''));
  subject text := nullif(trim(coalesce(p_subject_name, '')), '');
begin
  if char_length(contact) not between 3 and 200 or char_length(why) not between 10 and 2000
     or char_length(coalesce(subject, '')) > 200 or (p_person is null and subject is null) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if (select count(*) from takedown_requests d
      where lower(d.requester_contact) = lower(contact) and d.created_at > now() - interval '1 day') >= 5 then
    raise exception 'takedown_too_many' using errcode = 'PT429';
  end if;
  insert into takedown_requests (person_id, subject_name, requester_contact, reason)
  values ((select p.id from persons p where p.id = p_person), subject, contact, why);
end $$;

-- requester_contact is what the person asking gave us so we can reply. It is part of the takedown item, not a tree contact.
create function admin_takedowns_list(p_status text default 'open', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['takedowns']);
  select count(*)::int into total_rows from takedown_requests d where d.status = wanted;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'requester_contact', x.requester_contact,
      'reason', x.reason,
      'status', x.status,
      'subject_name', x.subject_name,
      'person_id', x.person_id,
      'person_name', x.person_name,
      'tree_id', x.tree_id,
      'tree_name', x.tree_name,
      'decision_note', x.decision_note,
      'decided_at', x.decided_at,
      'decided_by_name', x.decided_by_name,
      'created_at', x.created_at
    ) order by x.created_at, x.id), '[]'::jsonb)
  into page_rows
  from (
    select d.id, d.requester_contact, d.reason, d.status, d.subject_name, d.person_id, p.display_name as person_name,
           t.id as tree_id, t.name as tree_name, d.decision_note, d.decided_at,
           s.display_name as decided_by_name, d.created_at
    from takedown_requests d
    left join persons p on p.id = d.person_id
    left join trees t on t.id = p.tree_id
    left join profiles s on s.id = d.decided_by
    where d.status = wanted
    order by d.created_at, d.id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- 'remove' soft-deletes the person, deletes their contact values and tells the tree's Creator.
-- p_person names the person when the request came in with only a name.
create function admin_takedown_decide(p_id uuid, p_decision text, p_note text, p_person uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item takedown_requests%rowtype;
  cleaned text;
  target uuid;
  target_name text;
  target_tree uuid;
  tree_creator uuid;
begin
  perform admin_require(array['takedowns']);
  if p_decision not in ('remove', 'dismiss') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  cleaned := admin_clean_reason(p_note);
  select * into item from takedown_requests d where d.id = p_id for update;
  if not found then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if item.status <> 'open' then
    raise exception 'admin_already_decided' using errcode = 'PT409';
  end if;
  target := coalesce(p_person, item.person_id);
  if p_decision = 'remove' then
    select p.display_name, p.tree_id into target_name, target_tree from persons p where p.id = target for update;
    if target_tree is null then
      raise exception 'admin_takedown_needs_person' using errcode = 'PT422';
    end if;
    update persons set deleted_at = coalesce(deleted_at, now()), taken_down_at = now() where id = target;
    delete from person_contacts where person_id = target;
    select t.creator_id into tree_creator from trees t where t.id = target_tree;
    insert into notifications (recipient_id, kind, payload)
    values (tree_creator, 'person_taken_down',
            jsonb_build_object('tree_id', target_tree, 'person_id', target, 'person_name', target_name));
  end if;
  update takedown_requests
  set status = case when p_decision = 'remove' then 'removed' else 'dismissed' end,
      person_id = case when p_decision = 'remove' then target else person_id end,
      decided_by = auth.uid(), decided_at = now(), decision_note = cleaned
  where id = p_id;
  perform admin_log(case when p_decision = 'remove' then 'takedown.removed' else 'takedown.dismissed' end,
    'takedown', p_id::text, cleaned,
    case when p_decision = 'remove' then jsonb_build_object('person_id', target, 'tree_id', target_tree) else '{}'::jsonb end);
  return jsonb_build_object('ok', true);
end $$;

-- ===== Payments overview =====

-- one_time_orders belongs to the payments area (0007), so it is read only if it is there. No buyer details, only totals.
create function admin_payments_overview(p_status text default null, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(p_status, '');
  total_rows int;
  page_rows jsonb;
  summary jsonb;
  orders jsonb := null;
begin
  perform admin_require(array['payments']);
  select jsonb_build_object(
    'plans', (select count(*) from family_plans),
    'members', (select count(*) from family_plan_members),
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from
      (select f.status::text as status, count(*) as n from family_plans f group by 1) s), '{}'::jsonb),
    'by_store', coalesce((select jsonb_object_agg(s.store, s.n) from
      (select f.store::text as store, count(*) as n from family_plans f group by 1) s), '{}'::jsonb),
    'by_product', coalesce((select jsonb_object_agg(s.product_id, s.n) from
      (select f.product_id, count(*) as n from family_plans f group by 1) s), '{}'::jsonb)
  ) into summary;

  if to_regclass('public.one_time_orders') is not null then
    execute $sql$
      select jsonb_build_object(
        'total', (select count(*) from public.one_time_orders),
        'by_status', coalesce((select jsonb_object_agg(s.state, s.n) from
          (select status as state, count(*) as n from public.one_time_orders group by 1) s), '{}'::jsonb),
        'paid_minor_by_currency', coalesce((select jsonb_object_agg(s.currency, s.n) from
          (select currency, sum(amount_minor) as n from public.one_time_orders where status = 'paid' group by 1) s), '{}'::jsonb))
    $sql$ into orders;
  end if;

  select count(*)::int into total_rows from family_plans f where wanted is null or f.status::text = wanted;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'payer_id', x.payer_id,
      'payer_name', x.display_name,
      'payer_phone_masked', admin_mask_phone(x.login_phone),
      'store', x.store,
      'product_id', x.product_id,
      'status', x.status,
      'trial_ends_at', x.trial_ends_at,
      'renews_at', x.renews_at,
      'external_id', x.external_id,
      'members', (select count(*) from family_plan_members m where m.plan_id = x.id)
    ) order by x.renews_at desc nulls last, x.id), '[]'::jsonb)
  into page_rows
  from (
    select f.id, f.payer_id, p.display_name, p.login_phone, f.store, f.product_id, f.status, f.trial_ends_at, f.renews_at, f.external_id
    from family_plans f join profiles p on p.id = f.payer_id
    where wanted is null or f.status::text = wanted
    order by f.renews_at desc nulls last, f.id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('summary', summary, 'orders', orders, 'total', total_rows, 'rows', page_rows);
end $$;

-- ===== Staff: AYWO Admin only =====

create function admin_set_permissions(p_profile uuid, p_role app_admin_role_t, p_permissions text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from app_admin_permissions where profile_id = p_profile;
  if p_role = 'sub_admin' then
    if coalesce(array_length(p_permissions, 1), 0) = 0 then
      raise exception 'admin_permission_required' using errcode = 'PT422';
    end if;
    insert into app_admin_permissions (profile_id, permission, granted_by)
    select distinct p_profile, g.name, auth.uid() from unnest(p_permissions) g(name);
  end if;
end $$;

create function admin_staff_list(p_limit int default 100, p_offset int default 0) returns jsonb
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
      'permissions', coalesce((select jsonb_agg(g.permission order by g.permission)
                               from app_admin_permissions g where g.profile_id = x.profile_id), '[]'::jsonb),
      'created_at', x.created_at,
      'blocked_at', x.banned_at,
      'is_me', x.profile_id = auth.uid()
    ) order by x.role, x.display_name, x.profile_id), '[]'::jsonb)
  into page_rows
  from (
    select a.profile_id, p.display_name, p.login_phone, a.role, a.created_at, u.banned_at
    from app_admins a
    join profiles p on p.id = a.profile_id
    join auth.users u on u.id = a.profile_id
    order by a.role, p.display_name, a.profile_id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- The person must have signed in once, or been created with create-admin. p_phone is in E.164 (checked by the route).
create function admin_staff_add(p_phone text, p_role app_admin_role_t, p_permissions text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare person uuid;
begin
  perform admin_require(array['staff']);
  select p.id into person from profiles p where p.login_phone = p_phone and p.deleted_at is null;
  if person is null then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  if exists (select 1 from app_admins a where a.profile_id = person) then
    raise exception 'admin_already_staff' using errcode = 'PT409';
  end if;
  insert into app_admins (profile_id, role, added_by) values (person, p_role, auth.uid());
  perform admin_set_permissions(person, p_role, p_permissions);
  perform admin_log('staff.added', 'user', person::text, null,
    jsonb_build_object('role', p_role, 'permissions', case when p_role = 'sub_admin' then to_jsonb(p_permissions) else '[]'::jsonb end));
  return jsonb_build_object('profile_id', person);
end $$;

-- Nobody changes or removes their own place, so at least one AYWO Admin always remains.
create function admin_staff_update(p_profile uuid, p_role app_admin_role_t, p_permissions text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform admin_require(array['staff']);
  if p_profile = auth.uid() then
    raise exception 'admin_cannot_change_self' using errcode = 'PT422';
  end if;
  update app_admins set role = p_role where profile_id = p_profile;
  if not found then
    raise exception 'admin_user_not_found' using errcode = 'PT404';
  end if;
  perform admin_set_permissions(p_profile, p_role, p_permissions);
  perform admin_log('staff.updated', 'user', p_profile::text, null,
    jsonb_build_object('role', p_role, 'permissions', case when p_role = 'sub_admin' then to_jsonb(p_permissions) else '[]'::jsonb end));
  return jsonb_build_object('ok', true);
end $$;

create function admin_staff_remove(p_profile uuid) returns jsonb
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
  perform admin_log('staff.removed', 'user', p_profile::text);
  return jsonb_build_object('ok', true);
end $$;

-- ===== Audit log: AYWO Admin only =====

create function admin_audit_list(p_action text default null, p_actor uuid default null, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(trim(coalesce(p_action, '')), '');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['audit']);
  select count(*)::int into total_rows from admin_audit_log l
  where (wanted is null or l.action ilike admin_like(wanted)) and (p_actor is null or l.actor_id = p_actor);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'actor_id', x.actor_id,
      'actor_name', x.display_name,
      'action', x.action,
      'target_type', x.target_type,
      'target_id', x.target_id,
      'reason', x.reason,
      'details', x.details,
      'created_at', x.created_at
    ) order by x.id desc), '[]'::jsonb)
  into page_rows
  from (
    select l.id, l.actor_id, p.display_name, l.action, l.target_type, l.target_id, l.reason, l.details, l.created_at
    from admin_audit_log l left join profiles p on p.id = l.actor_id
    where (wanted is null or l.action ilike admin_like(wanted)) and (p_actor is null or l.actor_id = p_actor)
    order by l.id desc limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- ===== Grants and row rules =====

revoke all on function admin_audit_append_only(), persons_takedown_guard(), has_admin_permission(text), admin_is_staff(),
  admin_require(text[]), admin_require_staff(), admin_clean_reason(text), admin_log(text, text, text, text, jsonb),
  admin_mask_phone(text), admin_mask_email(text), admin_like(text), admin_limit(int), admin_offset(int),
  admin_me(), admin_dashboard(), admin_users_list(text, int, int), admin_user_block(uuid, text), admin_user_unblock(uuid, text),
  admin_trees_list(text, int, int), admin_tree_people(uuid, text, int, int),
  admin_kin_terms_list(text, int, int), admin_kin_review(uuid, text),
  admin_term_reports_list(text, int, int), admin_term_report_decide(uuid, text, text, text),
  takedown_submit(uuid, text, text, text), admin_takedowns_list(text, int, int), admin_takedown_decide(uuid, text, text, uuid),
  admin_payments_overview(text, int, int), admin_set_permissions(uuid, app_admin_role_t, text[]),
  admin_staff_list(int, int), admin_staff_add(text, app_admin_role_t, text[]), admin_staff_update(uuid, app_admin_role_t, text[]),
  admin_staff_remove(uuid), admin_audit_list(text, uuid, int, int)
  from public, anon, authenticated;

-- Each of these checks the caller itself. The helpers above stay internal.
grant execute on function has_admin_permission(text),
  admin_me(), admin_dashboard(), admin_users_list(text, int, int), admin_user_block(uuid, text), admin_user_unblock(uuid, text),
  admin_trees_list(text, int, int), admin_tree_people(uuid, text, int, int),
  admin_kin_terms_list(text, int, int), admin_kin_review(uuid, text),
  admin_term_reports_list(text, int, int), admin_term_report_decide(uuid, text, text, text),
  admin_takedowns_list(text, int, int), admin_takedown_decide(uuid, text, text, uuid),
  admin_payments_overview(text, int, int),
  admin_staff_list(int, int), admin_staff_add(text, app_admin_role_t, text[]), admin_staff_update(uuid, app_admin_role_t, text[]),
  admin_staff_remove(uuid), admin_audit_list(text, uuid, int, int)
  to authenticated;
grant execute on function takedown_submit(uuid, text, text, text) to anon, authenticated;

grant select (profile_id, role) on app_admins to authenticated;
grant select on app_admin_permissions to authenticated;
grant select on admin_audit_log to authenticated;

alter table app_admin_permissions enable row level security;
alter table admin_audit_log enable row level security;

-- GET /me needs the caller's own role; everyone else's stays hidden.
create policy app_admins_self on app_admins for select using (profile_id = auth.uid());
create policy app_admin_permissions_read on app_admin_permissions for select
  using (profile_id = auth.uid() or has_admin_permission('staff'));
create policy admin_audit_log_read on admin_audit_log for select using (has_admin_permission('audit'));
