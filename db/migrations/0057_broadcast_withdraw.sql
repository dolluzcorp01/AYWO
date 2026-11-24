-- PR 63: a system notice sent by mistake can be taken back.
--
-- A notice went to every account and could never be changed or removed: a wrong time or a slip in the wording stayed
-- in everyone's Notifications for good. Withdrawing removes it from every list. A push or email that already went
-- out cannot be called back, so the usual next step is a short corrected notice; the screen says so.

create function admin_broadcast_withdraw(p_broadcast uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  why text;
  gone int;
begin
  perform admin_require(array['staff']);
  why := admin_clean_reason(p_reason);
  if not exists (select 1 from admin_audit_log l where l.action = 'broadcast.sent' and l.target_id = p_broadcast::text) then
    raise exception 'admin_not_found' using errcode = 'PT404';
  end if;
  if exists (select 1 from admin_audit_log l where l.action = 'broadcast.withdrawn' and l.target_id = p_broadcast::text) then
    raise exception 'already_decided' using errcode = 'PT409';
  end if;
  delete from notifications n where n.kind = 'system_notice' and n.payload ->> 'broadcast_id' = p_broadcast::text;
  get diagnostics gone = row_count;
  perform admin_log('broadcast.withdrawn', 'broadcast', p_broadcast::text, why, jsonb_build_object('removed', gone));
  return jsonb_build_object('removed', gone);
end $$;

-- The same list as 0035, with the notice's own id and whether it was withdrawn.
create or replace function admin_broadcasts_list(p_limit int default 25, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  total_rows int;
  page_rows jsonb;
begin
  perform admin_require(array['staff']);
  select count(*)::int into total_rows from admin_audit_log l where l.action = 'broadcast.sent';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id,
      'broadcast_id', x.target_id,
      'sent_at', x.created_at,
      'sent_by_name', x.display_name,
      'title', x.details ->> 'title',
      'body', x.details ->> 'body',
      'recipients', coalesce((x.details ->> 'recipients')::int, 0),
      'reason', x.reason,
      'withdrawn', exists (select 1 from admin_audit_log w where w.action = 'broadcast.withdrawn' and w.target_id = x.target_id)
    ) order by x.id desc), '[]'::jsonb)
  into page_rows
  from (
    select l.id, l.target_id, l.created_at, p.display_name, l.details, l.reason
    from admin_audit_log l left join profiles p on p.id = l.actor_id
    where l.action = 'broadcast.sent'
    order by l.id desc limit admin_limit(p_limit) offset admin_offset(p_offset)
  ) x;
  return jsonb_build_object('total', total_rows, 'rows', page_rows);
end $$;

revoke all on function admin_broadcast_withdraw(uuid, text) from public, anon;
grant execute on function admin_broadcast_withdraw(uuid, text) to authenticated;
