-- PR 37: the business half of the staff console lets staff put right what they got wrong.
--   Orders      a mistyped tracking number can be corrected and a step clicked by mistake taken one step back;
--               search also finds an order by the buyer's name or phone, the city, the short order number or the
--               payment reference the buyer reads from their statement.
--   Offers      a coupon nobody used and a banner can be deleted.
--   Moderation  a "Keep it" on an abuse report and a dismissed takedown can be reopened. Removals stay final.
--               Both lists can also return one item whatever its state, for a link from the work queue.
--   Dictionary  a word can be corrected while it is approved, the lists can be searched, and decided
--               wrong-word reports can be looked at again.
--   Trees       search by the Creator's name.
--   Payments    search by the payer's name or phone.
--   Notices     the notices sent before, and how many people the next one reaches.

-- ===== Orders =====

-- Same parameters as before, so this replaces the function in place.
create or replace function admin_orders_list(p_fulfilment text default null, p_q text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(p_fulfilment, '');
  q text := nullif(trim(coalesce(p_q, '')), '');
  -- A phone number is matched on its digits alone, so "98400 12345" finds "+919840012345". Four digits at least,
  -- and only when nothing but a number was typed, or every order would match a stray "1".
  digits text := case when q ~ '^[0-9+() -]+$' and length(regexp_replace(q, '\D', '', 'g')) >= 4
                      then regexp_replace(q, '\D', '', 'g') end;
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['orders', 'payments']);
  with hits as (
    select o.*, b.display_name as buyer_name,
           coalesce(o.details #>> '{shipping,address,city}', o.details #>> '{shipping,city}') as ship_city,
           coalesce(o.details #>> '{shipping,address,country}', o.details #>> '{shipping,country}') as ship_country
    from one_time_orders o left join profiles b on b.id = o.buyer_id
    where o.status in ('paid', 'refunded')
      and (wanted is null or o.fulfilment = wanted)
      and (q is null
           or o.id::text = lower(q) or o.buyer_id::text = lower(q)
           -- The short order number shown in the list: the first 8 characters of the id.
           or left(o.id::text, 8) = lower(q)
           or lower(o.tracking_number) = lower(q)
           or lower(o.payment_id) = lower(q)
           or b.display_name ilike admin_like(q)
           or o.details #>> '{shipping,name}' ilike admin_like(q)
           or coalesce(o.details #>> '{shipping,address,city}', o.details #>> '{shipping,city}') ilike admin_like(q)
           or (digits is not null and (
                regexp_replace(coalesce(b.login_phone, ''), '\D', '', 'g') like '%' || digits || '%'
                or regexp_replace(coalesce(o.details #>> '{shipping,phone}', ''), '\D', '', 'g') like '%' || digits || '%')))
  )
  select (select count(*)::int from hits),
         (select coalesce(jsonb_agg(jsonb_build_object(
            'id', x.id, 'order_no', upper(left(x.id::text, 8)),
            'product', x.product, 'store', x.store, 'amount_minor', x.amount_minor, 'currency', x.currency,
            'discount_minor', x.discount_minor, 'coupon', (select c.code from coupons c where c.id = x.coupon_id),
            'status', x.status, 'fulfilment', x.fulfilment, 'carrier', x.carrier, 'tracking_number', x.tracking_number,
            'tracking_url', x.tracking_url,
            'quantity', coalesce((x.details ->> 'quantity')::int, 1),
            'city', x.ship_city, 'country', x.ship_country,
            'buyer_id', x.buyer_id, 'buyer_name', x.buyer_name,
            'created_at', x.created_at, 'paid_at', x.paid_at, 'fulfilment_at', x.fulfilment_at, 'refunded_at', x.refunded_at,
            'can_refund', x.status = 'paid' and x.payment_id is not null,
            'work_id', (select w.id from work_items w where w.kind = 'order' and w.ref_id = x.id)
          ) order by x.paid_at desc nulls last, x.id), '[]'::jsonb)
          from (select * from hits order by paid_at desc nulls last, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows,
    'counts', (select jsonb_object_agg(f, (select count(*) from one_time_orders o where o.status = 'paid' and o.fulfilment = f))
               from unnest(array['queued', 'printing', 'shipped', 'delivered', 'cancelled']) f));
end $$;

-- A shipped order whose tracking number or courier was typed wrongly. The buyer is told the order changed, so they
-- look at the right number. An empty courier or link clears it.
create function admin_order_correct_tracking(p_id uuid, p_carrier text, p_tracking text, p_tracking_url text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cleaned text;
  o one_time_orders;
  new_carrier text := nullif(trim(coalesce(p_carrier, '')), '');
  new_tracking text := nullif(trim(coalesce(p_tracking, '')), '');
  new_url text := nullif(trim(coalesce(p_tracking_url, '')), '');
begin
  perform admin_require(array['orders']);
  cleaned := admin_clean_reason(p_reason);
  select * into o from one_time_orders where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if o.status <> 'paid' or o.fulfilment <> 'shipped' then raise exception 'order_bad_step' using errcode = 'PT409'; end if;
  if new_tracking is null then raise exception 'order_tracking_required' using errcode = 'PT422'; end if;
  if char_length(new_tracking) > 80 or char_length(coalesce(new_carrier, '')) > 60 or char_length(coalesce(new_url, '')) > 300
     or (new_url is not null and new_url !~ '^https://') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  update one_time_orders set carrier = new_carrier, tracking_number = new_tracking, tracking_url = new_url where id = p_id;
  if o.buyer_id is not null then
    insert into notifications (recipient_id, kind, payload)
    values (o.buyer_id, 'order_update', jsonb_build_object('order_id', p_id, 'step', 'tracking_corrected', 'product', o.product));
  end if;
  perform admin_log('order.tracking_corrected', 'order', p_id::text, cleaned,
    jsonb_build_object('carrier_before', o.carrier, 'carrier', new_carrier, 'tracking_before', o.tracking_number, 'tracking', new_tracking));
  return jsonb_build_object('ok', true);
end $$;

-- One step back, for a step clicked by mistake: delivered to shipped, shipped to printing, printing to queued.
-- Never for a cancelled or refunded order. Going back from shipped takes the tracking details off, because the
-- parcel has not left; they are kept in the audit log.
create function admin_order_step_back(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cleaned text;
  o one_time_orders;
  back text;
begin
  perform admin_require(array['orders']);
  cleaned := admin_clean_reason(p_reason);
  select * into o from one_time_orders where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  back := case o.fulfilment when 'delivered' then 'shipped' when 'shipped' then 'printing' when 'printing' then 'queued' end;
  if o.status <> 'paid' or back is null then raise exception 'order_bad_step' using errcode = 'PT409'; end if;
  update one_time_orders set fulfilment = back, fulfilment_at = now(),
    carrier = case when back = 'printing' then null else carrier end,
    tracking_number = case when back = 'printing' then null else tracking_number end,
    tracking_url = case when back = 'printing' then null else tracking_url end
  where id = p_id;
  -- A delivered order had left the work queue. It is waiting for staff again.
  perform work_open('order', p_id, case o.product when 'tree_poster' then 'Print poster' else 'Print family book' end);
  update work_items set status = case when back = 'queued' then 'open' else 'in_progress' end, updated_at = now(),
    due_at = case when o.fulfilment = 'delivered' then now() + work_sla('order') else due_at end
  where kind = 'order' and ref_id = p_id and status in ('open', 'in_progress');
  if o.buyer_id is not null then
    insert into notifications (recipient_id, kind, payload)
    values (o.buyer_id, 'order_update', jsonb_build_object('order_id', p_id, 'step', 'step_undone', 'product', o.product));
  end if;
  perform admin_log('order.step_undone', 'order', p_id::text, cleaned,
    jsonb_build_object('from', o.fulfilment, 'to', back, 'carrier_before', o.carrier, 'tracking_before', o.tracking_number));
  return jsonb_build_object('ok', true, 'fulfilment', back);
end $$;

-- ===== Offers =====

-- Same as before, plus can_delete: no order was ever paid with the code, and nobody is paying with it right now.
create or replace function admin_coupons_list(p_view text default 'active') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['marketing']);
  return coalesce((
    select jsonb_agg(to_jsonb(c) - 'created_by' || jsonb_build_object(
      'uses', (select count(*) from one_time_orders o where o.coupon_id = c.id and o.status = 'paid'),
      'discount_given_minor', (select coalesce(sum(o.discount_minor), 0) from one_time_orders o where o.coupon_id = c.id and o.status = 'paid'),
      'can_delete', not exists (select 1 from one_time_orders o where o.coupon_id = c.id
                                and (o.status in ('paid', 'refunded') or (o.status = 'created' and o.created_at > now() - interval '1 hour'))),
      'running', c.active and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())) order by c.created_at desc)
    from coupons c
    where case coalesce(p_view, 'active') when 'all' then true
            when 'ended' then not c.active or (c.ends_at is not null and c.ends_at <= now())
            else c.active and (c.ends_at is null or c.ends_at > now()) end), '[]'::jsonb);
end $$;

-- A coupon made by mistake. One that took money off a real order stays, so that order still reads true: it can
-- only be switched off.
create function admin_coupon_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c coupons;
begin
  perform admin_require(array['marketing']);
  select * into c from coupons where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if exists (select 1 from one_time_orders o where o.coupon_id = p_id
             and (o.status in ('paid', 'refunded') or (o.status = 'created' and o.created_at > now() - interval '1 hour'))) then
    raise exception 'coupon_used_no_delete' using errcode = 'PT409';
  end if;
  delete from coupons where id = p_id;
  perform admin_log('coupon.deleted', 'coupon', p_id::text, null,
    jsonb_build_object('code', c.code, 'title', c.title, 'kind', c.kind, 'value', c.value, 'active', c.active));
  return jsonb_build_object('ok', true);
end $$;

-- A banner made by mistake. Its view counts go with it; what it said stays in the audit log.
create function admin_announcement_delete(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a announcements;
  views int;
begin
  perform admin_require(array['marketing']);
  select * into a from announcements where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  select count(*)::int into views from announcement_views v where v.announcement_id = p_id;
  delete from announcements where id = p_id;
  perform admin_log('announcement.deleted', 'announcement', p_id::text, null,
    jsonb_build_object('title', a.title, 'audience', a.audience, 'active', a.active, 'seen', views + a.visitor_views));
  return jsonb_build_object('ok', true);
end $$;

-- ===== Abuse reports =====

-- p_only: one report whatever its state, for the link from the work queue.
drop function admin_reports_list(text, int, int);
create function admin_reports_list(p_status text default 'open', p_limit int default 25, p_offset int default 0, p_only uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['moderation']);
  select count(*)::int into total_rows from content_reports r
  where case when p_only is not null then r.id = p_only else r.status = wanted end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'target_type', x.target_type, 'target_id', x.target_id, 'reason', x.reason, 'note', x.note,
      'status', x.status, 'created_at', x.created_at,
      'reporter_name', (select p.display_name from profiles p where p.id = x.reporter_id),
      'owner_id', x.target_owner,
      'owner_name', (select p.display_name from profiles p where p.id = x.target_owner),
      'owner_reports', (select count(*) from content_reports o where o.target_owner = x.target_owner and o.status = 'removed'),
      'owner_blocked', (select u.banned_at is not null from auth.users u where u.id = x.target_owner),
      'same_target', (select count(*) from content_reports o where o.target_type = x.target_type and o.target_id = x.target_id),
      'target', admin_report_target(x),
      'decision_note', x.decision_note, 'decided_at', x.decided_at,
      'decided_by_name', (select p.display_name from profiles p where p.id = x.decided_by),
      'work_id', (select w.id from work_items w where w.kind = 'report' and w.ref_id = x.id)
    ) order by x.created_at, x.id), '[]'::jsonb)
  into page_rows
  from (select * from content_reports r
        where case when p_only is not null then r.id = p_only else r.status = wanted end
        order by r.created_at, r.id limit admin_limit(p_limit) offset admin_offset(p_offset)) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- "Keep it" pressed by mistake: the report is open again and back in the work queue with a fresh 24 hours.
-- A report that removed something stays decided: the content is gone and the people who reported it were told.
create function admin_report_reopen(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r content_reports;
  cleaned text;
begin
  perform admin_require(array['moderation']);
  cleaned := admin_clean_reason(p_reason);
  select * into r from content_reports where id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if r.status = 'removed' then raise exception 'admin_decision_final' using errcode = 'PT409'; end if;
  if r.status = 'open' then raise exception 'admin_already_open' using errcode = 'PT409'; end if;
  begin
    update content_reports set status = 'open', decided_by = null, decided_at = null, decision_note = null where id = p_id;
  exception when unique_violation then
    -- The same person reported the same thing again after the first decision, and that report is open.
    raise exception 'admin_already_open' using errcode = 'PT409';
  end;
  perform work_open('report', p_id, 'Report: ' || r.reason || ' (' || replace(r.target_type, '_', ' ') || ')',
    case when r.reason in ('self_harm', 'violence', 'nudity') then 'urgent' when r.reason in ('harassment', 'hate') then 'high' else 'normal' end);
  update work_items set due_at = now() + work_sla('report'), overdue_notified_at = null, updated_at = now()
  where kind = 'report' and ref_id = p_id;
  perform admin_log('report.reopened', 'report', p_id::text, cleaned,
    jsonb_build_object('target_type', r.target_type, 'target_id', r.target_id, 'note_before', r.decision_note));
  return jsonb_build_object('ok', true);
end $$;

-- ===== Takedown requests =====

-- p_only: one request whatever its state, for the link from the work queue.
drop function admin_takedowns_list(text, int, int);
create function admin_takedowns_list(p_status text default 'open', p_limit int default 25, p_offset int default 0, p_only uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['takedowns']);
  select count(*)::int into total_rows from takedown_requests d
  where case when p_only is not null then d.id = p_only else d.status = wanted end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'requester_contact', x.requester_contact,
      'reason', x.reason,
      'status', x.status,
      'subject_name', x.subject_name,
      'person_id', x.person_id,
      'person_name', x.person_name,
      'tree_id', x.tree_id,
      'tree_name', x.tree_name,
      'decision_note', x.decision_note,
      'decided_at', x.decided_at,
      'decided_by_name', x.decided_by_name,
      'created_at', x.created_at
    ) order by x.created_at, x.id), '[]'::jsonb)
  into page_rows
  from (
    select d.id, d.requester_contact, d.reason, d.status, d.subject_name, d.person_id, p.display_name as person_name,
           t.id as tree_id, t.name as tree_name, d.decision_note, d.decided_at,
           s.display_name as decided_by_name, d.created_at
    from takedown_requests d
    left join persons p on p.id = d.person_id
    left join trees t on t.id = p.tree_id
    left join profiles s on s.id = d.decided_by
    where case when p_only is not null then d.id = p_only else d.status = wanted end
    order by d.created_at, d.id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- A request dismissed by mistake is open again and back in the work queue with a fresh 72 hours.
-- A request that removed a person stays decided: the person and their contact details are gone for good.
create function admin_takedown_reopen(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  item takedown_requests%rowtype;
  cleaned text;
begin
  perform admin_require(array['takedowns']);
  cleaned := admin_clean_reason(p_reason);
  select * into item from takedown_requests d where d.id = p_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'PT404'; end if;
  if item.status = 'removed' then raise exception 'admin_decision_final' using errcode = 'PT409'; end if;
  if item.status = 'open' then raise exception 'admin_already_open' using errcode = 'PT409'; end if;
  update takedown_requests set status = 'open', decided_by = null, decided_at = null, decision_note = null where id = p_id;
  -- The work trigger only closes an item when a request is decided, so the item is opened again here.
  perform work_open('takedown', p_id, coalesce(item.subject_name, 'Takedown request'), 'high');
  update work_items set due_at = now() + work_sla('takedown'), overdue_notified_at = null, updated_at = now()
  where kind = 'takedown' and ref_id = p_id;
  perform admin_log('takedown.reopened', 'takedown', p_id::text, cleaned, jsonb_build_object('note_before', item.decision_note));
  return jsonb_build_object('ok', true);
end $$;

-- ===== Dictionary =====

-- p_q: part of the word (either script), of the relationship or of the language name.
drop function admin_kin_terms_list(text, int, int);
create function admin_kin_terms_list(p_status text default 'pending', p_limit int default 25, p_offset int default 0, p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'pending');
  q text := nullif(trim(coalesce(p_q, '')), '');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['dictionary']);
  with hits as (
    select k.id, k.term, k.term_native, k.path_code, kp.description_en, k.language_code, l.name_en,
           k.speaker_gender, k.status, p.display_name as submitted_by_name, k.created_at
    from kin_terms k
    join kin_paths kp on kp.code = k.path_code
    join languages l on l.code = k.language_code
    left join profiles p on p.id = k.submitted_by
    where k.status::text = wanted
      and (q is null or k.term ilike admin_like(q) or k.term_native ilike admin_like(q)
           or kp.description_en ilike admin_like(q) or l.name_en ilike admin_like(q))
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'term', x.term,
        'term_native', x.term_native,
        'path_code', x.path_code,
        'path_description', x.description_en,
        'language_code', x.language_code,
        'language_name', x.name_en,
        'speaker_gender', x.speaker_gender,
        'status', x.status,
        'submitted_by_name', x.submitted_by_name,
        'created_at', x.created_at
      ) order by x.created_at, x.id), '[]'::jsonb)
     from (select * from hits order by created_at, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- As before (0022), and staff can now correct the spelling while approving: p_term is the word in Latin letters and
-- p_native the word in its own script (empty takes it off). A word already approved can be corrected the same way.
-- With p_term left out, the word stays exactly as it was sent.
drop function admin_kin_review(uuid, text);
create function admin_kin_review(p_id uuid, p_decision text, p_term text default null, p_native text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k kin_terms;
  target term_status_t;
  new_word text := nullif(trim(coalesce(p_term, '')), '');
  new_native text := nullif(trim(coalesce(p_native, '')), '');
  corrected boolean;
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
    insert into notifications (recipient_id, kind, payload)
    values (k.submitted_by, 'kin_term_reviewed',
            jsonb_build_object('term', case when corrected then new_word else k.term end, 'decision', p_decision));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Who decided a wrong-word report, and when, so past decisions can be shown. Decisions made before this are filled
-- in from the audit log.
alter table term_reports
  add column decided_by uuid references profiles (id) on delete set null,
  add column decided_at timestamptz;

update term_reports r set decided_by = l.actor_id, decided_at = l.created_at
from (
  select distinct on (target_id) target_id, actor_id, created_at
  from admin_audit_log
  where target_type = 'term_report' and action in ('term_report.accepted', 'term_report.dismissed')
  order by target_id, id desc
) l
where l.target_id = r.id::text and r.status <> 'open';

-- p_status 'decided' gives accepted and dismissed reports together, the newest decision first.
create or replace function admin_term_reports_list(p_status text default 'open', p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := coalesce(nullif(p_status, ''), 'open');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['dictionary']);
  select count(*)::int into total_rows from term_reports r
  where case when wanted = 'decided' then r.status <> 'open' else r.status = wanted end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'kin_term_id', x.kin_term_id,
      'term', x.term,
      'term_native', x.term_native,
      'word_status', x.word_status,
      'path_description', x.description_en,
      'language_name', x.name_en,
      'suggestion', x.suggestion,
      'status', x.status,
      'reporter_name', x.reporter_name,
      'created_at', x.created_at,
      'decided_at', x.decided_at,
      'decided_by_name', x.decided_by_name
    ) order by x.sort_at, x.id), '[]'::jsonb)
  into page_rows
  from (
    select r.id, r.kin_term_id, k.term, k.term_native, k.status as word_status, kp.description_en, l.name_en, r.suggestion, r.status,
           p.display_name as reporter_name, r.created_at, r.decided_at, s.display_name as decided_by_name,
           -- Open reports: the oldest first. Decided ones: the newest decision first.
           case when wanted = 'open' then extract(epoch from r.created_at)
                else -extract(epoch from coalesce(r.decided_at, r.created_at)) end as sort_at
    from term_reports r
    join kin_terms k on k.id = r.kin_term_id
    join kin_paths kp on kp.code = k.path_code
    join languages l on l.code = k.language_code
    left join profiles p on p.id = r.reporter_id
    left join profiles s on s.id = r.decided_by
    where case when wanted = 'decided' then r.status <> 'open' else r.status = wanted end
    order by sort_at, r.id limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- As before (0008), and it now records who decided and when.
create or replace function admin_term_report_decide(p_id uuid, p_decision text, p_new_term text default null, p_new_native text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  term_id uuid;
  state text;
  new_word text := nullif(trim(coalesce(p_new_term, '')), '');
begin
  perform admin_require(array['dictionary']);
  if p_decision not in ('accept', 'dismiss') then
    raise exception 'bad_input' using errcode = 'PT422';
  end if;
  select r.kin_term_id, r.status into term_id, state from term_reports r where r.id = p_id for update;
  if term_id is null then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if state <> 'open' then
    raise exception 'admin_already_decided' using errcode = 'PT409';
  end if;
  if p_decision = 'accept' then
    if new_word is not null then
      update kin_terms set term = new_word, term_native = nullif(trim(coalesce(p_new_native, '')), ''), status = 'verified'
      where id = term_id;
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
  return jsonb_build_object('ok', true);
end $$;

-- ===== Trees =====

-- Same parameters as before; the search now also matches the name of the person who made the tree.
create or replace function admin_trees_list(p_q text default null, p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  q text := nullif(trim(coalesce(p_q, '')), '');
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['trees']);
  with hits as (
    select t.id, t.name, t.creator_id, c.display_name as creator_name, t.created_at, t.updated_at, t.deleted_at
    from trees t left join profiles c on c.id = t.creator_id
    where q is null or t.name ilike admin_like(q) or c.display_name ilike admin_like(q)
       or t.id::text = lower(q) or t.creator_id::text = lower(q)
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'name', x.name,
        'creator_id', x.creator_id,
        'creator_name', x.creator_name,
        'created_at', x.created_at,
        'updated_at', x.updated_at,
        'deleted', x.deleted_at is not null,
        'people', (select count(*) from persons p where p.tree_id = x.id and p.deleted_at is null),
        'shares', (select count(*) from shares s where s.tree_id = x.id and s.revoked_at is null)
      ) order by x.created_at desc, x.id), '[]'::jsonb)
     from (select * from hits order by created_at desc, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- ===== Payments =====

-- p_q: part of the payer's name, or part of their phone number (digits). The totals at the top stay for all plans.
drop function admin_payments_overview(text, int, int);
create function admin_payments_overview(p_status text default null, p_limit int default 25, p_offset int default 0, p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  wanted text := nullif(p_status, '');
  q text := nullif(trim(coalesce(p_q, '')), '');
  -- As in the orders list: a number is matched on its digits, four at least.
  digits text := case when q ~ '^[0-9+() -]+$' and length(regexp_replace(q, '\D', '', 'g')) >= 4
                      then regexp_replace(q, '\D', '', 'g') end;
  total_rows int;
  page_rows jsonb;
  summary jsonb;
  orders jsonb := null;
begin
  perform admin_require(array['payments']);
  select jsonb_build_object(
    'plans', (select count(*) from family_plans),
    'members', (select count(*) from family_plan_members),
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from
      (select f.status::text as status, count(*) as n from family_plans f group by 1) s), '{}'::jsonb),
    'by_store', coalesce((select jsonb_object_agg(s.store, s.n) from
      (select f.store::text as store, count(*) as n from family_plans f group by 1) s), '{}'::jsonb),
    'by_product', coalesce((select jsonb_object_agg(s.product_id, s.n) from
      (select f.product_id, count(*) as n from family_plans f group by 1) s), '{}'::jsonb)
  ) into summary;

  if to_regclass('public.one_time_orders') is not null then
    execute $sql$
      select jsonb_build_object(
        'total', (select count(*) from public.one_time_orders),
        'by_status', coalesce((select jsonb_object_agg(s.state, s.n) from
          (select status as state, count(*) as n from public.one_time_orders group by 1) s), '{}'::jsonb),
        'paid_minor_by_currency', coalesce((select jsonb_object_agg(s.currency, s.n) from
          (select currency, sum(amount_minor) as n from public.one_time_orders where status = 'paid' group by 1) s), '{}'::jsonb))
    $sql$ into orders;
  end if;

  with hits as (
    select f.id, f.payer_id, p.display_name, p.login_phone, f.store, f.product_id, f.status, f.trial_ends_at, f.renews_at, f.external_id
    from family_plans f join profiles p on p.id = f.payer_id
    where (wanted is null or f.status::text = wanted)
      and (q is null or p.display_name ilike admin_like(q) or f.payer_id::text = lower(q)
           or (digits is not null and regexp_replace(coalesce(p.login_phone, ''), '\D', '', 'g') like '%' || digits || '%'))
  )
  select
    (select count(*)::int from hits),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id,
        'payer_id', x.payer_id,
        'payer_name', x.display_name,
        'payer_phone_masked', admin_mask_phone(x.login_phone),
        'store', x.store,
        'product_id', x.product_id,
        'status', x.status,
        'trial_ends_at', x.trial_ends_at,
        'renews_at', x.renews_at,
        'external_id', x.external_id,
        'members', (select count(*) from family_plan_members m where m.plan_id = x.id)
      ) order by x.renews_at desc nulls last, x.id), '[]'::jsonb)
     from (select * from hits order by renews_at desc nulls last, id limit admin_limit(p_limit) offset admin_offset(p_offset)) x)
  into total_rows, page_rows;
  return jsonb_build_object('summary', summary, 'orders', orders, 'total', total_rows, 'rows', page_rows);
end $$;

-- ===== System notices =====

-- The notices sent before, read from the audit log (a notice is not stored anywhere else).
create function admin_broadcasts_list(p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['staff']);
  select count(*)::int into total_rows from admin_audit_log l where l.action = 'broadcast.sent';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'sent_at', x.created_at,
      'sent_by_name', x.display_name,
      'title', x.details ->> 'title',
      'body', x.details ->> 'body',
      'recipients', coalesce((x.details ->> 'recipients')::int, 0),
      'reason', x.reason
    ) order by x.id desc), '[]'::jsonb)
  into page_rows
  from (
    select l.id, l.created_at, p.display_name, l.details, l.reason
    from admin_audit_log l left join profiles p on p.id = l.actor_id
    where l.action = 'broadcast.sent'
    order by l.id desc limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

-- Before sending: how many accounts a notice reaches now (the same people admin_broadcast writes to), and how many
-- of the three allowed in a day have gone out.
create function admin_broadcast_count() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require(array['staff']);
  return jsonb_build_object(
    'recipients', (select count(*) from profiles p join auth.users u on u.id = p.id where p.deleted_at is null and u.banned_at is null),
    'sent_today', (select count(*) from admin_audit_log l where l.action = 'broadcast.sent' and l.created_at > now() - interval '1 day'),
    'daily_limit', 3);
end $$;

revoke all on function
  admin_orders_list(text, text, int, int), admin_order_correct_tracking(uuid, text, text, text, text), admin_order_step_back(uuid, text),
  admin_coupons_list(text), admin_coupon_delete(uuid), admin_announcement_delete(uuid),
  admin_reports_list(text, int, int, uuid), admin_report_reopen(uuid, text),
  admin_takedowns_list(text, int, int, uuid), admin_takedown_reopen(uuid, text),
  admin_kin_terms_list(text, int, int, text), admin_kin_review(uuid, text, text, text),
  admin_term_reports_list(text, int, int), admin_term_report_decide(uuid, text, text, text),
  admin_trees_list(text, int, int), admin_payments_overview(text, int, int, text),
  admin_broadcasts_list(int, int), admin_broadcast_count()
from public, anon, authenticated;
grant execute on function
  admin_orders_list(text, text, int, int), admin_order_correct_tracking(uuid, text, text, text, text), admin_order_step_back(uuid, text),
  admin_coupons_list(text), admin_coupon_delete(uuid), admin_announcement_delete(uuid),
  admin_reports_list(text, int, int, uuid), admin_report_reopen(uuid, text),
  admin_takedowns_list(text, int, int, uuid), admin_takedown_reopen(uuid, text),
  admin_kin_terms_list(text, int, int, text), admin_kin_review(uuid, text, text, text),
  admin_term_reports_list(text, int, int), admin_term_report_decide(uuid, text, text, text),
  admin_trees_list(text, int, int), admin_payments_overview(text, int, int, text),
  admin_broadcasts_list(int, int), admin_broadcast_count()
to authenticated;
