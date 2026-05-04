# infra/supabase

Vita's Supabase project (`dkccadwohifcqcdzhhnu` · us-west-1) lives here.

## Migrations

| File | What it sets up |
|---|---|
| [`20260504100000_l0_substrate.sql`](migrations/20260504100000_l0_substrate.sql) | tenants · memberships · principals · channels · l0_source_types registry · l0_artifacts |
| [`20260504100100_l1_extraction_runs.sql`](migrations/20260504100100_l1_extraction_runs.sql) | l1_extraction_runs · l1_events · l1_active_extraction (+ history audit) · l1_embeddings · l1_doc_chunks |
| [`20260504100200_l2_l3_with_staleness.sql`](migrations/20260504100200_l2_l3_with_staleness.sql) | l2_syntheses (+ citation integrity gate) · l3_surfaces · staleness propagation triggers · `l2_current` / `l3_current` views |

The Supabase GitHub integration (configured 2026-05-04) auto-applies any new file under `migrations/` when pushed to `main`.

## Architecture

### L0 → L1 → L2 → L3, with the seven refinements from the May 4 design review

- **L0 is immutable.** sha256 unique per tenant; immutability proof.
- **L1 is plural.** Each `(artifact, facet, extractor, version, parameters)` is its own *extraction run*. Same audio → many L1 projections (transcription, diarization, emotion, topic_segments). Upgrade whisper → new run, old run preserved, active pointer flips, dependent L2s auto-marked stale.
- **L1 events are universal.** One shape across chat / meeting / WhatsApp / email / OCR. Typed source-locator columns (`ts_start_s`, `byte_offset`, `line_no`, `page`) instead of jsonb-only.
- **`actor_id` and `channel_id`** are FK-typed (principals / channels), not loose text — so canonicalization happens at extraction time and "everything Jeffrey said" is one B-tree lookup.
- **Side tables for non-event projections** — `l1_embeddings` (pgvector), `l1_doc_chunks` (PDF chunks). Keeps `l1_events` narrow.
- **Citation integrity is a DB constraint.** Inserting an L2 synthesis with cited event_ids that don't exist throws — Yitzchak's L5 verification, made enforceable.
- **Staleness propagates automatically.** L1 active flip → triggers mark dependent L2s stale → triggers mark dependent L3 surfaces stale. Old L2/L3 stay queryable for reproducibility.

## Conventions

- All tenant-scoped tables have `tenant_id uuid` and tenant-bound RLS reading `public.current_tenant_id()` (resolved from `auth.uid()` via `tenant_memberships`).
- Writes for L1 layer happen via service_role (the runtime workers in `packages/runtime/`); UI never inserts directly into `l1_*`.
- Helper views `l2_current` and `l3_current` return latest non-superseded rows per scope/surface — what UIs read by default.

## Adding a new L0 source type

1. Insert one row in `l0_source_types` with the source name + default facets.
2. Write an extractor function in `packages/runtime/extractors/<source>.ts` with signature `(L0Artifact, ExtractionRun) => AsyncIterable<L1Event>`.
3. Hook a streamer in `adapters/<source>/` that creates the L0 row + queues an extraction run.
