-- PR 37: a note left on a person can be corrected or taken back by the one who wrote it.
-- The tree's Creator can also delete any note in their tree (but not reword someone else's).
create function person_comment_update(p_comment uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_body), '') = '' then
    raise exception 'comment_empty' using errcode = 'PT422';
  end if;
  update comments set body = trim(p_body) where id = p_comment and author_id = auth.uid();
  if not found then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
end $$;

create function person_comment_delete(p_comment uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from comments c
  where c.id = p_comment
    and (c.author_id = auth.uid() or exists (select 1 from trees t where t.id = c.tree_id and t.creator_id = auth.uid()));
  if not found then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
end $$;

revoke all on function person_comment_update(uuid, text), person_comment_delete(uuid) from public, anon;
grant execute on function person_comment_update(uuid, text), person_comment_delete(uuid) to authenticated;
