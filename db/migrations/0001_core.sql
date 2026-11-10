-- AYWO core schema (LLD L3). Dictionary tables are in 0003_kinship.sql; rules are in 0002_rls.sql.
create extension if not exists pg_trgm with schema extensions;

create type gender_t       as enum ('male', 'female', 'other', 'unknown');
create type living_t       as enum ('living', 'deceased', 'unknown');
create type date_prec_t    as enum ('exact', 'month', 'year', 'about', 'unknown');
create type contact_kind_t as enum ('mobile', 'whatsapp', 'email');
create type union_kind_t   as enum ('marriage', 'partnership', 'unknown');
create type union_status_t as enum ('current', 'divorced', 'separated', 'widowed', 'annulled', 'unknown');
create type link_kind_t    as enum ('birth', 'adopted', 'step', 'foster', 'unknown');
create type share_role_t   as enum ('viewer', 'commenter', 'editor', 'co_creator');
create type edit_mode_t    as enum ('direct', 'approval');
create type request_kind_t as enum ('access_edit', 'access_contacts', 'role_upgrade', 'change', 'merge');
create type request_state_t as enum ('pending', 'approved', 'declined', 'expired', 'applied');
create type store_t        as enum ('apple', 'google', 'razorpay', 'stripe');
create type plan_status_t  as enum ('trial', 'active', 'grace', 'expired', 'cancelled');
create type import_source_t as enum ('gedcom', 'lighten');
create type app_admin_role_t as enum ('aywo_admin', 'sub_admin');

-- LLD L1 text matching. Mirrors normalize() in packages/shared.
create function aywo_normalize(t text) returns text
language sql immutable parallel safe
as $$ select lower(trim(regexp_replace(normalize(t, NFKC), '\s+', ' ', 'g'))) $$;

create table languages (
  code text primary key,
  name_en text not null,
  name_native text,
  script text,
  rtl boolean not null default false,
  enabled boolean not null default true
);

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  login_phone text unique,
  email text unique,
  language_code text not null default 'en' references languages (code),
  large_text boolean not null default false,
  is_minor boolean not null default false,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table trees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  creator_id uuid not null references profiles (id),
  successor_id uuid references profiles (id),
  creator_person_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table persons (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees (id) on delete cascade,
  display_name text not null,
  name_normalized text generated always as (aywo_normalize(display_name)) stored,
  name_unknown boolean not null default false,
  note_label text,
  gender gender_t not null default 'unknown',
  living living_t not null default 'unknown',
  birth_date date,
  death_date date,
  birth_precision date_prec_t,
  death_precision date_prec_t,
  birth_place text,
  death_place text,
  birth_order smallint,
  photo_path text,
  notes text,
  claimed_by uuid references profiles (id),
  created_by uuid not null references profiles (id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index persons_tree_idx on persons (tree_id) where deleted_at is null;
create index persons_name_trgm_idx on persons using gin (name_normalized extensions.gin_trgm_ops);
create unique index persons_one_claim_per_tree on persons (tree_id, claimed_by) where claimed_by is not null;

alter table trees add constraint trees_creator_person_fk
  foreign key (creator_person_id) references persons (id) on delete set null;

create table person_contacts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons (id) on delete cascade,
  kind contact_kind_t not null,
  value text not null,
  value_normalized text not null,
  created_by uuid not null references profiles (id)
);
create index person_contacts_match_idx on person_contacts (value_normalized);
create index person_contacts_person_idx on person_contacts (person_id);

create table unions (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees (id) on delete cascade,
  partner1_id uuid not null references persons (id) on delete cascade,
  partner2_id uuid references persons (id) on delete cascade,
  kind union_kind_t not null default 'unknown',
  status union_status_t not null default 'unknown',
  seq1 smallint,
  seq2 smallint,
  start_date date,
  end_date date,
  version int not null default 1
);
create index unions_tree_idx on unions (tree_id);

create table parent_child (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees (id) on delete cascade,
  parent_id uuid not null references persons (id) on delete cascade,
  child_id uuid not null references persons (id) on delete cascade,
  union_id uuid references unions (id) on delete set null,
  kind link_kind_t not null default 'birth',
  unique (parent_id, child_id)
);
create index parent_child_tree_idx on parent_child (tree_id);
create index parent_child_child_idx on parent_child (child_id);

create table person_closure (
  ancestor_id uuid not null references persons (id) on delete cascade,
  descendant_id uuid not null references persons (id) on delete cascade,
  depth smallint not null,
  primary key (ancestor_id, descendant_id)
);
create index person_closure_desc_idx on person_closure (descendant_id);

create table shares (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees (id) on delete cascade,
  scope_person_id uuid references persons (id) on delete cascade,
  grantee_profile_id uuid references profiles (id),
  grantee_person_id uuid references persons (id),
  link_token text unique,
  role share_role_t not null,
  edit_mode edit_mode_t not null default 'direct',
  contacts_visible boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);
create index shares_grantee_idx on shares (grantee_profile_id) where revoked_at is null;
create index shares_tree_idx on shares (tree_id);

create table requests (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees (id) on delete cascade,
  kind request_kind_t not null,
  requester_id uuid not null references profiles (id),
  target_person_id uuid references persons (id) on delete set null,
  payload jsonb,
  status request_state_t not null default 'pending',
  decided_by uuid references profiles (id),
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index requests_tree_idx on requests (tree_id, status);

create table comments (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid not null references trees (id) on delete cascade,
  person_id uuid not null references persons (id) on delete cascade,
  author_id uuid not null references profiles (id),
  body text not null check (char_length(body) <= 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index comments_person_idx on comments (person_id);

-- actor_id is null when the server itself makes the change (for example a scheduled job).
create table history (
  id bigint generated always as identity primary key,
  tree_id uuid not null references trees (id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  actor_id uuid references profiles (id),
  at timestamptz not null default now(),
  batch_id uuid not null,
  reverted_by bigint references history (id)
);
create index history_tree_idx on history (tree_id, at desc);
create index history_batch_idx on history (batch_id);

create table family_plans (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null references profiles (id),
  store store_t not null,
  product_id text not null,
  status plan_status_t not null,
  trial_ends_at timestamptz,
  renews_at timestamptz,
  external_id text not null
);

create table family_plan_members (
  plan_id uuid not null references family_plans (id) on delete cascade,
  profile_id uuid not null references profiles (id),
  primary key (plan_id, profile_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  payload jsonb,
  channels_sent text[],
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on notifications (recipient_id, created_at desc);

create table notification_prefs (
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null,
  push boolean not null default true,
  sms boolean not null default false,
  email boolean not null default true,
  primary key (profile_id, kind)
);

create table consents (
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'parental')),
  version text not null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, kind, version)
);

create table takedown_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references persons (id) on delete set null,
  requester_contact text not null,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table app_admins (
  profile_id uuid primary key references profiles (id) on delete cascade,
  role app_admin_role_t not null
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  tree_id uuid references trees (id) on delete cascade,
  created_by uuid not null references profiles (id),
  source import_source_t not null,
  file_path text not null,
  preview jsonb,
  status text not null default 'preview',
  created_at timestamptz not null default now()
);

-- ===== Triggers =====

-- Editable rows carry version; a stale save is refused. SQLSTATE PT409 makes PostgREST answer HTTP 409 (F-SHR-07).
create function check_version() returns trigger language plpgsql as $$
begin
  if new.version <> old.version then
    raise exception 'version_conflict' using errcode = 'PT409';
  end if;
  new.version := old.version + 1;
  return new;
end $$;
create trigger persons_version before update on persons for each row execute function check_version();
create trigger unions_version before update on unions for each row execute function check_version();

create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger persons_touch before update on persons for each row execute function touch_updated_at();
create trigger trees_touch before update on trees for each row execute function touch_updated_at();

-- Every person is their own closure row at depth 0.
create function closure_on_person() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into person_closure (ancestor_id, descendant_id, depth) values (new.id, new.id, 0);
  return new;
end $$;
create trigger persons_closure after insert on persons for each row execute function closure_on_person();

-- A person can never be their own ancestor.
create function parent_child_no_cycle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id = new.child_id or exists (
    select 1 from person_closure where ancestor_id = new.child_id and descendant_id = new.parent_id
  ) then
    raise exception 'family_loop' using errcode = 'PT422';
  end if;
  return new;
end $$;
create trigger parent_child_cycle before insert or update of parent_id, child_id on parent_child
  for each row execute function parent_child_no_cycle();

-- Rebuilds the ancestors of one person and all their descendants. Simple and correct for several parents.
create function rebuild_closure_below(p_person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  for d in
    select c.descendant_id from person_closure c
    join persons p on p.id = c.descendant_id
    where c.ancestor_id = p_person
  loop
    delete from person_closure where descendant_id = d and depth > 0;
    insert into person_closure (ancestor_id, descendant_id, depth)
    with recursive up as (
      select parent_id as ancestor_id, 1 as depth from parent_child where child_id = d
      union all
      select pc.parent_id, up.depth + 1 from parent_child pc join up on pc.child_id = up.ancestor_id
    )
    select up.ancestor_id, d, min(up.depth)::smallint
    from up join persons p on p.id = up.ancestor_id
    group by up.ancestor_id;
  end loop;
end $$;

create function closure_on_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform rebuild_closure_below(new.child_id);
  elsif tg_op = 'DELETE' then
    perform rebuild_closure_below(old.child_id);
  else
    perform rebuild_closure_below(old.child_id);
    perform rebuild_closure_below(new.child_id);
  end if;
  return null;
end $$;
create trigger parent_child_closure after insert or update or delete on parent_child
  for each row execute function closure_on_link();

-- Audit (F-SHR-06). One user action shares a batch: set_config('aywo.batch_id', <uuid>, true).
create function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  batch uuid := coalesce(nullif(current_setting('aywo.batch_id', true), '')::uuid, gen_random_uuid());
  row_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  tree uuid;
begin
  -- History is readable by editors, so contact values must never be copied into it (F-CON).
  if tg_table_name = 'person_contacts' then
    row_new := row_new - 'value' - 'value_normalized';
    row_old := row_old - 'value' - 'value_normalized';
    select p.tree_id into tree from persons p where p.id = coalesce((row_new ->> 'person_id')::uuid, (row_old ->> 'person_id')::uuid);
  else
    tree := coalesce((row_new ->> 'tree_id')::uuid, (row_old ->> 'tree_id')::uuid);
  end if;
  -- No history row while the whole tree is being deleted (the foreign key could not hold).
  if tree is null or not exists (select 1 from trees t where t.id = tree) then return null; end if;
  insert into history (tree_id, table_name, row_id, op, before, after, actor_id, batch_id)
  values (tree, tg_table_name, coalesce((row_new ->> 'id')::uuid, (row_old ->> 'id')::uuid),
          lower(tg_op), row_old, row_new, auth.uid(), batch);
  return null;
end $$;
create trigger persons_audit after insert or update or delete on persons for each row execute function audit_row();
create trigger unions_audit after insert or update or delete on unions for each row execute function audit_row();
create trigger parent_child_audit after insert or update or delete on parent_child for each row execute function audit_row();
create trigger person_contacts_audit after insert or update or delete on person_contacts for each row execute function audit_row();

-- Family plan: payer plus five (F-PAY-01, T-PAY-02).
create function family_plan_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from family_plan_members where plan_id = new.plan_id) >= 6 then
    raise exception 'family_plan_full' using errcode = 'PT422';
  end if;
  return new;
end $$;
create trigger family_plan_members_limit before insert on family_plan_members
  for each row execute function family_plan_limit();
