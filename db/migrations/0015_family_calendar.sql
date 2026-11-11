-- 0015: the family calendar. One list for any range of up to 62 days: birthdays and wedding anniversaries (as on
-- Home), remembrance days for relatives who have passed, and the invitations the person is part of.
-- Plus a way to set a wedding date in the app, and a morning reminder on remembrance days, the same way as birthdays.

-- The same day and month in another year. 29 Feb becomes 28 Feb in a year without it.
create function date_in_year(p_date date, p_year int) returns date
language sql immutable as $$
  select make_date(p_year, extract(month from p_date)::int,
    least(extract(day from p_date)::int,
          extract(day from (make_date(p_year, extract(month from p_date)::int, 1) + interval '1 month - 1 day'))::int))
$$;

create function family_calendar(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'calendar_range' using errcode = 'PT422';
  end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'date', x ->> 'kind', x ->> 'name') from (
      -- Birthdays of living people. One entry per real person even if they are in two trees.
      select distinct on (coalesce(p.claimed_by::text, p.id::text), o.day) jsonb_build_object(
        'kind', 'birthday', 'person_id', p.id, 'tree_id', p.tree_id, 'name', p.display_name, 'date', o.day,
        'years', case when p.birth_precision = 'exact' then extract(year from o.day)::int - extract(year from p.birth_date)::int end,
        'me', p.claimed_by is not distinct from me) as x
      from persons p
      cross join lateral (select date_in_year(p.birth_date, y) as day
                          from generate_series(extract(year from p_from)::int, extract(year from p_to)::int) y) o
      where p.tree_id in (select social_my_tree_ids()) and tree_role(p.tree_id) <> 'none'
        and p.deleted_at is null and p.living = 'living' and p.birth_date is not null
        and coalesce(p.birth_precision, 'exact') in ('exact', 'month')
        and o.day between p_from and p_to and o.day >= p.birth_date
      union all
      -- Wedding anniversaries of living couples.
      select jsonb_build_object(
        'kind', 'anniversary', 'person_id', u.partner1_id, 'tree_id', u.tree_id,
        'name', a.display_name || ' & ' || b.display_name, 'date', o.day,
        'years', extract(year from o.day)::int - extract(year from u.start_date)::int, 'me', false)
      from unions u join persons a on a.id = u.partner1_id join persons b on b.id = u.partner2_id
      cross join lateral (select date_in_year(u.start_date, y) as day
                          from generate_series(extract(year from p_from)::int, extract(year from p_to)::int) y) o
      where u.tree_id in (select social_my_tree_ids()) and tree_role(u.tree_id) <> 'none'
        and u.kind = 'marriage' and u.status = 'current' and u.start_date is not null
        and a.deleted_at is null and b.deleted_at is null and a.living = 'living' and b.living = 'living'
        and o.day between p_from and p_to and o.day > u.start_date
      union all
      -- Remembrance days: only with the exact day known, so the family is never told a wrong date.
      select distinct on (coalesce(p.claimed_by::text, p.id::text), o.day) jsonb_build_object(
        'kind', 'remembrance', 'person_id', p.id, 'tree_id', p.tree_id, 'name', p.display_name, 'date', o.day,
        'years', extract(year from o.day)::int - extract(year from p.death_date)::int, 'me', false)
      from persons p
      cross join lateral (select date_in_year(p.death_date, y) as day
                          from generate_series(extract(year from p_from)::int, extract(year from p_to)::int) y) o
      where p.tree_id in (select social_my_tree_ids()) and tree_role(p.tree_id) <> 'none'
        and p.deleted_at is null and p.living = 'deceased' and p.death_date is not null
        and coalesce(p.death_precision, 'exact') = 'exact'
        and o.day between p_from and p_to and o.day > p.death_date
      union all
      -- Invitations the person sent or received, on the day they happen in India.
      select jsonb_build_object(
        'kind', 'event', 'event_id', e.id, 'event_kind', e.kind, 'name', e.title,
        'date', (e.starts_at at time zone 'Asia/Kolkata')::date, 'starts_at', e.starts_at, 'place', e.place,
        'me', e.host_id = me)
      from events e
      where e.cancelled_at is null and e.starts_at is not null
        and (e.host_id = me or exists (select 1 from event_invitees i where i.event_id = e.id and i.profile_id = me))
        and (e.starts_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    ) q), '[]'::jsonb);
end $$;

-- ===== Wedding date: until now only a family file could set it, so anniversaries rarely showed =====

-- For those who may edit both partners. A full date only, or null to clear it. Recorded in History like any edit.
create function union_set_date(p_union uuid, p_version int, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u unions;
  new_version int;
begin
  select * into u from unions where id = p_union;
  if u.id is null or tree_role(u.tree_id, u.partner1_id) = 'none' then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if not can_edit(u.tree_id, u.partner1_id) or (u.partner2_id is not null and not can_edit(u.tree_id, u.partner2_id)) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if u.kind <> 'marriage' then
    raise exception 'not_a_marriage' using errcode = 'PT422';
  end if;
  if p_date is not null and (p_date > current_date or p_date < date '1800-01-01') then
    raise exception 'bad_date' using errcode = 'PT422';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  update unions set start_date = p_date, version = coalesce(p_version, u.version) where id = p_union
  returning version into new_version;
  return jsonb_build_object('status', 'saved', 'id', p_union, 'version', new_version);
end $$;

-- ===== Remembrance reminders: a quiet push at 8 in the morning, India time, once a day per tree =====

create table remembrance_reminders_sent (
  profile_id uuid not null references profiles (id) on delete cascade,
  tree_id uuid not null references trees (id) on delete cascade,
  day date not null,
  primary key (profile_id, tree_id, day)
);
alter table remembrance_reminders_sent enable row level security;

create function remembrance_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n int;
begin
  if extract(hour from now() at time zone 'Asia/Kolkata') < 8 then return 0; end if;
  with remembered as (
    select p.tree_id, p.display_name from persons p
    where p.deleted_at is null and p.living = 'deceased' and p.death_date is not null
      and coalesce(p.death_precision, 'exact') = 'exact' and p.death_date < today
      and date_in_year(p.death_date, extract(year from today)::int) = today
  ), members as (
    select t.id as tree_id, t.creator_id as profile_id from trees t where t.deleted_at is null
    union
    select s.tree_id, s.grantee_profile_id from shares s where s.grantee_profile_id is not null and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  ), digest as (
    select m.profile_id, r.tree_id, string_agg(r.display_name, ', ' order by r.display_name) as names, count(*) as n
    from remembered r join members m on m.tree_id = r.tree_id
    join profiles pr on pr.id = m.profile_id and pr.deleted_at is null
    where not exists (select 1 from remembrance_reminders_sent s where s.profile_id = m.profile_id and s.tree_id = r.tree_id and s.day = today)
    group by m.profile_id, r.tree_id
  ), marked as (
    insert into remembrance_reminders_sent (profile_id, tree_id, day) select d.profile_id, d.tree_id, today from digest d
    on conflict do nothing returning profile_id, tree_id
  )
  insert into notifications (recipient_id, kind, payload)
  select d.profile_id, 'remembrance_today', jsonb_build_object('tree_id', d.tree_id, 'body',
    case when d.n > 3 then split_part(d.names, ', ', 1) || ', ' || split_part(d.names, ', ', 2) || ', ' || split_part(d.names, ', ', 3)
                            || ' +' || (d.n - 3) else d.names end)
  from digest d join marked k on k.profile_id = d.profile_id and k.tree_id = d.tree_id;
  get diagnostics n = row_count;
  delete from remembrance_reminders_sent where day < today - 7;
  return n;
end $$;

revoke all on function date_in_year(date, int), family_calendar(date, date), remembrance_reminders(), union_set_date(uuid, int, date) from public, anon, authenticated;
grant execute on function family_calendar(date, date), union_set_date(uuid, int, date) to authenticated;
