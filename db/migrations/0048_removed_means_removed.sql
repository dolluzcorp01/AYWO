-- PR 56: someone who is removed stays removed.
--
-- 1. A person removed from a friends group could walk back in with the old join link. Removing someone now makes a
--    new link; the maker shares the new one with whoever should still be able to join.
-- 2. A relative whose access to a tree was removed stayed in that tree's family chats and went on reading them.
--    They now leave those chats, unless another share still gives them the tree.

create or replace function group_remove_member(p_group uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := social_me();
begin
  if p_profile <> me and not exists (select 1 from groups g where g.id = p_group and g.created_by = me) then
    raise exception 'not_allowed' using errcode = 'PT403';
  end if;
  delete from group_members where group_id = p_group and profile_id = p_profile;
  -- Removed by the maker (not someone leaving by their own choice): the old link must not let them back in.
  if found and p_profile <> me then
    update groups set invite_token = social_random_token() where id = p_group;
  end if;
end $$;

create function shares_leave_tree_chats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.revoked_at is not null and old.revoked_at is null and new.grantee_profile_id is not null
     and not exists (select 1 from trees t where t.id = new.tree_id and t.creator_id = new.grantee_profile_id)
     and not exists (
       select 1 from shares s
       where s.tree_id = new.tree_id and s.grantee_profile_id = new.grantee_profile_id and s.id <> new.id
         and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
     ) then
    update chat_members m set left_at = now()
    from chats c
    where c.id = m.chat_id and c.tree_id = new.tree_id and m.profile_id = new.grantee_profile_id and m.left_at is null;
  end if;
  return null;
end $$;
create trigger shares_leave_tree_chats after update of revoked_at on shares
  for each row execute function shares_leave_tree_chats();

-- A trigger only: nobody calls it directly.
revoke all on function shares_leave_tree_chats() from public, anon, authenticated;
