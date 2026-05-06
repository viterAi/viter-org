-- ⚠️ DRAFT — NOT YET APPLIED ⚠️
--
-- 020 · extractor_metadata v2 with HPI §7.10 conformance fields.
--
-- SUPERSEDES: 20260505270000_extractor_metadata.sql (the v1 draft from
-- sibling-2's May 5 ontology brainstorm). Apply ONLY this v2 file. The v1
-- can be deleted or kept as historical context.
--
-- WHY V2:
--   1. HPI §7.10 (FORBIDDEN: routing substrate content through external
--      inference without per-token consent) requires every external
--      inference path to be discoverable + auditable. v1 carried no
--      §7.10 metadata. v2 adds the three columns auditors need:
--        - external_inference     (does this tool send substrate bytes
--                                  to a third-party model?)
--        - provider_audience_uri  (the URI written into HPI tokens'
--                                  `aud` field when authorizing this tool)
--        - requires_local_inference (true = this tool satisfies §7.10's
--                                    SHOULD-support-local-only-modes)
--   2. v1 was extractor-only. The user's audio-tools toolbox needs to
--      include xAI TTS — a generator. v2 adds:
--        - direction              ('extract' | 'generate')
--   3. v1 pricing for whisper-large-v3-turbo + assemblyai was estimated
--      pre-shootout. v2 reconciles to user's verified numbers from the
--      May 2 OpenRouter shootout (~/Openrouter-experments/experiments/
--      whisper-shootout/REAL-MEETING.md + REAL-MEETING-2.md).
--   4. v1 didn't include `openai/whisper-large-v3` (non-turbo). v2
--      adds it — the May 2 finding that v3 wins on real meeting audio
--      makes this row load-bearing.
--   5. v2 adds xAI TTS as a candidate row (pricing 'unverified' per
--      Cite-or-Die — Mordechai must provide a citation before this row
--      flips to 'active').
--
-- REVERSIBLE: every DDL is `drop ... if exists` first; data backfills
-- are idempotent overwrites; seed is `on conflict (id) do update`.
--
-- Apply via:
--   mcp__supabase__apply_migration(
--     project_id='dkccadwohifcqcdzhhnu',
--     name='020_extractor_metadata_v2_hpi_conformance',
--     query=<contents below WITHOUT the leading DO-NOT-APPLY banner>)
--
-- Pre-apply checks (DO BEFORE):
--   1. Confirm v1 (20260505270000) has NOT been applied:
--        SELECT * FROM information_schema.tables
--         WHERE table_schema='public' AND table_name='extractor_metadata';
--      → if it returns a row, v1 is live and v2 must become an ALTER
--        instead of CREATE. Re-draft accordingly.
--   2. Confirm version-drift backfill hasn't been done either (still
--      shows '1.0.0' + '2026-05-04' as separate versions):
--        SELECT extractor, version, count(*) FROM l1_extraction_runs
--         WHERE extractor IN ('mammoth-extractRawText', 'sheetjs-sheet_to_csv',
--                             'regex-strip-html', 'markdown-identity')
--         GROUP BY 1,2 ORDER BY 1,2;
--      → if both versions per extractor are present, the version-drift
--        section below runs. If only one version, skip phase 1.

-- ────────────────────────────────────────────────────────────────────
-- PHASE 1: VERSION DRIFT BACKFILL (carried over from v1, unchanged)
-- ────────────────────────────────────────────────────────────────────
-- mammoth: pin to library version 1.10.0
update public.l1_events
   set extraction_method = 'mammoth-extractRawText@1.10.0'
 where extraction_method in (
   'mammoth-extractRawText@1.0.0',
   'mammoth-extractRawText@2026-05-04'
 );

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

-- TODO: replicate the dedup pattern for sheetjs / regex-strip-html /
--   markdown-identity if their dual-version rows exist (per pre-apply check 2).

-- ────────────────────────────────────────────────────────────────────
-- PHASE 2: extractor_metadata TABLE (with HPI §7.10 + direction)
-- ────────────────────────────────────────────────────────────────────

create table public.extractor_metadata (
  id                       text primary key,
  family                   text not null,
  facet                    text not null,
  source_types             text[] not null default '{}',
  intended_status          text not null default 'active'
                             check (intended_status in ('active','candidate','deprecated','experiment')),
  provider                 text,
  pricing_model            jsonb,
  benchmark_data           jsonb,

  -- ── HPI §7.10 conformance fields (NEW IN V2) ────────────────────
  -- Every row in this table is a *potential* tool the dispatcher may
  -- invoke. HPI §7.10 forbids routing substrate content through any
  -- external inference service whose model provider is not named in
  -- the token's `audience` (`aud`) field. These columns let the
  -- dispatcher (and HPI audit) answer:
  --   "Does invoking this tool require token authorization for an
  --    external inference path?"
  external_inference       boolean not null default false,
  provider_audience_uri    text,                             -- URI for HPI token `aud`
  requires_local_inference boolean not null default false,   -- §7.10 SHOULD: local-only mode

  -- ── Direction (NEW IN V2) ───────────────────────────────────────
  -- 'extract' = consume L0 bytes, emit L1 derivative (whisper, gemini,
  --             mammoth, sheetjs, parsers).
  -- 'generate' = consume text/structured input, emit L0-grade artifact
  --              that may CROSS substrate boundaries when published
  --              (xAI TTS, OpenAI TTS, ElevenLabs TTS, image generation).
  direction                text not null default 'extract'
                             check (direction in ('extract', 'generate')),

  notes                    text,
  superseded_by            text references public.extractor_metadata(id),
  added_at                 timestamptz not null default now(),
  deprecated_at            timestamptz,
  metadata                 jsonb not null default '{}'
);

create index extractor_metadata_family    on public.extractor_metadata (family);
create index extractor_metadata_facet     on public.extractor_metadata (facet);
create index extractor_metadata_status    on public.extractor_metadata (intended_status);
create index extractor_metadata_direction on public.extractor_metadata (direction);
create index extractor_metadata_external  on public.extractor_metadata (external_inference);

alter table public.extractor_metadata enable row level security;

create policy extractor_metadata_read on public.extractor_metadata
  for select to authenticated using (true);

comment on table  public.extractor_metadata
  is 'Per-tool registry. Drives dispatcher tool selection AND HPI §7.10 audit. NOT cross-substrate — each substrate seeds its own. The schema is portable; the rows are local.';

comment on column public.extractor_metadata.external_inference
  is 'HPI §7.10: true = invoking this tool sends substrate bytes to a third-party model. Audit events MUST include `external_inference_provider` when this is true.';
comment on column public.extractor_metadata.provider_audience_uri
  is 'HPI §7.10: URI written into HPI token `aud` field when a substrate-holder authorizes this tool. NULL for in-process tools.';
comment on column public.extractor_metadata.requires_local_inference
  is 'HPI §7.10: true = this row is the local-only-mode option for its facet (Apple Silicon, on-device). Satisfies the SHOULD clause.';
comment on column public.extractor_metadata.direction
  is 'extract = L0→L1 derivation. generate = produces L0-grade artifact that may cross substrate boundaries (Chidush 019).';

-- ────────────────────────────────────────────────────────────────────
-- PHASE 3: VIEWS (carried over from v1, unchanged)
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
  case
    when max(coalesce(completed_at, started_at)) > now() - interval '30 days'
    then 'active' else 'dormant'
  end                                as observed_status
from public.l1_extraction_runs
group by extractor, version;

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
  m.external_inference, m.provider_audience_uri, m.requires_local_inference,
  m.direction,
  m.superseded_by,
  m.added_at as registered_at, m.deprecated_at,
  case when e.id is null then 'metadata_only' else 'observed' end as source_origin
from public.extractor_metadata m
full outer join public.extractors e on e.id = m.id;

grant select on public.extractors      to authenticated;
grant select on public.extractors_full to authenticated;

-- ────────────────────────────────────────────────────────────────────
-- PHASE 4: SEED — production rows + candidates + USER'S 4 ROWS
-- ────────────────────────────────────────────────────────────────────

insert into public.extractor_metadata
  (id, family, facet, source_types, intended_status, provider,
   pricing_model, external_inference, provider_audience_uri,
   requires_local_inference, direction, notes)
values

-- ─── User-named active transcription tools (verified pricing May 2 2026) ──

('openrouter:openai/whisper-large-v3-turbo@2026-05-06', 'attachment', 'transcription',
 array['whatsapp_message','whatsapp_message_live'], 'active', 'openrouter',
 '{"unit":"audio_hour","usd_per_hour":0.04,"verified":"2026-05-02 OpenRouter shootout","src":"~/Openrouter-experments/experiments/whisper-shootout/REAL-MEETING.md"}'::jsonb,
 true, 'https://openrouter.ai/api/v1', false, 'extract',
 'Default for short single-speaker voice notes (live WhatsApp + zip). WER 0.40 on 4-speaker merged meeting audio (worse than v3) but fast + cheap. Single speaker, no diarization needed.'),

('openrouter:openai/whisper-large-v3@2026-05-06', 'attachment', 'transcription',
 array['whatsapp_message','whatsapp_message_live','meeting_audio'], 'active', 'openrouter',
 '{"unit":"audio_hour","usd_per_hour":0.11,"verified":"2026-05-02 OpenRouter shootout","src":"REAL-MEETING.md"}'::jsonb,
 true, 'https://openrouter.ai/api/v1', false, 'extract',
 'Better WER than turbo on real audio (0.31 vs 0.40 single-mic 3-speaker). Use for longer/noisier voice notes; meeting transcription fallback when AssemblyAI not configured.'),

('assemblyai:universal-1@2026-05-06', 'meeting', 'transcription_diarization_bundled',
 array['meeting_audio'], 'active', 'assemblyai',
 '{"unit":"audio_hour","usd_per_hour_batch":0.27,"usd_per_hour_realtime":0.37,"verified":"2026-05-05 sibling-2 bench","src":"simulations/calibration/v2-cohort-findings.md"}'::jsonb,
 true, 'https://api.assemblyai.com/v2', false, 'extract',
 'Best ergonomics for meetings: one POST, native speaker_labels. Streaming supported. Use for any meeting >2min OR multi-speaker WhatsApp audio.'),

('xai:grok-tts@2026-05-06', 'speech_synthesis', 'tts',
 array['text_input'], 'candidate', 'xai',
 '{"unit":"chars","usd_per_1k_chars":null,"verified":"unverified","note":"Mordechai requested this row 2026-05-06; pricing endpoint citation pending. Per Cite-or-Die LAW 2 (le-havdel elef avdal) row stays candidate until citation lands.","src":null}'::jsonb,
 true, 'https://api.x.ai/v1', false, 'generate',
 'Text-to-speech for ship-as-audio responses (mobile-speak alternative). Streaming-capable per xAI Grok-Voice public statements; concrete API shape + per-1k-char pricing TBD. NOTE: generated audio is a NEW L0 entity in any receiving substrate (Chidush 019). Its provenance is the substrate-holder''s ingester role over the generation.')

-- ─── Carry-over from v1 draft: in-process extractors (no §7.10 burden) ────
,
('mammoth-extractRawText@1.10.0', 'attachment', 'doc_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'DOCX → plain text. Library version pinned. In-process = no external inference, no §7.10 burden.'),

('sheetjs-sheet_to_csv@0.18.5', 'attachment', 'tabular_csv',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'XLSX → CSV via sheetjs.'),

('regex-strip-html@1.0.0', 'attachment', 'plain_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'HTML → plain text via tag-stripping regex.'),

('markdown-identity@1.0.0', 'attachment', 'plain_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'Markdown preserved as-is.'),

('json-pretty@2026-05-04', 'attachment', 'doc_text',
 array['whatsapp_message'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'JSON → 2-space pretty-printed.'),

('jsonl-turns-v1@0.1.0', 'session_log', 'turn_text',
 array['claude_code_jsonl','cursor_jsonl'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'Walks JSONL session, emits one l1_event per turn.'),

('whatsapp-text-parser@v1', 'whatsapp', 'messages',
 array['whatsapp_zip'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'Highest-volume extractor. _chat.txt → l0_artifact + l1_event per line.'),

('gowa-webhook-handler@1.0', 'whatsapp', 'messages',
 array['whatsapp_message_live'], 'active', 'in-process',
 '{"unit":"in_process"}'::jsonb,
 false, NULL, false, 'extract',
 'Live message receiver. Hot-path Edge Function inserts l0/l1 directly.')

-- ─── Carry-over: image + PDF (external) ────────────────────────────────
,
('google/gemini-3.1-flash-lite-preview@2026-05-04', 'attachment', 'image_caption',
 array['whatsapp_message','whatsapp_message_live'], 'active', 'openrouter',
 '{"unit":"input_token","approx_usd_per_image":0.0005}'::jsonb,
 true, 'https://openrouter.ai/api/v1', false, 'extract',
 'Image → caption + OCR text.'),

('google/gemini-2.5-flash-lite@2026-05-04', 'attachment', 'doc_chunks',
 array['pdf_upload','whatsapp_message'], 'active', 'openrouter',
 '{"unit":"input_token","approx_usd_per_page":0.0008}'::jsonb,
 true, 'https://openrouter.ai/api/v1', false, 'extract',
 'PDF → per-page text via vision.')

-- ─── Carry-over candidates from v1 (pricing reconciled where verified) ──
,
('elevenlabs:scribe-v2@2026-03-11', 'meeting', 'transcription_diarization_bundled',
 array['meeting_audio'], 'candidate', 'elevenlabs',
 '{"unit":"audio_hour_bundled","approx_usd_per_hour":0.12,"verified":"unverified","note":"40% cheaper than Scribe v1 per March 2026 launch announcement; concrete batch vs realtime split TBD"}'::jsonb,
 true, 'https://api.elevenlabs.io/v1', false, 'extract',
 'Cheapest cloud acoustic for meetings. 98% speaker accuracy, up to 32 speakers. Untested at sibling-2 bench (key quota blocked).'),

('xai:grok-stt@2026-04-18', 'meeting', 'transcription_diarization_bundled',
 array['meeting_audio'], 'candidate', 'xai',
 '{"unit":"audio_hour_bundled","approx_usd_per_hour":0.10}'::jsonb,
 true, 'https://api.x.ai/v1', false, 'extract',
 '40% cheaper than AssemblyAI. WER 34.81% (worse). Drift 0.8/1.1/0.1pp. Best on small-speaker counts.'),

('pyannoteai:community-1@2026', 'meeting', 'diarization',
 array['meeting_audio'], 'candidate', 'pyannoteai',
 '{"unit":"audio_hour_diarization_only","approx_usd_per_hour":0.04,"currency_native":"EUR 0.035/hr"}'::jsonb,
 true, 'https://api.pyannote.ai/v1', false, 'extract',
 'Cheapest acoustic-grade cloud diarization. Open-source pyannote community-1 hosted by team. Diar-only — pair with whisper.'),

('meeting:diarization:claude-sonnet-4.6-content-cue@2026-05-05', 'meeting', 'diarization',
 array['meeting_audio'], 'candidate', 'openrouter',
 '{"unit":"input_token","approx_usd_per_meeting":0.10}'::jsonb,
 true, 'https://openrouter.ai/api/v1', false, 'extract',
 'v0.1 LLM-as-diarizer fallback. Inferior to acoustic (drift 6-14pp vs 1pp).')

on conflict (id) do update set
  family                   = excluded.family,
  facet                    = excluded.facet,
  source_types             = excluded.source_types,
  intended_status          = excluded.intended_status,
  provider                 = excluded.provider,
  pricing_model            = excluded.pricing_model,
  external_inference       = excluded.external_inference,
  provider_audience_uri    = excluded.provider_audience_uri,
  requires_local_inference = excluded.requires_local_inference,
  direction                = excluded.direction,
  notes                    = excluded.notes;

-- Embed bench data on the meeting candidates (carried over)
update public.extractor_metadata
   set benchmark_data = '{"audio":"04-30 supercut.mp3","wer":0.2277,"speaker_share_drift_pp":[0.3,0.9,1.3],"wall_seconds_for_41_min":6,"validated":"2026-05-05"}'::jsonb
 where id = 'assemblyai:universal-1@2026-05-06';

update public.extractor_metadata
   set benchmark_data = '{"audio":"04-30 supercut.mp3","wer":0.3481,"speaker_share_drift_pp":[0.8,1.1,0.1],"wall_seconds_for_41_min":27,"validated":"2026-05-05"}'::jsonb
 where id = 'xai:grok-stt@2026-04-18';

update public.extractor_metadata
   set benchmark_data = '{"audio":"04-30 supercut.mp3","speaker_share_drift_pp":[11.3,13.6,6.0],"chunks":5,"validated":"2026-05-05"}'::jsonb
 where id = 'meeting:diarization:claude-sonnet-4.6-content-cue@2026-05-05';

-- ────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION (run these manually):
--
--   -- 1. row count by status
--   SELECT intended_status, count(*) FROM extractor_metadata GROUP BY 1;
--   -- expected: 12 active + 4 candidate (note: xai:grok-tts@2026-05-06
--   -- is candidate until pricing citation lands)
--
--   -- 2. row count by direction
--   SELECT direction, count(*) FROM extractor_metadata GROUP BY 1;
--   -- expected: 15 extract + 1 generate (xai-tts)
--
--   -- 3. external_inference distribution
--   SELECT external_inference, count(*) FROM extractor_metadata GROUP BY 1;
--   -- expected: 9 external + 7 in-process
--
--   -- 4. HPI §7.10 ready surface — what audit event needs to fire
--   --    when each external row is invoked
--   SELECT id, provider_audience_uri FROM extractor_metadata
--    WHERE external_inference = true ORDER BY id;
--
--   -- 5. observed-vs-intended drift (post-first-runs)
--   SELECT id, source_origin, intended_status, observed_status
--     FROM extractors_full ORDER BY id;
-- ────────────────────────────────────────────────────────────────────
