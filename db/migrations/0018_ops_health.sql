-- 0018: knowing when something breaks, and being able to get the data back.
-- backup_runs: each nightly database backup (made by the API, stored encrypted in a separate storage bucket).
-- job_status: each background job's last success and last failure, so a job failing quietly is seen.
-- server_errors: API errors that were not the caller's fault (HTTP 500). No request body, no person: only the route
--   pattern, the error type and a short message.
-- ops_alerts: when each alert email was last sent, so a broken thing sends one email, not one a minute.

create table backup_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  object_key text check (char_length(object_key) <= 300),
  bytes bigint,
  error text check (char_length(error) <= 500)
);
create index backup_runs_time on backup_runs (started_at desc);
alter table backup_runs enable row level security;

create table job_status (
  name text primary key,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text check (char_length(last_error) <= 500),
  failures_in_row int not null default 0
);
alter table job_status enable row level security;

create table server_errors (
  id bigint generated always as identity primary key,
  route text not null check (char_length(route) <= 200),
  method text not null check (char_length(method) <= 10),
  message text not null check (char_length(message) <= 500),
  fingerprint text not null check (char_length(fingerprint) <= 100),
  created_at timestamptz not null default now()
);
create index server_errors_time on server_errors (created_at);
create index server_errors_fp on server_errors (fingerprint, created_at desc);
alter table server_errors enable row level security;

create table ops_alerts (
  key text primary key check (char_length(key) <= 100),
  last_sent_at timestamptz not null
);
alter table ops_alerts enable row level security;

-- A job finished: reset or count its failures. Returns the failures in a row (0 after a success).
create function job_record(p_name text, p_ok boolean, p_error text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_ok then
    insert into job_status (name, last_ok_at, failures_in_row) values (p_name, now(), 0)
    on conflict (name) do update set last_ok_at = now(), failures_in_row = 0;
    return 0;
  end if;
  insert into job_status (name, last_error_at, last_error, failures_in_row) values (p_name, now(), left(p_error, 500), 1)
  on conflict (name) do update set last_error_at = now(), last_error = left(p_error, 500), failures_in_row = job_status.failures_in_row + 1
  returning failures_in_row into n;
  return n;
end $$;

-- True when this alert may be sent now (not sent in the last p_quiet), and marks it sent.
create function ops_alert_claim(p_key text, p_quiet interval default interval '6 hours') returns boolean
language plpgsql security definer set search_path = public as $$
declare claimed text;
begin
  insert into ops_alerts (key, last_sent_at) values (p_key, now())
  on conflict (key) do update set last_sent_at = now() where ops_alerts.last_sent_at <= now() - p_quiet
  returning key into claimed;
  return claimed is not null;
end $$;

-- Old records go: server errors after 30 days, backup runs after 400.
create function ops_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from server_errors where created_at < now() - interval '30 days';
  delete from backup_runs where started_at < now() - interval '400 days';
$$;

-- Same as 0012, plus backups, job status and server errors.
create or replace function admin_app_health(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30));
begin
  perform admin_require(array['settings', 'analytics']);
  return jsonb_build_object(
    'errors', coalesce((select jsonb_agg(g order by g ->> 'count' desc) from (
      select jsonb_build_object('fingerprint', e.fingerprint, 'message', max(e.message), 'count', count(*),
        'people', count(distinct e.profile_id), 'last_seen', max(e.created_at), 'first_seen', min(e.created_at),
        'platforms', to_jsonb(array_agg(distinct e.platform)), 'versions', to_jsonb(array_agg(distinct e.app_version)),
        'routes', to_jsonb((array_agg(distinct e.route))[1:5]),
        'stack', (select x.stack from client_errors x where x.fingerprint = e.fingerprint order by x.id desc limit 1)) as g
      from client_errors e where e.created_at > since group by e.fingerprint order by count(*) desc limit 50) q), '[]'::jsonb),
    'total', (select count(*) from client_errors e where e.created_at > since),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j)) from (select * from job_runs order by 1 desc limit 20) j), '[]'::jsonb),
    'job_status', coalesce((select jsonb_agg(to_jsonb(j) order by j.failures_in_row desc, j.name) from job_status j), '[]'::jsonb),
    'backups', coalesce((select jsonb_agg(to_jsonb(b) order by b.started_at desc) from
      (select id, started_at, finished_at, ok, object_key, bytes, error from backup_runs order by started_at desc limit 14) b), '[]'::jsonb),
    'last_good_backup', (select max(finished_at) from backup_runs where ok),
    'server_errors', coalesce((select jsonb_agg(g order by (g ->> 'count')::int desc) from (
      select jsonb_build_object('route', max(s.method) || ' ' || max(s.route), 'message', max(s.message), 'count', count(*),
        'last_seen', max(s.created_at)) as g
      from server_errors s where s.created_at > since group by s.fingerprint order by count(*) desc limit 30) q), '[]'::jsonb),
    'server_error_total', (select count(*) from server_errors s where s.created_at > since));
end $$;

revoke all on function job_record(text, boolean, text), ops_alert_claim(text, interval), ops_cleanup() from public, anon, authenticated;
