-- AYWO social area (LLD L3.1, PRD A6.10 and A6.11): chat, memories, friends groups, invites, Pop Party, alerts, SOS.
-- Clients read through row rules and write only through the functions below. Every function checks the caller itself.

create type chat_kind_t       as enum ('group', 'direct');
create type group_kind_t      as enum ('friends');
create type message_media_t   as enum ('photo', 'voice');
create type reaction_target_t as enum ('post', 'comment');
create type event_kind_t      as enum ('housewarming', 'engagement', 'wedding', 'birthday', 'sixtieth', 'eightieth',
                                       'get_together', 'death_anniversary', 'pop_party');
create type rsvp_answer_t     as enum ('yes', 'no', 'maybe');
create type poll_topic_t      as enum ('date', 'venue', 'menu');
create type alert_kind_t      as enum ('death', 'hospital', 'blood', 'help', 'news');

-- ===== P2 friends groups =====
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind group_kind_t not null default 'friends',
  invite_token text not null unique,
  created_by uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table group_members (
  group_id uuid not null references groups (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, profile_id)
);
create index group_members_profile_idx on group_members (profile_id);

-- ===== P2 chat =====
create table chats (
  id uuid primary key default gen_random_uuid(),
  kind chat_kind_t not null,
  tree_id uuid references trees (id) on delete set null,
  group_id uuid references groups (id) on delete set null,
  name text check (char_length(name) <= 80),
  -- 'smaller-id:larger-id', so two people have one 1-to-1 chat only.
  direct_key text unique,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind = 'direct' or name is not null)
);

create table chat_members (
  chat_id uuid not null references chats (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_at timestamptz,
  primary key (chat_id, profile_id)
);
create index chat_members_profile_idx on chat_members (profile_id) where left_at is null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats (id) on delete cascade,
  sender_id uuid references profiles (id) on delete set null,
  body text check (char_length(body) <= 4000),
  media_path text,
  media_kind message_media_t,
  media_ms int check (media_ms is null or media_ms between 0 and 3600000),
  reply_to uuid references messages (id) on delete set null,
  -- Set by the phone, so sending again after a dropped connection does not post twice.
  client_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (deleted_at is not null or body is not null or media_path is not null),
  check ((media_path is null) = (media_kind is null))
);
create index messages_chat_idx on messages (chat_id, created_at desc);
create unique index messages_client_idx on messages (chat_id, sender_id, client_id) where client_id is not null;

-- ===== P2 memories =====
create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles (id) on delete cascade,
  tree_id uuid references trees (id) on delete cascade,
  group_id uuid references groups (id) on delete cascade,
  body text check (char_length(body) <= 4000),
  happened_on date not null default current_date,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((tree_id is null) <> (group_id is null))
);
create index posts_tree_idx on posts (tree_id, created_at desc) where deleted_at is null;
create index posts_group_idx on posts (group_id, created_at desc) where deleted_at is null;

create table post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  path text not null,
  position smallint not null default 0,
  added_by uuid references profiles (id) on delete set null
);
create index post_media_post_idx on post_media (post_id, position);

-- A person in a tree, or a friend in a group, who has no person card.
create table post_tags (
  post_id uuid not null references posts (id) on delete cascade,
  person_id uuid references persons (id) on delete cascade,
  profile_id uuid references profiles (id) on delete cascade,
  check ((person_id is null) <> (profile_id is null))
);
create unique index post_tags_unique on post_tags (post_id, coalesce(person_id, profile_id));
create index post_tags_person_idx on post_tags (person_id);
create index post_tags_profile_idx on post_tags (profile_id);

create table post_collaborators (
  post_id uuid not null references posts (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create table post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  author_id uuid not null references profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index post_comments_post_idx on post_comments (post_id, created_at);

create table reactions (
  target_type reaction_target_t not null,
  target_id uuid not null,
  profile_id uuid not null references profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, profile_id)
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts (id) on delete cascade,
  run_on date not null,
  sent_at timestamptz,
  unique (post_id, run_on)
);
create index reminders_due_idx on reminders (run_on) where sent_at is null;

-- ===== P3 invites and Pop Party =====
create table events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles (id) on delete cascade,
  kind event_kind_t not null,
  title text not null check (char_length(title) between 1 and 120),
  starts_at timestamptz,
  place text check (char_length(place) <= 200),
  menu text check (char_length(menu) <= 200),
  note text check (char_length(note) <= 1000),
  canva_url text check (canva_url ~ '^https://(www\.)?canva\.(com|link)/'),
  design text not null default 'classic' check (design in ('classic', 'marigold', 'gold', 'midnight')),
  decided_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind = 'pop_party' or starts_at is not null)
);
create index events_host_idx on events (host_id, created_at desc);

create table event_invitees (
  event_id uuid not null references events (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);
create index event_invitees_profile_idx on event_invitees (profile_id);

create table rsvps (
  event_id uuid not null references events (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  answer rsvp_answer_t not null,
  guests smallint not null default 0 check (guests between 0 and 50),
  updated_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);

create table polls (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  topic poll_topic_t not null,
  closed_at timestamptz,
  unique (event_id, topic)
);

create table poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  position smallint not null default 0
);
create index poll_options_poll_idx on poll_options (poll_id, position);

create table poll_votes (
  poll_id uuid not null references polls (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  option_id uuid not null references poll_options (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (poll_id, profile_id)
);

-- ===== P4 alerts =====
create table alerts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles (id) on delete cascade,
  kind alert_kind_t not null,
  body text not null check (char_length(body) between 1 and 500),
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  audience_type text not null check (audience_type in ('tree', 'branch', 'people', 'group')),
  created_at timestamptz not null default now(),
  check ((kind = 'blood') = (blood_group is not null))
);
create index alerts_sender_idx on alerts (sender_id, created_at desc);

create table alert_recipients (
  alert_id uuid not null references alerts (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  seen_at timestamptz,
  primary key (alert_id, profile_id)
);
create index alert_recipients_profile_idx on alert_recipients (profile_id);

-- ===== P5 SOS =====
create table sos_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  contact_profile_id uuid references profiles (id) on delete cascade,
  -- Only a number the person typed in themselves. A family member's number stays on their own profile.
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name text not null default '' check (char_length(name) <= 80),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  check ((contact_profile_id is null) <> (phone is null)),
  unique (profile_id, contact_profile_id),
  unique (profile_id, phone)
);
create index sos_contacts_owner_idx on sos_contacts (profile_id, position);

create table sos_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  last_lat double precision check (last_lat between -90 and 90),
  last_lng double precision check (last_lng between -180 and 180),
  last_at timestamptz,
  -- SHA-256 of the live page's link token. The token itself is sent out once and never stored.
  token_hash text not null unique,
  -- SHA-256 of the key the phone's background task sends locations with. The sign-in token cannot be read on a locked iPhone.
  write_hash text not null unique
);
create index sos_events_owner_idx on sos_events (profile_id, started_at desc);
create unique index sos_events_one_active on sos_events (profile_id) where ended_at is null;
create index sos_events_end_idx on sos_events (ends_at) where ended_at is null;

-- Who was chosen when this SOS began, so later changes to the list change nothing about this event.
create table sos_event_contacts (
  event_id uuid not null references sos_events (id) on delete cascade,
  position smallint not null,
  contact_profile_id uuid references profiles (id) on delete cascade,
  name text not null default '',
  phone text,   -- never granted to clients; used by the server for the SMS only
  primary key (event_id, position)
);
create index sos_event_contacts_profile_idx on sos_event_contacts (contact_profile_id);

create table sos_locations (
  id bigint generated always as identity primary key,
  event_id uuid not null references sos_events (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real,
  at timestamptz not null default now()
);
create index sos_locations_event_idx on sos_locations (event_id, at desc);

-- ===== Helpers =====

create function social_me() returns uuid
language plpgsql stable as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'PT401'; end if;
  return me;
end $$;

-- 244 random bits from the database's secure generator. pgcrypto is not needed.
create function social_random_token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- Same result as sha256 hex in Node (hashToken in auth-tokens.ts).
create function social_hash_token(p_token text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

-- A name for a profile. Never a number or an email.
create function social_name(p_profile uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(trim(pr.display_name), ''),
    (select c.display_name from persons c where c.claimed_by = pr.id and c.deleted_at is null limit 1),
    '')
  from profiles pr where pr.id = p_profile
$$;

create function social_uuids(p jsonb) returns uuid[]
language plpgsql immutable as $$
declare result uuid[];
begin
  if p is null then return '{}'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'bad_input' using errcode = 'PT422'; end if;
  select coalesce(array_agg(distinct value::uuid), '{}') into result from jsonb_array_elements_text(p);
  return result;
end $$;

create function social_texts(p jsonb) returns text[]
language plpgsql immutable as $$
declare result text[];
begin
  if p is null then return '{}'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'bad_input' using errcode = 'PT422'; end if;
  select coalesce(array_agg(trim(value)), '{}') into result
  from jsonb_array_elements_text(p) where trim(value) <> '';
  return result;
end $$;

-- Everyone uploads only into their own folder (routes/uploads.ts), so a stored path must be in the caller's folder.
create function social_check_path(p_path text, p_folder text) returns void
language plpgsql stable as $$
begin
  if p_path not like p_folder || '/' || auth.uid()::text || '/%' or position('..' in p_path) > 0 then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
end $$;

-- Notifications carry names and ids only, never contact values. The delivery job sends them.
create function social_notify(p_recipients uuid[], p_kind text, p_payload jsonb) returns void
language sql security definer set search_path = public as $$
  insert into notifications (recipient_id, kind, payload)
  select distinct r, p_kind, p_payload from unnest(p_recipients) r
  where r is not null and r is distinct from auth.uid()
$$;

-- Every account connected to a tree: its Creator, people who claimed a card, and people it is shared with.
create function social_tree_profiles(p_tree uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.creator_id from trees t where t.id = p_tree and t.deleted_at is null
  union
  select p.claimed_by from persons p join trees t on t.id = p.tree_id
  where p.tree_id = p_tree and p.claimed_by is not null and p.deleted_at is null and t.deleted_at is null
  union
  select s.grantee_profile_id from shares s join trees t on t.id = s.tree_id
  where s.tree_id = p_tree and s.grantee_profile_id is not null and t.deleted_at is null
    and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
$$;

-- The accounts in one branch: claimed cards inside it, and shares meant for someone inside it.
create function social_branch_profiles(p_tree uuid, p_person uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.claimed_by from persons p
  where p.tree_id = p_tree and p.claimed_by is not null and p.deleted_at is null and in_branch(p_person, p.id)
  union
  select s.grantee_profile_id from shares s
  where s.tree_id = p_tree and s.grantee_profile_id is not null and s.grantee_person_id is not null
    and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
    and in_branch(p_person, s.grantee_person_id)
$$;

-- Tree members the caller may know about. A branch-only share sees accounts inside that branch only.
create function social_visible_tree_members(p_tree uuid) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if tree_role(p_tree) <> 'none' then
    return query select x from social_tree_profiles(p_tree) x;
  elsif can_view_tree(p_tree) then
    return query
      select p.claimed_by from persons p
      where p.tree_id = p_tree and p.claimed_by is not null and p.deleted_at is null
        and tree_role(p_tree, p.id) <> 'none';
  end if;
end $$;

create function social_my_tree_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.id from trees t where t.creator_id = auth.uid() and t.deleted_at is null
  union
  select p.tree_id from persons p join trees t on t.id = p.tree_id
  where p.claimed_by = auth.uid() and p.deleted_at is null and t.deleted_at is null
  union
  select s.tree_id from shares s join trees t on t.id = s.tree_id
  where s.grantee_profile_id = auth.uid() and t.deleted_at is null
    and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
$$;

create function social_in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members m join groups g on g.id = m.group_id
    where m.group_id = p_group and m.profile_id = auth.uid() and g.deleted_at is null
  )
$$;

-- Everyone the caller shares a tree or a friends group with: family and friends, nobody else.
create function social_circle() returns setof uuid
language sql stable security definer set search_path = public as $$
  select v from social_my_tree_ids() t, lateral social_visible_tree_members(t) v
  union
  select m.profile_id from group_members m
  join group_members mine on mine.group_id = m.group_id and mine.profile_id = auth.uid()
  join groups g on g.id = m.group_id and g.deleted_at is null
$$;

-- Turns the sender's choice into accounts: whole tree, a branch, chosen people or a group. Never everyone.
-- Refuses anything outside the sender's own trees and groups.
create function social_audience(p_audience jsonb) returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  kind text := p_audience ->> 'type';
  tree uuid;
  grp uuid;
  person uuid;
  wanted uuid[];
begin
  if kind = 'tree' then
    tree := (p_audience ->> 'tree_id')::uuid;
    if tree is null or tree_role(tree) = 'none' then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    return query select x from social_tree_profiles(tree) x where x <> me;
  elsif kind = 'branch' then
    tree := (p_audience ->> 'tree_id')::uuid;
    person := (p_audience ->> 'person_id')::uuid;
    if tree is null or person is null
       or not exists (select 1 from persons p where p.id = person and p.tree_id = tree and p.deleted_at is null)
       or tree_role(tree, person) = 'none' then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    return query select x from social_branch_profiles(tree, person) x where x <> me;
  elsif kind = 'group' then
    grp := (p_audience ->> 'group_id')::uuid;
    if grp is null or not social_in_group(grp) then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    return query select m.profile_id from group_members m where m.group_id = grp and m.profile_id <> me;
  elsif kind = 'people' then
    wanted := array_remove(social_uuids(p_audience -> 'profile_ids'), me);
    if cardinality(wanted) > 500 then raise exception 'too_many_people' using errcode = 'PT422'; end if;
    if exists (select 1 from unnest(wanted) w where w not in (select social_circle())) then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    return query select w from unnest(wanted) w;
  else
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
end $$;

create function social_in_chat(p_chat uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_members m where m.chat_id = p_chat and m.profile_id = auth.uid() and m.left_at is null)
$$;

create function social_can_view_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from posts p
    where p.id = p_post and p.deleted_at is null and (
      p.author_id = auth.uid()
      or (p.tree_id is not null and tree_role(p.tree_id) <> 'none')
      or (p.group_id is not null and social_in_group(p.group_id))
    )
  )
$$;

create function social_can_view_reaction(p_type reaction_target_t, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_type
    when 'post' then social_can_view_post(p_target)
    else exists (select 1 from post_comments c where c.id = p_target and social_can_view_post(c.post_id))
  end
$$;

create function social_can_see_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from events e where e.id = p_event and e.host_id = auth.uid())
      or exists (select 1 from event_invitees i where i.event_id = p_event and i.profile_id = auth.uid())
$$;

create function social_can_see_poll(p_poll uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from polls p where p.id = p_poll and social_can_see_event(p.event_id))
$$;

create function social_can_see_alert(p_alert uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from alerts a where a.id = p_alert and a.sender_id = auth.uid())
      or exists (select 1 from alert_recipients r where r.alert_id = p_alert and r.profile_id = auth.uid())
$$;

-- SOS locations: the person in trouble and the contacts chosen for this event, nobody else.
create function social_can_see_sos(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from sos_events e where e.id = p_event and e.profile_id = auth.uid())
      or exists (select 1 from sos_event_contacts c where c.event_id = p_event and c.contact_profile_id = auth.uid())
$$;

-- ===== People pickers =====

-- Names only. p_tree or p_group narrows the list; without either it is the caller's whole circle.
create function social_people(p_tree uuid default null, p_group uuid default null, p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  needle text := nullif(aywo_normalize(coalesce(p_q, '')), '');
  ids uuid[];
begin
  if p_tree is not null then
    select coalesce(array_agg(x), '{}') into ids from social_visible_tree_members(p_tree) x;
  elsif p_group is not null then
    if not social_in_group(p_group) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
    select coalesce(array_agg(m.profile_id), '{}') into ids from group_members m where m.group_id = p_group;
  else
    select coalesce(array_agg(x), '{}') into ids from social_circle() x;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', q.id, 'name', q.name) order by q.name)
    from (
      select i as id, social_name(i) as name from unnest(ids) i
      where i is not null and i <> me
    ) q
    where needle is null or aywo_normalize(q.name) like '%' || needle || '%'
  ), '[]'::jsonb);
end $$;

-- The trees and groups a sender can address. whole_tree says whether 'whole tree' is open to them.
create function social_circles() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return jsonb_build_object(
    'trees', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'whole_tree', tree_role(t.id) <> 'none') order by t.name)
      from trees t where t.id in (select social_my_tree_ids())), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
      from groups g join group_members m on m.group_id = g.id and m.profile_id = me
      where g.deleted_at is null), '[]'::jsonb)
  );
end $$;

-- ===== Friends groups =====

create function group_create(p_name text, p_members jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  new_id uuid;
  wanted uuid[] := array_remove(social_uuids(p_members), me);
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = 'PT422'; end if;
  if exists (select 1 from unnest(wanted) w where w not in (select social_circle())) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  insert into groups (name, invite_token, created_by) values (trim(p_name), social_random_token(), me) returning id into new_id;
  insert into group_members (group_id, profile_id) select new_id, x from unnest(array_append(wanted, me)) x;
  perform social_notify(wanted, 'group_added', jsonb_build_object('group_id', new_id, 'group_name', trim(p_name), 'by', me, 'from_name', social_name(me)));
  return jsonb_build_object('id', new_id);
end $$;

create function group_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name,
      'members', (select count(*) from group_members x where x.group_id = g.id)) order by g.name)
    from groups g join group_members m on m.group_id = g.id and m.profile_id = me
    where g.deleted_at is null), '[]'::jsonb);
end $$;

create function group_detail(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  g groups;
begin
  select * into g from groups where id = p_group and deleted_at is null;
  if g.id is null or not social_in_group(p_group) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  return jsonb_build_object(
    'id', g.id, 'name', g.name, 'is_mine', g.created_by = me, 'invite_token', g.invite_token,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'profile_id', m.profile_id, 'name', social_name(m.profile_id), 'started_it', m.profile_id = g.created_by)
        order by m.joined_at), '[]'::jsonb) from group_members m where m.group_id = g.id));
end $$;

create function group_add_members(p_group uuid, p_members jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  wanted uuid[] := array_remove(social_uuids(p_members), me);
  group_name text;
begin
  select name into group_name from groups where id = p_group and deleted_at is null;
  if group_name is null or not social_in_group(p_group) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if exists (select 1 from unnest(wanted) w where w not in (select social_circle())) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  insert into group_members (group_id, profile_id) select p_group, x from unnest(wanted) x on conflict do nothing;
  perform social_notify(wanted, 'group_added', jsonb_build_object('group_id', p_group, 'group_name', group_name, 'by', me, 'from_name', social_name(me)));
end $$;

-- Whoever started the group may remove people. Anyone may remove themselves.
create function group_remove_member(p_group uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if p_profile <> me and not exists (select 1 from groups g where g.id = p_group and g.created_by = me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  delete from group_members where group_id = p_group and profile_id = p_profile;
end $$;

-- Only the name, so a stranger with the link learns nothing else before joining.
create function group_join_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  g groups;
begin
  select * into g from groups where invite_token = p_token and deleted_at is null;
  if g.id is null then raise exception 'link_not_valid' using errcode = 'PT404'; end if;
  return jsonb_build_object('name', g.name, 'already_in', exists (
    select 1 from group_members m where m.group_id = g.id and m.profile_id = me), 'id', g.id);
end $$;

create function group_join(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  g groups;
begin
  select * into g from groups where invite_token = p_token and deleted_at is null;
  if g.id is null then raise exception 'link_not_valid' using errcode = 'PT404'; end if;
  insert into group_members (group_id, profile_id) values (g.id, me) on conflict do nothing;
  return g.id;
end $$;

-- Old link stops working.
create function group_new_link(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  fresh text := social_random_token();
begin
  update groups set invite_token = fresh where id = p_group and created_by = me and deleted_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  return fresh;
end $$;

-- ===== Chat (AYWO Plus only) =====

create function social_need_plus() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_plus(auth.uid()) then raise exception 'plus_required' using errcode = 'PT402'; end if;
end $$;

create function social_message_json(m messages) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare parent messages;
begin
  if m.deleted_at is not null then
    return jsonb_build_object('id', m.id, 'chat_id', m.chat_id, 'sender_id', m.sender_id,
      'sender_name', social_name(m.sender_id), 'created_at', m.created_at, 'deleted', true);
  end if;
  if m.reply_to is not null then select * into parent from messages where id = m.reply_to; end if;
  return jsonb_build_object(
    'id', m.id, 'chat_id', m.chat_id, 'sender_id', m.sender_id, 'sender_name', social_name(m.sender_id),
    'body', m.body, 'media_path', m.media_path, 'media_kind', m.media_kind, 'media_ms', m.media_ms,
    'client_id', m.client_id, 'created_at', m.created_at, 'deleted', false,
    'reply', case when parent.id is null or parent.deleted_at is not null then null else jsonb_build_object(
      'id', parent.id, 'sender_name', social_name(parent.sender_id), 'body', left(parent.body, 120), 'media_kind', parent.media_kind) end);
end $$;

create function chat_open_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  dkey text;
  found_id uuid;
begin
  perform social_need_plus();
  if p_other is null or p_other = me or p_other not in (select social_circle()) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  dkey := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  insert into chats (kind, direct_key, created_by) values ('direct', dkey, me) on conflict (direct_key) do nothing;
  select id into found_id from chats where direct_key = dkey;
  insert into chat_members (chat_id, profile_id) values (found_id, me), (found_id, p_other)
    on conflict (chat_id, profile_id) do update set left_at = null;
  return found_id;
end $$;

-- A family group is a tree or branch audience; friends use a group; or chosen people.
create function chat_create_group(p_name text, p_audience jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  new_id uuid;
  wanted uuid[];
begin
  perform social_need_plus();
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required' using errcode = 'PT422'; end if;
  select coalesce(array_agg(x), '{}') into wanted from social_audience(p_audience) x;
  insert into chats (kind, name, tree_id, group_id, created_by)
  values ('group', trim(p_name),
          case when p_audience ->> 'type' in ('tree', 'branch') then (p_audience ->> 'tree_id')::uuid end,
          case when p_audience ->> 'type' = 'group' then (p_audience ->> 'group_id')::uuid end, me)
  returning id into new_id;
  insert into chat_members (chat_id, profile_id) select new_id, x from unnest(array_append(wanted, me)) x on conflict do nothing;
  perform social_notify(wanted, 'chat_added', jsonb_build_object('chat_id', new_id, 'chat_name', trim(p_name), 'by', me, 'from_name', social_name(me)));
  return new_id;
end $$;

create function chat_add_members(p_chat uuid, p_members jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  c chats;
  wanted uuid[] := array_remove(social_uuids(p_members), me);
begin
  perform social_need_plus();
  select * into c from chats where id = p_chat;
  if c.id is null or c.kind <> 'group' or not social_in_chat(p_chat) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if exists (select 1 from unnest(wanted) w where w not in (select social_circle())) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  insert into chat_members (chat_id, profile_id) select p_chat, x from unnest(wanted) x
    on conflict (chat_id, profile_id) do update set left_at = null;
  perform social_notify(wanted, 'chat_added', jsonb_build_object('chat_id', p_chat, 'chat_name', c.name, 'by', me, 'from_name', social_name(me)));
end $$;

create function chat_leave(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update chat_members set left_at = now() where chat_id = p_chat and profile_id = me and left_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

create function chat_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  perform social_need_plus();
  return coalesce((
    select jsonb_agg(q.item order by q.sort_at desc)
    from (
      select coalesce(c.last_message_at, c.created_at) as sort_at, jsonb_build_object(
        'id', c.id, 'kind', c.kind,
        'name', case when c.kind = 'direct' then (
            select social_name(o.profile_id) from chat_members o where o.chat_id = c.id and o.profile_id <> me limit 1)
          else c.name end,
        'other_id', case when c.kind = 'direct' then (
            select o.profile_id from chat_members o where o.chat_id = c.id and o.profile_id <> me limit 1) end,
        'last_message_at', c.last_message_at,
        'last', (select jsonb_build_object('body', left(l.body, 80), 'media_kind', l.media_kind, 'deleted', l.deleted_at is not null)
                 from messages l where l.chat_id = c.id order by l.created_at desc limit 1),
        'unread', (select count(*) from messages u
                   where u.chat_id = c.id and u.deleted_at is null and u.sender_id is distinct from me
                     and u.created_at > coalesce(m.last_read_at, m.joined_at))
      ) as item
      from chats c join chat_members m on m.chat_id = c.id and m.profile_id = me and m.left_at is null
      order by coalesce(c.last_message_at, c.created_at) desc
      limit 200
    ) q), '[]'::jsonb);
end $$;

-- Newest first. Photos and voice notes come back as paths; the route swaps them for short-lived links.
create function chat_messages(p_chat uuid, p_before timestamptz default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  c chats;
begin
  perform social_need_plus();
  if not social_in_chat(p_chat) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into c from chats where id = p_chat;
  return jsonb_build_object(
    'chat', jsonb_build_object(
      'id', c.id, 'kind', c.kind,
      'name', case when c.kind = 'direct' then (
          select social_name(o.profile_id) from chat_members o where o.chat_id = c.id and o.profile_id <> me limit 1)
        else c.name end,
      'members', (select count(*) from chat_members x where x.chat_id = c.id and x.left_at is null)),
    'messages', coalesce((
      select jsonb_agg(social_message_json(q) order by q.created_at desc)
      from messages q
      where q.id in (
        select x.id from messages x
        where x.chat_id = p_chat and (p_before is null or x.created_at < p_before)
        order by x.created_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 100)
      )), '[]'::jsonb));
end $$;

create function chat_members_list(p_chat uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform social_me();
  perform social_need_plus();
  if not social_in_chat(p_chat) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', m.profile_id, 'name', social_name(m.profile_id)) order by m.joined_at)
    from chat_members m where m.chat_id = p_chat and m.left_at is null), '[]'::jsonb);
end $$;

create function send_message(
  p_chat uuid,
  p_body text default null,
  p_media_path text default null,
  p_media_kind message_media_t default null,
  p_media_ms int default null,
  p_reply_to uuid default null,
  p_client_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_body, '')), '');
  m messages;
  others uuid[];
begin
  perform social_need_plus();
  if not social_in_chat(p_chat) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if clean is null and p_media_path is null then raise exception 'message_empty' using errcode = 'PT422'; end if;
  if (p_media_path is null) <> (p_media_kind is null) then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_media_path is not null then perform social_check_path(p_media_path, 'chat'); end if;
  if p_reply_to is not null and not exists (select 1 from messages r where r.id = p_reply_to and r.chat_id = p_chat) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_client_id is not null then
    select * into m from messages x where x.chat_id = p_chat and x.sender_id = me and x.client_id = p_client_id;
    if m.id is not null then return social_message_json(m); end if;
  end if;

  insert into messages (chat_id, sender_id, body, media_path, media_kind, media_ms, reply_to, client_id)
  values (p_chat, me, clean, p_media_path, p_media_kind, p_media_ms, p_reply_to, p_client_id)
  returning * into m;
  update chats set last_message_at = m.created_at where id = p_chat;

  -- One waiting notification per chat, not one per message. No message text leaves in a notification.
  select coalesce(array_agg(o.profile_id), '{}') into others
  from chat_members o
  where o.chat_id = p_chat and o.left_at is null and o.profile_id <> me
    and not exists (
      select 1 from notifications n
      where n.recipient_id = o.profile_id and n.kind = 'chat_message' and n.read_at is null
        and n.payload ->> 'chat_id' = p_chat::text
    );
  perform social_notify(others, 'chat_message', jsonb_build_object(
    'chat_id', p_chat, 'by', me, 'from_name', social_name(me),
    'chat_name', (select c.name from chats c where c.id = p_chat)));

  -- Reaches the WebSocket hub only when this transaction commits.
  perform pg_notify('aywo_chat', json_build_object('chat_id', p_chat, 'message_id', m.id)::text);
  return social_message_json(m);
end $$;

create function message_delete(p_message uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  chat uuid;
begin
  update messages set deleted_at = now(), body = null, media_path = null, media_kind = null, media_ms = null
  where id = p_message and sender_id = me and deleted_at is null
  returning chat_id into chat;
  if chat is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  perform pg_notify('aywo_chat', json_build_object('chat_id', chat, 'message_id', p_message)::text);
end $$;

create function chat_mark_read(p_chat uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update chat_members set last_read_at = now() where chat_id = p_chat and profile_id = me and left_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  update notifications set read_at = now()
  where recipient_id = me and kind = 'chat_message' and read_at is null and payload ->> 'chat_id' = p_chat::text;
end $$;

-- For the WebSocket hub. Server only: who may receive this message right now.
create function social_chat_recipients(p_chat uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.profile_id from chat_members m
  where m.chat_id = p_chat and m.left_at is null and has_plus(m.profile_id)
$$;

-- ===== Memories =====

create function social_post_json(p posts, p_full boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  return jsonb_build_object(
    'id', p.id, 'author_id', p.author_id, 'author_name', social_name(p.author_id),
    'tree_id', p.tree_id, 'group_id', p.group_id, 'body', p.body, 'happened_on', p.happened_on,
    'closed', p.closed_at is not null, 'created_at', p.created_at,
    'is_mine', p.author_id = me,
    'can_edit', p.author_id = me or exists (select 1 from post_collaborators c where c.post_id = p.id and c.profile_id = me),
    'scope_name', coalesce((select t.name from trees t where t.id = p.tree_id), (select g.name from groups g where g.id = p.group_id)),
    'media', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'path', m.path) order by m.position), '[]'::jsonb)
              from post_media m where m.post_id = p.id),
    'tags', (select coalesce(jsonb_agg(jsonb_build_object(
                'person_id', t.person_id, 'profile_id', t.profile_id,
                'name', coalesce((select x.display_name from persons x where x.id = t.person_id), social_name(t.profile_id)))), '[]'::jsonb)
             from post_tags t where t.post_id = p.id),
    'collaborators', (select coalesce(jsonb_agg(jsonb_build_object('profile_id', c.profile_id, 'name', social_name(c.profile_id))), '[]'::jsonb)
                      from post_collaborators c where c.post_id = p.id),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n)), '[]'::jsonb)
                  from (select x.emoji, count(*) as n from reactions x
                        where x.target_type = 'post' and x.target_id = p.id group by x.emoji order by n desc) r),
    'my_reaction', (select x.emoji from reactions x where x.target_type = 'post' and x.target_id = p.id and x.profile_id = me),
    'comment_count', (select count(*) from post_comments c where c.post_id = p.id and c.deleted_at is null),
    'comments', case when p_full then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'author_id', c.author_id, 'author_name', social_name(c.author_id), 'body', c.body, 'created_at', c.created_at,
        'mine', c.author_id = me,
        'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n)), '[]'::jsonb)
                      from (select x.emoji, count(*) as n from reactions x
                            where x.target_type = 'comment' and x.target_id = c.id group by x.emoji) r),
        'my_reaction', (select x.emoji from reactions x where x.target_type = 'comment' and x.target_id = c.id and x.profile_id = me)
      ) order by c.created_at), '[]'::jsonb)
      from post_comments c where c.post_id = p.id and c.deleted_at is null) end
  );
end $$;

-- Accounts behind tagged cards and tagged friends.
create function social_post_tagged_profiles(p_post uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select pe.claimed_by as x from post_tags t join persons pe on pe.id = t.person_id
    where t.post_id = p_post and pe.claimed_by is not null and pe.deleted_at is null
    union
    select t.profile_id from post_tags t where t.post_id = p_post and t.profile_id is not null
  ) q
$$;

create function social_post_add_tags(p posts, p_people uuid[], p_profiles uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  before_tagged uuid[] := social_post_tagged_profiles(p.id);
  fresh uuid[];
begin
  if cardinality(p_people) > 0 and (p.tree_id is null or exists (
    select 1 from unnest(p_people) w
    where not exists (select 1 from persons x where x.id = w and x.tree_id = p.tree_id and x.deleted_at is null)
       or tree_role(p.tree_id, w) = 'none'
  )) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if cardinality(p_profiles) > 0 and (p.group_id is null or exists (
    select 1 from unnest(p_profiles) w
    where not exists (select 1 from group_members m where m.group_id = p.group_id and m.profile_id = w)
  )) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  insert into post_tags (post_id, person_id) select p.id, w from unnest(p_people) w on conflict do nothing;
  insert into post_tags (post_id, profile_id) select p.id, w from unnest(p_profiles) w on conflict do nothing;
  select coalesce(array_agg(x), '{}') into fresh from unnest(social_post_tagged_profiles(p.id)) x where not (x = any (before_tagged));
  perform social_notify(fresh, 'memory_tag', jsonb_build_object('post_id', p.id, 'by', auth.uid(), 'from_name', social_name(auth.uid())));
end $$;

create function social_check_collaborators(p posts, p_people uuid[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (
    select 1 from unnest(p_people) w
    where not (
      (p.tree_id is not null and w in (select social_visible_tree_members(p.tree_id)))
      or (p.group_id is not null and exists (select 1 from group_members m where m.group_id = p.group_id and m.profile_id = w))
    )
  ) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
end $$;

-- p_tree or p_group says who may see it. Photos are stored paths in the caller's own folder.
create function post_create(
  p_tree uuid default null,
  p_group uuid default null,
  p_body text default null,
  p_happened_on date default null,
  p_media jsonb default null,
  p_tag_people jsonb default null,
  p_tag_profiles jsonb default null,
  p_collaborators jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  p posts;
  paths text[] := social_texts(p_media);
  clean text := nullif(trim(coalesce(p_body, '')), '');
  path text;
  helpers uuid[] := array_remove(social_uuids(p_collaborators), me);
  i int := 0;
begin
  if (p_tree is null) = (p_group is null) then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_tree is not null and tree_role(p_tree) = 'none' then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if p_group is not null and not social_in_group(p_group) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if clean is null and cardinality(paths) = 0 then raise exception 'memory_empty' using errcode = 'PT422'; end if;
  if cardinality(paths) > 20 then raise exception 'too_many_photos' using errcode = 'PT422'; end if;
  if p_happened_on > current_date then raise exception 'date_in_future' using errcode = 'PT422'; end if;

  insert into posts (author_id, tree_id, group_id, body, happened_on)
  values (me, p_tree, p_group, clean, coalesce(p_happened_on, current_date))
  returning * into p;

  foreach path in array paths loop
    perform social_check_path(path, 'posts');
    insert into post_media (post_id, path, position, added_by) values (p.id, path, i, me);
    i := i + 1;
  end loop;

  perform social_post_add_tags(p, social_uuids(p_tag_people), social_uuids(p_tag_profiles));
  perform social_check_collaborators(p, helpers);
  insert into post_collaborators (post_id, profile_id) select p.id, x from unnest(helpers) x;
  perform social_notify(helpers, 'memory_collaborator', jsonb_build_object('post_id', p.id, 'by', me, 'from_name', social_name(me)));

  -- F-MEM-02: the next time this date comes round.
  insert into reminders (post_id, run_on)
  values (p.id, (
    select min(d)::date from generate_series(p.happened_on + interval '1 year', current_date + interval '1 year 1 day', interval '1 year') d
    where d::date > current_date
  ));
  return p.id;
end $$;

create function post_feed(p_tree uuid default null, p_group uuid default null, p_before timestamptz default null, p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if p_tree is not null and tree_role(p_tree) = 'none' then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if p_group is not null and not social_in_group(p_group) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  return coalesce((
    select jsonb_agg(social_post_json(q, false) order by q.created_at desc)
    from posts q
    where q.id in (
      select x.id from posts x
      where x.deleted_at is null
        and (p_before is null or x.created_at < p_before)
        and ((p_tree is null and p_group is null and (
               x.author_id = me
               or (x.tree_id in (select social_my_tree_ids()) and tree_role(x.tree_id) <> 'none')
               or (x.group_id in (select m.group_id from group_members m where m.profile_id = me))))
             or x.tree_id = p_tree or x.group_id = p_group)
      order by x.created_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    )), '[]'::jsonb);
end $$;

create function post_detail(p_post uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p posts;
begin
  perform social_me();
  if not social_can_view_post(p_post) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into p from posts where id = p_post;
  return social_post_json(p, true);
end $$;

-- Author and collaborators may add photos and tags while the thread is open.
create function social_post_for_edit(p_post uuid) returns posts
language plpgsql stable security definer set search_path = public as $$
declare p posts;
begin
  select * into p from posts where id = p_post and deleted_at is null;
  if p.id is null or not (p.author_id = auth.uid() or exists (
    select 1 from post_collaborators c where c.post_id = p_post and c.profile_id = auth.uid()
  )) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p.closed_at is not null then raise exception 'thread_closed' using errcode = 'PT409'; end if;
  return p;
end $$;

create function post_add_media(p_post uuid, p_media jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  p posts := social_post_for_edit(p_post);
  path text;
  i int;
begin
  select coalesce(max(position) + 1, 0) into i from post_media where post_id = p.id;
  if i + cardinality(social_texts(p_media)) > 20 then raise exception 'too_many_photos' using errcode = 'PT422'; end if;
  foreach path in array social_texts(p_media) loop
    perform social_check_path(path, 'posts');
    insert into post_media (post_id, path, position, added_by) values (p.id, path, i, me);
    i := i + 1;
  end loop;
end $$;

create function post_add_tags(p_post uuid, p_tag_people jsonb default null, p_tag_profiles jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  p posts := social_post_for_edit(p_post);
begin
  perform social_post_add_tags(p, social_uuids(p_tag_people), social_uuids(p_tag_profiles));
end $$;

create function post_add_collaborators(p_post uuid, p_collaborators jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  p posts;
  helpers uuid[] := array_remove(social_uuids(p_collaborators), me);
begin
  select * into p from posts where id = p_post and author_id = me and deleted_at is null;
  if p.id is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  perform social_check_collaborators(p, helpers);
  insert into post_collaborators (post_id, profile_id) select p.id, x from unnest(helpers) x on conflict do nothing;
  perform social_notify(helpers, 'memory_collaborator', jsonb_build_object('post_id', p.id, 'by', me, 'from_name', social_name(me)));
end $$;

-- 'Close the thread': nothing more can be added. The author can open it again.
create function post_set_closed(p_post uuid, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update posts set closed_at = case when p_closed then now() end
  where id = p_post and author_id = me and deleted_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

create function post_delete(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update posts set deleted_at = now() where id = p_post and author_id = me and deleted_at is null;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  delete from reminders where post_id = p_post;
end $$;

-- PRD A6.9: comments are 'interactions', which AYWO Plus covers. Reading them stays free.
create function post_comment(p_post uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  p posts;
  clean text := nullif(trim(coalesce(p_body, '')), '');
  new_id uuid;
begin
  perform social_need_plus();
  if not social_can_view_post(p_post) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into p from posts where id = p_post;
  if p.closed_at is not null then raise exception 'thread_closed' using errcode = 'PT409'; end if;
  if clean is null then raise exception 'message_empty' using errcode = 'PT422'; end if;
  insert into post_comments (post_id, author_id, body) values (p_post, me, clean) returning id into new_id;
  perform social_notify(
    array_append((select coalesce(array_agg(c.profile_id), '{}') from post_collaborators c where c.post_id = p_post), p.author_id),
    'memory_comment', jsonb_build_object('post_id', p_post, 'by', me, 'from_name', social_name(me)));
  return new_id;
end $$;

create function comment_delete(p_comment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update post_comments c set deleted_at = now()
  where c.id = p_comment and c.deleted_at is null and (
    c.author_id = me or exists (select 1 from posts p where p.id = c.post_id and p.author_id = me)
  );
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- Seeing reactions is free; adding one needs Plus. An empty emoji takes the caller's reaction away.
create function react(p_target_type reaction_target_t, p_target_id uuid, p_emoji text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  post uuid;
  clean text := nullif(trim(coalesce(p_emoji, '')), '');
begin
  perform social_need_plus();
  if not social_can_view_reaction(p_target_type, p_target_id) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  post := case when p_target_type = 'post' then p_target_id
          else (select c.post_id from post_comments c where c.id = p_target_id) end;
  if (select p.closed_at from posts p where p.id = post) is not null then
    raise exception 'thread_closed' using errcode = 'PT409';
  end if;
  if clean is null then
    delete from reactions where target_type = p_target_type and target_id = p_target_id and profile_id = me;
  else
    insert into reactions (target_type, target_id, profile_id, emoji) values (p_target_type, p_target_id, me, clean)
    on conflict (target_type, target_id, profile_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

-- F-MEM-02. Daily job; safe to run often because each reminder is marked when sent.
create function run_memory_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  sent int := 0;
begin
  for r in
    select rm.id, rm.run_on, p.id as post_id, p.happened_on
    from reminders rm join posts p on p.id = rm.post_id
    where rm.sent_at is null and rm.run_on <= current_date and p.deleted_at is null
    for update of rm skip locked
  loop
    insert into notifications (recipient_id, kind, payload)
    select x, 'memory_reminder', jsonb_build_object(
      'post_id', r.post_id, 'happened_on', r.happened_on,
      'years', extract(year from r.run_on)::int - extract(year from r.happened_on)::int)
    from unnest(social_post_tagged_profiles(r.post_id)) x;
    update reminders set sent_at = now() where id = r.id;
    insert into reminders (post_id, run_on) values (r.post_id, (r.run_on + interval '1 year')::date)
    on conflict (post_id, run_on) do nothing;
    sent := sent + 1;
  end loop;
  return sent;
end $$;

-- ===== Invites and Pop Party =====

create function social_event_json(e events) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  return jsonb_build_object(
    'id', e.id, 'host_id', e.host_id, 'host_name', social_name(e.host_id), 'kind', e.kind, 'title', e.title,
    'starts_at', e.starts_at, 'place', e.place, 'menu', e.menu, 'note', e.note, 'canva_url', e.canva_url,
    'design', e.design, 'cancelled', e.cancelled_at is not null, 'decided', e.decided_at is not null, 'is_mine', e.host_id = me,
    'my_answer', (select r.answer from rsvps r where r.event_id = e.id and r.profile_id = me),
    'yes', (select count(*) from rsvps r where r.event_id = e.id and r.answer = 'yes'),
    'invited', (select count(*) from event_invitees i where i.event_id = e.id)
  );
end $$;

create function event_create(
  p_kind event_kind_t,
  p_title text,
  p_starts_at timestamptz,
  p_audience jsonb,
  p_place text default null,
  p_note text default null,
  p_canva_url text default null,
  p_design text default 'classic'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  new_id uuid;
  wanted uuid[];
begin
  if p_kind = 'pop_party' then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'name_required' using errcode = 'PT422'; end if;
  if p_starts_at is null then raise exception 'date_required' using errcode = 'PT422'; end if;
  -- Premium designs arrive only through the paid order.
  if coalesce(p_design, 'classic') not in ('classic', 'marigold') then raise exception 'design_not_owned' using errcode = 'PT402'; end if;
  select coalesce(array_agg(x), '{}') into wanted from social_audience(p_audience) x;
  if cardinality(wanted) = 0 then raise exception 'no_recipients' using errcode = 'PT422'; end if;
  insert into events (host_id, kind, title, starts_at, place, note, canva_url, design)
  values (me, p_kind, trim(p_title), p_starts_at, nullif(trim(coalesce(p_place, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
          nullif(trim(coalesce(p_canva_url, '')), ''), coalesce(p_design, 'classic'))
  returning id into new_id;
  insert into event_invitees (event_id, profile_id) select new_id, x from unnest(wanted) x;
  perform social_notify(wanted, 'invite', jsonb_build_object(
    'event_id', new_id, 'event_kind', p_kind, 'title', trim(p_title), 'by', me, 'from_name', social_name(me), 'starts_at', p_starts_at));
  return new_id;
end $$;

create function event_update(
  p_event uuid,
  p_title text default null,
  p_starts_at timestamptz default null,
  p_place text default null,
  p_note text default null,
  p_canva_url text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e events;
begin
  update events set
    title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
    starts_at = coalesce(p_starts_at, starts_at),
    place = coalesce(nullif(trim(coalesce(p_place, '')), ''), place),
    note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
    canva_url = coalesce(nullif(trim(coalesce(p_canva_url, '')), ''), canva_url)
  where id = p_event and host_id = me and cancelled_at is null
  returning * into e;
  if e.id is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  perform social_notify((select coalesce(array_agg(i.profile_id), '{}') from event_invitees i where i.event_id = p_event),
    'invite_changed', jsonb_build_object('event_id', e.id, 'title', e.title, 'by', me, 'from_name', social_name(me)));
end $$;

create function event_cancel(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e events;
begin
  update events set cancelled_at = now() where id = p_event and host_id = me and cancelled_at is null returning * into e;
  if e.id is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  perform social_notify((select coalesce(array_agg(i.profile_id), '{}') from event_invitees i where i.event_id = p_event),
    'invite_cancelled', jsonb_build_object('event_id', e.id, 'title', e.title, 'by', me, 'from_name', social_name(me)));
end $$;

create function event_add_invitees(p_event uuid, p_audience jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e events;
  fresh uuid[];
begin
  select * into e from events where id = p_event and host_id = me and cancelled_at is null;
  if e.id is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  with added as (
    insert into event_invitees (event_id, profile_id)
    select p_event, x from social_audience(p_audience) x
    on conflict do nothing
    returning profile_id
  )
  select coalesce(array_agg(profile_id), '{}') into fresh from added;
  perform social_notify(fresh, 'invite', jsonb_build_object(
    'event_id', e.id, 'event_kind', e.kind, 'title', e.title, 'by', me, 'from_name', social_name(me), 'starts_at', e.starts_at));
end $$;

create function event_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return coalesce((
    select jsonb_agg(social_event_json(q) order by q.starts_at desc nulls first, q.created_at desc)
    from events q
    where q.id in (
      select e.id from events e
      where e.host_id = me or exists (select 1 from event_invitees i where i.event_id = e.id and i.profile_id = me)
      order by e.starts_at desc nulls first, e.created_at desc
      limit 200
    )), '[]'::jsonb);
end $$;

create function event_detail(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  e events;
begin
  if not social_can_see_event(p_event) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into e from events where id = p_event;
  return social_event_json(e) || jsonb_build_object(
    'owned_designs', (select coalesce(jsonb_agg(split_part(o.details ->> 'design_id', ':', 2)), '[]'::jsonb)
      from one_time_orders o
      where o.buyer_id = me and o.product = 'premium_invite' and o.status = 'paid'
        and o.details ->> 'design_id' like e.id::text || ':%'),
    -- Bought through Apple or Google, which carry no event: ready to spend on a design.
    'spare_designs', (select count(*) from one_time_orders o
      where o.buyer_id = me and o.product = 'premium_invite' and o.status = 'paid' and o.details ->> 'design_id' is null),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'profile_id', i.profile_id, 'name', social_name(i.profile_id), 'answer', r.answer, 'guests', coalesce(r.guests, 0))
        order by social_name(i.profile_id)), '[]'::jsonb)
      from event_invitees i left join rsvps r on r.event_id = i.event_id and r.profile_id = i.profile_id
      where i.event_id = e.id),
    'polls', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'topic', p.topic, 'closed', p.closed_at is not null,
        'my_option', (select v.option_id from poll_votes v where v.poll_id = p.id and v.profile_id = me),
        'options', (select coalesce(jsonb_agg(jsonb_build_object(
            'id', o.id, 'label', o.label,
            'votes', (select count(*) from poll_votes v where v.option_id = o.id)) order by o.position), '[]'::jsonb)
          from poll_options o where o.poll_id = p.id)) order by p.topic), '[]'::jsonb)
      from polls p where p.event_id = e.id));
end $$;

create function rsvp_set(p_event uuid, p_answer rsvp_answer_t, p_guests int default 0) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e events;
begin
  select * into e from events where id = p_event;
  if e.id is null or not exists (select 1 from event_invitees i where i.event_id = p_event and i.profile_id = me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if e.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'PT409'; end if;
  insert into rsvps (event_id, profile_id, answer, guests) values (p_event, me, p_answer, coalesce(p_guests, 0))
  on conflict (event_id, profile_id) do update set answer = excluded.answer, guests = excluded.guests, updated_at = now();
  perform social_notify(array[e.host_id], 'rsvp', jsonb_build_object(
    'event_id', e.id, 'title', e.title, 'by', me, 'from_name', social_name(me), 'answer', p_answer));
end $$;

-- Free designs at any time. A premium one needs a paid premium_invite order (one_time_orders, owned by the pay area):
-- on the web the order names '<event id>:<design>'; a store purchase names nothing, so it is spent here, once.
create function event_set_design(p_event uuid, p_design text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  wanted text := p_event::text || ':' || coalesce(p_design, '');
  spare uuid;
begin
  if not exists (select 1 from events e where e.id = p_event and e.host_id = me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_design not in ('classic', 'marigold') and not exists (
    select 1 from one_time_orders o
    where o.buyer_id = me and o.product = 'premium_invite' and o.status = 'paid' and o.details ->> 'design_id' = wanted
  ) then
    select o.id into spare from one_time_orders o
    where o.buyer_id = me and o.product = 'premium_invite' and o.status = 'paid' and o.details ->> 'design_id' is null
    order by o.paid_at limit 1 for update;
    if spare is null then raise exception 'design_not_owned' using errcode = 'PT402'; end if;
    update one_time_orders set details = details || jsonb_build_object('design_id', wanted) where id = spare;
  end if;
  update events set design = p_design where id = p_event;  -- the table's check refuses an unknown design
end $$;

-- Pop Party: a quick plan. Date, venue and menu are put to a vote among the family and friends invited.
create function pop_party_create(
  p_title text,
  p_audience jsonb,
  p_dates jsonb default null,
  p_venues jsonb default null,
  p_menus jsonb default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  new_id uuid;
  wanted uuid[];
  poll_id uuid;
  topic poll_topic_t;
  labels text[];
begin
  if coalesce(trim(p_title), '') = '' then raise exception 'name_required' using errcode = 'PT422'; end if;
  select coalesce(array_agg(x), '{}') into wanted from social_audience(p_audience) x;
  if cardinality(wanted) = 0 then raise exception 'no_recipients' using errcode = 'PT422'; end if;
  if cardinality(social_texts(p_dates)) + cardinality(social_texts(p_venues)) + cardinality(social_texts(p_menus)) = 0 then
    raise exception 'poll_options_required' using errcode = 'PT422';
  end if;
  insert into events (host_id, kind, title, note) values (me, 'pop_party', trim(p_title), nullif(trim(coalesce(p_note, '')), ''))
  returning id into new_id;
  insert into event_invitees (event_id, profile_id) select new_id, x from unnest(wanted) x;
  foreach topic in array array['date', 'venue', 'menu']::poll_topic_t[] loop
    labels := social_texts(case topic when 'date' then p_dates when 'venue' then p_venues else p_menus end);
    if cardinality(labels) > 0 then
      insert into polls (event_id, topic) values (new_id, topic) returning id into poll_id;
      insert into poll_options (poll_id, label, position)
      select poll_id, l, (ord - 1)::smallint from unnest(labels) with ordinality as u(l, ord);
    end if;
  end loop;
  perform social_notify(wanted, 'invite', jsonb_build_object(
    'event_id', new_id, 'event_kind', 'pop_party', 'title', trim(p_title), 'by', me, 'from_name', social_name(me)));
  return new_id;
end $$;

create function poll_vote(p_poll uuid, p_option uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if not social_can_see_poll(p_poll) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if (select closed_at from polls where id = p_poll) is not null then raise exception 'poll_closed' using errcode = 'PT409'; end if;
  if not exists (select 1 from poll_options o where o.id = p_option and o.poll_id = p_poll) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  insert into poll_votes (poll_id, profile_id, option_id) values (p_poll, me, p_option)
  on conflict (poll_id, profile_id) do update set option_id = excluded.option_id, voted_at = now();
end $$;

-- The host settles the plan; the polls close and everyone is told.
create function pop_party_decide(p_event uuid, p_starts_at timestamptz, p_place text default null, p_menu text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  e events;
begin
  if p_starts_at is null then raise exception 'date_required' using errcode = 'PT422'; end if;
  update events set starts_at = p_starts_at, place = nullif(trim(coalesce(p_place, '')), ''),
    menu = nullif(trim(coalesce(p_menu, '')), ''), decided_at = now()
  where id = p_event and host_id = me and kind = 'pop_party' and cancelled_at is null
  returning * into e;
  if e.id is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  update polls set closed_at = now() where event_id = p_event and closed_at is null;
  perform social_notify((select coalesce(array_agg(i.profile_id), '{}') from event_invitees i where i.event_id = p_event),
    'invite_changed', jsonb_build_object('event_id', e.id, 'title', e.title, 'by', me, 'from_name', social_name(me), 'starts_at', e.starts_at));
end $$;

-- ===== Alerts (free) =====

-- F-NOT-01: the sender always picks who hears it. 20 a day stops a mistake or a misuse becoming a flood.
create function send_alert(p_kind alert_kind_t, p_body text, p_audience jsonb, p_blood_group text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  clean text := nullif(trim(coalesce(p_body, '')), '');
  wanted uuid[];
  new_id uuid;
begin
  if clean is null then raise exception 'message_empty' using errcode = 'PT422'; end if;
  if p_kind = 'blood' and p_blood_group is null then raise exception 'blood_group_required' using errcode = 'PT422'; end if;
  if p_kind <> 'blood' and p_blood_group is not null then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if (select count(*) from alerts a where a.sender_id = me and a.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many_alerts' using errcode = 'PT429';
  end if;
  select coalesce(array_agg(x), '{}') into wanted from social_audience(p_audience) x;
  if cardinality(wanted) = 0 then raise exception 'no_recipients' using errcode = 'PT422'; end if;
  insert into alerts (sender_id, kind, body, blood_group, audience_type)
  values (me, p_kind, clean, p_blood_group, p_audience ->> 'type') returning id into new_id;
  insert into alert_recipients (alert_id, profile_id) select new_id, x from unnest(wanted) x;
  perform social_notify(wanted, 'alert', jsonb_build_object(
    'alert_id', new_id, 'alert_kind', p_kind, 'blood_group', p_blood_group, 'by', me, 'from_name', social_name(me), 'body', left(clean, 140)));
  return jsonb_build_object('id', new_id, 'recipients', cardinality(wanted));
end $$;

create function alerts_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return coalesce((
    select jsonb_agg(q.item order by q.created_at desc) from (
      select a.created_at, jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'body', a.body, 'blood_group', a.blood_group, 'created_at', a.created_at,
        'sender_id', a.sender_id, 'sender_name', social_name(a.sender_id), 'is_mine', a.sender_id = me,
        'recipients', case when a.sender_id = me then (select count(*) from alert_recipients r where r.alert_id = a.id) end,
        'seen', a.sender_id = me or exists (select 1 from alert_recipients r where r.alert_id = a.id and r.profile_id = me and r.seen_at is not null)
      ) as item
      from alerts a
      where a.sender_id = me or exists (select 1 from alert_recipients r where r.alert_id = a.id and r.profile_id = me)
      order by a.created_at desc limit 200
    ) q), '[]'::jsonb);
end $$;

create function alert_mark_seen(p_alert uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  update alert_recipients set seen_at = now() where alert_id = p_alert and profile_id = me and seen_at is null;
  update notifications set read_at = now()
  where recipient_id = me and kind = 'alert' and read_at is null and payload ->> 'alert_id' = p_alert::text;
end $$;

-- ===== SOS (free) =====

create function sos_contacts_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  -- A typed number is the caller's own entry. A family member's number is never included.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'position', c.position, 'contact_profile_id', c.contact_profile_id, 'phone', c.phone,
      'name', coalesce(nullif(c.name, ''), social_name(c.contact_profile_id), '')) order by c.position, c.created_at)
    from sos_contacts c where c.profile_id = me), '[]'::jsonb);
end $$;

create function sos_contact_add(p_contact_profile uuid default null, p_phone text default null, p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  new_id uuid;
begin
  if (p_contact_profile is null) = (p_phone is null) then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_phone is not null and p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'phone_not_valid' using errcode = 'PT422'; end if;
  if p_contact_profile is not null and (p_contact_profile = me or p_contact_profile not in (select social_circle())) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if (select count(*) from sos_contacts where profile_id = me) >= 5 then
    raise exception 'sos_contacts_full' using errcode = 'PT422';
  end if;
  insert into sos_contacts (profile_id, contact_profile_id, phone, name, position)
  values (me, p_contact_profile, p_phone, coalesce(trim(p_name), ''),
          (select coalesce(max(position) + 1, 0) from sos_contacts where profile_id = me))
  returning id into new_id;
  return new_id;
end $$;

create function sos_contact_remove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  delete from sos_contacts where id = p_id and profile_id = me;
  if not found then raise exception 'not_allowed' using errcode = 'PT403'; end if;
end $$;

-- The first in the list is the one who gets the call.
create function sos_contacts_reorder(p_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if jsonb_typeof(p_ids) <> 'array' then raise exception 'bad_input' using errcode = 'PT422'; end if;
  update sos_contacts c set position = (o.ord - 1)::smallint
  from jsonb_array_elements_text(p_ids) with ordinality as o(id, ord)
  where c.id = o.id::uuid and c.profile_id = me;
end $$;

-- Starts the event. Returns the page token once. The route sends the SMS, because it alone reads the numbers.
create function sos_start(p_minutes int, p_lat double precision default null, p_lng double precision default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  token text := social_random_token();
  write_token text := social_random_token();
  e sos_events;
  who text := social_name(me);
  receivers uuid[];
begin
  if p_minutes is null or p_minutes not between 15 and 480 then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if not exists (select 1 from sos_contacts where profile_id = me) then
    raise exception 'sos_no_contacts' using errcode = 'PT422';
  end if;
  update sos_events set ended_at = ends_at where profile_id = me and ended_at is null and ends_at <= now();
  if exists (select 1 from sos_events where profile_id = me and ended_at is null) then
    raise exception 'sos_already_active' using errcode = 'PT409';
  end if;

  insert into sos_events (profile_id, ends_at, last_lat, last_lng, last_at, token_hash, write_hash)
  values (me, now() + make_interval(mins => p_minutes), p_lat, p_lng,
          case when p_lat is not null and p_lng is not null then now() end, social_hash_token(token), social_hash_token(write_token))
  returning * into e;

  if p_lat is not null and p_lng is not null then
    insert into sos_locations (event_id, lat, lng) values (e.id, p_lat, p_lng);
  end if;

  -- A typed number that belongs to someone on AYWO also reaches them in the app. They are not told to the sender.
  insert into sos_event_contacts (event_id, position, contact_profile_id, name, phone)
  select e.id, (row_number() over (order by c.position, c.created_at) - 1)::smallint,
         coalesce(c.contact_profile_id, matched.id),
         coalesce(nullif(c.name, ''), social_name(c.contact_profile_id), ''),
         coalesce(c.phone, target.login_phone)
  from sos_contacts c
  left join profiles target on target.id = c.contact_profile_id
  left join profiles matched on c.phone is not null and matched.login_phone = c.phone
  where c.profile_id = me;

  select coalesce(array_agg(x.contact_profile_id), '{}') into receivers
  from sos_event_contacts x where x.event_id = e.id and x.contact_profile_id is not null;

  -- The route pushes at once. channels_sent tells the delivery job not to send this row again.
  insert into notifications (recipient_id, kind, payload, channels_sent)
  select r, 'sos', jsonb_build_object('event_id', e.id, 'by', me, 'from_name', who, 'ends_at', e.ends_at), array['direct']
  from unnest(receivers) r;

  return jsonb_build_object('id', e.id, 'token', token, 'write_token', write_token, 'ends_at', e.ends_at);
end $$;

-- Server only. The numbers and names to reach for one event, first contact first.
create function sos_targets(p_event uuid)
returns table (event_owner uuid, owner_name text, owner_language text, position_no smallint, profile_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select e.profile_id, social_name(e.profile_id), o.language_code, c.position, c.contact_profile_id, c.phone
  from sos_events e
  join profiles o on o.id = e.profile_id
  join sos_event_contacts c on c.event_id = e.id
  where e.id = p_event
  order by c.position
$$;

-- Called from the background location task with the event's own key. False tells the phone to stop sending.
create function sos_location(p_write_token text, p_lat double precision, p_lng double precision, p_accuracy real default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare e sos_events;
begin
  select * into e from sos_events where write_hash = social_hash_token(p_write_token);
  if e.id is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  if e.ended_at is not null or e.ends_at <= now() then return false; end if;
  insert into sos_locations (event_id, lat, lng, accuracy_m) values (e.id, p_lat, p_lng, p_accuracy);
  update sos_events set last_lat = p_lat, last_lng = p_lng, last_at = now() where id = e.id;
  return true;
end $$;

-- False when it had already ended: pressing Stop late is not an error, and nobody is told twice.
create function sos_stop(p_event uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  receivers uuid[];
begin
  if not exists (select 1 from sos_events e where e.id = p_event and e.profile_id = me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  update sos_events set ended_at = now() where id = p_event and ended_at is null;
  if not found then return false; end if;
  select coalesce(array_agg(x.contact_profile_id), '{}') into receivers
  from sos_event_contacts x where x.event_id = p_event and x.contact_profile_id is not null;
  perform social_notify(receivers, 'sos_ended', jsonb_build_object('event_id', p_event, 'by', me, 'from_name', social_name(me)));
  return true;
end $$;

create function sos_active() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := social_me();
  e sos_events;
begin
  select * into e from sos_events where profile_id = me and ended_at is null and ends_at > now() limit 1;
  if e.id is null then return null; end if;
  return jsonb_build_object('id', e.id, 'started_at', e.started_at, 'ends_at', e.ends_at, 'last_at', e.last_at);
end $$;

-- SOS events from people who chose the caller as a contact, while running.
create function sos_incoming() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', social_name(e.profile_id), 'started_at', e.started_at, 'ends_at', e.ends_at) order by e.started_at desc)
    from sos_events e join sos_event_contacts c on c.event_id = e.id and c.contact_profile_id = me
    where e.ended_at is null and e.ends_at > now()), '[]'::jsonb);
end $$;

-- In the app, for the person themselves and their chosen contacts.
create function sos_view(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e sos_events;
begin
  perform social_me();
  if not social_can_see_sos(p_event) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into e from sos_events where id = p_event;
  return jsonb_build_object(
    'id', e.id, 'name', social_name(e.profile_id), 'started_at', e.started_at, 'ends_at', e.ends_at, 'ended_at', e.ended_at,
    'active', e.ended_at is null and e.ends_at > now(),
    'last', case when e.last_lat is null then null else jsonb_build_object('lat', e.last_lat, 'lng', e.last_lng, 'at', e.last_at) end,
    'trail', (select coalesce(jsonb_agg(jsonb_build_object('lat', q.lat, 'lng', q.lng, 'at', q.at)), '[]'::jsonb)
              from (select l.lat, l.lng, l.at from sos_locations l where l.event_id = e.id order by l.at desc limit 30) q));
end $$;

-- The public page. Open to anyone holding the token, only while the event runs. Null for a wrong token.
create function sos_page(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e sos_events;
begin
  select * into e from sos_events where token_hash = social_hash_token(p_token);
  if e.id is null then return null; end if;
  if e.ended_at is not null or e.ends_at <= now() then
    return jsonb_build_object('active', false);
  end if;
  return jsonb_build_object(
    'active', true, 'name', social_name(e.profile_id), 'language', (select p.language_code from profiles p where p.id = e.profile_id),
    'started_at', e.started_at, 'ends_at', e.ends_at, 'lat', e.last_lat, 'lng', e.last_lng, 'last_at', e.last_at);
end $$;

-- Job: close events whose time ran out, then delete everything from events that ended more than 7 days ago.
create function sos_close_and_purge() returns int
language plpgsql security definer set search_path = public as $$
declare gone int;
begin
  update sos_events set ended_at = ends_at where ended_at is null and ends_at <= now();
  delete from sos_events where ended_at < now() - interval '7 days';
  get diagnostics gone = row_count;
  return gone;
end $$;

-- ===== Home =====

create function social_home_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := social_me();
begin
  return jsonb_build_object(
    'unread_chats', case when has_plus(me) then (
      select count(*) from chat_members m
      where m.profile_id = me and m.left_at is null and exists (
        select 1 from messages u
        where u.chat_id = m.chat_id and u.deleted_at is null and u.sender_id is distinct from me
          and u.created_at > coalesce(m.last_read_at, m.joined_at))) else 0 end,
    'unseen_alerts', (select count(*) from alert_recipients r where r.profile_id = me and r.seen_at is null),
    'open_invites', (
      select count(*) from event_invitees i join events e on e.id = i.event_id
      where i.profile_id = me and e.cancelled_at is null and (e.starts_at is null or e.starts_at > now())
        and not exists (select 1 from rsvps r where r.event_id = i.event_id and r.profile_id = me)),
    'incoming_sos', sos_incoming());
end $$;

-- ===== Rights: clients read through row rules and write through functions only =====

alter table groups enable row level security;
alter table group_members enable row level security;
alter table chats enable row level security;
alter table chat_members enable row level security;
alter table messages enable row level security;
alter table posts enable row level security;
alter table post_media enable row level security;
alter table post_tags enable row level security;
alter table post_collaborators enable row level security;
alter table post_comments enable row level security;
alter table reactions enable row level security;
alter table reminders enable row level security;              -- no client policy: job only
alter table events enable row level security;
alter table event_invitees enable row level security;
alter table rsvps enable row level security;
alter table polls enable row level security;
alter table poll_options enable row level security;
alter table poll_votes enable row level security;
alter table alerts enable row level security;
alter table alert_recipients enable row level security;
alter table sos_contacts enable row level security;
alter table sos_events enable row level security;
alter table sos_event_contacts enable row level security;
alter table sos_locations enable row level security;

grant select (id, name, kind, created_by, created_at, deleted_at) on groups to authenticated;   -- not invite_token
grant select on group_members, chats, chat_members, messages, posts, post_media, post_tags, post_collaborators,
  post_comments, reactions, events, event_invitees, rsvps, polls, poll_options, poll_votes,
  alerts, alert_recipients, sos_contacts, sos_locations to authenticated;
grant select (id, profile_id, started_at, ends_at, ended_at, last_lat, last_lng, last_at) on sos_events to authenticated;   -- not token_hash
grant select (event_id, position, contact_profile_id, name) on sos_event_contacts to authenticated;                         -- not phone

create policy groups_read on groups for select using (social_in_group(id));
create policy group_members_read on group_members for select using (social_in_group(group_id));

-- Chat needs Plus to read as well as to write.
create policy chats_read on chats for select using (social_in_chat(id) and has_plus(auth.uid()));
create policy chat_members_read on chat_members for select using (social_in_chat(chat_id) and has_plus(auth.uid()));
create policy messages_read on messages for select using (social_in_chat(chat_id) and has_plus(auth.uid()));

create policy posts_read on posts for select using (social_can_view_post(id));
create policy post_media_read on post_media for select using (social_can_view_post(post_id));
create policy post_tags_read on post_tags for select using (social_can_view_post(post_id));
create policy post_collaborators_read on post_collaborators for select using (social_can_view_post(post_id));
create policy post_comments_read on post_comments for select using (deleted_at is null and social_can_view_post(post_id));
create policy reactions_read on reactions for select using (social_can_view_reaction(target_type, target_id));

create policy events_read on events for select using (social_can_see_event(id));
create policy event_invitees_read on event_invitees for select using (social_can_see_event(event_id));
create policy rsvps_read on rsvps for select using (social_can_see_event(event_id));
create policy polls_read on polls for select using (social_can_see_event(event_id));
create policy poll_options_read on poll_options for select using (social_can_see_poll(poll_id));
create policy poll_votes_read on poll_votes for select using (social_can_see_poll(poll_id));

create policy alerts_read on alerts for select using (social_can_see_alert(id));
create policy alert_recipients_read on alert_recipients for select using (
  profile_id = auth.uid() or exists (select 1 from alerts a where a.id = alert_id and a.sender_id = auth.uid())
);

create policy sos_contacts_own on sos_contacts for select using (profile_id = auth.uid());
create policy sos_events_read on sos_events for select using (social_can_see_sos(id));
create policy sos_event_contacts_read on sos_event_contacts for select using (social_can_see_sos(event_id));
create policy sos_locations_read on sos_locations for select using (social_can_see_sos(event_id));

-- New functions can be run by everyone until revoked, so every function here is revoked by name first.
do $$
declare
  f regprocedure;
  internal text[] := array[
    'social_random_token', 'social_hash_token', 'social_name', 'social_uuids', 'social_texts', 'social_check_path',
    'social_notify', 'social_tree_profiles', 'social_branch_profiles', 'social_visible_tree_members', 'social_my_tree_ids',
    'social_circle', 'social_audience', 'social_need_plus', 'social_message_json', 'social_chat_recipients',
    'social_post_json', 'social_post_tagged_profiles', 'social_post_add_tags', 'social_check_collaborators',
    'social_post_for_edit', 'social_event_json', 'run_memory_reminders', 'sos_targets',
    'sos_close_and_purge'];
  -- The first line is also needed by the row rules above, which run as the caller.
  callable text[] := array[
    'social_me', 'social_in_group', 'social_in_chat', 'social_can_view_post', 'social_can_view_reaction', 'social_can_see_event',
    'social_can_see_poll', 'social_can_see_alert', 'social_can_see_sos',
    'social_people', 'social_circles', 'social_home_counts',
    'group_create', 'group_list', 'group_detail', 'group_add_members', 'group_remove_member', 'group_join_preview', 'group_join', 'group_new_link',
    'chat_open_direct', 'chat_create_group', 'chat_add_members', 'chat_leave', 'chat_list', 'chat_messages', 'chat_members_list',
    'send_message', 'message_delete', 'chat_mark_read',
    'post_create', 'post_feed', 'post_detail', 'post_add_media', 'post_add_tags', 'post_add_collaborators', 'post_set_closed',
    'post_delete', 'post_comment', 'comment_delete', 'react',
    'event_create', 'event_update', 'event_cancel', 'event_add_invitees', 'event_list', 'event_detail', 'rsvp_set', 'event_set_design',
    'pop_party_create', 'poll_vote', 'pop_party_decide',
    'send_alert', 'alerts_list', 'alert_mark_seen',
    'sos_contacts_list', 'sos_contact_add', 'sos_contact_remove', 'sos_contacts_reorder', 'sos_start', 'sos_stop',
    'sos_active', 'sos_incoming', 'sos_view'];
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (internal || callable || array['sos_page', 'sos_location'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (callable || array['sos_page', 'sos_location'])
  loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- The live-location page and the background task have no sign-in: the tokens are the keys.
grant execute on function sos_page(text) to anon;
grant execute on function sos_location(text, double precision, double precision, real) to anon;
