-- PR 37: a takedown request that came in with only a name. Staff pick the person from a short list of matches
-- instead of typing a person id copied from the Trees page (which a Moderator cannot even open).
-- Name, tree, who made the tree and the birth year only: enough to tell two people of the same name apart,
-- never contacts, notes or photos. Every search is recorded.

create function admin_takedown_people(p_request uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  q text := trim(coalesce(p_name, ''));
  found_rows jsonb;
begin
  perform admin_require(array['takedowns']);
  if length(q) < 2 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  if not exists (select 1 from takedown_requests d where d.id = p_request) then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'name', x.display_name,
      'birth_year', x.birth_year,
      'tree_id', x.tree_id,
      'tree_name', x.tree_name,
      'creator_name', x.creator_name
    ) order by x.display_name, x.tree_name, x.id), '[]'::jsonb)
  into found_rows
  from (
    select p.id, p.display_name, extract(year from p.birth_date)::int as birth_year,
           t.id as tree_id, t.name as tree_name, c.display_name as creator_name
    from persons p
    join trees t on t.id = p.tree_id and t.deleted_at is null
    left join profiles c on c.id = t.creator_id
    where p.deleted_at is null and p.display_name ilike admin_like(q)
    order by p.display_name, t.name, p.id
    limit 20
  ) x;
  perform admin_log('takedown.person_search', 'takedown', p_request::text, null, jsonb_build_object('found', jsonb_array_length(found_rows)));
  return found_rows;
end $$;

revoke all on function admin_takedown_people(uuid, text) from public, anon, authenticated;
grant execute on function admin_takedown_people(uuid, text) to authenticated;
