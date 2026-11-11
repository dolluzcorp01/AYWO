-- Deleting an account waits 30 days. "Delete my account" now books the deletion and signs the person out
-- everywhere; signing in again before the date shows a banner with "Keep my account". After 30 days the daily
-- job runs account_delete() as that person, exactly as an immediate delete did before. One wrong tap can no
-- longer take a family's history away for good.

alter table profiles add column delete_after timestamptz;
create index profiles_delete_after_idx on profiles (delete_after) where delete_after is not null and deleted_at is null;

-- POST /account/delete. The same paying-plan warning as account_delete, checked now while the person is here.
create function account_delete_request(p_plan_acknowledged boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  due timestamptz;
begin
  if me is null or not exists (select 1 from profiles where id = me and deleted_at is null) then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  if not coalesce(p_plan_acknowledged, false) and exists (
    select 1 from family_plans f
    where f.payer_id = me and f.status in ('trial', 'active', 'grace') and f.will_renew
  ) then
    raise exception 'plan_cancel_first' using errcode = 'PT409';
  end if;
  -- Asking twice keeps the first date: the 30 days do not start again.
  update profiles set delete_after = coalesce(delete_after, now() + interval '30 days')
  where id = me returning delete_after into due;
  -- Signed out on every phone: signing in again is how a person changes their mind.
  update auth.refresh_tokens set revoked_at = now() where user_id = me and revoked_at is null;
  return jsonb_build_object('delete_after', due);
end $$;

-- POST /account/keep: "Keep my account".
create function account_delete_cancel() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'PT401';
  end if;
  update profiles set delete_after = null where id = me and deleted_at is null;
  return my_account();
end $$;

-- For the daily job only: accounts whose 30 days are over.
create function accounts_due_for_deletion(p_limit int default 50) returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where delete_after <= now() and deleted_at is null order by delete_after limit p_limit
$$;

-- Same as 0010, plus delete_after, so the app can show the banner.
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
    'delete_after', p.delete_after
  ) into answer
  from profiles p where p.id = me and p.deleted_at is null;
  if answer is null then
    raise exception 'session_ended' using errcode = 'PT401';
  end if;
  return answer;
end $$;

revoke execute on function account_delete_request(boolean), account_delete_cancel(), accounts_due_for_deletion(int) from public, anon;
grant execute on function account_delete_request(boolean), account_delete_cancel() to authenticated;
revoke execute on function accounts_due_for_deletion(int) from authenticated;
