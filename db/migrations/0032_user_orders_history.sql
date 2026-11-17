-- PR 37: My orders shows the buyer where the parcel is going and a reference to quote to Support.
-- Same rows as before (the buyer's own paid or refunded orders), with two things added:
--   shipping     the delivery address the buyer typed. Razorpay orders store it flat; Stripe stores the lines
--                under "address". Both come back in one flat shape. Null for things that are not posted.
--   payment_ref  the payment service's own id for the payment, as printed on the bank or card statement.
create or replace function my_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'product', o.product, 'amount_minor', o.amount_minor, 'currency', o.currency,
      'discount_minor', o.discount_minor, 'status', o.status, 'fulfilment', o.fulfilment, 'carrier', o.carrier,
      'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url, 'created_at', o.created_at, 'paid_at', o.paid_at,
      'quantity', coalesce((o.details ->> 'quantity')::int, 1),
      'payment_ref', o.payment_id,
      'shipping', case when jsonb_typeof(o.details -> 'shipping') = 'object' then jsonb_build_object(
        'name', o.details #>> '{shipping,name}',
        'line1', coalesce(o.details #>> '{shipping,address,line1}', o.details #>> '{shipping,line1}'),
        'line2', coalesce(o.details #>> '{shipping,address,line2}', o.details #>> '{shipping,line2}'),
        'city', coalesce(o.details #>> '{shipping,address,city}', o.details #>> '{shipping,city}'),
        'state', coalesce(o.details #>> '{shipping,address,state}', o.details #>> '{shipping,state}'),
        'postal_code', coalesce(o.details #>> '{shipping,address,postal_code}', o.details #>> '{shipping,postal_code}'),
        'country', coalesce(o.details #>> '{shipping,address,country}', o.details #>> '{shipping,country}')) end
    ) order by o.created_at desc), '[]'::jsonb)
  from one_time_orders o where o.buyer_id = social_me() and o.status in ('paid', 'refunded')
$$;

revoke all on function my_orders() from public, anon;
grant execute on function my_orders() to authenticated;
