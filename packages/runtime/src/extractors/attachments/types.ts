/**
 * Unified extraction result shape — every attachment extractor returns this,
 * regardless of mime/modality. Lets the dispatcher and the Trigger.dev task
 * speak one schema.
 */

export type ExtractionKind = 'transcript' | 'doc_text' | 'image_caption' | 'video_transcript';

export interface ExtractionSegment {
  /** Audio: seconds. Doc: page-relative offset. Image: bbox order. */
  start: number | null;
  end: number | null;
  /** Doc/PDF: 1-based page number. */
  page: number | null;
  text: string;
}

export interface ExtractionResult {
  kind: ExtractionKind;
  /** The canonical extracted text — what we put into l1_event.content. */
  text: string;
  /** ISO 639-1 if the extractor detected one (whisper, gemini). */
  language: string | null;
  /** Audio/video duration in seconds. null for static docs. */
  duration_s: number | null;
  /** Per-page (PDF), per-segment (audio), per-region (image). [] if not segmented. */
  segments: ExtractionSegment[];
  /** Identifier of the extractor — goes into l1_extraction_runs.extractor. */
  extractor: string;
  /** Semver of the extractor — goes into l1_extraction_runs.version. */
  version: string;
  /** Whether re-running the extractor on the same bytes yields the same output. */
  is_deterministic: boolean;
  /** Free-form metrics. Spread into l1_extraction_runs.metrics. */
  metrics: Record<string, unknown>;
  /** Recoverable issues. */
  warnings: string[];
}

export interface ExtractionInput {
  buf: Buffer;
  filename: string;
  mime: string;
}

export interface ExtractorContext {
  /** OpenRouter API key — required for LLM-routed extractors (audio/PDF/image). */
  openrouterApiKey?: string;
  /** Override default model for this extractor (advanced / eval). */
  modelOverride?: string;
  /**
   * Optional LLM call logger — when provided, every OpenRouter call inside
   * the extractor opens/closes a public.llm_call_log row. Logging is
   * best-effort and never throws. Constructed by the trigger.dev task or
   * standalone script with tenant_id + caller + (optional) trigger_run_id.
   */
  logger?: import('../../llm-log/index.js').LLMCallLogger;
  /** Scope tags stamped on every llm_call_log row (e.g. artifact id). */
  scopeKind?: string;
  scopeKey?: string;
  /**
   * Forwarded to OpenRouter as request-level `metadata` so OR's Broadcast
   * feature surfaces them as `trace.metadata.*` OTLP attributes — the
   * openrouter-webhook reads these to UPSERT the right llm_call_log row.
   * At minimum: tenant_id. Recommended: caller, scope_kind, scope_key,
   * trigger_run_id.
   */
  callerMetadata?: Record<string, string | number | null | undefined>;
  /** Whisper vocab biasing — seeds the model with proper nouns / domain terms. */
  biasingPrompt?: string;
  /** ISO 639-1 language hint (e.g. 'en', 'he'). Improves Whisper accuracy on non-English content. */
  languageHint?: string;
}
