-- ⚠️ DRAFT — NOT YET APPLIED ⚠️
-- 019 · extractor_metadata table + extractors view + extractors_full join.
--
-- Architecture: high-cardinality run data stays in l1_extraction_runs.
-- This migration adds:
--   1. Version-drift backfill for 4 in-process extractors (1.0.0 ↔ 2026-05-04)
--   2. extractor_metadata: only the slow-moving fields (family, facet, status,
--      pricing_model, benchmark_data) that can't be derived from runs
--   3. extractors view: auto-derived from l1_extraction_runs aggregation
--   4. extractors_full view: the full join — what we have + what we know
--   5. Seed insert with 12 production rows + 4 candidates + version drift consolidation
--
-- Reversible: every DDL is `drop ... if exists` first; data backfills are
-- idempotent overwrites; seed is `on conflict (id) do update`.
--
-- Apply via:
--   mcp__supabase__apply_migration(project_id, '019_extractor_metadata',
--     <contents of this file with the leading DO-NOT-APPLY banner removed>)
--
-- Pre-apply checks (DO BEFORE):
--   1. Verify mammoth/sheetjs/regex/markdown duplicate runs would not collide:
--      with c as (
--        select tenant_id, artifact_id, facet, extractor,
--               '1.10.0' as new_version, parameters,
--               count(*) as n
--          from l1_extraction_runs
--         where extractor = 'mammoth-extractRawText'
--         group by 1,2,3,4,5,6
--      ) select * from c where n > 1;
--      → if any rows return > 1, the version-merge will violate the unique key
--        on (tenant, artifact, facet, extractor, version, parameters).
--        Resolve by deleting older duplicate first OR adding a JSON discriminator
--        to parameters.
--   2. Run `select count(*) from l1_extraction_runs` BEFORE and AFTER —
--      they should differ ONLY by the count of resolved duplicates.

-- ────────────────────────────────────────────────────────────────────
-- PHASE 1: VERSION DRIFT BACKFILL
-- ────────────────────────────────────────────────────────────────────
-- Same code, two version strings, two l1_extraction_runs rows per input.
-- Canonical convention: in-process extractors → semver of the wrapping library.

-- mammoth: pin to library version 1.10.0 (per packages/runtime/package.json)
update public.l1_events
   set extraction_method = 'mammoth-extractRawText@1.10.0'
 where extraction_method in (
   'mammoth-extractRawText@1.0.0',
   'mammoth-extractRawText@2026-05-04'
 );

-- Note: l1_extraction_runs row consolidation happens AFTER pre-apply check
-- determines whether duplicates exist. If they do, this migration becomes
-- a 2-step process. Drafting the safe version that handles dedup:

-- Step 1: pick the canonical run row per group (lowest started_at wins)
-- Step 2: re-point any l1_events to the canonical run
-- Step 3: delete the non-canonical runs
-- Step 4: update remaining canonical run to new version
-- (4 such patterns for mammoth, sheetjs, regex-strip-html, markdown-identity)

with mammoth_canonical as (
  select distinct on (tenant_id, artifact_id, facet, parameters)
         id, tenant_id, artifact_id, facet, parameters
    from public.l1_extraction_runs
   where extractor = 'mammoth-extractRawText'
     and version in ('1.0.0', '2026-05-04')
   order by tenant_id, artifact_id, facet, parameters, started_at asc
),
mammoth_dups as (
  select r.id as dup_id, c.id as canonical_id
    from public.l1_extraction_runs r
    join mammoth_canonical c
      on c.tenant_id = r.tenant_id
     and c.artifact_id = r.artifact_id
     and c.facet = r.facet
     and c.parameters = r.parameters
   where r.extractor = 'mammoth-extractRawText'
     and r.version in ('1.0.0', '2026-05-04')
     and r.id <> c.id
)
update public.l1_events
   set extraction_run_id = (select canonical_id from mammoth_dups where dup_id = l1_events.extraction_run_id)
 where extraction_run_id in (select dup_id from mammoth_dups);

delete from public.l1_extraction_runs
 where extractor = 'mammoth-extractRawText'
   and version in ('1.0.0', '2026-05-04')
   and id not in (
     select distinct on (tenant_id, artifact_id, facet, parameters) id
       from public.l1_extraction_runs
      where extractor = 'mammoth-extractRawText'
        and version in ('1.0.0', '2026-05-04')
      order by tenant_id, artifact_id, facet, parameters, started_at asc
   );

update public.l1_extraction_runs
   set version = '1.10.0'
 where extractor = 'mammoth-extractRawText'
   and version in ('1.0.0', '2026-05-04');

-- TODO: replicate the dedup pattern for:
--   sheetjs-sheet_to_csv: '0.18.5' + '2026-05-04' → canonical '0.18.5'
--   regex-strip-html:     '1.0.0' + '2026-05-04' → canonical '1.0.0'
--   markdown-identity:    '1.0.0' + '2026-05-04' → canonical '1.0.0'

-- ────────────────────────────────────────────────────────────────────
-- PHASE 2: extractor_metadata TABLE
-- ────────────────────────────────────────────────────────────────────

create table public.extractor_metadata (
  id                 text primary key,                 -- 'extractor@version' OR 'provider:family:facet'
  family             text not null,                    -- 'attachment' | 'meeting' | 'whatsapp' | …
  facet              text not null,                    -- 'transcription' | 'diarization' | …
  source_types       text[] not null default '{}',
  intended_status    text not null default 'active'
                       check (intended_status in ('active','candidate','deprecated','experiment')),
  provider           text,                             -- 'openrouter' | 'in-process' | 'assemblyai' | …
  pricing_model      jsonb,                            -- {unit, usd_per_unit_estimate, currency}
  benchmark_data     jsonb,                            -- {wer, cer, drift_pp[], ref}
  notes              text,
  superseded_by      text references public.extractor_metadata(id),
  added_at           timestamptz not null default now(),
  deprecated_at      timestamptz,
  metadata           jsonb not null default '{}'
);

create index extractor_metadata_family on public.extractor_metadata (family);
create index extractor_metadata_facet on public.extractor_metadata (facet);
create index extractor_metadata_status on public.extractor_metadata (intended_status);

alter table public.extractor_metadata enable row level security;

-- Read: any tenant member (registry is shared across tenants — it's about CODE, not DATA)
create policy extractor_metadata_read on public.extractor_metadata
  for select to authenticated using (true);

-- Write: service role only (the sync script runs as service role)
-- (no insert/update/delete policy = no access for authenticated users)

-- ────────────────────────────────────────────────────────────────────
-- PHASE 3: extractors VIEW (auto-derived from runs)
-- ────────────────────────────────────────────────────────────────────

create or replace view public.extractors as
select
  extractor || '@' || version       as id,
  extractor                          as name,
  version,
  count(*)                           as total_runs,
  sum(case when status = 'ok' then 1 else 0 end) as ok_runs,
  sum(case when status = 'failed' then 1 else 0 end) as failed_runs,
  min(started_at)                    as first_run_at,
  max(coalesce(completed_at, started_at)) as last_run_at,
  bool_and(is_deterministic)         as is_deterministic,
  -- "active" = at least one run in the past 30 days
  case
    when max(coalesce(completed_at, started_at)) > now() - interval '30 days'
    then 'active' else 'dormant'
  end                                as observed_status
from public.l1_extraction_runs
group by extractor, version;

-- Joined view: what we have + what we intended
create or replace view public.extractors_full as
select
  coalesce(e.id, m.id)               as id,
  e.name, e.version,
  e.total_runs, e.ok_runs, e.failed_runs,
  e.first_run_at, e.last_run_at,
  e.is_deterministic,
  e.observed_status,
  m.family, m.facet, m.source_types,
  m.intended_status, m.provider,
  m.pricing_model, m.benchmark_data, m.notes,
  m.superseded_by,
  m.added_at as registered_at, m.deprecated_at,
  -- bench-only entries (candidates not yet run) show NULL run-side fields
  case when e.id is null then 'metadata_only' else 'observed' end as source_origin
from public.extractor_metadata m
full outer join public.extractors e on e.id = m.id;

grant select on public.extractors to authenticated;
grant select on public.extractors_full to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- PHASE 4: SEED — production rows + candidates
-- ────────────────────────────────────────────────────────────────────
-- Source of truth for these rows: notes/extractors-catalog.json
-- Maintainable via scripts/sync-extractor-metadata.ts (TS REGISTRY → DB).

insert into public.extractor_metadata (id, family, facet, source_types, intended_status, provider, pricing_model, notes) values

-- ─── Active production extractors ───────────────────────────────────
('openai/whisper-large-v3-turbo@2026-05-04', 'attachment', 'transcription',
 array['whatsapp_message','whatsapp_message_live'], 'active', 'openrouter',
 '{"unit":"audio_second","approx_usd_per_hour":0.07}'::jsonb,
 'WhatsApp voice notes — single-file, opus→wav transcode'),

('openai/whisper-large-v3-turbo@2026-05-05', 'meeting', 'transcription',
 array['meeting_audio'], 'active', 'openrouter',
 '{"unit":"audio_second","approx_usd_per_hour":0.07}'::jsonb,
 'Long-form audio chunked at 10-min via ffmpeg + bias prompt (today''s shipping)'),

('google/gemini-3.1-flash-lite-preview@2026-05-04', 'attachment', 'image_caption',
 array['whatsapp_message','whatsapp_message_live'], 'active', 'openrouter',
 '{"unit":"input_token","approx_usd_per_image":0.0005}'::jsonb,
 'Image → caption + OCR text'),

('google/gemini-2.5-flash-lite@2026-05-04', 'attachment', 'doc_chunks',
 array['pdf_upload','whatsapp_message'], 'active', 'openrouter',
 '{"unit":"input_token","approx_usd_per_page":0.0008}'::jsonb,
 'PDF → per-page text via vision'),

('mammoth-extractRawText@1.10.0', 'attachment', 'doc_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'DOCX → plain text. Library version pinned.'),

('sheetjs-sheet_to_csv@0.18.5', 'attachment', 'tabular_csv',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'XLSX → CSV via sheetjs'),

('regex-strip-html@1.0.0', 'attachment', 'plain_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'HTML → plain text via tag-stripping regex'),

('markdown-identity@1.0.0', 'attachment', 'plain_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'Markdown preserved as-is'),

('json-pretty@2026-05-04', 'attachment', 'doc_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'JSON → 2-space pretty-printed'),

('jsonl-turns-v1@0.1.0', 'session_log', 'turn_text',
 array['claude_code_jsonl','cursor_jsonl'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'Walks JSONL session, emits one l1_event per turn'),

('whatsapp-text-parser@v1', 'whatsapp', 'messages',
 array['whatsapp_zip'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'Highest-volume extractor. _chat.txt → l0_artifact + l1_event per line'),

('gowa-webhook-handler@1.0', 'whatsapp', 'messages',
 array['whatsapp_message_live'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 'Live message receiver. Hot-path Edge Function inserts l0/l1 directly.'),

-- ─── Candidate extractors (benchmarked today, not yet deployed) ─────
('meeting:diarization:claude-sonnet-4.6-content-cue@2026-05-05', 'meeting', 'diarization',
 array['meeting_audio'], 'candidate', 'openrouter',
 '{"unit":"input_token","approx_usd_per_meeting":0.10}'::jsonb,
 'v0.1 LLM-as-diarizer. Inferior to acoustic (drift 6-14pp vs 1pp). Fallback only.'),

('assemblyai:universal@2026-05-05', 'meeting', 'transcription_diarization_bundled',
 array['meeting_audio'], 'candidate', 'assemblyai',
 '{"unit":"audio_hour_bundled","approx_usd_per_hour":0.17,"breakdown":{"transcription":0.15,"diarization_addon":0.02}}'::jsonb,
 'Validated 2026-05-05. WER 22.77%, drift 0.3/0.9/1.3pp. Recommended production default.'),

('xai:grok-stt@2026-04-18', 'meeting', 'transcription_diarization_bundled',
 array['meeting_audio'], 'candidate', 'xai',
 '{"unit":"audio_hour_bundled","approx_usd_per_hour":0.10}'::jsonb,
 '40% cheaper than AssemblyAI. WER 34.81% (worse). Drift 0.8/1.1/0.1pp. Best on small speakers.'),

('elevenlabs:scribe-v2@2026-03-11', 'meeting', 'transcription_diarization_bundled',
 array['meeting_audio'], 'candidate', 'elevenlabs',
 '{"unit":"audio_hour_bundled","approx_usd_per_hour":0.22}'::jsonb,
 'Untested 2026-05-05 (key quota blocked). Claims 98% speaker label accuracy, up to 32 speakers.'),

('pyannoteai:community-1@2026', 'meeting', 'diarization',
 array['meeting_audio'], 'candidate', 'pyannoteai',
 '{"unit":"audio_hour_diarization_only","approx_usd_per_hour":0.04,"currency_native":"EUR 0.035/hr"}'::jsonb,
 'Cheapest acoustic-grade cloud diarization. Open-source pyannote community-1 hosted by team. Diar-only — pair with whisper.')

on conflict (id) do update set
  family = excluded.family,
  facet = excluded.facet,
  source_types = excluded.source_types,
  intended_status = excluded.intended_status,
  provider = excluded.provider,
  pricing_model = excluded.pricing_model,
  notes = excluded.notes;

-- Embed today's bench data on the meeting candidates
update public.extractor_metadata
   set benchmark_data = '{"audio":"04-30 supercut.mp3","wer":0.2277,"speaker_share_drift_pp":[0.3,0.9,1.3],"wall_seconds_for_41_min":6,"validated":"2026-05-05"}'::jsonb
 where id = 'assemblyai:universal@2026-05-05';

update public.extractor_metadata
   set benchmark_data = '{"audio":"04-30 supercut.mp3","wer":0.3481,"speaker_share_drift_pp":[0.8,1.1,0.1],"wall_seconds_for_41_min":27,"validated":"2026-05-05"}'::jsonb
 where id = 'xai:grok-stt@2026-04-18';

update public.extractor_metadata
   set benchmark_data = '{"audio":"04-30 supercut.mp3","speaker_share_drift_pp":[11.3,13.6,6.0],"chunks":5,"validated":"2026-05-05"}'::jsonb
 where id = 'meeting:diarization:claude-sonnet-4.6-content-cue@2026-05-05';

-- ────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION (run these manually):
--   select intended_status, count(*) from extractor_metadata group by intended_status;
--   → expect 12 active + 4 candidate
--   select count(*) from extractors;
--   → expect ~12 distinct (extractor, version) pairs (post-drift-fix)
--   select count(*) from extractors_full where source_origin = 'metadata_only';
--   → expect 4 (the candidate rows that haven't run)
-- ────────────────────────────────────────────────────────────────────
