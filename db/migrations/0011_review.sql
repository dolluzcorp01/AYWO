-- Security review fixes. `create or replace` keeps a function's grants; anything new is revoked by name at the end.
-- No new error codes: everything here uses codes that already have an errors entry in the locale files.

-- ===== A branch or self-branch editor cannot pull someone from outside into their branch =====

-- Same as 0004, plus one check. Linking an existing person as a child or partner put them inside the branch
-- (person_closure and in_branch), which gave the caller read and edit rights over someone they had no rights to.
create or replace function add_relative(
  p_anchor uuid,
  p_relation text,
  p_person jsonb default null,
  p_existing_person uuid default null,
  p_union uuid default null,
  p_link_kind link_kind_t default 'birth'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  other uuid;
  new_union uuid;
  u unions;
  existing_parents uuid[];
  parent uuid;
begin
  select tree_id into tree from persons where id = p_anchor and deleted_at is null;
  if tree is null or not can_edit(tree, p_anchor) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if p_relation not in ('parent', 'child', 'spouse', 'sibling') then
    raise exception 'bad_relation' using errcode = 'PT422';
  end if;
  if p_relation in ('parent', 'sibling') and not can_edit(tree) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;

  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);

  if p_existing_person is not null then
    if not exists (select 1 from persons where id = p_existing_person and tree_id = tree and deleted_at is null) then
      raise exception 'not_in_this_tree' using errcode = 'PT422';
    end if;
    if not can_edit(tree, p_existing_person) then
      raise exception 'not_allowed' using errcode = 'PT403';
    end if;
    other := p_existing_person;
  else
    other := insert_person_from_json(tree, p_person);
  end if;

  select array_agg(parent_id) into existing_parents from parent_child where child_id = p_anchor;

  if p_relation = 'child' then
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    values (tree, p_anchor, other, p_union, p_link_kind);
    if p_union is not null then
      select * into u from unions where id = p_union and tree_id = tree and p_anchor in (partner1_id, partner2_id);
      if u.id is null then
        raise exception 'bad_union' using errcode = 'PT422';
      end if;
      if u.partner2_id is not null then
        insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
        values (tree, case when u.partner1_id = p_anchor then u.partner2_id else u.partner1_id end, other, p_union, p_link_kind);
      end if;
    end if;

  elsif p_relation = 'parent' then
    if p_link_kind = 'birth' and coalesce(array_length(existing_parents, 1), 0) >= 2 then
      raise exception 'already_two_parents' using errcode = 'PT422';
    end if;
    if p_link_kind = 'birth' and array_length(existing_parents, 1) = 1 then
      select id into new_union from unions
      where tree_id = tree and (partner1_id, partner2_id) in ((existing_parents[1], other), (other, existing_parents[1]));
      if new_union is null then
        insert into unions (tree_id, partner1_id, partner2_id) values (tree, existing_parents[1], other) returning id into new_union;
      end if;
      update parent_child set union_id = new_union where parent_id = existing_parents[1] and child_id = p_anchor;
    end if;
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    values (tree, other, p_anchor, new_union, p_link_kind);

  elsif p_relation = 'spouse' then
    insert into unions (tree_id, partner1_id, partner2_id, kind, status, seq1)
    values (tree, p_anchor, other, 'marriage', 'current',
            (select count(*) + 1 from unions where p_anchor in (partner1_id, partner2_id)))
    returning id into new_union;

  else
    if existing_parents is null then
      parent := insert_person_from_json(tree, jsonb_build_object('display_name', 'Name unknown', 'name_unknown', true));
      insert into parent_child (tree_id, parent_id, child_id, kind) values (tree, parent, p_anchor, 'unknown');
      existing_parents := array[parent];
    end if;
    insert into parent_child (tree_id, parent_id, child_id, union_id, kind)
    select tree, pc.parent_id, other, pc.union_id, p_link_kind from parent_child pc where pc.child_id = p_anchor;
  end if;

  return jsonb_build_object('person_id', other, 'union_id', coalesce(new_union, p_union));
end $$;

-- ===== Nobody claims a card by typing their own number onto it =====

-- The claim trusts value_normalized, which came straight from the caller. The stored match must now be the number shown.
create or replace function set_person_contact(p_person uuid, p_kind contact_kind_t, p_value text, p_value_normalized text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tree uuid;
  new_id uuid;
  shown text := trim(coalesce(p_value, ''));
  match_on text := coalesce(p_value_normalized, '');
  digits text;
begin
  select tree_id into tree from persons where id = p_person and deleted_at is null;
  if tree is null or not can_edit(tree, p_person) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if shown = '' or char_length(shown) > 200 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_kind = 'email' then
    if match_on <> lower(shown) or match_on !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'bad_input' using errcode = 'PT422';
    end if;
  else
    -- The number as typed may lack the country code or start with a trunk 0, so it must be the end of the full number.
    digits := ltrim(regexp_replace(shown, '\D', '', 'g'), '0');
    if match_on !~ '^\+[1-9][0-9]{6,14}$' or char_length(digits) < 6 or right(substr(match_on, 2), char_length(digits)) <> digits then
      raise exception 'bad_input' using errcode = 'PT422';
    end if;
  end if;
  insert into person_contacts (person_id, kind, value, value_normalized, created_by)
  values (p_person, p_kind, shown, match_on, auth.uid())
  returning id into new_id;
  return new_id;
end $$;

-- Same as 0004, except that a number the caller typed in themselves proves nothing, unless they run the tree anyway.
-- Without this an editor typed their own number on any card, claimed it, and read that person's contacts as 'self',
-- picked up any share waiting for that person, and got a viewer's sight of the whole tree from a branch-only share.
create or replace function claim_candidates()
returns table (person_id uuid, tree_id uuid, tree_name text, display_name text, photo_path text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, t.id, t.name, p.display_name, p.photo_path
  from person_contacts c
  join persons p on p.id = c.person_id
  join trees t on t.id = p.tree_id
  where c.kind in ('mobile', 'whatsapp')
    and c.value_normalized = my_verified_phone()
    and (c.created_by <> auth.uid() or is_creator_or_cocreator(t.id))
    and p.claimed_by is null and p.deleted_at is null and t.deleted_at is null
    and not exists (select 1 from persons o where o.tree_id = t.id and o.claimed_by = auth.uid())
$$;

-- Same as 0010, except that whoever added the person must still belong to the tree. A removed editor kept this power.
create or replace function claim_undo(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  row_now persons;
  tree_creator uuid;
begin
  select * into row_now from persons where id = p_person;
  select creator_id into tree_creator from trees where id = row_now.tree_id;
  if row_now.id is null or row_now.claimed_by is null
     or not (me = tree_creator or (me = row_now.created_by and tree_role(row_now.tree_id, p_person) <> 'none')) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  update persons set
    claimed_by = null,
    photo_path = case when photo_path = (select p.photo_path from profiles p where p.id = row_now.claimed_by) then null else photo_path end
  where id = p_person;
  insert into notifications (recipient_id, kind, payload)
  values (row_now.claimed_by, 'claim_undone', jsonb_build_object('person_id', p_person, 'tree_id', row_now.tree_id));
end $$;

-- ===== An editor cannot wipe out a whole tree through undo =====

-- Undoing an import batch hard-deletes its people and closes the tree. That belongs to those who run the tree.
alter function history_revert(bigint, uuid) rename to history_revert_inner;
revoke all on function history_revert_inner(bigint, uuid) from public, anon, authenticated;

create function history_revert(p_history bigint default null, p_batch uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tree uuid;
  runs_it boolean;
  answer jsonb;
begin
  select h.tree_id into tree from history h where h.id = p_history or h.batch_id = p_batch limit 1;
  -- Asked first: once the tree is closed nobody has a role in it.
  runs_it := tree is not null and is_creator_or_cocreator(tree);
  answer := history_revert_inner(p_history, p_batch);
  if tree is not null and not runs_it and exists (select 1 from trees t where t.id = tree and t.deleted_at is not null) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  return answer;
end $$;

-- ===== SOS =====

-- Same as 0009, except that a contact's sight of the location ends with the SOS. It was readable for 7 more days.
create or replace function sos_view(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e sos_events;
  running boolean;
  may_see_place boolean;
begin
  perform social_me();
  if not social_can_see_sos(p_event) then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  select * into e from sos_events where id = p_event;
  running := e.ended_at is null and e.ends_at > now();
  may_see_place := running or e.profile_id = auth.uid();
  return jsonb_build_object(
    'id', e.id, 'name', social_name(e.profile_id), 'started_at', e.started_at, 'ends_at', e.ends_at, 'ended_at', e.ended_at,
    'active', running,
    'last', case when e.last_lat is null or not may_see_place then null else jsonb_build_object('lat', e.last_lat, 'lng', e.last_lng, 'at', e.last_at) end,
    'trail', case when not may_see_place then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('lat', q.lat, 'lng', q.lng, 'at', q.at)), '[]'::jsonb)
      from (select l.lat, l.lng, l.at from sos_locations l where l.event_id = e.id order by l.at desc limit 30) q) end);
end $$;

-- Each SOS texts every contact, and contacts may be any typed number with the sender's own name in the text.
-- Start and stop in a loop was a free way to send SMS to strangers. Six a day leaves room for real use and a drill.
create function sos_events_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from sos_events e where e.profile_id = new.profile_id and e.started_at > now() - interval '1 day') >= 6 then
    raise exception 'too_many_requests' using errcode = 'PT429';
  end if;
  return new;
end $$;
create trigger sos_events_daily_limit before insert on sos_events
  for each row execute function sos_events_limit();

-- ===== Alerts =====

-- Alerts go out by SMS. Anyone who joins a group through its link could text all of it 20 times a day.
create function alerts_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from alert_recipients r join alerts a on a.id = r.alert_id
      where a.sender_id = new.sender_id and a.created_at > now() - interval '1 day') >= 1000 then
    raise exception 'too_many_alerts' using errcode = 'PT429';
  end if;
  return new;
end $$;
create trigger alerts_daily_limit before insert on alerts
  for each row execute function alerts_limit();

-- ===== Live chat =====

-- A blocked account's socket stays open until its token runs out, so the check belongs to each message.
create or replace function social_chat_recipients(p_chat uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.profile_id from chat_members m
  join auth.users u on u.id = m.profile_id and u.banned_at is null
  where m.chat_id = p_chat and m.left_at is null and has_plus(m.profile_id)
$$;

-- ===== Family plan =====

-- Typing a phone number used to return that account's name, so any payer could look people up by number.
-- Family and friends appear by name. Someone else appears to the payer, who typed the number, by its last four digits.
create function plan_member_label(p_profile uuid, p_payer uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_profile = auth.uid() or p_profile = p_payer or p_profile in (select social_circle()) then p.display_name
    when auth.uid() = p_payer then '******' || right(coalesce(p.login_phone, ''), 4)
    else ''
  end
  from profiles p where p.id = p_profile
$$;

create or replace function plan_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  f family_plans;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'PT401'; end if;
  select * into f from family_plans
  where id in (select my_plan_ids())
  order by (status in ('trial', 'active', 'grace')) desc, (payer_id = me) desc, last_event_at desc nulls last
  limit 1;
  if not found then
    return jsonb_build_object('plus', false, 'status', null, 'store', null, 'product_id', null, 'renews_at', null,
      'trial_ends_at', null, 'will_renew', false, 'is_payer', false, 'members', '[]'::jsonb,
      'trial_eligible', true);
  end if;
  return jsonb_build_object(
    'plus', has_plus(me),
    'status', f.status,
    'store', f.store,
    'product_id', f.product_id,
    'renews_at', f.renews_at,
    'trial_ends_at', f.trial_ends_at,
    'will_renew', f.will_renew,
    'is_payer', f.payer_id = me,
    'trial_eligible', not exists (select 1 from family_plans x where x.payer_id = me and x.trial_ends_at is not null),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'display_name', plan_member_label(p.id, f.payer_id), 'is_payer', p.id = f.payer_id)
                       order by (p.id = f.payer_id) desc, p.display_name)
      from family_plan_members m join profiles p on p.id = m.profile_id
      where m.plan_id = f.id and p.deleted_at is null
    ), '[]'::jsonb)
  );
end $$;

-- The answers below still say whether a number is on AYWO, so tries are limited per account. A refusal rolls back its
-- transaction, which would forget a wrong number, so the route counts each try in a transaction of its own first.
-- Server only: no grant, no policy.
create table plan_member_tries (
  payer_id uuid not null references profiles (id) on delete cascade,
  tried_at timestamptz not null default now()
);
create index plan_member_tries_idx on plan_member_tries (payer_id, tried_at desc);
alter table plan_member_tries enable row level security;

create function plan_member_try(p_payer uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from plan_member_tries t where t.payer_id = p_payer and t.tried_at > now() - interval '1 day') >= 30 then
    return false;
  end if;
  insert into plan_member_tries (payer_id) values (p_payer);
  return true;
end $$;

-- Same as 0007, with the name rule above.
create or replace function plan_add_member(p_phone text default null, p_profile uuid default null, p_person uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  plan_id_now uuid;
  target uuid;
  person_tree uuid;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'PT401'; end if;
  if num_nonnulls(p_phone, p_profile, p_person) <> 1 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;

  select id into plan_id_now from family_plans
  where payer_id = me and status in ('trial', 'active', 'grace')
  order by last_event_at desc nulls last limit 1 for update;
  if plan_id_now is null then
    if exists (select 1 from family_plans where payer_id = me) then
      raise exception 'plan_not_active' using errcode = 'PT409';
    end if;
    raise exception 'plan_not_payer' using errcode = 'PT403';
  end if;

  if p_phone is not null then
    select id into target from profiles where login_phone = p_phone and deleted_at is null;
  elsif p_profile is not null then
    select id into target from profiles where id = p_profile and deleted_at is null;
  else
    select claimed_by, tree_id into target, person_tree from persons where id = p_person and deleted_at is null;
    if person_tree is null or not can_view_tree(person_tree) then
      raise exception 'plan_member_not_found' using errcode = 'PT404';
    end if;
    if target is null then
      raise exception 'plan_person_not_on_aywo' using errcode = 'PT422';
    end if;
  end if;
  if target is null then
    raise exception 'plan_member_not_found' using errcode = 'PT404';
  end if;
  if target = me then
    raise exception 'plan_member_is_you' using errcode = 'PT422';
  end if;
  if has_plus(target) then
    raise exception 'plan_member_already_has_plus' using errcode = 'PT409';
  end if;

  insert into family_plan_members (plan_id, profile_id) values (plan_id_now, me) on conflict do nothing;
  insert into family_plan_members (plan_id, profile_id) values (plan_id_now, target);
  insert into notifications (recipient_id, kind, payload)
  values (target, 'plan_member_added', jsonb_build_object('plan_id', plan_id_now, 'by', me));

  return jsonb_build_object('profile_id', target, 'display_name', plan_member_label(target, me));
end $$;

-- ===== Deleting an account =====

-- Same as 0010, plus everything from 0007 and 0009 and the rest of what the person left behind. The profile is only
-- blanked, so foreign key cascades never fire: each table has to be cleared here by hand.
create or replace function account_delete(p_plan_acknowledged boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_phone text;
  t trees;
  heir uuid;
  passed int := 0;
  closed int := 0;
  my_chats uuid[];
begin
  if me is null or not exists (select 1 from profiles where id = me and deleted_at is null) then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not coalesce(p_plan_acknowledged, false) and exists (
    select 1 from family_plans f
    where f.payer_id = me and f.status in ('trial', 'active', 'grace') and f.will_renew
  ) then
    raise exception 'plan_cancel_first' using errcode = 'PT409';
  end if;
  perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
  select login_phone into my_phone from profiles where id = me;

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

  delete from person_contacts c using persons p where c.person_id = p.id and p.claimed_by = me;
  update trees set creator_person_id = null
  where creator_person_id in (select id from persons where claimed_by = me);
  update persons c set photo_path = null
  from profiles pr
  where pr.id = me and c.claimed_by = me and c.photo_path = pr.photo_path;
  update persons set claimed_by = null where claimed_by = me;
  update trees set successor_id = null where successor_id = me;

  update shares set revoked_at = now() where grantee_profile_id = me and revoked_at is null;
  update requests set status = 'expired', decided_at = now(), note = 'account_deleted' where requester_id = me and status = 'pending';
  delete from comments where author_id = me;
  delete from notifications where recipient_id = me;
  delete from notification_prefs where profile_id = me;
  delete from consents where profile_id = me;
  delete from family_plan_members where profile_id = me;
  delete from device_tokens where profile_id = me;

  -- Live location first: nothing about where this person was stays behind. Others' SOS lists lose them too.
  delete from sos_events where profile_id = me;
  delete from sos_event_contacts where contact_profile_id = me;
  delete from sos_contacts where profile_id = me or contact_profile_id = me;

  -- Chat. Messages leave their words behind for nobody; the others keep a 'deleted' marker so a thread still reads.
  select coalesce(array_agg(chat_id), '{}') into my_chats from chat_members where profile_id = me;
  update messages set sender_id = null, body = null, media_path = null, media_kind = null, media_ms = null, client_id = null,
    deleted_at = coalesce(deleted_at, now())
  where sender_id = me;
  delete from chat_members where profile_id = me;
  update chats set created_by = null where created_by = me;
  delete from chats c where c.id = any (my_chats) and not exists (select 1 from chat_members m where m.chat_id = c.id);

  -- Memories. reactions has no foreign key to what it reacts to.
  delete from reactions r using post_comments c
  where r.target_type = 'comment' and r.target_id = c.id
    and (c.author_id = me or c.post_id in (select id from posts where author_id = me));
  delete from reactions r using posts p where r.target_type = 'post' and r.target_id = p.id and p.author_id = me;
  delete from reactions where profile_id = me;
  delete from post_comments where author_id = me;
  delete from post_media where added_by = me;
  delete from post_tags where profile_id = me;
  delete from post_collaborators where profile_id = me;
  delete from posts where author_id = me;

  -- Friends groups go on under the longest-standing member; an empty one goes.
  delete from group_members where profile_id = me;
  update groups g set created_by = (select m.profile_id from group_members m where m.group_id = g.id order by m.joined_at, m.profile_id limit 1)
  where g.created_by = me and exists (select 1 from group_members m where m.group_id = g.id);
  delete from groups where created_by = me;

  -- Invites. Those still to come are called off for the people invited.
  insert into notifications (recipient_id, kind, payload)
  select i.profile_id, 'invite_cancelled', jsonb_build_object('event_id', e.id, 'title', e.title)
  from events e join event_invitees i on i.event_id = e.id
  where e.host_id = me and e.cancelled_at is null and (e.starts_at is null or e.starts_at > now()) and i.profile_id <> me;
  delete from events where host_id = me;
  delete from event_invitees where profile_id = me;
  delete from rsvps where profile_id = me;
  delete from poll_votes where profile_id = me;

  delete from alerts where sender_id = me;
  delete from alert_recipients where profile_id = me;

  -- What other people's inboxes kept of this person's name and words.
  update notifications set payload = payload - 'from_name' - 'body' where payload ->> 'by' = me::text;

  -- An import preview is a whole family's names, dates and notes.
  delete from imports where created_by = me;
  delete from term_reports where reporter_id = me;
  update kin_terms set submitted_by = null where submitted_by = me;
  -- The money record stays for the accounts. The delivery address and phone do not.
  update one_time_orders set buyer_id = null, details = details - 'shipping' where buyer_id = me;
  delete from plan_member_tries where payer_id = me;
  delete from app_admin_permissions where profile_id = me;
  delete from app_admins where profile_id = me;

  update profiles set display_name = '', login_phone = null, email = null, photo_path = null, last_active_at = null, deleted_at = now() where id = me;
  update auth.users set phone = null, email = null, phone_confirmed_at = null, raw_user_meta_data = '{}', banned_at = now() where id = me;
  update auth.refresh_tokens set revoked_at = now() where user_id = me and revoked_at is null;
  if my_phone is not null then
    delete from auth.otp_codes where phone = my_phone;
  end if;

  return jsonb_build_object('deleted', true, 'trees_passed_on', passed, 'trees_closed', closed);
end $$;

-- ===== Grants =====

revoke all on function sos_events_limit(), alerts_limit(), plan_member_label(uuid, uuid), plan_member_try(uuid),
  history_revert(bigint, uuid)
  from public, anon, authenticated;
grant execute on function history_revert(bigint, uuid) to authenticated;
