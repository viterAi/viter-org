/**
 * Universal LLM call logger.
 *
 * Every OpenRouter (or direct-Anthropic) call should funnel through one of two
 * code paths that own the `llm_call_log` row lifecycle:
 *
 *   1. Synthesizer (`packages/runtime/src/synthesizers/synthesizer.ts`) — already
 *      writes its own row and back-links the result.
 *
 *   2. Attachment extractors (audio / image / pdf) — historically did NOT log,
 *      which is the gap this module closes. The trigger.dev task constructs
 *      a logger and threads it through `ExtractorContext`; standalone scripts
 *      can construct one too.
 *
 * Logging is best-effort: a failure to insert/update should NEVER take down
 * the actual LLM call. We swallow errors with a console.warn.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LLMCallStartArgs {
  model: string;                                   // 'openai/whisper-large-v3-turbo'
  parameters?: Record<string, unknown>;            // {route, format, temperature, …}
  promptVersion?: string;                          // 'whisper-benchmark-v1' | 'day-prompt-v2'
  scopeKind?: string;                              // 'meeting_audio' | 'whatsapp_attachment' | 'day'
  scopeKey?: string;                               // filename / artifact_id / 'YYYY-MM-DD'
  callerRef?: string;                              // uuid backref (l2_synthesis.id, eval_run.id, l1_extraction_runs.id)
  systemPromptHash?: string;
  userPromptChars?: number;
  userPromptHash?: string;
  // ─── audio-shape (set on start so they survive even if finish fails) ───
  audioSeconds?: number;                           // for /audio/transcriptions calls
  audioFormat?: string;                            // 'wav' | 'mp3' | 'opus' | 'm4a'
  audioBytes?: number;
  audioLanguage?: string;                          // ISO 639-1 hint passed in
  outputKind?: string;                             // 'chat' | 'transcript' | 'embedding' | 'image_caption'
  // ─── debug payloads (small + safe; bytes redacted) ─────────────────────
  rawRequest?: Record<string, unknown>;
}

export interface LLMCallFinishArgs {
  status: 'ok' | 'failed' | 'timeout' | 'cancelled';
  modelUsed?: string | null;
  providerName?: string | null;
  generationId?: string | null;
  finishReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  latencyMs: number;
  generationTimeMs?: number | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  /** Small redacted response — bytes/base64 stripped; safe to persist. */
  rawResponse?: Record<string, unknown> | null;
  /** Free-form per-call metrics merged into row.metadata jsonb. */
  metadataExtra?: Record<string, unknown>;
}

export interface LLMCallLogger {
  start(args: LLMCallStartArgs): Promise<string | null>;
  finish(id: string | null, args: LLMCallFinishArgs): Promise<void>;
}

export interface LLMCallLoggerSpec {
  db: SupabaseClient;
  tenantId: string;
  caller: string;                              // 'extractor.audio' | 'extractor.image' | 'transcription.benchmark' | …
  /** Trigger.dev run id, when invoked from a trigger task — stamped into metadata for filterability. */
  triggerRunId?: string;
  /** Trigger.dev task id ('extract-attachment', 'ingest-zip', …). */
  triggerTaskId?: string;
  /** Free-form provenance — script path or task id. */
  source?: string;
  /** OpenTelemetry session id (e.g. one trigger.dev run = one session). */
  sessionId?: string;
  /** dev | staging | prod — used by the rollup view to gate prod cost alerts. */
  environment?: string;
  /** Default tags — appended to row.tags on insert. */
  tags?: string[];
}

export function createLLMCallLogger(spec: LLMCallLoggerSpec): LLMCallLogger {
  return {
    async start(args) {
      const baseMetadata: Record<string, unknown> = {};
      if (spec.source) baseMetadata.source = spec.source;
      if (spec.triggerRunId) baseMetadata.trigger_run_id = spec.triggerRunId;

      const row: Record<string, unknown> = {
        tenant_id: spec.tenantId,
        caller: spec.caller,
        prompt_version: args.promptVersion ?? null,
        scope_kind: args.scopeKind ?? null,
        scope_key: args.scopeKey ?? null,
        caller_ref: args.callerRef ?? null,
        model_requested: args.model,
        parameters: args.parameters ?? {},
        system_prompt_hash: args.systemPromptHash ?? null,
        user_prompt_chars: args.userPromptChars ?? null,
        user_prompt_hash: args.userPromptHash ?? null,
        status: 'running',
        started_at: new Date().toISOString(),
        metadata: baseMetadata,
        trigger_run_id: spec.triggerRunId ?? null,
        trigger_task_id: spec.triggerTaskId ?? null,
        session_id: spec.sessionId ?? null,
        environment: spec.environment ?? null,
        tags: spec.tags ?? [],
        audio_seconds: args.audioSeconds ?? null,
        audio_format: args.audioFormat ?? null,
        audio_bytes: args.audioBytes ?? null,
        audio_language: args.audioLanguage ?? null,
        output_kind: args.outputKind ?? null,
        raw_request: args.rawRequest ?? null,
      };

      const { data, error } = await spec.db
        .from('llm_call_log')
        .insert(row)
        .select('id')
        .single();

      if (error) {
        console.warn(`[llm-log] start insert failed (caller=${spec.caller}): ${error.message}`);
        return null;
      }
      return data.id as string;
    },

    async finish(id, args) {
      if (!id) return;

      const baseMetadata: Record<string, unknown> = {};
      if (spec.source) baseMetadata.source = spec.source;
      if (spec.triggerRunId) baseMetadata.trigger_run_id = spec.triggerRunId;
      if (args.metadataExtra) Object.assign(baseMetadata, args.metadataExtra);

      // Sparse update: only set columns we actually have values for, so we
      // never clobber a value set on start (e.g. audio_language='en' set on
      // start should survive even if the response omits the language echo).
      const update: Record<string, unknown> = {
        status: args.status,
        completed_at: new Date().toISOString(),
        latency_ms: args.latencyMs,
        metadata: baseMetadata,
      };
      if (args.modelUsed != null) update.model_used = args.modelUsed;
      if (args.providerName != null) update.provider_name = args.providerName;
      if (args.generationId != null) update.generation_id = args.generationId;
      if (args.finishReason != null) update.finish_reason = args.finishReason;
      if (args.promptTokens != null) update.prompt_tokens = args.promptTokens;
      if (args.completionTokens != null) update.completion_tokens = args.completionTokens;
      if (args.reasoningTokens != null) update.reasoning_tokens = args.reasoningTokens;
      if (args.cachedTokens != null) update.cached_tokens = args.cachedTokens;
      if (args.totalTokens != null) update.total_tokens = args.totalTokens;
      if (args.costUsd != null) {
        update.cost_usd = args.costUsd;
        update.cost_source = 'caller';
      }
      if (args.generationTimeMs != null) update.generation_time_ms = args.generationTimeMs;
      if (args.errorMessage != null) update.error_message = args.errorMessage;
      if (args.errorCode != null) update.error_code = args.errorCode;
      if (args.rawResponse != null) update.raw_response = args.rawResponse;
      // Audio-specific (whisper / gpt-audio) — first-class columns added in
      // migration 010 so dashboards can query without jsonb path expressions.
      // Only overwrite when finish has a value — preserves start values.
      const m = args.metadataExtra ?? {};
      if (typeof m.audio_seconds === 'number') update.audio_seconds = m.audio_seconds;
      if (typeof m.audio_format === 'string') update.audio_format = m.audio_format;
      if (typeof m.audio_bytes_sent === 'number') update.audio_bytes = m.audio_bytes_sent;
      if (typeof m.audio_language === 'string') update.audio_language = m.audio_language;
      if (typeof m.n_segments === 'number') update.audio_n_segments = m.n_segments;
      if (typeof m.chars === 'number') update.output_chars = m.chars;
      if (typeof m.output_kind === 'string') update.output_kind = m.output_kind;

      const { error } = await spec.db.from('llm_call_log').update(update).eq('id', id);
      if (error) {
        console.warn(`[llm-log] finish update failed (caller=${spec.caller}): ${error.message}`);
      }
    },
  };
}

/** Wrap any async OpenRouter call so a logger row is opened/closed automatically. */
export async function withLLMCallLog<T>(
  logger: LLMCallLogger | undefined,
  startArgs: LLMCallStartArgs,
  fn: () => Promise<{
    result: T;
    finishExtras?: Partial<LLMCallFinishArgs>;
  }>,
): Promise<T> {
  const t0 = Date.now();
  const id = logger ? await logger.start(startArgs) : null;
  try {
    const { result, finishExtras } = await fn();
    if (logger) {
      await logger.finish(id, {
        status: 'ok',
        latencyMs: Date.now() - t0,
        ...(finishExtras ?? {}),
      });
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logger) {
      await logger.finish(id, {
        status: 'failed',
        latencyMs: Date.now() - t0,
        errorMessage: msg.slice(0, 500),
      });
    }
    throw err;
  }
}
