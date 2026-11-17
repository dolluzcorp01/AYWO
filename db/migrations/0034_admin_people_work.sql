-- PR 37: the admin panel's pages about people and work.
--  1. Users list: show only blocked accounts, AYWO Plus accounts or staff, and sort by newest, last active or name.
--  2. Free Plus days given by mistake (300 typed for 30) can be taken back.
--  3. Work queue history keeps what changed as data, so the screen can say it in the staff member's language.
--  4. Help tickets: search by customer name or subject, reopen a closed ticket, close one without an answer.
--  5. Any staff member can see the names of the AYWO Admins, to know whom to ask for more access.

-- ===== 1. Users list: filter and sort =====

-- Search by name, exact id, exact email, or at least 7 digits of the phone number. Phones and emails come back masked.
-- p_filter: 'all', 'blocked', 'plus', 'staff'. p_sort: 'newest', 'active' (last active first), 'name'.
drop function admin_users_list(text, int, int);
create function admin_users_list(p_q text default null, p_limit int default 25, p_offset int default 0,
  p_filter text default 'all', p_sort text default 'newest') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(trim(coalesce(p_q, '')), '');
  digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  only_these text := coalesce(nullif(p_filter, ''), 'all');
  sorted_by text := coalesce(nullif(p_sort, ''), 'newest');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['users', 'support']);
  if only_these not in ('all', 'blocked', 'plus', 'staff') or sorted_by not in ('newest', 'active', 'name') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  with hits as (
    select p.id, p.display_name, p.login_phone, p.email, p.created_at, p.last_active_at, p.deleted_at, u.banned_at
    from profiles p join auth.users u on u.id = p.id
    where (q is null
       or p.display_name ilike admin_like(q)
       or p.id::text = lower(q)
       or lower(p.email) = lower(q)
       or (char_length(digits) >= 7 and regexp_replace(coalesce(p.login_phone, ''), '\D', '', 'g') like '%' || digits))
      and case only_these
            when 'blocked' then u.banned_at is not null
            when 'plus' then has_plus(p.id)
            when 'staff' then exists (select 1 from app_admins a where a.profile_id = p.id)
            else true end
  ), page as (
    -- Accounts with no name, or never active, go last in their sort. Newest first settles every tie.
    select h.*, row_number() over (order by
        case when sorted_by = 'name' then lower(nullif(trim(h.display_name), '')) end asc nulls last,
        case when sorted_by = 'active' then h.last_active_at end desc nulls last,
        h.created_at desc, h.id) as place
    from hits h
    order by place limit admin_limit(p_limit) offset admin_offset(p_offset)
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
      ) order by x.place), '[]'::jsonb)
     from page x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- ===== 2. Take back free Plus days =====

-- The undo for admin_user_give_plus. Free Plus never ends earlier than now: asking for more days than are left
-- simply ends it. Paid plans are not touched. The person is not sent a notification.
create function admin_user_take_plus(p_user uuid, p_days int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := admin_clean_reason(p_reason);
  had_until timestamptz;
  new_until timestamptz;
begin
  perform admin_require(array['payments', 'support']);
  if p_days is null or p_days not between 1 and 365 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  select p.plus_bonus_until into had_until from profiles p where p.id = p_user and p.deleted_at is null for update;
  if not found then raise exception 'admin_user_not_found' using errcode = 'PT404'; end if;
  if had_until is null or had_until <= now() then raise exception 'admin_no_free_plus' using errcode = 'PT422'; end if;
  new_until := had_until - make_interval(days => p_days);
  if new_until <= now() then new_until := null; end if;
  update profiles set plus_bonus_until = new_until where id = p_user;
  perform admin_log('user.plus_taken_back', 'user', p_user::text, cleaned,
    jsonb_build_object('days', p_days, 'was_until', had_until, 'now_until', new_until));
  return jsonb_build_object('plus_bonus_until', new_until);
end $$;

-- ===== 3. Work queue: what changed, as data =====

-- For a line the system wrote ("Changed: ..."): the same change as data, for example
-- {"status": "in_progress", "assignee": "<id>", "assignee_name": "Kavi"}. Empty for a note a staff member typed.
alter table work_notes add column changed jsonb;

create or replace function admin_work_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w work_items;
begin
  perform admin_require_staff();
  select * into w from work_items where id = p_id;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_require(array[work_permission(w.kind)]);
  return admin_work_json(w) || jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'author_name', p.display_name, 'body', n.body,
                                                             'changes', n.changed, 'created_at', n.created_at) order by n.id)
                         from work_notes n left join profiles p on p.id = n.author_id where n.item_id = w.id), '[]'::jsonb),
    'assignable', coalesce((select jsonb_agg(jsonb_build_object('profile_id', a.profile_id, 'name', p.display_name) order by p.display_name)
                            from app_admins a join profiles p on p.id = a.profile_id join auth.users u on u.id = a.profile_id
                            where u.banned_at is null and (a.role = 'aywo_admin' or exists (
                              select 1 from app_admin_permissions g where g.profile_id = a.profile_id and g.permission = work_permission(w.kind)))), '[]'::jsonb));
end $$;

-- Changes owner, status, priority or deadline. A new owner is told at once (push and the admin queue).
-- The history line keeps its English text for old screens, and now also carries the change as data.
create or replace function admin_work_update(p_id uuid, p_status text default null, p_priority text default null,
  p_assignee uuid default null, p_unassign boolean default false, p_due_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w work_items;
  changes jsonb := '{}';
  shown jsonb;
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
    -- The name is kept with the line, so the history still reads right after that person leaves the staff.
    shown := changes;
    if changes ->> 'assignee' is not null then
      shown := shown || jsonb_build_object('assignee_name', (select p.display_name from profiles p where p.id = p_assignee));
    end if;
    insert into work_notes (item_id, author_id, body, changed)
    values (p_id, auth.uid(),
            'Changed: ' || (select string_agg(k || ' ' || coalesce(v #>> '{}', 'none'), ', ') from jsonb_each(changes) e(k, v)),
            shown);
    perform admin_log('work.updated', 'work_item', p_id::text, null, changes);
  end if;
  return admin_work_json((select x from work_items x where x.id = p_id));
end $$;

-- ===== 4. Help tickets: search, reopen, close without an answer =====

-- p_status: 'open', 'waiting', 'closed' or 'all'. p_q matches the subject or the customer's name.
-- Tickets waiting for staff show the longest-waiting first; closed tickets and "all" show the latest first.
drop function admin_tickets_list(text, int, int);
create function admin_tickets_list(p_status text default 'open', p_limit int default 25, p_offset int default 0,
  p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  q text := nullif(trim(coalesce(p_q, '')), '');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['support']);
  with hits as (
    select t.id,
           case when wanted in ('closed', 'all') then -extract(epoch from t.updated_at) else extract(epoch from t.updated_at) end as place
    from support_tickets t left join profiles p on p.id = t.profile_id
    where (wanted = 'all' or t.status = wanted)
      and (q is null or t.subject ilike admin_like(q) or p.display_name ilike admin_like(q))
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(ticket_json(x, false) || jsonb_build_object(
        'profile_id', x.profile_id, 'name', (select p.display_name from profiles p where p.id = x.profile_id),
        'work_id', (select w.id from work_items w where w.kind = 'ticket' and w.ref_id = x.id),
        'assignee_name', (select p.display_name from work_items w join profiles p on p.id = w.assignee_id where w.kind = 'ticket' and w.ref_id = x.id))
      order by y.place, y.id), '[]'::jsonb)
     from (select h.id, h.place from hits h order by h.place, h.id limit admin_limit(p_limit) offset admin_offset(p_offset)) y
     join support_tickets x on x.id = y.id)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- A ticket closed by mistake, or one the customer raised again by phone: it waits for staff again.
create function admin_ticket_reopen(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t support_tickets;
begin
  perform admin_require(array['support']);
  select * into t from support_tickets where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if t.status <> 'closed' then raise exception 'admin_already_decided' using errcode = 'PT409'; end if;
  update support_tickets set status = 'open', closed_at = null, updated_at = now() where id = t.id;
  perform work_open('ticket', t.id, t.subject);
  perform admin_log('ticket.reopened', 'ticket', t.id::text);
  return jsonb_build_object('ok', true);
end $$;

-- Closes a ticket with nothing more to say (a duplicate, a thank-you, a test). No message goes to the person;
-- a reply from them opens it again, as with any closed ticket.
create function admin_ticket_close(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t support_tickets;
begin
  perform admin_require(array['support']);
  select * into t from support_tickets where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if t.status = 'closed' then raise exception 'admin_already_decided' using errcode = 'PT409'; end if;
  update support_tickets set status = 'closed', closed_at = now(), updated_at = now() where id = t.id;
  perform work_close('ticket', t.id);
  perform admin_log('ticket.closed', 'ticket', t.id::text, null, jsonb_build_object('answered', false));
  return jsonb_build_object('ok', true);
end $$;

-- ===== 5. Who the AYWO Admins are =====

-- Names only, for "Ask an AYWO Admin". Any staff member may call it; no phone numbers, no ids.
create function admin_admin_names() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require_staff();
  return coalesce((
    select jsonb_agg(p.display_name order by p.display_name)
    from app_admins a join profiles p on p.id = a.profile_id join auth.users u on u.id = a.profile_id
    where a.role = 'aywo_admin' and u.banned_at is null and p.deleted_at is null
      and nullif(trim(p.display_name), '') is not null), '[]'::jsonb);
end $$;

revoke all on function admin_users_list(text, int, int, text, text), admin_user_take_plus(uuid, int, text),
  admin_tickets_list(text, int, int, text), admin_ticket_reopen(uuid), admin_ticket_close(uuid), admin_admin_names()
  from public, anon, authenticated;
grant execute on function admin_users_list(text, int, int, text, text), admin_user_take_plus(uuid, int, text),
  admin_tickets_list(text, int, int, text), admin_ticket_reopen(uuid), admin_ticket_close(uuid), admin_admin_names()
  to authenticated;
