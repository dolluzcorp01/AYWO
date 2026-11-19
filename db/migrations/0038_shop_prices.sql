-- PR 42: the prices of what the shop sells are set by staff in Admin > Offers > Shop prices, not in the server's code.
-- One row per product, with its price for buyers in India (rupees, in paise) and for everyone else (US dollars, in
-- cents). A change needs a reason and is written to the audit log with the old and the new price. An order keeps the
-- price it was made at, so a change only ever reaches orders started after it.

create table shop_prices (
  product text primary key check (product in ('tree_poster', 'family_book', 'premium_invite')),
  -- Razorpay takes nothing under 1 rupee and Stripe nothing under 50 cents. The top limits catch a slipped digit.
  inr_minor int not null check (inr_minor between 100 and 10000000),
  usd_minor int not null check (usd_minor between 50 and 200000),
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz
);
-- No row rules: nobody reads the table directly. The server reads it when it prices the shop and an order.
alter table shop_prices enable row level security;
insert into shop_prices (product, inr_minor, usd_minor) values
  ('tree_poster', 79900, 1999),
  ('family_book', 149900, 3999),
  ('premium_invite', 4900, 199);

create function admin_shop_prices_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['payments', 'marketing']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('product', s.product, 'inr_minor', s.inr_minor, 'usd_minor', s.usd_minor, 'updated_at', s.updated_at,
             'updated_by_name', (select p.display_name from profiles p where p.id = s.updated_by))
           order by array_position(array['tree_poster', 'family_book', 'premium_invite'], s.product))
    from shop_prices s), '[]'::jsonb);
end $$;

create function admin_shop_price_set(p_product text, p_inr_minor int, p_usd_minor int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text := admin_clean_reason(p_reason);
  before shop_prices;
begin
  perform admin_require(array['payments']);
  if p_inr_minor is null or p_usd_minor is null
     or p_inr_minor not between 100 and 10000000 or p_usd_minor not between 50 and 200000 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  select * into before from shop_prices where product = p_product for update;
  if before.product is null then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  -- Saving the same prices again is not a change and must not fill the audit log.
  if before.inr_minor = p_inr_minor and before.usd_minor = p_usd_minor then
    raise exception 'admin_nothing_changed' using errcode = 'PT422';
  end if;
  update shop_prices set inr_minor = p_inr_minor, usd_minor = p_usd_minor, updated_by = auth.uid(), updated_at = now() where product = p_product;
  perform admin_log('shop_price.changed', 'shop_price', p_product, cleaned, jsonb_build_object(
    'product', p_product,
    'rupees_before', (before.inr_minor / 100.0)::numeric(12, 2), 'rupees_now', (p_inr_minor / 100.0)::numeric(12, 2),
    'dollars_before', (before.usd_minor / 100.0)::numeric(12, 2), 'dollars_now', (p_usd_minor / 100.0)::numeric(12, 2)));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function admin_shop_prices_list(), admin_shop_price_set(text, int, int, text) from public, anon, authenticated;
grant execute on function admin_shop_prices_list(), admin_shop_price_set(text, int, int, text) to authenticated;
