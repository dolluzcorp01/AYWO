-- PR 65: fixes from checking PRs 52-64.
--
-- 1. Sharing a tree again with someone who already had it (to change what they may do) threw them out of the tree's
--    family chats: the old share is ended a moment before the new one is saved, and the check ran in between. The same
--    happened to whoever inherits a tree when its owner's account is deleted. The check now runs when the whole change
--    is finished.
-- 2. When the person who made a family chat lost the tree, nobody was left who could rename or close the chat. It now
--    passes to the longest-standing member, as it does when the maker leaves by choice (0045).
-- 3. An order was marked "code used beyond its limit" when the buyer's earlier order with that code had been refunded,
--    although the code had rightly been offered again.
-- 4. A number that pressed "This text is not for me" still got the all-clear text of the running SOS.
-- 5. The live signal for a new notification says who it is for, so the API does not look up every row of a notice
--    sent to everyone only to find that nobody it is for has the app open.

create or replace function shares_leave_tree_chats() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c record;
  heir uuid;
begin
  if new.revoked_at is not null and old.revoked_at is null and new.grantee_profile_id is not null
     and not exists (select 1 from trees t where t.id = new.tree_id and t.creator_id = new.grantee_profile_id)
     and not exists (
       select 1 from shares s
       where s.tree_id = new.tree_id and s.grantee_profile_id = new.grantee_profile_id and s.id <> new.id
         and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
     ) then
    for c in
      update chat_members m set left_at = now()
      from chats ch
      where ch.id = m.chat_id and ch.tree_id = new.tree_id and m.profile_id = new.grantee_profile_id and m.left_at is null
      returning ch.id, ch.kind, ch.created_by
    loop
      if c.kind <> 'direct' and c.created_by = new.grantee_profile_id then
        select m.profile_id into heir from chat_members m
        where m.chat_id = c.id and m.left_at is null
        order by m.joined_at, m.profile_id limit 1;
        if heir is not null then
          update chats set created_by = heir where id = c.id;
        end if;
      end if;
    end loop;
  end if;
  return null;
end $$;

-- Deferred: it runs when the change is complete, so a replacement share or a new owner is already in place.
drop trigger shares_leave_tree_chats on shares;
create constraint trigger shares_leave_tree_chats after update of revoked_at on shares
  deferrable initially deferred
  for each row execute function shares_leave_tree_chats();

create or replace function apply_order_event(
  p_store store_t, p_order uuid, p_external text, p_status text,
  p_amount_minor bigint default null, p_currency text default null, p_payment_id text default null, p_details jsonb default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  o one_time_orders;
  over_limit boolean := false;
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
    -- The money has arrived, so the order is paid whatever happened to it meanwhile. One that takes the person past
    -- the code's limit (an earlier unpaid order paid late) is marked for staff. Counted the way coupon_quote counts:
    -- paid orders only, so a refunded order gives the code back.
    if o.coupon_id is not null and o.buyer_id is not null then
      select (select count(*) from one_time_orders x
              where x.coupon_id = o.coupon_id and x.buyer_id = o.buyer_id and x.id <> o.id and x.status = 'paid')
             >= c.per_user_limit
      into over_limit from coupons c where c.id = o.coupon_id;
    end if;
    update one_time_orders set status = 'paid', paid_at = now(), payment_id = coalesce(p_payment_id, payment_id),
      details = details || coalesce(p_details, '{}'::jsonb)
                || case when coalesce(over_limit, false) then '{"coupon_over_limit": true}'::jsonb else '{}'::jsonb end
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

-- The all-clear goes to the same list as the alarm. A number that has said stop is on that list without its number.
create or replace function sos_targets(p_event uuid)
returns table (event_owner uuid, owner_name text, owner_language text, position_no smallint, profile_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select e.profile_id, social_name(e.profile_id), o.language_code, c.position, c.contact_profile_id,
         case when c.contact_profile_id is null and exists (select 1 from sos_number_stops s where s.phone = c.phone)
              then null else c.phone end
  from sos_events e
  join profiles o on o.id = e.profile_id
  join sos_event_contacts c on c.event_id = e.id
  where e.id = p_event
  order by c.position
$$;

create or replace function notifications_announce() returns trigger
language plpgsql as $$
begin
  perform pg_notify('aywo_chat', json_build_object('notification_id', new.id, 'recipient_id', new.recipient_id)::text);
  return null;
end $$;
