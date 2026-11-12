-- 0019: consent the way India's DPDP Rules ask for it (Rule 3, in force about May 2027): a plain, itemised notice
-- before health details are kept, an unticked "I agree", withdrawal as easy as agreeing, and a record of each.
--
-- consent_events: every agreement and withdrawal, never changed afterwards (the proof). One row per action.
-- Health card: emergency_card_save needs the person's agreement to the current notice; SOS helpers see the card only
--   while that agreement stands; withdrawing deletes the card. Cards saved before this release stay hidden from SOS
--   until their owner agrees.
-- my_consents(): what the "My consents" page shows: terms, privacy, health card, marketing, with dates and history.

create table consent_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'parental', 'health_card', 'marketing')),
  version text not null check (char_length(version) between 1 and 40),
  action text not null check (action in ('granted', 'withdrawn')),
  created_at timestamptz not null default now()
);
create index consent_events_person on consent_events (profile_id, kind, created_at desc);
alter table consent_events enable row level security;
create policy consent_events_own on consent_events for select using (profile_id = auth.uid());
grant select on consent_events to authenticated;

-- The health card notice the app shows. Change it when the notice changes in a way that matters.
create function health_notice_version() returns text language sql immutable as $$ select '2026-11' $$;

-- The latest action for one kind of consent: the version agreed to, or null when never given or withdrawn.
create function consent_current(p_profile uuid, p_kind text) returns text
language sql stable security definer set search_path = public as $$
  select case when e.action = 'granted' then e.version end
  from consent_events e where e.profile_id = p_profile and e.kind = p_kind
  order by e.created_at desc, e.id desc limit 1
$$;

create function consent_record(p_profile uuid, p_kind text, p_version text, p_action text) returns void
language sql security definer set search_path = public as $$
  insert into consent_events (profile_id, kind, version, action) values (p_profile, p_kind, p_version, p_action)
$$;

-- Terms and privacy agreed at sign-up also go in the history (the API calls this beside the old consents row).
create function consent_accept(p_kind text, p_version text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if p_kind not in ('terms', 'privacy', 'parental') then raise exception 'bad_input' using errcode = 'PT422'; end if;
  insert into consents (profile_id, kind, version) values (me, p_kind, p_version) on conflict do nothing;
  if consent_current(me, p_kind) is distinct from p_version then perform consent_record(me, p_kind, p_version, 'granted'); end if;
end $$;

-- Saving the card needs agreement to the current notice: either already given, or given now with this save.
drop function emergency_card_save(jsonb);
create function emergency_card_save(p_card jsonb, p_agree_version text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e emergency_cards;
  clean jsonb := coalesce(p_card, '{}');
begin
  if exists (select 1 from jsonb_object_keys(clean) k where k not in ('blood_group', 'allergies', 'conditions', 'medications', 'note')) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_agree_version is not null and p_agree_version <> health_notice_version() then
    -- The app showed an older notice: it must show the current one first.
    raise exception 'consent_outdated' using errcode = 'PT409';
  end if;
  if p_agree_version is null and consent_current(me, 'health_card') is null then
    raise exception 'consent_needed' using errcode = 'PT403';
  end if;
  if p_agree_version is not null and consent_current(me, 'health_card') is distinct from p_agree_version then
    perform consent_record(me, 'health_card', p_agree_version, 'granted');
  end if;
  insert into emergency_cards (profile_id, blood_group, allergies, conditions, medications, note, updated_at)
  values (me, nullif(clean ->> 'blood_group', ''), nullif(trim(clean ->> 'allergies'), ''), nullif(trim(clean ->> 'conditions'), ''),
          nullif(trim(clean ->> 'medications'), ''), nullif(trim(clean ->> 'note'), ''), now())
  on conflict (profile_id) do update set blood_group = excluded.blood_group, allergies = excluded.allergies,
    conditions = excluded.conditions, medications = excluded.medications, note = excluded.note, updated_at = now()
  returning * into e;
  return emergency_card_json(e);
end $$;

-- Deleting the card is withdrawing the agreement, and the other way round: one tap does both.
create or replace function emergency_card_delete() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  agreed text := consent_current(me, 'health_card');
begin
  delete from emergency_cards where profile_id = me;
  if agreed is not null then perform consent_record(me, 'health_card', agreed, 'withdrawn'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- SOS helpers see the card only while its owner's agreement stands.
create or replace function sos_emergency_card(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e sos_events;
begin
  perform social_me();
  if not social_can_see_sos(p_event) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into e from sos_events where id = p_event;
  if e.ended_at is not null and e.ended_at < now() - interval '1 day' then return null; end if;
  if consent_current(e.profile_id, 'health_card') is null then return null; end if;
  return (select emergency_card_json(c) from emergency_cards c where c.profile_id = e.profile_id);
end $$;

-- Marketing choices go in the history too.
create or replace function marketing_set(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  was boolean;
begin
  select marketing_opt_in into was from profiles where id = me;
  update profiles set marketing_opt_in = coalesce(p_on, false), marketing_opt_in_at = now() where id = me;
  if coalesce(p_on, false) is distinct from coalesce(was, false) then
    perform consent_record(me, 'marketing', '1', case when coalesce(p_on, false) then 'granted' else 'withdrawn' end);
  end if;
  return jsonb_build_object('marketing_opt_in', coalesce(p_on, false));
end $$;

-- Everything the "My consents" page shows, and what goes in the data download.
create function my_consents() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return jsonb_build_object(
    'health_notice_version', health_notice_version(),
    'items', (select jsonb_agg(x order by x ->> 'order') from (
      select jsonb_build_object('order', 1, 'kind', k.kind,
        'agreed_version', coalesce(consent_current(me, k.kind), (select max(c.version) from consents c where c.profile_id = me and c.kind = k.kind)),
        'agreed_at', coalesce(
          (select max(e.created_at) from consent_events e where e.profile_id = me and e.kind = k.kind and e.action = 'granted'),
          (select max(c.granted_at) from consents c where c.profile_id = me and c.kind = k.kind))) as x
      from (values ('terms'), ('privacy')) k(kind)
      union all
      select jsonb_build_object('order', 2, 'kind', 'health_card',
        'agreed_version', consent_current(me, 'health_card'),
        'agreed_at', (select max(e.created_at) from consent_events e where e.profile_id = me and e.kind = 'health_card' and e.action = 'granted'),
        'has_card', exists (select 1 from emergency_cards c where c.profile_id = me),
        'current', consent_current(me, 'health_card') = health_notice_version())
      union all
      select jsonb_build_object('order', 3, 'kind', 'marketing',
        'agreed_version', case when p.marketing_opt_in then '1' end,
        'agreed_at', case when p.marketing_opt_in then p.marketing_opt_in_at end)
      from profiles p where p.id = me) q),
    'history', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'version', e.version, 'action', e.action, 'at', e.created_at)
        order by e.created_at desc, e.id desc)
      from (select * from consent_events where profile_id = me order by created_at desc, id desc limit 50) e), '[]'::jsonb));
end $$;

revoke all on function consent_current(uuid, text), consent_record(uuid, text, text, text) from public, anon, authenticated;
revoke all on function consent_accept(text, text), emergency_card_save(jsonb, text), my_consents(), health_notice_version() from public, anon;
grant execute on function consent_accept(text, text), emergency_card_save(jsonb, text), my_consents(), health_notice_version() to authenticated;
