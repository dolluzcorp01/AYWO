-- PR 43: the website's front page sends people to the Android and iPhone apps. Staff set the two store links in
-- Admin > App settings > App store links. An empty link means that app is not in its store yet, and the front page
-- then says "Coming soon" instead of showing a button that opens nothing.

alter table app_config drop constraint app_config_key_check;
alter table app_config add constraint app_config_key_check
  check (key in ('min_version', 'latest_version', 'maintenance', 'features', 'whats_new', 'support', 'store_links'));
insert into app_config (key, value) values ('store_links', '{"android": "", "ios": ""}');

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
  update app_config set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  perform admin_log('config.changed', 'config', p_key, cleaned, jsonb_build_object('value', p_value));
  return jsonb_build_object('ok', true);
end $$;
