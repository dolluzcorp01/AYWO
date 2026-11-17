-- PR 37: the audit log can be searched with the words on the screen.
-- The search box used to match only the hidden action code ("user.blocked"). Now the typed words also match the
-- staff member's name and the reason, the screen sends the action codes whose plain-language label matches
-- ("Removed staff"), and the list can be cut down to a range of days.

drop function admin_audit_list(text, uuid, int, int);
create function admin_audit_list(
  p_action text default null,
  p_actor uuid default null,
  p_limit int default 25,
  p_offset int default 0,
  p_actions text[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(trim(coalesce(p_action, '')), '');
  -- "staff.removed" and "staff_removed" are the same action: the screen knows them by their label key.
  codes text[] := (select array_agg(replace(c, '.', '_')) from unnest(coalesce(p_actions, '{}')) c);
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['audit']);
  with hits as (
    select l.id, l.actor_id, p.display_name, l.action, l.target_type, l.target_id, l.reason, l.details, l.created_at
    from admin_audit_log l left join profiles p on p.id = l.actor_id
    where (wanted is null
           or replace(l.action, '.', '_') ilike admin_like(replace(wanted, '.', '_'))
           or replace(l.action, '.', '_') = any (coalesce(codes, '{}'))
           or p.display_name ilike admin_like(wanted)
           or l.reason ilike admin_like(wanted))
      and (p_actor is null or l.actor_id = p_actor)
      and (p_from is null or l.created_at >= p_from)
      and (p_to is null or l.created_at < p_to)
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'actor_id', x.actor_id,
        'actor_name', x.display_name,
        'action', x.action,
        'target_type', x.target_type,
        'target_id', x.target_id,
        'target_name', admin_target_name(x.target_type, x.target_id),
        'reason', x.reason,
        'details', x.details,
        'created_at', x.created_at
      ) order by x.id desc), '[]'::jsonb)
     from (select * from hits order by id desc limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

revoke all on function admin_audit_list(text, uuid, int, int, text[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function admin_audit_list(text, uuid, int, int, text[], timestamptz, timestamptz) to authenticated;
