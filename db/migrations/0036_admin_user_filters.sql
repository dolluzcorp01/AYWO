-- PR 38: the dashboard's "Active in 30 days", "New in 7 days" and "People who want offers" cards open the Users
-- list already narrowed to those accounts. Each filter uses the same rule as the dashboard count beside it.
-- Only the allowed-filter check and the filter itself change; create or replace keeps the grants from 0034.

CREATE OR REPLACE FUNCTION public.admin_users_list(p_q text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_filter text DEFAULT 'all'::text, p_sort text DEFAULT 'newest'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q text := nullif(trim(coalesce(p_q, '')), '');
  digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  only_these text := coalesce(nullif(p_filter, ''), 'all');
  sorted_by text := coalesce(nullif(p_sort, ''), 'newest');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['users', 'support']);
  if only_these not in ('all', 'blocked', 'plus', 'staff', 'active30', 'new7', 'offers') or sorted_by not in ('newest', 'active', 'name') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  with hits as (
    select p.id, p.display_name, p.login_phone, p.email, p.created_at, p.last_active_at, p.deleted_at, u.banned_at
    from profiles p join auth.users u on u.id = p.id
    where (q is null
       or p.display_name ilike admin_like(q)
       or p.id::text = lower(q)
       or lower(p.email) = lower(q)
       or (char_length(digits) >= 7 and regexp_replace(coalesce(p.login_phone, ''), '\D', '', 'g') like '%' || digits))
      and case only_these
            when 'blocked' then u.banned_at is not null
            when 'plus' then has_plus(p.id)
            when 'staff' then exists (select 1 from app_admins a where a.profile_id = p.id)
            when 'active30' then p.last_active_at > now() - interval '30 days'
            when 'new7' then p.created_at > now() - interval '7 days'
            when 'offers' then p.marketing_opt_in and p.deleted_at is null
            else true end
  ), page as (
    -- Accounts with no name, or never active, go last in their sort. Newest first settles every tie.
    select h.*, row_number() over (order by
        case when sorted_by = 'name' then lower(nullif(trim(h.display_name), '')) end asc nulls last,
        case when sorted_by = 'active' then h.last_active_at end desc nulls last,
        h.created_at desc, h.id) as place
    from hits h
    order by place limit admin_limit(p_limit) offset admin_offset(p_offset)
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'display_name', x.display_name,
        'phone_masked', admin_mask_phone(x.login_phone),
        'email_masked', admin_mask_email(x.email),
        'created_at', x.created_at,
        'last_active_at', x.last_active_at,
        'deleted', x.deleted_at is not null,
        'blocked_at', x.banned_at,
        'trees_created', (select count(*) from trees t where t.creator_id = x.id and t.deleted_at is null),
        'plus', has_plus(x.id),
        'staff_role', (select a.role from app_admins a where a.profile_id = x.id)
      ) order by x.place), '[]'::jsonb)
     from page x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $function$;
