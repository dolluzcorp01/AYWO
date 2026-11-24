-- PR 53: a code still works on the second try, and "one per person" holds.
--
-- Closing the payment box left an unpaid order behind, and for the next hour that order counted as the person's
-- one use: the second try said "You've already used that code". After the hour it stopped counting, so a pile of
-- unpaid orders could all be paid later, each with the discount.
--
-- Now a person's own unpaid order never blocks them: starting a new order with the same code replaces the earlier
-- unpaid one (the API marks it expired). And a payment that arrives for an order beyond the code's limit is
-- marked, so staff can see it and put it right.

create or replace function coupon_quote(p_code text, p_product text, p_amount_minor bigint, p_currency text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c coupons;
  used int;
  mine int;
  off bigint;
begin
  select * into c from coupons where code = upper(trim(coalesce(p_code, '')));
  if not found or not c.active then raise exception 'coupon_invalid' using errcode = 'PT422'; end if;
  if c.starts_at > now() or (c.ends_at is not null and c.ends_at < now()) then raise exception 'coupon_expired' using errcode = 'PT422'; end if;
  if not (p_product = any (c.products)) then raise exception 'coupon_not_for_product' using errcode = 'PT422'; end if;
  if c.kind = 'amount' and c.currency <> p_currency then raise exception 'coupon_not_for_product' using errcode = 'PT422'; end if;
  if p_amount_minor < c.min_amount_minor then raise exception 'coupon_min_amount' using errcode = 'PT422'; end if;
  if c.new_users_only and (me is null or exists (select 1 from one_time_orders o where o.buyer_id = me and o.status = 'paid')) then
    raise exception 'coupon_new_users_only' using errcode = 'PT422';
  end if;
  -- Everyone's paid orders count, and other people's orders started in the last hour (their payment may still be open).
  -- The person's own unpaid order does not: their next order takes its place.
  select count(*) filter (where o.status = 'paid' or o.buyer_id is distinct from me),
         count(*) filter (where o.buyer_id = me and o.status = 'paid')
  into used, mine
  from one_time_orders o
  where o.coupon_id = c.id and (o.status = 'paid' or (o.status = 'created' and o.created_at > now() - interval '1 hour'));
  if c.max_uses is not null and used >= c.max_uses then raise exception 'coupon_used_up' using errcode = 'PT422'; end if;
  if mine >= c.per_user_limit then raise exception 'coupon_already_used' using errcode = 'PT422'; end if;
  off := case when c.kind = 'percent' then (p_amount_minor * c.value) / 100 else c.value end;
  -- Payment providers need at least one rupee or one cent.
  off := least(off, greatest(p_amount_minor - 100, 0));
  return jsonb_build_object('coupon_id', c.id, 'code', c.code, 'title', c.title, 'discount_minor', off, 'final_minor', p_amount_minor - off);
end $$;

-- Returns paid, already, amount_mismatch, refunded, failed, expired, ignored or unknown_order.
-- States only move forward, so events arriving in any order, or twice, end in the same place.
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
    -- the code's limit (an earlier unpaid order paid late) is marked for staff.
    if o.coupon_id is not null and o.buyer_id is not null then
      select (select count(*) from one_time_orders x
              where x.coupon_id = o.coupon_id and x.buyer_id = o.buyer_id and x.id <> o.id and x.status in ('paid', 'refunded'))
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
