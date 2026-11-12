-- 0017: where people stop on the way in. The app sends a tiny note the first time each step happens on a device:
-- opened the app, asked for a code, verified it, saved a name, started a tree, added a first relative, reached five
-- people, invited someone. Only a random id made on the device, the platform and the language: no name, number or
-- account, so it cannot be tied to a person. Kept for 400 days.

create table app_events (
  device_id uuid not null,
  event text not null check (event in (
    'app_opened', 'code_requested', 'code_verified', 'name_saved', 'tree_started', 'first_relative', 'five_people', 'invite_sent')),
  platform text not null check (platform in ('web', 'ios', 'android')),
  lang text not null check (lang ~ '^[a-z]{2,3}$'),
  created_at timestamptz not null default now(),
  -- Each step counts once per device: sending it again changes nothing.
  primary key (device_id, event)
);
create index app_events_time on app_events (created_at);
alter table app_events enable row level security;

-- The steps in order, for the funnel and its labels.
create function funnel_steps() returns text[] language sql immutable as $$
  select array['app_opened', 'code_requested', 'code_verified', 'name_saved', 'tree_started', 'first_relative', 'five_people', 'invite_sent']
$$;

-- Only the API calls this (the route has its own rate limit).
create function track_event(p_device uuid, p_event text, p_platform text, p_lang text) returns void
language sql security definer set search_path = public as $$
  insert into app_events (device_id, event, platform, lang)
  values (p_device, p_event, p_platform, lower(left(split_part(coalesce(p_lang, 'en'), '-', 1), 3)))
  on conflict do nothing
$$;

-- Staff with Analytics: for devices that first opened the app in the last p_days days, how many reached each step.
-- Split by platform and by language, so a drop only on iPhone or only in Tamil stands out.
create function admin_funnel(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  span int := least(greatest(coalesce(p_days, 30), 1), 400);
begin
  perform admin_require(array['analytics']);
  return (
    with cohort as (
      select device_id, platform, lang from app_events
      where event = 'app_opened' and created_at > now() - make_interval(days => span)
    ), reached as (
      select c.platform, c.lang, e.event, e.device_id
      from cohort c join app_events e on e.device_id = c.device_id
    ), steps as (
      select s.step, s.n from unnest(funnel_steps()) with ordinality as s(step, n)
    )
    select jsonb_build_object(
      'days', span,
      'steps', (select jsonb_agg(jsonb_build_object('step', st.step,
                  'devices', (select count(distinct r.device_id) from reached r where r.event = st.step)) order by st.n) from steps st),
      'by_platform', (select coalesce(jsonb_object_agg(p.platform, p.counts), '{}'::jsonb) from (
          select c.platform, (select jsonb_agg((select count(distinct r.device_id) from reached r where r.event = st.step and r.platform = c.platform) order by st.n) from steps st) as counts
          from (select distinct platform from cohort) c) p),
      'by_lang', (select coalesce(jsonb_object_agg(l.lang, l.counts), '{}'::jsonb) from (
          select c.lang, (select jsonb_agg((select count(distinct r.device_id) from reached r where r.event = st.step and r.lang = c.lang) order by st.n) from steps st) as counts
          from (select distinct lang from cohort) c) l)
    ));
end $$;

-- Old notes go after 400 days.
create function app_events_cleanup() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from app_events where created_at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function track_event(uuid, text, text, text), admin_funnel(int), app_events_cleanup(), funnel_steps() from public, anon, authenticated;
grant execute on function admin_funnel(int) to authenticated;
