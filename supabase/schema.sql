create extension if not exists "pgcrypto";

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  channel text not null check (channel in ('whatsapp', 'email', 'portal', 'manual_upload')),
  description text,
  markdown text not null default '',
  seed_format text not null default 'markdown' check (seed_format in ('markdown', 'json', 'csv')),
  created_at timestamptz not null default now()
);

create table if not exists views (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  view_name text not null,
  view_type text not null check (view_type in ('aging_table', 'follow_up_kanban')),
  sort_order int not null default 0,
  is_default boolean not null default false,
  current_spec_version int not null default 1,
  spec jsonb not null default '{}'::jsonb,
  ui_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, view_name)
);

create table if not exists view_versions (
  id uuid primary key default gen_random_uuid(),
  view_id uuid not null references views(id) on delete cascade,
  version_number int not null,
  spec jsonb not null,
  summary text not null,
  created_at timestamptz not null default now(),
  unique (view_id, version_number)
);

create table if not exists view_drafts (
  id uuid primary key default gen_random_uuid(),
  view_id uuid not null references views(id) on delete cascade,
  source_fingerprint text not null,
  spec jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'discarded')),
  created_at timestamptz not null default now()
);

create table if not exists view_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  view_id uuid not null references views(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_views_source on views (source_id);
create index if not exists idx_versions_view on view_versions (view_id, version_number desc);
create index if not exists idx_view_drafts_view_status on view_drafts (view_id, status, created_at desc);
create index if not exists idx_view_events_source on view_events (source_id, created_at desc);
