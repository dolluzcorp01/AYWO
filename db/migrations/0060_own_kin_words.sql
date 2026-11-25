-- Your own word for one relative.
--
-- "We use a different word" used to only send the word to staff. Approving it changed nothing the person could see:
-- the dictionary is shared by everyone who speaks the language, so one family's word cannot replace "Brother" for
-- all of them, and the card kept the old word for ever. The person was also told only that the word "was reviewed".
--
-- Now the word is kept for that person, on that one card, and shows at once. Nobody else sees it: every relative
-- stands in a different place in the tree and has their own word for the same person. The word still goes to staff,
-- and once approved other families can pick it from the suggestions.

create table kin_word_choices (
  user_id uuid not null references profiles (id) on delete cascade,
  person_id uuid not null references persons (id) on delete cascade,
  tree_id uuid not null references trees (id) on delete cascade,
  term text not null check (char_length(trim(term)) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (user_id, person_id)
);
create index kin_word_choices_tree_idx on kin_word_choices (tree_id, user_id);

grant select, insert, update, delete on kin_word_choices to authenticated;
alter table kin_word_choices enable row level security;

create policy kin_word_choices_read on kin_word_choices for select using (user_id = auth.uid());
create policy kin_word_choices_delete on kin_word_choices for delete using (user_id = auth.uid());
-- Only for a person you can see, and filed under that person's own tree.
create policy kin_word_choices_insert on kin_word_choices for insert with check (
  user_id = auth.uid() and exists (select 1 from persons p where p.id = person_id and p.tree_id = kin_word_choices.tree_id and p.deleted_at is null)
);
create policy kin_word_choices_update on kin_word_choices for update using (user_id = auth.uid()) with check (
  user_id = auth.uid() and exists (select 1 from persons p where p.id = person_id and p.tree_id = kin_word_choices.tree_id and p.deleted_at is null)
);

-- As before (0035). The notice now carries the card the word was set on, so a tap opens it, and the corrected
-- spelling when staff changed it.
create or replace function admin_kin_review(p_id uuid, p_decision text, p_term text default null, p_native text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k kin_terms;
  target term_status_t;
  new_word text := nullif(trim(coalesce(p_term, '')), '');
  new_native text := nullif(trim(coalesce(p_native, '')), '');
  corrected boolean;
  card record;
begin
  perform admin_require(array['dictionary']);
  if p_decision not in ('approve', 'reject') or char_length(coalesce(new_word, '')) > 120 or char_length(coalesce(new_native, '')) > 120 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  target := case when p_decision = 'approve' then 'verified'::term_status_t else 'rejected'::term_status_t end;
  select * into k from kin_terms where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  corrected := p_decision = 'approve' and new_word is not null
               and (new_word is distinct from k.term or new_native is distinct from k.term_native);
  if k.status = target and not corrected then
    raise exception 'admin_already_decided' using errcode = 'PT409';
  end if;
  begin
    update kin_terms set status = target,
      term = case when corrected then new_word else term end,
      term_native = case when corrected then new_native else term_native end
    where id = p_id;
  exception when unique_violation then
    -- The corrected spelling is already in the dictionary for this relationship and language.
    raise exception 'kin_term_exists' using errcode = 'PT409';
  end;
  perform admin_log(case when p_decision = 'reject' then 'kin_term.rejected' when k.status = target then 'kin_term.corrected' else 'kin_term.approved' end,
    'kin_term', p_id::text, null,
    case when corrected then jsonb_build_object('word_before', k.term, 'word', new_word) else '{}'::jsonb end);
  -- Only a first decision tells the person who sent the word.
  if k.submitted_by is not null and k.status = 'pending' then
    select c.person_id, c.tree_id into card
    from kin_word_choices c join persons p on p.id = c.person_id and p.deleted_at is null
    where c.user_id = k.submitted_by and aywo_normalize(c.term) = k.normalized_term
    order by c.created_at desc limit 1;
    insert into notifications (recipient_id, kind, payload)
    values (k.submitted_by, 'kin_term_reviewed',
            jsonb_strip_nulls(jsonb_build_object(
              'term', case when corrected then new_word else k.term end,
              'sent_as', case when corrected and new_word is distinct from k.term then k.term end,
              'decision', p_decision,
              'on_card', card.person_id is not null,
              'person_id', card.person_id, 'tree_id', card.tree_id)));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- As before (0035). The person who reported the word is now told what was decided; they heard nothing before. A
-- corrected word that is already in the dictionary gives a clear refusal instead of a server error.
create or replace function admin_term_report_decide(p_id uuid, p_decision text, p_new_term text default null, p_new_native text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  term_id uuid;
  state text;
  reporter uuid;
  old_word text;
  new_word text := nullif(trim(coalesce(p_new_term, '')), '');
begin
  perform admin_require(array['dictionary']);
  if p_decision not in ('accept', 'dismiss') or char_length(coalesce(new_word, '')) > 120 or char_length(coalesce(p_new_native, '')) > 120 then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  select r.kin_term_id, r.status, r.reporter_id into term_id, state, reporter from term_reports r where r.id = p_id for update;
  if term_id is null then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if state <> 'open' then
    raise exception 'admin_already_decided' using errcode = 'PT409';
  end if;
  select term into old_word from kin_terms where id = term_id;
  if p_decision = 'accept' then
    if new_word is not null then
      begin
        update kin_terms set term = new_word, term_native = nullif(trim(coalesce(p_new_native, '')), ''), status = 'verified'
        where id = term_id;
      exception when unique_violation then
        raise exception 'kin_term_exists' using errcode = 'PT409';
      end;
    else
      update kin_terms set status = 'rejected' where id = term_id;
    end if;
  end if;
  update term_reports set status = case when p_decision = 'accept' then 'accepted' else 'dismissed' end,
    decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  perform admin_log(case when p_decision = 'accept' then 'term_report.accepted' else 'term_report.dismissed' end,
    'term_report', p_id::text, null,
    jsonb_build_object('kin_term_id', term_id, 'word_replaced', p_decision = 'accept' and new_word is not null));
  if reporter is not null then
    insert into notifications (recipient_id, kind, payload)
    values (reporter, 'term_report_decided',
            jsonb_strip_nulls(jsonb_build_object('term', old_word, 'decision', p_decision,
              'new_term', case when p_decision = 'accept' then new_word end)));
  end if;
  return jsonb_build_object('ok', true);
end $$;
