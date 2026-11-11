-- 0016: Elder mode. A simple Home with a few big buttons, for parents and grandparents. Kept on the account so it
-- follows the person to a new phone, the same as large text.

alter table profiles add column simple_mode boolean not null default false;

-- Same as 0014, plus simple_mode.
create or replace function my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  answer jsonb;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  -- The successor rule reads this. An hour's accuracy is plenty.
  update profiles set last_active_at = now()
  where id = me and (last_active_at is null or last_active_at < now() - interval '1 hour');
  select jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'login_phone', p.login_phone, 'email', p.email,
    'language_code', p.language_code, 'large_text', p.large_text, 'photo_path', p.photo_path,
    'plus', has_plus(me),
    'plus_until', (
      select max(coalesce(f.renews_at, f.trial_ends_at)) from family_plans f
      left join family_plan_members m on m.plan_id = f.id
      where f.status in ('trial', 'active', 'grace') and (f.payer_id = me or m.profile_id = me)
    ),
    'admin_role', (select a.role::text from app_admins a where a.profile_id = me),
    'delete_after', p.delete_after,
    'simple_mode', p.simple_mode
  ) into answer
  from profiles p where p.id = me and p.deleted_at is null;
  if answer is null then
    raise exception 'session_ended' using errcode = 'PT401';
  end if;
  return answer;
end $$;

-- Same as 0010, plus simple_mode.
create or replace function me_update(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if p_patch ? 'display_name' and (coalesce(trim(p_patch ->> 'display_name'), '') = '' or char_length(p_patch ->> 'display_name') > 200) then
    raise exception 'name_required' using errcode = 'PT422';
  end if;
  if p_patch ? 'email' and p_patch ->> 'email' is not null and p_patch ->> 'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'email_invalid' using errcode = 'PT422';
  end if;
  if p_patch ? 'photo_path' and not photo_path_ok(p_patch ->> 'photo_path', me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  update profiles set
    display_name = case when p_patch ? 'display_name' then trim(p_patch ->> 'display_name') else display_name end,
    email = case when p_patch ? 'email' then lower(trim(p_patch ->> 'email')) else email end,
    language_code = case when p_patch ? 'language_code' then p_patch ->> 'language_code' else language_code end,
    large_text = case when p_patch ? 'large_text' then coalesce((p_patch ->> 'large_text')::boolean, false) else large_text end,
    simple_mode = case when p_patch ? 'simple_mode' then coalesce((p_patch ->> 'simple_mode')::boolean, false) else simple_mode end,
    photo_path = case when p_patch ? 'photo_path' then p_patch ->> 'photo_path' else photo_path end
  where id = me and deleted_at is null;
  if p_patch ->> 'photo_path' is not null then
    perform set_config('aywo.batch_id', gen_random_uuid()::text, true);
    update persons set photo_path = p_patch ->> 'photo_path'
    where claimed_by = me and deleted_at is null and photo_path is null;
  end if;
  return my_account();
end $$;
