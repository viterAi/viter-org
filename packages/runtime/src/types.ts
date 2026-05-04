/**
 * Vita runtime — shared types for extractors and adapters.
 *
 * These mirror the schema in infra/supabase/migrations/20260504100*.sql.
 */

export type UUID = string;
export type ISOTimestamp = string;

export type Modality =
  | 'text'
  | 'voice'
  | 'image'
  | 'video'
  | 'tool_call'
  | 'file'
  | 'signal';

export type RunStatus = 'pending' | 'running' | 'ok' | 'failed' | 'cancelled';

/** Row from public.l0_artifacts */
export interface L0Artifact {
  id: UUID;
  tenant_id: UUID;
  source_type: string;
  source_uri: string;
  sha256: string;
  bytes: number | null;
  origin_at: ISOTimestamp;
  captured_at: ISOTimestamp;
  storage_url: string | null;
  inline_text: string | null;
  metadata: Record<string, unknown>;
}

/** Row from public.l1_extraction_runs (already inserted; passed to extractor) */
export interface ExtractionRun {
  id: UUID;
  tenant_id: UUID;
  artifact_id: UUID;
  facet: string;
  extractor: string;
  version: string;
  parameters: Record<string, unknown>;
  is_deterministic: boolean;
  status: RunStatus;
}

/** Shape of a row to be inserted into public.l1_events.
 *  id + created_at are server-generated; tenant_id/artifact_id/extraction_run_id
 *  are filled by the runner from the run context. */
export interface L1EventInsert {
  facet: string;
  event_at: ISOTimestamp;
  position: number;
  actor_id: UUID | null;
  channel_id: UUID | null;
  modality: Modality;
  content: string | null;
  ts_start_s: number | null;
  ts_end_s: number | null;
  byte_offset: number | null;
  line_no: number | null;
  page: number | null;
  confidence: number | null;
  extraction_method: string | null;
  metadata: Record<string, unknown>;
}

/** Helpers a runner gives an extractor so it can resolve FKs and load content. */
export interface ExtractorContext {
  /** principals.canonical_id → principals.id (or null if unknown) */
  resolveActor(canonicalId: string): Promise<UUID | null>;
  /** channels.(kind, identifier) → channels.id (or null if unknown) */
  resolveChannel(kind: string, identifier: string): Promise<UUID | null>;
  /** Returns the raw bytes/text for the artifact; reads inline_text if present, else fetches storage_url. */
  fetchContent(artifact: L0Artifact): Promise<string | Buffer>;
}

/** Extractor signature: pure async iterator from one L0 + one run → many L1 events. */
export type Extractor = (
  artifact: L0Artifact,
  run: ExtractionRun,
  ctx: ExtractorContext,
) => AsyncIterable<L1EventInsert>;
