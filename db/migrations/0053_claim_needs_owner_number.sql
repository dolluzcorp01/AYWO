-- PR 59: a card can only be taken through a number the tree's owner stands behind.
--
-- "Is this you?" offered a card to anyone signing in with a number saved on it. 0011 stopped a number the caller
-- typed in themselves from counting, but an editor with a second SIM could still put that second number on a
-- relative's card, sign in with it as a new account, and take the card: its saved numbers, the whole tree, and any
-- share waiting for that person. 0047 told the owner afterwards. This closes it:
--
-- A number proves a claim only when
--   * a Creator or Co-creator of the tree saved it on the card, or
--   * the tree is already shared with the person signing in (the owner chose them by their number).
-- An Editor can still save a cousin's number on the card. The cousin gets "Is this you?" once the owner shares the
-- tree with them, which is how relatives are invited anyway.

create or replace function claim_candidates()
returns table (person_id uuid, tree_id uuid, tree_name text, display_name text, photo_path text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, t.id, t.name, p.display_name, p.photo_path
  from person_contacts c
  join persons p on p.id = c.person_id
  join trees t on t.id = p.tree_id
  where c.kind in ('mobile', 'whatsapp')
    and c.value_normalized = my_verified_phone()
    and (c.created_by <> auth.uid() or is_creator_or_cocreator(t.id))
    and (
      c.created_by = t.creator_id
      or exists (
        select 1 from shares s
        where s.tree_id = t.id and s.grantee_profile_id = c.created_by and s.role = 'co_creator'
          and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      )
      or exists (
        select 1 from shares s
        where s.tree_id = t.id and s.grantee_profile_id = auth.uid()
          and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
      )
      or t.creator_id = auth.uid()
    )
    and p.claimed_by is null and p.deleted_at is null and t.deleted_at is null
    and not exists (select 1 from persons o where o.tree_id = t.id and o.claimed_by = auth.uid())
$$;
