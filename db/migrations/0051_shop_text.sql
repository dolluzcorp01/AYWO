-- PR 58: staff set what each shop product is called and how it is described.
--
-- Admin could already change a product's pictures and price, but its name and description were fixed in the app.
-- shop_text holds staff's own words for each product, in English and Tamil. An empty part keeps the app's words.
-- Which products exist is still decided in the code: each one has its own printing and delivery steps.

alter table app_config drop constraint app_config_key_check;
alter table app_config add constraint app_config_key_check
  check (key in ('min_version', 'latest_version', 'maintenance', 'features', 'whats_new', 'support', 'store_links',
                 'publisher', 'emergency_numbers', 'faq', 'shop_text'));
insert into app_config (key, value) values ('shop_text', '{}');

create or replace function admin_config_set(p_key text, p_value jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cleaned text := admin_clean_reason(p_reason);
begin
  perform admin_require(array['settings']);
  if jsonb_typeof(p_value) <> 'object' then raise exception 'bad_input' using errcode = 'PT422'; end if;
  if p_key in ('min_version', 'latest_version') and exists (
      select 1 from jsonb_each_text(p_value) e where e.key not in ('ios', 'android') or e.value !~ '^\d{1,3}\.\d{1,3}\.\d{1,3}$') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_key = 'maintenance' and (jsonb_typeof(p_value -> 'on') <> 'boolean' or char_length(coalesce(p_value ->> 'message', '')) > 300) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if p_key = 'features' and exists (select 1 from jsonb_each(p_value) e where jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- Only the real stores: a link typed wrongly, or to anywhere else, must never sit behind a "Get the app" button.
  if p_key = 'store_links' and (
      p_value - 'android' - 'ios' <> '{}'::jsonb
      or coalesce(p_value ->> 'android', '') !~ '^(https://play\.google\.com/store/apps/details\?id=[A-Za-z0-9._]{3,100})?$'
      or coalesce(p_value ->> 'ios', '') !~ '^(https://apps\.apple\.com/[A-Za-z0-9/._-]{3,150})?$') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- Company and contact details on the public pages. Text only, short, and no key the pages do not know.
  if p_key = 'publisher' and (
      exists (select 1 from jsonb_each(p_value) e where e.key not in (
        'company', 'cin', 'gstin', 'address', 'email', 'phone', 'supportHours', 'grievanceOfficer', 'grievanceEmail',
        'courtCity', 'deliveryDays', 'refundDays', 'damageDays', 'refundWorkingDays', 'draft'))
      or exists (select 1 from jsonb_each(p_value) e where e.key <> 'draft'
                 and (jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 300))
      or jsonb_typeof(coalesce(p_value -> 'draft', 'true'::jsonb)) <> 'boolean') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- A wrong emergency number is dangerous: two-letter country, digits only, and India can never be left out.
  if p_key = 'emergency_numbers' and (
      not (p_value ? 'IN')
      or exists (select 1 from jsonb_each(p_value) e
                 where e.key !~ '^[A-Z]{2}$' or jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^[0-9]{2,6}$')) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- Extra questions staff add, and built-in ones they hide.
  if p_key = 'faq' and (
      p_value - 'items' - 'hidden' <> '{}'::jsonb
      or jsonb_typeof(coalesce(p_value -> 'items', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(p_value -> 'hidden', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(p_value -> 'items', '[]'::jsonb)) > 100
      or octet_length(p_value::text) > 200000
      or exists (select 1 from jsonb_array_elements(coalesce(p_value -> 'items', '[]'::jsonb)) i
                 where jsonb_typeof(i) <> 'object'
                    or coalesce(i ->> 'id', '') !~ '^[a-z0-9]{4,20}$'
                    or coalesce(i ->> 'group', '') not in ('start', 'tree', 'safety', 'plus', 'orders', 'account')
                    or char_length(coalesce(i #>> '{q,en}', '')) not between 3 and 300
                    or char_length(coalesce(i #>> '{a,en}', '')) not between 3 and 3000
                    or char_length(coalesce(i #>> '{q,ta}', '')) > 300
                    or char_length(coalesce(i #>> '{a,ta}', '')) > 3000)
      or exists (select 1 from jsonb_array_elements(coalesce(p_value -> 'hidden', '[]'::jsonb)) h
                 where jsonb_typeof(h) <> 'string' or (h #>> '{}') !~ '^[a-z]{2,20}\.[A-Za-z]{2,30}$')) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  -- Staff's own name and description for a shop product, in English and Tamil. Plain text, short.
  if p_key = 'shop_text' and (
      exists (select 1 from jsonb_each(p_value) e where e.key not in ('tree_poster', 'family_book', 'premium_invite')
                 or jsonb_typeof(e.value) <> 'object' or e.value - 'name' - 'about' <> '{}'::jsonb)
      or exists (select 1 from jsonb_each(p_value) e, jsonb_each(e.value) part
                 where jsonb_typeof(part.value) <> 'object' or part.value - 'en' - 'ta' <> '{}'::jsonb
                    or char_length(coalesce(part.value ->> 'en', '')) > (case when part.key = 'name' then 60 else 300 end)
                    or char_length(coalesce(part.value ->> 'ta', '')) > (case when part.key = 'name' then 60 else 300 end))) then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  update app_config set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_log('config.changed', 'config', p_key, cleaned, jsonb_build_object('value', p_value));
  return jsonb_build_object('ok', true);
end $$;
