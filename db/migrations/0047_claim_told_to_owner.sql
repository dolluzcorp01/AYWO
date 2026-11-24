-- PR 54: the tree's owner always hears when someone takes a card as their own.
--
-- "Yes, this is me" told only whoever first added that person. An editor could add a relative, put a second number
-- of their own on the card, sign in with that number and take the card: the only notice went to the editor
-- themselves, and the owner, who can undo it, never knew. Now the Creator and Co-creators are told as well.

create or replace function claim_confirm(p_person uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  tree uuid;
  added_by uuid;
  told jsonb;
begin
  select c.tree_id into tree from claim_candidates() c where c.person_id = p_person;
  if tree is null then
    raise exception 'not_your_entry' using errcode = 'PT403';
  end if;
  update persons set claimed_by = me where id = p_person returning created_by into added_by;
  told := jsonb_build_object('person_id', p_person, 'tree_id', tree, 'by', me);
  insert into notifications (recipient_id, kind, payload)
  select who, 'claim_made', told
  from (
    select added_by as who
    union
    select t.creator_id from trees t where t.id = tree
    union
    select s.grantee_profile_id from shares s
    where s.tree_id = tree and s.role = 'co_creator' and s.grantee_profile_id is not null
      and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
  ) x
  where who is not null and who <> me;
  return tree;
end $$;
