-- PR 52: notifications are shown inside the app, and arrive at once.
--
-- Every notification (an answer to an invitation, a new invitation, a comment on a memory, an alert) was saved here
-- and sent as a phone push. Nothing in the app listed them, so anyone without push saw none of it. The app now has a
-- Notifications list (GET /notifications), and this trigger tells the API the moment one is saved, so an open app
-- shows it without waiting. Same channel as chat: the API keeps one LISTEN connection.

create or replace function notifications_announce() returns trigger
language plpgsql as $$
begin
  perform pg_notify('aywo_chat', json_build_object('notification_id', new.id)::text);
  return null;
end $$;

drop trigger if exists notifications_announce on notifications;
create trigger notifications_announce after insert on notifications
  for each row execute function notifications_announce();

-- The list and its unread number are read per person, newest first.
create index if not exists notifications_recipient_idx on notifications (recipient_id, created_at desc);
