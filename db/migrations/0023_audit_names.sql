-- PR 27. Audit log shows what was acted on by name (the word, the person, the tree), not only its id.

-- A readable name for an audit row's target. Ids that are not uuids, or types without a name, give null.
create function admin_target_name(p_type text, p_id text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  tid uuid;
begin
  if p_id is null or p_id !~ '^[0-9a-fA-F-]{36}$' then
    return null;
  end if;
  tid := p_id::uuid;
  return case p_type
    when 'kin_term' then (select term from kin_terms where kin_terms.id = tid)
    when 'user' then (select display_name from profiles where profiles.id = tid)
    when 'tree' then (select name from trees where trees.id = tid)
    when 'campaign' then (select title from campaigns where campaigns.id = tid)
    else null
  end;
exception when others then
  return null;
end $$;
revoke all on function admin_target_name(text, text) from public, anon, authenticated;

create or replace function admin_audit_list(p_action text default null, p_actor uuid default null, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(trim(coalesce(p_action, '')), '');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['audit']);
  select count(*)::int into total_rows from admin_audit_log l
  where (wanted is null or l.action ilike admin_like(wanted)) and (p_actor is null or l.actor_id = p_actor);
  select coalesce(jsonb_agg(jsonb_build_object(
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
  into page_rows
  from (
    select l.id, l.actor_id, p.display_name, l.action, l.target_type, l.target_id, l.reason, l.details, l.created_at
    from admin_audit_log l left join profiles p on p.id = l.actor_id
    where (wanted is null or l.action ilike admin_like(wanted)) and (p_actor is null or l.actor_id = p_actor)
    order by l.id desc limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;
