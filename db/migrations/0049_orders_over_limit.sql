-- PR 56: staff see an order that used a code beyond its limit.
--
-- 0043 marks an order paid late, after the same person had already used the code (details.coupon_over_limit).
-- The mark was saved and shown nowhere. The Orders list now carries it, so staff can refund the difference or let it be.
-- The function is 0035's with that one value added.

create or replace function admin_orders_list(p_fulfilment text default null, p_q text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(p_fulfilment, '');
  q text := nullif(trim(coalesce(p_q, '')), '');
  -- A phone number is matched on its digits alone, so "98400 12345" finds "+919840012345". Four digits at least,
  -- and only when nothing but a number was typed, or every order would match a stray "1".
  digits text := case when q ~ '^[0-9+() -]+$' and length(regexp_replace(q, '\D', '', 'g')) >= 4
                      then regexp_replace(q, '\D', '', 'g') end;
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['orders', 'payments']);
  with hits as (
    select o.*, b.display_name as buyer_name,
           coalesce(o.details #>> '{shipping,address,city}', o.details #>> '{shipping,city}') as ship_city,
           coalesce(o.details #>> '{shipping,address,country}', o.details #>> '{shipping,country}') as ship_country
    from one_time_orders o left join profiles b on b.id = o.buyer_id
    where o.status in ('paid', 'refunded')
      and (wanted is null or o.fulfilment = wanted)
      and (q is null
           or o.id::text = lower(q) or o.buyer_id::text = lower(q)
           -- The short order number shown in the list: the first 8 characters of the id.
           or left(o.id::text, 8) = lower(q)
           or lower(o.tracking_number) = lower(q)
           or lower(o.payment_id) = lower(q)
           or b.display_name ilike admin_like(q)
           or o.details #>> '{shipping,name}' ilike admin_like(q)
           or coalesce(o.details #>> '{shipping,address,city}', o.details #>> '{shipping,city}') ilike admin_like(q)
           or (digits is not null and (
                regexp_replace(coalesce(b.login_phone, ''), '\D', '', 'g') like '%' || digits || '%'
                or regexp_replace(coalesce(o.details #>> '{shipping,phone}', ''), '\D', '', 'g') like '%' || digits || '%')))
  )
  select (select count(*)::int from hits),
         (select coalesce(jsonb_agg(jsonb_build_object(
            'id', x.id, 'order_no', upper(left(x.id::text, 8)),
            'product', x.product, 'store', x.store, 'amount_minor', x.amount_minor, 'currency', x.currency,
            'discount_minor', x.discount_minor, 'coupon', (select c.code from coupons c where c.id = x.coupon_id),
            'coupon_over_limit', coalesce((x.details ->> 'coupon_over_limit')::boolean, false),
            'status', x.status, 'fulfilment', x.fulfilment, 'carrier', x.carrier, 'tracking_number', x.tracking_number,
            'tracking_url', x.tracking_url,
            'quantity', coalesce((x.details ->> 'quantity')::int, 1),
            'city', x.ship_city, 'country', x.ship_country,
            'buyer_id', x.buyer_id, 'buyer_name', x.buyer_name,
            'created_at', x.created_at, 'paid_at', x.paid_at, 'fulfilment_at', x.fulfilment_at, 'refunded_at', x.refunded_at,
            'can_refund', x.status = 'paid' and x.payment_id is not null,
            'work_id', (select w.id from work_items w where w.kind = 'order' and w.ref_id = x.id)
          ) order by x.paid_at desc nulls last, x.id), '[]'::jsonb)
          from (select * from hits order by paid_at desc nulls last, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows,
    'counts', (select jsonb_object_agg(f, (select count(*) from one_time_orders o where o.status = 'paid' and o.fulfilment = f))
               from unnest(array['queued', 'printing', 'shipped', 'delivered', 'cancelled']) f));
end $$;
