-- AYWO Plus, family plan, one-time orders, device push tokens (LLD L3, L10, L11).
-- Rule: only signed webhooks change family_plans. They reach it through apply_plan_event, which the app cannot call.

-- ===== Additions to existing tables =====
alter table family_plans
  add column will_renew boolean not null default true,
  add column last_event_at timestamptz;   -- newest provider event applied, so late or repeated ones change nothing
create unique index family_plans_external_idx on family_plans (store, external_id);
create index family_plans_payer_idx on family_plans (payer_id);
create index family_plan_members_profile_idx on family_plan_members (profile_id);

alter table notifications add column delivery_attempts smallint not null default 0;
create index notifications_undelivered_idx on notifications (created_at) where channels_sent is null;

-- ===== New tables =====
create table device_tokens (
  expo_push_token text primary key,
  profile_id uuid not null references profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index device_tokens_profile_idx on device_tokens (profile_id);

-- Expo answers 'was it delivered' later; dead tokens are found from these (services/push.ts).
create table push_tickets (
  ticket_id text primary key,
  expo_push_token text not null,
  created_at timestamptz not null default now()
);

-- Replay protection. The row is written in the same transaction as the change it guards,
-- so a failed attempt leaves no row and the provider's retry still works.
create table webhook_events (
  provider text not null check (provider in ('razorpay', 'stripe', 'revenuecat')),
  event_id text not null,
  event_type text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table one_time_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references profiles (id) on delete set null,   -- the money record outlives a deleted account
  product text not null check (product in ('tree_poster', 'family_book', 'premium_invite')),
  store store_t not null,
  amount_minor bigint not null check (amount_minor >= 0),      -- paise or cents; set by the server, never by the app
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'expired', 'refunded')),
  external_id text,
  payment_id text,
  tree_id uuid references trees (id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (store, external_id)
);
create index one_time_orders_buyer_idx on one_time_orders (buyer_id, created_at desc);

-- ===== Rules =====
alter table device_tokens enable row level security;
alter table push_tickets enable row level security;
alter table webhook_events enable row level security;
alter table one_time_orders enable row level security;

-- push_tickets and webhook_events: no policy and no grant, so clients cannot touch them.
-- The token itself and provider ids are not granted: nothing in the app needs to read them back.
grant select (profile_id, platform, created_at, last_seen_at) on device_tokens to authenticated;
create policy device_tokens_own on device_tokens for select using (profile_id = auth.uid());

grant select (id, buyer_id, product, store, amount_minor, currency, status, tree_id, created_at, paid_at)
  on one_time_orders to authenticated;
create policy one_time_orders_own on one_time_orders for select using (buyer_id = auth.uid());

-- ===== Server-only functions: webhooks and jobs =====
create function record_webhook_event(p_provider text, p_event_id text, p_event_type text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into webhook_events (provider, event_id, event_type) values (p_provider, p_event_id, p_event_type)
  on conflict do nothing;
  return found;
end $$;

-- When two events carry the same timestamp, the later stage of a subscription's life wins.
create function plan_status_rank(p_status plan_status_t) returns int
language sql immutable set search_path = public as $$
  select case p_status when 'trial' then 1 when 'active' then 2 when 'grace' then 3 when 'cancelled' then 4 else 5 end
$$;

create function notify_plan_status(p_plan family_plans, p_old plan_status_t) returns void
language plpgsql security definer set search_path = public as $$
declare
  kind text;
begin
  if p_old is not distinct from p_plan.status then return; end if;
  -- A first event that already says 'ended' is a late delivery, not news.
  if p_old is null and p_plan.status in ('expired', 'cancelled') then return; end if;
  kind := case p_plan.status
    when 'trial' then 'plan_trial_started'
    when 'active' then 'plan_active'
    when 'grace' then 'plan_payment_failed'
    else 'plan_ended' end;
  insert into notifications (recipient_id, kind, payload)
  values (p_plan.payer_id, kind, jsonb_build_object(
    'plan_id', p_plan.id, 'product_id', p_plan.product_id,
    'ends_at', coalesce(p_plan.trial_ends_at, p_plan.renews_at), 'renews_at', p_plan.renews_at));
  if kind = 'plan_ended' then
    insert into notifications (recipient_id, kind, payload)
    select m.profile_id, 'plan_ended_member', jsonb_build_object('plan_id', p_plan.id, 'by', p_plan.payer_id)
    from family_plan_members m
    where m.plan_id = p_plan.id and m.profile_id <> p_plan.payer_id;
  end if;
end $$;

-- The only writer of family_plans. Returns created, applied, stale or unknown_profile.
-- Out-of-order safe: an event older than the newest one applied changes nothing. An 'ended' event that arrives
-- first still creates the row, so the older 'active' that follows it cannot switch Plus on.
create function apply_plan_event(
  p_store store_t, p_external_id text, p_payer uuid, p_product text, p_status plan_status_t,
  p_trial_ends timestamptz, p_renews timestamptz, p_will_renew boolean, p_event_at timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  cur family_plans;
  old_status plan_status_t;
begin
  select * into cur from family_plans where store = p_store and external_id = p_external_id for update;
  if not found then
    if p_payer is null or not exists (select 1 from profiles where id = p_payer) then
      return 'unknown_profile';
    end if;
    insert into family_plans (payer_id, store, product_id, status, trial_ends_at, renews_at, external_id, will_renew, last_event_at)
    values (p_payer, p_store, p_product, p_status, p_trial_ends, p_renews, p_external_id, p_will_renew, p_event_at)
    on conflict (store, external_id) do nothing
    returning * into cur;
    if found then
      insert into family_plan_members (plan_id, profile_id) values (cur.id, p_payer);
      -- A new subscription after an old one ended keeps the family that was on it.
      if p_status in ('trial', 'active', 'grace') then
        insert into family_plan_members (plan_id, profile_id)
        select cur.id, m.profile_id from family_plan_members m
        where m.profile_id <> p_payer and m.plan_id = (
          select f.id from family_plans f
          where f.payer_id = p_payer and f.id <> cur.id and f.status in ('expired', 'cancelled')
          order by f.last_event_at desc nulls last limit 1
        );
      end if;
      perform notify_plan_status(cur, null);
      return 'created';
    end if;
    select * into cur from family_plans where store = p_store and external_id = p_external_id for update;
  end if;

  if cur.last_event_at is not null and (
    p_event_at < cur.last_event_at
    or (p_event_at = cur.last_event_at and plan_status_rank(p_status) < plan_status_rank(cur.status))
  ) then
    return 'stale';
  end if;

  old_status := cur.status;
  update family_plans set
    product_id = coalesce(p_product, product_id),
    status = p_status,
    trial_ends_at = coalesce(p_trial_ends, trial_ends_at),
    renews_at = coalesce(p_renews, renews_at),
    will_renew = p_will_renew,
    last_event_at = p_event_at
  where id = cur.id
  returning * into cur;
  perform notify_plan_status(cur, old_status);
  return 'applied';
end $$;

-- RevenueCat moved a store subscription to another AYWO account (Restore purchases on another login).
create function apply_plan_transfer(p_from uuid, p_to uuid, p_event_at timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare
  r family_plans;
  moved int := 0;
begin
  if not exists (select 1 from profiles where id = p_to) then return 0; end if;
  for r in
    select * from family_plans
    where external_id = p_from::text and store in ('apple', 'google') for update
  loop
    if exists (select 1 from family_plans where store = r.store and external_id = p_to::text) then
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

-- Returns paid, already, amount_mismatch, refunded, failed, expired, ignored or unknown_order.
-- States only move forward, so events arriving in any order, or twice, end in the same place.
create function apply_order_event(
  p_store store_t, p_order uuid, p_external text, p_status text,
  p_amount_minor bigint default null, p_currency text default null, p_payment_id text default null, p_details jsonb default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  o one_time_orders;
begin
  select * into o from one_time_orders
  where store = p_store and ((p_order is not null and id = p_order) or (p_external is not null and external_id = p_external))
  limit 1 for update;
  if not found then return 'unknown_order'; end if;

  if p_status = 'paid' then
    if o.status in ('paid', 'refunded') then return 'already'; end if;
    if p_amount_minor is distinct from o.amount_minor or upper(p_currency) is distinct from o.currency then
      return 'amount_mismatch';
    end if;
    update one_time_orders set status = 'paid', paid_at = now(), payment_id = coalesce(p_payment_id, payment_id),
      details = details || coalesce(p_details, '{}'::jsonb)
    where id = o.id;
    if o.buyer_id is not null then
      insert into notifications (recipient_id, kind, payload)
      values (o.buyer_id, 'order_paid', jsonb_build_object('order_id', o.id, 'product', o.product));
    end if;
    return 'paid';
  elsif p_status = 'refunded' then
    if o.status = 'refunded' then return 'already'; end if;
    update one_time_orders set status = 'refunded' where id = o.id;
    return 'refunded';
  elsif p_status in ('failed', 'expired') then
    if o.status <> 'created' then return 'ignored'; end if;
    update one_time_orders set status = p_status where id = o.id;
    return p_status;
  end if;
  return 'ignored';
end $$;

-- Premium invite bought through Apple or Google: there is no order beforehand, the store's webhook is the record.
create function record_store_order(
  p_buyer uuid, p_store store_t, p_product text, p_external text, p_amount_minor bigint, p_currency text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if not exists (select 1 from profiles where id = p_buyer) then return false; end if;
  insert into one_time_orders (buyer_id, product, store, amount_minor, currency, status, external_id, paid_at)
  values (p_buyer, p_product, p_store, p_amount_minor, upper(p_currency), 'paid', p_external, now())
  on conflict (store, external_id) do nothing
  returning id into new_id;
  if new_id is null then return false; end if;
  insert into notifications (recipient_id, kind, payload)
  values (p_buyer, 'order_paid', jsonb_build_object('order_id', new_id, 'product', p_product));
  return true;
end $$;

-- LLD L11: 'Trial ending, 3 days before'. Asks only; never touches family_plans. Telling someone twice is prevented
-- by looking for the notification itself.
create function queue_trial_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  insert into notifications (recipient_id, kind, payload)
  select f.payer_id, 'trial_ending', jsonb_build_object('plan_id', f.id, 'product_id', f.product_id, 'ends_at', f.trial_ends_at)
  from family_plans f
  where f.status = 'trial' and f.will_renew
    and f.trial_ends_at > now() and f.trial_ends_at <= now() + interval '3 days'
    and not exists (
      select 1 from notifications x
      where x.recipient_id = f.payer_id and x.kind = 'trial_ending' and x.payload ->> 'plan_id' = f.id::text
    );
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function record_webhook_event(text, text, text) from public, anon, authenticated;
revoke all on function plan_status_rank(plan_status_t) from public, anon, authenticated;
revoke all on function notify_plan_status(family_plans, plan_status_t) from public, anon, authenticated;
revoke all on function apply_plan_event(store_t, text, uuid, text, plan_status_t, timestamptz, timestamptz, boolean, timestamptz) from public, anon, authenticated;
revoke all on function apply_plan_transfer(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function apply_order_event(store_t, uuid, text, text, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function record_store_order(uuid, store_t, text, text, bigint, text) from public, anon, authenticated;
revoke all on function queue_trial_reminders() from public, anon, authenticated;

-- ===== Functions for the signed-in person =====
-- What GET /plan shows. Names only: no phone number of anyone on the plan comes back.
create function plan_summary() returns jsonb
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
      select jsonb_agg(jsonb_build_object('profile_id', p.id, 'display_name', p.display_name, 'is_payer', p.id = f.payer_id)
                       order by (p.id = f.payer_id) desc, p.display_name)
      from family_plan_members m join profiles p on p.id = m.profile_id
      where m.plan_id = f.id and p.deleted_at is null
    ), '[]'::jsonb)
  );
end $$;

-- F-PAY-01. Exactly one of phone (already E.164), profile or a person on a tree the payer can see.
-- The row lock makes the limit of 6 hold when two adds race; the trigger from 0001 raises family_plan_full.
create function plan_add_member(p_phone text default null, p_profile uuid default null, p_person uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  plan_id_now uuid;
  target uuid;
  target_name text;
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

  -- The payer takes one of the six places.
  insert into family_plan_members (plan_id, profile_id) values (plan_id_now, me) on conflict do nothing;
  insert into family_plan_members (plan_id, profile_id) values (plan_id_now, target);
  insert into notifications (recipient_id, kind, payload)
  values (target, 'plan_member_added', jsonb_build_object('plan_id', plan_id_now, 'by', me));

  select display_name into target_name from profiles where id = target;
  return jsonb_build_object('profile_id', target, 'display_name', target_name);
end $$;

-- The payer removes someone, or a member leaves. The payer cannot leave their own plan: cancelling does that.
create function plan_remove_member(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n int;
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'PT401'; end if;
  if p_profile = me then
    delete from family_plan_members m using family_plans f
    where m.plan_id = f.id and m.profile_id = me and f.payer_id <> me;
    get diagnostics n = row_count;
    if n = 0 then
      if exists (select 1 from family_plans where payer_id = me) then
        raise exception 'plan_payer_cannot_leave' using errcode = 'PT422';
      end if;
      raise exception 'plan_member_not_found' using errcode = 'PT404';
    end if;
    return;
  end if;

  if not exists (select 1 from family_plans where payer_id = me) then
    raise exception 'plan_not_payer' using errcode = 'PT403';
  end if;
  delete from family_plan_members m using family_plans f
  where m.plan_id = f.id and m.profile_id = p_profile and f.payer_id = me;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'plan_member_not_found' using errcode = 'PT404';
  end if;
  insert into notifications (recipient_id, kind, payload)
  values (p_profile, 'plan_member_removed', jsonb_build_object('by', me));
end $$;

-- A phone that changes hands moves to whoever is signed in on it now.
create function register_device(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in' using errcode = 'PT401'; end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$' then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  insert into device_tokens (expo_push_token, profile_id, platform) values (p_token, me, p_platform)
  on conflict (expo_push_token) do update
    set profile_id = me, platform = excluded.platform, last_seen_at = now();
end $$;

create function unregister_device(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from device_tokens where expo_push_token = p_token and profile_id = auth.uid()
$$;

revoke all on function plan_summary() from public, anon, authenticated;
revoke all on function plan_add_member(text, uuid, uuid) from public, anon, authenticated;
revoke all on function plan_remove_member(uuid) from public, anon, authenticated;
revoke all on function register_device(text, text) from public, anon, authenticated;
revoke all on function unregister_device(text) from public, anon, authenticated;
grant execute on function plan_summary(), plan_add_member(text, uuid, uuid), plan_remove_member(uuid),
  register_device(text, text), unregister_device(text) to authenticated;
