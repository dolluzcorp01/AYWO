-- Removes exactly what scripts/demo-admin-data.sql added, and nothing else.
-- docker exec -i aywo-db-1 psql -U aywo -d aywo -v ON_ERROR_STOP=1 < scripts/demo-admin-data-remove.sql
begin;

delete from app_events where device_id::text like 'dddddddd-%';
delete from client_errors where message like '[demo]%';
delete from server_errors where message like '[demo]%';
delete from user_blocks where blocker_id::text like 'dddddddd-%' or blocked_id::text like 'dddddddd-%';

-- Work queue rows that point at dummy things (their notes go with them).
delete from work_items where ref_id::text like 'dddddddd-%';

delete from term_reports where id::text like 'dddddddd-%';
delete from kin_terms where id::text like 'dddddddd-%';
delete from takedown_requests where id::text like 'dddddddd-%';
delete from content_reports where id::text like 'dddddddd-%';
delete from support_tickets where id::text like 'dddddddd-%';
delete from one_time_orders where id::text like 'dddddddd-%';
delete from campaigns where id::text like 'dddddddd-%';
delete from announcements where id::text like 'dddddddd-%';
delete from coupons where id::text like 'dddddddd-%';
delete from family_plans where id::text like 'dddddddd-%';

-- The five made-up accounts last, once nothing points at them.
delete from profiles where id::text like 'dddddddd-%';
delete from auth.users where id::text like 'dddddddd-%';

commit;
