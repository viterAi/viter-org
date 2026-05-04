-- 002 · L1 extraction runs + events + active pointer + history audit + side tables
--
-- Core idea: L1 is keyed by (artifact, facet, extractor, version, parameters), not just artifact.
-- A single L0 has many L1 projections — each is one "extraction run." Active pointer per (artifact, facet)
-- says which run is canonical right now; old runs stay forever for reproducibility.
--
-- Refinements applied (per architecture review 2026-05-04):
--   #2 typed source-locator columns (ts_start_s, byte_offset, line_no, page) instead of jsonb-only
--   #3 is_deterministic flag → skip active pointer for deterministic facets
--   #4 side tables (l1_embeddings, l1_doc_chunks) so non-event projections don't bloat l1_events
--   #5 active_extraction_history audit trail with auto-trigger
--   #6 PK includes event_at for future RANGE partitioning by event_at

create extension if not exists vector;

-- ────────────────────────────────────────────────────────────────────
-- L1 EXTRACTION RUNS — the multiplexer
-- ────────────────────────────────────────────────────────────────────

create table public.l1_extraction_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  artifact_id     uuid not null references public.l0_artifacts(id) on delete cascade,

  facet           text not null,                  -- 'transcription' | 'emotion' | 'diarization' | 'ocr_text_blocks' | …
  extractor       text not null,                  -- 'whisper-large-v3' | 'gpt-5-audio' | 'pyannote-3.1' | 'jsonl-turns-v1'
  version         text not null,                  -- semver of the extractor code
  parameters      jsonb not null default '{}'::jsonb,
  is_deterministic boolean not null default false,

  status          text not null default 'pending'
                   check (status in ('pending','running','ok','failed','cancelled')),
  started_at      timestamptz,
  completed_at    timestamptz,
  error           text,

  confidence      numeric,                        -- run-level confidence (0..1)
  metrics         jsonb not null default '{}'::jsonb,    -- {wer, cer, cost_usd, runtime_ms, n_events}

  supersedes      uuid references public.l1_extraction_runs(id),

  created_at      timestamptz not null default now(),

  -- pure-function key: same inputs ⇒ exactly one row, ever
  unique (tenant_id, artifact_id, facet, extractor, version, parameters)
);
create index l1_runs_artifact_facet on public.l1_extraction_runs (artifact_id, facet);
create index l1_runs_pending        on public.l1_extraction_runs (status) where status in ('pending','running');
create index l1_runs_supersedes     on public.l1_extraction_runs (supersedes) where supersedes is not null;

-- ────────────────────────────────────────────────────────────────────
-- L1 EVENTS — universal event-shaped projections
-- ────────────────────────────────────────────────────────────────────

create table public.l1_events (
  id                uuid not null default gen_random_uuid(),
  tenant_id         uuid not null,
  artifact_id       uuid not null,
  extraction_run_id uuid not null references public.l1_extraction_runs(id) on delete cascade,
  facet             text not null,                  -- denormalized from run for fast filtering

  event_at          timestamptz not null,           -- when the event occurred in real-world time
  position          int not null default 0,         -- order within artifact (tie-breaker for same event_at)

  actor_id          uuid references public.principals(id),
  channel_id        uuid references public.channels(id),
  modality          text not null default 'text'
                     check (modality in ('text','voice','image','video','tool_call','file','signal')),
  content           text,

  -- typed source locator — most events fill 2 of 5
  ts_start_s        numeric,
  ts_end_s          numeric,
  byte_offset       bigint,
  line_no           int,
  page              int,

  -- L1.5 metadata (Yitzchak's integrity layer, as columns not as a layer)
  confidence        numeric,
  extraction_method text,                           -- copy of run's extractor; speeds up filtering

  metadata          jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  primary key (id, event_at)                        -- composite PK so future partitioning by event_at is one DDL away
);
create index l1_events_artifact_at      on public.l1_events (artifact_id, event_at);
create index l1_events_actor_at         on public.l1_events (tenant_id, actor_id, event_at) where actor_id is not null;
create index l1_events_channel_at       on public.l1_events (tenant_id, channel_id, event_at) where channel_id is not null;
create index l1_events_facet_at         on public.l1_events (tenant_id, facet, event_at);
create index l1_events_run              on public.l1_events (extraction_run_id);
create index l1_events_ts               on public.l1_events (artifact_id, ts_start_s) where ts_start_s is not null;

-- ────────────────────────────────────────────────────────────────────
-- L1 ACTIVE EXTRACTION — which run is canonical right now per (artifact, facet)
-- ────────────────────────────────────────────────────────────────────

create table public.l1_active_extraction (
  tenant_id     uuid not null,
  artifact_id   uuid not null,
  facet         text not null,
  active_run_id uuid not null references public.l1_extraction_runs(id),
  promoted_at   timestamptz not null default now(),
  promoted_by   text not null default 'auto',     -- 'auto' | <user_id> | 'rollback' | 'a/b winner'
  reason        text,
  primary key (tenant_id, artifact_id, facet)
);
create index l1_active_run_idx on public.l1_active_extraction (active_run_id);

-- ────────────────────────────────────────────────────────────────────
-- L1 ACTIVE EXTRACTION HISTORY — append-only audit trail of every flip
-- ────────────────────────────────────────────────────────────────────

create table public.l1_active_extraction_history (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  artifact_id  uuid not null,
  facet        text not null,
  from_run_id  uuid,
  to_run_id    uuid not null,
  flipped_at   timestamptz not null default now(),
  flipped_by   text not null,
  reason       text
);
create index l1_active_hist_lookup on public.l1_active_extraction_history (artifact_id, facet, flipped_at desc);

-- trigger: on active_extraction insert/update, append to history
create or replace function public.log_active_extraction_flip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.l1_active_extraction_history
      (tenant_id, artifact_id, facet, from_run_id, to_run_id, flipped_by, reason)
    values
      (new.tenant_id, new.artifact_id, new.facet, null, new.active_run_id,
       new.promoted_by, coalesce(new.reason, 'first-promote'));

  elsif tg_op = 'UPDATE' and new.active_run_id is distinct from old.active_run_id then
    insert into public.l1_active_extraction_history
      (tenant_id, artifact_id, facet, from_run_id, to_run_id, flipped_by, reason)
    values
      (new.tenant_id, new.artifact_id, new.facet, old.active_run_id, new.active_run_id,
       new.promoted_by, coalesce(new.reason, 'flip'));
  end if;
  return new;
end;
$$;

create trigger active_extraction_history_log
after insert or update on public.l1_active_extraction
for each row execute function public.log_active_extraction_flip();

-- ────────────────────────────────────────────────────────────────────
-- L1 EMBEDDINGS — side table; many embeddings per event allowed
-- ────────────────────────────────────────────────────────────────────

create table public.l1_embeddings (
  event_id          uuid not null,
  event_at          timestamptz not null,                              -- denorm to FK partitioned events later
  extraction_run_id uuid not null references public.l1_extraction_runs(id) on delete cascade,
  tenant_id         uuid not null,
  embedding         vector(1536) not null,                             -- OpenAI text-embedding-3-large size; resize per model
  metadata          jsonb not null default '{}'::jsonb,
  primary key (event_id, extraction_run_id)
);
create index l1_embeddings_ann on public.l1_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ────────────────────────────────────────────────────────────────────
-- L1 DOC CHUNKS — for PDFs / long documents; many chunks per artifact
-- (Use this instead of l1_events when chunks aren't event-shaped)
-- ────────────────────────────────────────────────────────────────────

create table public.l1_doc_chunks (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  artifact_id       uuid not null references public.l0_artifacts(id) on delete cascade,
  extraction_run_id uuid not null references public.l1_extraction_runs(id) on delete cascade,
  chunk_no          int not null,
  content           text not null,
  page              int,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (artifact_id, extraction_run_id, chunk_no)
);
create index l1_doc_chunks_artifact on public.l1_doc_chunks (artifact_id, extraction_run_id);

-- ────────────────────────────────────────────────────────────────────
-- RLS — tenant-scoped reads; writes via service_role only for v0.1
-- ────────────────────────────────────────────────────────────────────

alter table public.l1_extraction_runs            enable row level security;
alter table public.l1_events                     enable row level security;
alter table public.l1_active_extraction          enable row level security;
alter table public.l1_active_extraction_history  enable row level security;
alter table public.l1_embeddings                 enable row level security;
alter table public.l1_doc_chunks                 enable row level security;

create policy l1_runs_tenant_read         on public.l1_extraction_runs           for select using (tenant_id = public.current_tenant_id());
create policy l1_events_tenant_read       on public.l1_events                    for select using (tenant_id = public.current_tenant_id());
create policy l1_active_tenant_read       on public.l1_active_extraction         for select using (tenant_id = public.current_tenant_id());
create policy l1_active_hist_tenant_read  on public.l1_active_extraction_history for select using (tenant_id = public.current_tenant_id());
create policy l1_emb_tenant_read          on public.l1_embeddings                for select using (tenant_id = public.current_tenant_id());
create policy l1_chunks_tenant_read       on public.l1_doc_chunks                for select using (tenant_id = public.current_tenant_id());
