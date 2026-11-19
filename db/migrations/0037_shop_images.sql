-- PR 42: the pictures of what the shop sells (the family tree poster and the family book) are chosen by staff in
-- Admin > Offers > Shop pictures, not built into the app. Up to six for each product; the first one is the main
-- picture on the product card. Files live under shop/ in storage; a removed picture's file is cleared like any other.

create table shop_images (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('tree_poster', 'family_book')),
  path text not null unique check (path ~ '^shop/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  -- Lowest first. The lowest is the main picture.
  position int not null default 0,
  added_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index shop_images_product_idx on shop_images (product, position, created_at);
-- No row rules: nobody reads the table directly. The server reads it to sign the links the shop shows.
alter table shop_images enable row level security;

create function admin_shop_images_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['marketing']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'product', s.product, 'path', s.path, 'created_at', s.created_at,
             'added_by_name', (select p.display_name from profiles p where p.id = s.added_by))
           order by s.product, s.position, s.created_at)
    from shop_images s), '[]'::jsonb);
end $$;

create function admin_shop_image_add(p_product text, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  perform admin_require(array['marketing']);
  if p_product is null or p_product not in ('tree_poster', 'family_book')
     or p_path is null or p_path !~ '^shop/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
     or (select count(*) from shop_images where product = p_product) >= 6 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- A new picture goes to the end, so adding one never changes the main picture by surprise.
  insert into shop_images (product, path, position, added_by)
  values (p_product, p_path, coalesce((select max(position) + 1 from shop_images where product = p_product), 0), auth.uid())
  returning id into new_id;
  perform admin_log('shop_image.added', 'shop_image', p_product, null, jsonb_build_object('product', p_product));
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

create function admin_shop_image_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare gone shop_images;
begin
  perform admin_require(array['marketing']);
  delete from shop_images where id = p_id returning * into gone;
  if gone.id is null then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform storage_forget(gone.path, 'shop picture removed');
  perform admin_log('shop_image.removed', 'shop_image', gone.product, null, jsonb_build_object('product', gone.product));
  return jsonb_build_object('ok', true);
end $$;

create function admin_shop_image_first(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare chosen shop_images;
begin
  perform admin_require(array['marketing']);
  select * into chosen from shop_images where id = p_id;
  if chosen.id is null then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  update shop_images set position = (select min(position) - 1 from shop_images where product = chosen.product) where id = p_id;
  perform admin_log('shop_image.made_main', 'shop_image', chosen.product, null, jsonb_build_object('product', chosen.product));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function admin_shop_images_list(), admin_shop_image_add(text, text), admin_shop_image_remove(uuid), admin_shop_image_first(uuid)
from public, anon, authenticated;
grant execute on function admin_shop_images_list(), admin_shop_image_add(text, text), admin_shop_image_remove(uuid), admin_shop_image_first(uuid)
to authenticated;
