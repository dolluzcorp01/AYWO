-- PR 53: the duplicate scan finishes in about a second on a big family, not a minute.
--
-- The scan looked at every pair of people with similar names and worked out each pair's score with six small
-- queries. In a family that shares a surname nearly every pair has a similar name: 1,000 people gave about
-- 500,000 pairs, and the scan took close to a minute. It also runs at the end of every import, so bringing in a
-- 1,000-person file took over a minute and the app, which waits 90 seconds, was close to saying "failed".
--
-- The score and the rules are the same as merge_score. Two things changed:
--   * Each person's parents and partners are read once, and the score is worked out in the same query.
--   * A pair can only pass 0.85 when the two share a birth date, a parent or a partner (a name alone gives at most
--     0.6, and the same birth year with the same death year adds 0.2), so only those pairs are scored.

create or replace function merge_scan_tree(p_tree uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  tree_creator uuid;
  r record;
  req uuid;
  n int := 0;
begin
  select creator_id into tree_creator from trees where id = p_tree and deleted_at is null;
  if tree_creator is null then return 0; end if;
  for r in
    with parents as (
      select pc.child_id as id, array_agg(pc.parent_id) as ids
      from parent_child pc join persons c on c.id = pc.child_id
      where c.tree_id = p_tree group by pc.child_id
    ),
    partners as (
      select x.id, array_agg(x.other) as ids
      from (
        select u.partner1_id as id, u.partner2_id as other from unions u where u.tree_id = p_tree
        union all
        select u.partner2_id, u.partner1_id from unions u where u.tree_id = p_tree
      ) x
      where x.id is not null group by x.id
    ),
    people as materialized (
      select p.id, p.name_normalized as name, p.gender, p.claimed_by, p.birth_date, p.death_date,
             extract(year from p.birth_date) as born, extract(year from p.death_date) as died,
             pa.ids as parents, sp.ids as partners
      from persons p
      left join parents pa on pa.id = p.id
      left join partners sp on sp.id = p.id
      where p.tree_id = p_tree and p.deleted_at is null and not p.name_unknown
    ),
    scored as (
      select a.id as aid, b.id as bid,
        round(greatest(least(
          0.6 * (case when a.name = b.name then 1 else extensions.similarity(a.name, b.name) end)::numeric
          + case when a.birth_date is null or b.birth_date is null then 0
                 when a.birth_date = b.birth_date then 0.3
                 when a.born = b.born then 0.15
                 when abs(a.born - b.born) > 2 then -0.4
                 else 0 end
          + case when a.death_date is null or b.death_date is null then 0
                 when a.died = b.died then 0.05
                 when abs(a.died - b.died) > 2 then -0.4
                 else 0 end
          + case when a.parents is null or b.parents is null then 0
                 when a.parents && b.parents then 0.3
                 else -0.3 end
          + case when a.partners && b.partners then 0.3 else 0 end,
        1), 0), 2) as score
      from people a
      join people b on a.id < b.id
        and (a.birth_date = b.birth_date or a.parents && b.parents or a.partners && b.partners)
        and (a.name = b.name or a.name operator(extensions.%) b.name)
      where not (a.gender in ('male', 'female') and b.gender in ('male', 'female') and a.gender <> b.gender)
        and not (a.claimed_by is not null and b.claimed_by is not null)
    )
    select s.aid, s.bid, s.score
    from scored s
    where s.score > 0.85
      and not exists (select 1 from person_closure c where (c.ancestor_id = s.aid and c.descendant_id = s.bid) or (c.ancestor_id = s.bid and c.descendant_id = s.aid))
      and not exists (select 1 from unions u where (u.partner1_id = s.aid and u.partner2_id = s.bid) or (u.partner1_id = s.bid and u.partner2_id = s.aid))
      and not exists (
        select 1 from requests q where q.tree_id = p_tree and q.kind = 'merge'
          and q.payload ->> 'person_a' = s.aid::text and q.payload ->> 'person_b' = s.bid::text
      )
  loop
    insert into requests (tree_id, kind, requester_id, target_person_id, payload)
    values (p_tree, 'merge', tree_creator, r.bid, jsonb_build_object('person_a', r.aid, 'person_b', r.bid, 'score', r.score))
    returning id into req;
    perform notify_tree_managers(p_tree, 'merge_candidate', jsonb_build_object('request_id', req, 'tree_id', p_tree));
    n := n + 1;
  end loop;
  return n;
end $$;
