create table if not exists view_drafts (
  id uuid primary key default gen_random_uuid(),
  view_id uuid not null references views(id) on delete cascade,
  source_fingerprint text not null,
  spec jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'discarded')),
  created_at timestamptz not null default now()
);

create index if not exists idx_view_drafts_view_status
  on view_drafts (view_id, status, created_at desc);
