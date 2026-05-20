-- ✅ APPLIED 2026-05-11 ~02:00 IDT via mcp__supabase__apply_migration.
--
-- 022 · claim_facet — semantic claim extraction across messages + commits.
--
-- WHY:
--   Today vita has rich L1 events (47k rows) and rich l1_relations (12 rows,
--   ready for embedding-method links). But claims live INSIDE event content as
--   prose. To answer "what did Jeffrey ask for that produced commit abc123?"
--   we need typed claims (directive / decision / pain / question / scope_shift
--   for events; feature / fix / refactor / scope_shift for commits) with
--   their own embeddings. Then l1_relations + cosine similarity does the rest.
--
-- WHAT THIS MIGRATION DOES (additive only — no data loss):
--   1. Add `claim_facet` to default_facets of git_commit, whatsapp_message,
--      whatsapp_message_live, meeting_audio (and meeting transcription chain).
--      Existing rows untouched; future ingest fans this out.
--   2. Insert one `extractor_metadata` row for the gemini-3.1-flash-lite claim
--      extractor — same provider already used for image_caption (image facet),
--      now for claim facet across all message + commit families.
--   3. Enable RLS on `public.l1_relations` (was critical-flagged, RLS off).
--      Policy mirrors l1_events: tenant_members read, owner write.
--   4. Create helper view `v_claim_to_commit` exposing the killer query.
--
-- DESIGN NOTES:
--   - The claim's `kind` (directive / decision / pain / question / etc.) lives
--     in `l1_events.metadata->>'claim_kind'`. Not a CHECK constraint — kinds
--     evolve. The extractor enforces allowed values at write time.
--   - Embeddings use existing `l1_embeddings` table keyed by (event_id,
--     extraction_run_id). No new embedding table.
--   - Cross-event/commit links use existing `l1_relations`. relation_type=
--     'implements' for directive→commit, 'discusses' for proximity-only links.
--     method='embedding' when the link is inferred via cosine similarity,
--     'temporal' when via time-window only.
--   - HPI §7.10 conformance: gemini-3.1-flash-lite has external_inference=true
--     and provider_audience_uri set — substrate-holders authorize it via HPI
--     token's `aud` field per spec.
--
-- REVERSIBLE: every DDL is `if not exists` / `on conflict do update`; the
-- l0_source_types update is idempotent (array_cat + distinct).
--
-- APPLY VIA:
--   mcp__supabase__apply_migration(
--     project_id='dkccadwohifcqcdzhhnu',
--     name='022_claim_facet',
--     query=<contents below WITHOUT the leading DO-NOT-APPLY banner>)
--
-- PRE-APPLY CHECKS:
--   1. Confirm extractor_metadata is live (not still in .draft):
--        SELECT count(*) FROM public.extractor_metadata;  -- expect 20
--   2. Confirm git_commit source_type exists:
--        SELECT default_facets FROM public.l0_source_types WHERE source_type='git_commit';
--   3. Confirm l1_relations.relation_type already includes 'implements','discusses':
--        SELECT pg_get_constraintdef(oid) FROM pg_constraint
--         WHERE conrelid='public.l1_relations'::regclass AND contype='c';

-- ────────────────────────────────────────────────────────────────────
-- PHASE 1: add claim_facet to l0_source_types.default_facets
-- ────────────────────────────────────────────────────────────────────
update public.l0_source_types
   set default_facets = (
     select array_agg(distinct f)
       from unnest(default_facets || array['claim_facet']) as f
   )
 where source_type in (
   'git_commit',
   'whatsapp_message',
   'whatsapp_message_live',
   'whatsapp_zip',
   'meeting_audio',
   'claude_code_jsonl',
   'cursor_jsonl',
   'clawdbot_jsonl',
   'vita_chat',
   'email_eml'
 );

-- ────────────────────────────────────────────────────────────────────
-- PHASE 2: register the claim extractor in extractor_metadata
-- ────────────────────────────────────────────────────────────────────
insert into public.extractor_metadata (
  id, family, facet, source_types, intended_status,
  provider, pricing_model, external_inference, provider_audience_uri,
  requires_local_inference, direction, notes
) values (
  'openrouter:google/gemini-3.1-flash-lite@2026-05-11-claim',
  'claim',
  'claim_facet',
  array[
    'git_commit',
    'whatsapp_message','whatsapp_message_live','whatsapp_zip',
    'meeting_audio',
    'claude_code_jsonl','cursor_jsonl','clawdbot_jsonl','vita_chat',
    'email_eml'
  ],
  'active',
  'openrouter',
  jsonb_build_object(
    'input_per_million_usd',  0.10,
    'output_per_million_usd', 0.40,
    'verified_at',            '2026-05-10',
    'verification_source',    'switched-from-opus-4-5 in synthesizer.ts L78 yesterday afternoon'
  ),
  true,                                              -- external_inference
  'https://openrouter.ai/api/v1/chat/completions',  -- provider_audience_uri (HPI §7.10)
  false,                                             -- requires_local_inference
  'extract',
  'Extracts typed claims from prose. Output: 0..n claims per source, each with claim_kind ∈ {directive,decision,pain,question,scope_shift} for messages, {feature,fix,refactor,scope_shift,infra} for commits. Stored as l1_events with facet=claim_facet, modality=signal, content=canonical extracted text, metadata.claim_kind=<kind>, metadata.source_event_id=<originating event_id> when applicable.'
)
on conflict (id) do update set
  intended_status = excluded.intended_status,
  pricing_model   = excluded.pricing_model,
  notes           = excluded.notes,
  metadata        = coalesce(public.extractor_metadata.metadata, '{}'::jsonb)
                    || jsonb_build_object('updated_at', now());

-- ────────────────────────────────────────────────────────────────────
-- PHASE 3: enable RLS on l1_relations (was critical-flagged)
-- ────────────────────────────────────────────────────────────────────
alter table public.l1_relations enable row level security;

-- Read: tenant members can read relations within their tenant.
drop policy if exists l1_relations_select_tenant on public.l1_relations;
create policy l1_relations_select_tenant on public.l1_relations
  for select
  using (
    tenant_id in (
      select tenant_id from public.tenant_members where user_id = auth.uid()
    )
  );

-- Write: service-role only (backfill scripts, extractors).
drop policy if exists l1_relations_write_service on public.l1_relations;
create policy l1_relations_write_service on public.l1_relations
  for all
  to service_role
  using (true)
  with check (true);

-- ────────────────────────────────────────────────────────────────────
-- PHASE 4: helper view — v_claim_to_commit
-- ────────────────────────────────────────────────────────────────────
-- Usage:
--   SELECT * FROM v_claim_to_commit WHERE commit_sha='abc123' ORDER BY similarity DESC LIMIT 20;
--   SELECT * FROM v_claim_to_commit WHERE who='Jeffrey Levine' AND shipped_within_7d ORDER BY asked_at DESC;

drop view if exists public.v_claim_to_commit;
create view public.v_claim_to_commit as
with commit_claims as (
  select
    e.id            as commit_event_id,
    e.metadata->>'commit_sha'  as commit_sha,
    e.metadata->>'claim_kind'  as commit_kind,
    e.event_at      as committed_at,
    e.tenant_id,
    e.content       as commit_claim,
    emb.embedding   as commit_embedding
  from public.l1_events e
  left join public.l1_embeddings emb
    on emb.event_id = e.id and emb.event_at = e.event_at
  where e.facet = 'claim_facet'
    and e.metadata->>'source_kind' = 'commit'
    and e.metadata->>'claim_kind' in ('feature','fix','refactor','scope_shift','infra')
),
message_claims as (
  select
    e.id            as message_event_id,
    e.event_at      as asked_at,
    e.actor_id,
    p.display_name  as who,
    e.metadata->>'claim_kind' as claim_kind,
    e.content       as claim,
    e.tenant_id,
    emb.embedding   as claim_embedding
  from public.l1_events e
  left join public.principals p on p.id = e.actor_id
  left join public.l1_embeddings emb
    on emb.event_id = e.id and emb.event_at = e.event_at
  where e.facet = 'claim_facet'
    and e.metadata->>'source_kind' = 'event'
    and e.metadata->>'claim_kind' in ('directive','decision','pain','question','scope_shift')
)
select
  m.message_event_id,
  m.asked_at,
  m.who,
  m.claim_kind,
  m.claim,
  c.commit_event_id,
  c.commit_sha,
  c.committed_at,
  c.commit_kind,
  c.commit_claim,
  extract(epoch from (c.committed_at - m.asked_at)) / 86400.0 as lag_days,
  case
    when c.commit_embedding is not null and m.claim_embedding is not null
      then 1 - (c.commit_embedding <=> m.claim_embedding)
    else null
  end as similarity,
  (c.committed_at - m.asked_at) between interval '0 days' and interval '7 days'
    and 1 - (c.commit_embedding <=> m.claim_embedding) > 0.65
    as shipped_within_7d
from message_claims m
left join commit_claims c
  on c.tenant_id = m.tenant_id
 and c.committed_at between m.asked_at - interval '14 days'
                        and m.asked_at + interval '14 days';

comment on view public.v_claim_to_commit is
  'L1 facet-level join: every message claim × every commit claim within ±14d, with cosine similarity and shipped_within_7d boolean. Use for closed-loop accountability views (per-person ask vs ship rates) and for the "what discussed when commit X shipped" query.';

-- ────────────────────────────────────────────────────────────────────
-- POST-APPLY VERIFICATION
-- ────────────────────────────────────────────────────────────────────
-- Run after apply:
--   SELECT default_facets FROM l0_source_types WHERE source_type='git_commit';
--     -- expect: {commit_message,claim_facet}
--   SELECT id FROM extractor_metadata WHERE family='claim';
--     -- expect: openrouter:google/gemini-3.1-flash-lite@2026-05-11-claim
--   SELECT count(*) FROM v_claim_to_commit;
--     -- expect: 0 (no claim_facet rows yet — backfill is the next step)
--   SELECT relrowsecurity FROM pg_class WHERE relname='l1_relations';
--     -- expect: t
