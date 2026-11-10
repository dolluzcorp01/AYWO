-- AYWO platform layer on plain Postgres (DigitalOcean managed).
-- The Node API runs every request in a transaction as role 'authenticated' or 'anon', with the caller's id in
-- request.jwt.claims. All the row rules in 0002 onwards therefore apply, even if an API route has a bug.
create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pg_trgm with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- The API's own database user switches into these roles with 'set local role'.
grant anon, authenticated to current_user;
grant usage on schema public, auth, extensions to anon, authenticated;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  phone_confirmed_at timestamptz,
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  banned_at timestamptz
);

-- Only hashes are stored. The API alone reads these tables, as the database owner.
create table auth.otp_codes (
  id bigint generated always as identity primary key,
  phone text not null,
  code_hash text not null,
  attempts smallint not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_codes_phone_idx on auth.otp_codes (phone, created_at desc);

create table auth.refresh_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index refresh_tokens_user_idx on auth.refresh_tokens (user_id);

revoke all on all tables in schema auth from anon, authenticated, public;

create function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
