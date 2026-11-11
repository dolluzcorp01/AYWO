-- Defence in depth. Every public table keeps row security on, even the ones only reached through security-definer
-- functions, so a grant added by mistake later still shows nothing without a policy.
alter table public.admin_roles enable row level security;

-- Created by migrate.ts before any migration runs. Nobody signed in or visiting needs to see it.
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
