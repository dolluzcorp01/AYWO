-- The global relationship dictionary (LLD L3, L6).
create type speaker_gender as enum ('male', 'female');
create type term_status_t as enum ('ai_seeded', 'verified', 'pending', 'rejected');

create table kin_paths (
  code text primary key,
  description_en text not null,
  generation int not null,
  blood boolean not null
);

-- term is the Latin-letter word used for search and matching; term_native is the word in its own script.
create table kin_terms (
  id uuid primary key default gen_random_uuid(),
  path_code text not null references kin_paths (code),
  language_code text not null references languages (code),
  term text not null,
  term_native text,
  normalized_term text generated always as (aywo_normalize(term)) stored,
  speaker_gender speaker_gender,
  is_default boolean not null default false,
  status term_status_t not null default 'pending',
  submitted_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (path_code, language_code, normalized_term, speaker_gender)
);
create index kin_terms_lookup_idx on kin_terms (language_code, path_code) where status <> 'rejected';
create index kin_terms_suggest_idx on kin_terms using gin (normalized_term extensions.gin_trgm_ops);

create table term_reports (
  id uuid primary key default gen_random_uuid(),
  kin_term_id uuid not null references kin_terms (id) on delete cascade,
  reporter_id uuid not null references profiles (id),
  suggestion text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

grant select on kin_paths to anon, authenticated;
grant select, insert (path_code, language_code, term, term_native, speaker_gender, submitted_by) on kin_terms to authenticated;
grant select (id, path_code, language_code, term, term_native, normalized_term, speaker_gender, is_default, status) on kin_terms to anon;
grant select, insert (kin_term_id, reporter_id, suggestion) on term_reports to authenticated;

alter table kin_paths enable row level security;
alter table kin_terms enable row level security;
alter table term_reports enable row level security;

create policy kin_paths_read on kin_paths for select using (true);
-- Everyone reads approved words and their own pending ones (L4.2). Status changes only through admin-kin-review.
create policy kin_terms_read on kin_terms for select using (
  status in ('ai_seeded', 'verified') or submitted_by = auth.uid() or is_app_admin()
);
create policy kin_terms_submit on kin_terms for insert with check (submitted_by = auth.uid());
create policy term_reports_own on term_reports for select using (reporter_id = auth.uid() or is_app_admin());
create policy term_reports_insert on term_reports for insert with check (reporter_id = auth.uid());
