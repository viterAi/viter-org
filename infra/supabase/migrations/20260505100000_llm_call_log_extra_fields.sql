-- 010 · llm_call_log — extra fields for richer observability.
--
-- Per the May 5 audit: many rows were arriving with most columns null because
-- the call sites didn't capture them. Two changes:
--   (a) add a few first-class columns we'll reach for in dashboards
--   (b) make the OR-Broadcast webhook the canonical filler — it gets the
--       authoritative cost / token breakdown via OTLP and UPSERTs by
--       (tenant_id, generation_id).
--
-- We err on the side of MORE columns. Anything not yet broken out lives
-- under metadata.* (jsonb) — readable but not indexable.

-- ─── Trigger.dev / OpenRouter request correlation ───────────────────
alter table public.llm_call_log
  add column if not exists trigger_run_id   text,
  add column if not exists trigger_task_id  text,
  add column if not exists session_id       text,
  add column if not exists trace_id         text,
  add column if not exists span_id          text,
  add column if not exists parent_span_id   text;

-- ─── Audio-call specifics (whisper / gpt-audio) ─────────────────────
-- Whisper /audio/transcriptions returns usage.seconds + usage.cost rather
-- than tokens. We want both shapes first-class.
alter table public.llm_call_log
  add column if not exists audio_seconds       numeric(10,3),
  add column if not exists audio_format        text,
  add column if not exists audio_bytes         integer,
  add column if not exists audio_language      text,
  add column if not exists audio_n_segments    integer;

-- ─── Output shape ───────────────────────────────────────────────────
alter table public.llm_call_log
  add column if not exists output_chars       integer,
  add column if not exists output_kind        text;       -- 'chat' | 'transcript' | 'embedding' | 'image_caption'

-- ─── Tag array for dashboard filtering ──────────────────────────────
alter table public.llm_call_log
  add column if not exists tags               text[] default '{}'::text[];

-- ─── Environment marker (dev | staging | prod) ──────────────────────
alter table public.llm_call_log
  add column if not exists environment        text;       -- 'dev' | 'staging' | 'prod'

-- ─── Cost-enrich source (which path filled cost_usd) ────────────────
-- Useful for debugging "why is cost still null?":
--   'caller'         — caller computed it client-side (rare, only audio)
--   'or_broadcast'   — OR Broadcast OTLP webhook supplied it
--   'or_generation'  — async /api/v1/generation/{id} sweep filled it
--   null             — still pending
alter table public.llm_call_log
  add column if not exists cost_source        text
    check (cost_source is null or cost_source in ('caller','or_broadcast','or_generation','sweep'));

-- ─── Indexes for new query shapes ───────────────────────────────────
create index if not exists llm_log_trigger_run on public.llm_call_log (trigger_run_id) where trigger_run_id is not null;
create index if not exists llm_log_trace      on public.llm_call_log (trace_id) where trace_id is not null;
create index if not exists llm_log_session    on public.llm_call_log (tenant_id, session_id, started_at desc) where session_id is not null;
create index if not exists llm_log_tags_gin   on public.llm_call_log using gin (tags);

-- ─── Updated daily rollup view — include audio_seconds and tags ────
create or replace view public.llm_cost_daily as
select
  tenant_id,
  caller,
  scope_kind,
  date_trunc('day', started_at at time zone 'Asia/Jerusalem') as day,
  count(*) as n_calls,
  count(*) filter (where status = 'ok') as n_ok,
  count(*) filter (where status = 'failed') as n_failed,
  sum(prompt_tokens) as prompt_tokens,
  sum(completion_tokens) as completion_tokens,
  sum(reasoning_tokens) as reasoning_tokens,
  sum(cached_tokens) as cached_tokens,
  sum(audio_seconds) as audio_seconds,
  sum(cost_usd) as cost_usd,
  avg(latency_ms)::int as avg_latency_ms,
  percentile_cont(0.5) within group (order by latency_ms) as p50_latency_ms,
  percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms,
  count(*) filter (where cost_usd is null and status = 'ok') as n_cost_pending
from public.llm_call_log
group by tenant_id, caller, scope_kind, day;

-- ─── Sanity helper: rows with no cost yet, prioritized for sweep ────
create or replace view public.llm_cost_pending as
select id, tenant_id, caller, scope_key, model_used, generation_id, started_at, latency_ms
  from public.llm_call_log
 where status = 'ok'
   and cost_usd is null
   and generation_id is not null
   and started_at > now() - interval '7 days'
 order by started_at desc;
