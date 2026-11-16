-- PR 28: things a person runs into. A removed card keeps nobody in the tree, deleting an account really clears it,
-- nobody else can untag you, an SOS can pick its location back up, an invite's place can be cleared, and a store
-- subscription moved to another account keeps working.

-- ===== 1. A deleted card gives its account no rights =====
-- Deleting a wrongly claimed person is how a Creator takes that account out of the tree. The card was soft-deleted with
-- claimed_by still set, and these checks did not look at deleted_at, so the account stayed a viewer of the whole tree.
-- (claimed_by is kept on purpose: undoing the delete brings the claim back with the card.)

create or replace function tree_role(p_tree uuid, p_person uuid default null) returns tree_role_t
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  best tree_role_t := 'none';
  r share_role_t;
begin
  if me is null then return 'none'; end if;
  if not exists (select 1 from trees t where t.id = p_tree and t.deleted_at is null) then return 'none'; end if;
  if exists (select 1 from trees t where t.id = p_tree and t.creator_id = me) then
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
    where c.tree_id = p_tree and c.claimed_by = me and c.deleted_at is null and pc.descendant_id = p_person
  ) then
    best := 'editor';
  end if;
  if best = 'none' and exists (
    select 1 from persons c where c.tree_id = p_tree and c.claimed_by = me and c.deleted_at is null
  ) then
    best := 'viewer';
  end if;
  return best;
end $$;

create or replace function can_edit(p_tree uuid, p_person uuid default null) returns boolean
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
    where c.tree_id = p_tree and c.claimed_by = me and c.deleted_at is null and pc.descendant_id = p_person
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

-- The list on Home and Me: a tree where the person's only link was a card that has since been removed is not theirs.
create or replace function my_trees() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  update profiles set last_active_at = now()
  where id = me and (last_active_at is null or last_active_at < now() - interval '1 hour');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'name', x.name, 'role', x.role_now, 'joined', x.joined, 'branch_only', x.whole_role = 'none',
      'people', case when x.whole_role <> 'none'
        then (select count(*) from persons p where p.tree_id = x.id and p.deleted_at is null)
        else (select count(*) from persons p where p.tree_id = x.id and p.deleted_at is null and tree_role(x.id, p.id) <> 'none')
      end
    ) order by x.joined desc)
    from (
      select t.id, t.name, tree_role(t.id) as whole_role,
        greatest(tree_role(t.id), (
          select max(s.role::text::tree_role_t) from shares s
          where s.tree_id = t.id and s.grantee_profile_id = me and s.revoked_at is null
            and (s.expires_at is null or s.expires_at > now())
        )) as role_now,
        case when t.creator_id = me then t.created_at else coalesce((
          select min(s.created_at) from shares s
          where s.tree_id = t.id and s.grantee_profile_id = me and s.revoked_at is null
        ), t.created_at) end as joined
      from trees t
      where t.deleted_at is null and (
        t.creator_id = me
        or exists (
          select 1 from shares s where s.tree_id = t.id and s.grantee_profile_id = me and s.revoked_at is null
            and (s.expires_at is null or s.expires_at > now())
        )
        or exists (select 1 from persons c where c.tree_id = t.id and c.claimed_by = me and c.deleted_at is null)
      )
    ) x
  ), '[]'::jsonb);
end $$;

-- ===== 2. Untag: the author removes any tag; anyone else only their own =====
-- Before, passing your own profile id passed the check, and the delete then also matched whichever person id was sent:
-- anyone could untag anyone, on any memory.
create or replace function post_remove_tag(p_post uuid, p_person uuid default null, p_profile uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  is_author boolean;
  my_person boolean;
begin
  if p_person is null and p_profile is null then raise exception 'bad_input' using errcode = 'PT422'; end if;
  is_author := exists (select 1 from posts where id = p_post and author_id = me and deleted_at is null);
  my_person := p_person is not null and exists (select 1 from persons x where x.id = p_person and x.claimed_by = me);
  if is_author then
    delete from post_tags t where t.post_id = p_post
      and ((p_person is not null and t.person_id = p_person) or (p_profile is not null and t.profile_id = p_profile));
  elsif my_person or p_profile = me then
    delete from post_tags t where t.post_id = p_post
      and ((my_person and t.person_id = p_person) or (p_profile = me and t.profile_id = me));
  else
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  if not found then raise exception 'not_found' using errcode = 'PT404'; end if;
end $$;

-- ===== 3. Closing a help ticket closes its staff task only when the ticket was yours =====
create or replace function ticket_close(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update support_tickets set status = 'closed', closed_at = now(), updated_at = now()
  where id = p_ticket and profile_id = social_me() and status <> 'closed';
  if found then perform work_close('ticket', p_ticket); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ===== 4. An invite's place and note can be cleared =====
-- Nothing sent (null) leaves a field as it is. An empty text clears the place or the note; the title, the time and the
-- design link cannot be emptied.
create or replace function event_update(
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
    place = case when p_place is null then place else nullif(trim(p_place), '') end,
    note = case when p_note is null then note else nullif(trim(p_note), '') end,
    canva_url = coalesce(nullif(trim(coalesce(p_canva_url, '')), ''), canva_url)
  where id = p_event and host_id = me and cancelled_at is null
  returning * into e;
  if e.id is null then raise exception 'not_allowed' using errcode = 'PT403'; end if;
  perform social_notify((select coalesce(array_agg(i.profile_id), '{}') from event_invitees i where i.event_id = p_event),
    'invite_changed', jsonb_build_object('event_id', e.id, 'title', e.title, 'by', me, 'from_name', social_name(me)));
end $$;

-- ===== 5. An SOS can pick its live location back up =====
-- The key the phone sends locations with is given once, in the answer to "start". If that answer was lost on a bad
-- connection, or the SOS is opened on another phone, there was no way to send location for the rest of the SOS.
-- This gives the owner a new key for their own running SOS; the old key stops working.
create function sos_resume(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := social_me();
  write_token text := social_random_token();
  e sos_events;
begin
  update sos_events set write_hash = social_hash_token(write_token)
  where id = p_event and profile_id = me and ended_at is null and ends_at > now()
  returning * into e;
  if e.id is null then return null; end if;
  return jsonb_build_object('write_token', write_token, 'ends_at', e.ends_at);
end $$;
revoke all on function sos_resume(uuid) from public, anon, authenticated;
grant execute on function sos_resume(uuid) to authenticated;

-- ===== 6. A store subscription moved to another account keeps working =====
-- "Restore purchases" on a second login moves the subscription. When the receiving account already had a row for that
-- store (an old, ended subscription), the sender's live plan was ended and the receiver's old row was left ended:
-- a paid subscription gave nobody AYWO Plus until the next renewal. Now the receiver's row takes the live plan over.
create or replace function apply_plan_transfer(p_from uuid, p_to uuid, p_event_at timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare
  r family_plans;
  t family_plans;
  member uuid;
  moved int := 0;
begin
  if p_from = p_to then return 0; end if;
  if not exists (select 1 from profiles where id = p_to) then return 0; end if;
  for r in
    select * from family_plans
    where external_id = p_from::text and store in ('apple', 'google') for update
  loop
    select * into t from family_plans where store = r.store and external_id = p_to::text for update;
    if found then
      if r.status in ('trial', 'active', 'grace') and (t.last_event_at is null or t.last_event_at <= p_event_at) then
        update family_plans set product_id = r.product_id, status = r.status, trial_ends_at = r.trial_ends_at,
          renews_at = r.renews_at, will_renew = r.will_renew, last_event_at = p_event_at
        where id = t.id;
        insert into family_plan_members (plan_id, profile_id) values (t.id, p_to) on conflict do nothing;
        -- The family on the plan comes along, as far as there is room (six in all).
        for member in
          select m.profile_id from family_plan_members m where m.plan_id = r.id and m.profile_id not in (p_from, p_to)
        loop
          exit when (select count(*) from family_plan_members m where m.plan_id = t.id) >= 6;
          insert into family_plan_members (plan_id, profile_id) values (t.id, member) on conflict do nothing;
        end loop;
      end if;
      update family_plans set status = 'expired', will_renew = false, last_event_at = p_event_at where id = r.id;
    else
      delete from family_plan_members where plan_id = r.id and profile_id = p_from;
      update family_plans set payer_id = p_to, external_id = p_to::text, last_event_at = p_event_at where id = r.id;
      insert into family_plan_members (plan_id, profile_id) values (r.id, p_to) on conflict do nothing;
    end if;
    moved := moved + 1;
  end loop;
  return moved;
end $$;
revoke all on function apply_plan_transfer(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ===== 7. Deleting an account clears what was added after the delete function was written =====
-- account_delete last changed in 0011. Everything 0012 and later added about a person stayed behind for good:
-- the emergency health card, help tickets, blocks, invitations by code, email codes. The profile row is only blanked,
-- never removed, so 'on delete cascade' on those tables never ran.
alter function account_delete(boolean) rename to account_delete_inner;
revoke all on function account_delete_inner(boolean) from public, anon, authenticated;

create function account_delete(p_plan_acknowledged boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  answer jsonb;
begin
  -- First, so that a refusal (not signed in, or a plan that must be cancelled first) changes nothing at all.
  answer := account_delete_inner(p_plan_acknowledged);

  -- Health details: blood group, allergies, conditions, medicines.
  delete from emergency_cards where profile_id = me;
  -- Help tickets and everything written in them, and the staff tasks that pointed at them.
  delete from work_items w where w.kind = 'ticket' and w.ref_id in (select t.id from support_tickets t where t.profile_id = me);
  delete from support_tickets where profile_id = me;
  delete from user_blocks where blocker_id = me or blocked_id = me;
  delete from referrals where referred_id = me or referrer_id = me;
  -- A report stays for the staff record, without the reporter's own words or name on it.
  update content_reports set reporter_id = null, note = null where reporter_id = me;
  delete from announcement_views where profile_id = me;
  -- Holds the email address a code was sent to.
  delete from email_codes where profile_id = me;
  update client_errors set profile_id = null where profile_id = me;
  update profiles set referral_code = null, plus_bonus_until = null, marketing_opt_in = false, marketing_opt_in_at = null,
    email_verified_at = null
  where id = me;
  -- consent_events is kept: it is the proof of what was agreed to and when, and holds nothing but the account's id.
  return answer;
end $$;
revoke all on function account_delete(boolean) from public, anon, authenticated;
grant execute on function account_delete(boolean) to authenticated;
