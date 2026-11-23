-- FOR YOUR OWN LAPTOP ONLY. Never run this on the live database: it deletes every account and every family.
--
-- Removes all users, trees, people, memories, chats, events, alerts, tickets and admin logins, so you can test
-- from scratch as a brand new user. Keeps the app setup: relationship words, languages, app settings, shop
-- pictures and prices, coupons, announcements, campaigns and admin roles.
--
-- Run it from the project folder:
--   docker exec -i aywo-db-1 psql -U aywo -d aywo < scripts/dev-clear-users.sql

\set ON_ERROR_STOP on
begin;
-- No triggers while clearing: history and counters must not react to rows that are all going away anyway.
set local session_replication_role = replica;

-- The kept tables remember who made each row. Those people are being deleted.
update kin_terms set submitted_by = null where submitted_by is not null;
update shop_images set added_by = null;
update admin_roles set created_by = null;
update coupons set created_by = null;
update announcements set created_by = null;
update campaigns set sent_by = null;
update app_config set updated_by = null;
update shop_prices set updated_by = null;

do $$
declare r record;
begin
  for r in
    select schemaname s, tablename t from pg_tables
    where schemaname in ('public', 'auth')
      and tablename not in ('schema_migrations', 'kin_paths', 'kin_terms', 'languages', 'app_config', 'shop_images',
                            'shop_prices', 'admin_roles', 'coupons', 'announcements', 'campaigns', 'job_status')
  loop
    execute format('delete from %I.%I', r.s, r.t);
  end loop;
end $$;
commit;

select 'Cleared. Accounts left: ' || (select count(*) from auth.users) as result;
