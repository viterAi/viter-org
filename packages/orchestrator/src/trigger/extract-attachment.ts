/**
 * extractAttachment — single fan-out task that handles ALL modalities.
 *
 * Replaces the standalone phase 3 (transcribe) + phase 4 (docs) scripts.
 * Phase 5 (images) lights up automatically — the dispatcher routes
 * `image/*` mime to gemini-3.1-flash-lite-preview.
 *
 * One task body, one model surface, one billing line, one observability
 * dashboard. Per-attachment retry: voice note #57 fails on a flaky
 * OpenRouter response, retries alone, doesn't block the other 104.
 */

import { schemaTask, tags, metadata, logger } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

import { dispatchExtract } from '@vita/runtime/extractors-attachments';
import { createLLMCallLogger } from '@vita/runtime/llm-log';

const ExtractAttachmentPayload = z.object({
  tenant_id: z.string().uuid(),
  artifact_id: z.string().uuid(),
  filename: z.string(),
  mime: z.string(),
  remote_path: z.string(),         // l0-whatsapp/<tenant>/<chat>/<filename>
  channel_id: z.string().uuid().nullable(),
  origin_at: z.string(),           // ISO
  actor_id: z.string().uuid().nullable(),
});

export const extractAttachment = schemaTask({
  id: 'extract-attachment',
  schema: ExtractAttachmentPayload,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30_000,
    randomize: true,
  },
  queue: { concurrencyLimit: 8 },           // cap OpenRouter parallelism per worker
  machine: { preset: 'small-1x' },
  maxDuration: 300,                          // 5 min per file is generous

  run: async (payload, { ctx }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Skip if a successful extraction run already exists for this artifact + facet.
    // Facet inferred from mime — audio→transcription, others→doc_text/image_caption.
    const facet = inferFacet(payload.mime, payload.filename);

    // Trigger.dev observability: tags make the run filterable in the UI;
    // metadata accumulates per-run stats (call count, total cost) visible in
    // the run sidebar without leaving the dashboard.
    await tags.add(`tenant:${payload.tenant_id}`);
    await tags.add(`facet:${facet}`);
    await tags.add(`artifact:${payload.artifact_id}`);
    metadata.set('llm.calls', 0).set('llm.cost_usd', 0).set('facet', facet);

    const { data: existing } = await supabase
      .from('l1_extraction_runs')
      .select('id')
      .eq('tenant_id', payload.tenant_id)
      .eq('artifact_id', payload.artifact_id)
      .eq('facet', facet)
      .eq('status', 'ok')
      .maybeSingle();

    if (existing) {
      return { skipped: true, reason: 'already-extracted', run_id: existing.id };
    }

    // Download bytes from Storage
    const { data: blob, error: dErr } = await supabase.storage
      .from('l0-whatsapp')
      .download(payload.remote_path);
    if (dErr || !blob) throw new Error(`download failed: ${dErr?.message}`);
    const buf = Buffer.from(await blob.arrayBuffer());

    // Build the LLM call logger — every OpenRouter call inside the extractor
    // opens/closes a public.llm_call_log row stamped with this trigger run id.
    const callerForFacet =
      facet === 'transcription' ? 'extractor.audio'
      : facet === 'image_caption' ? 'extractor.image'
      : 'extractor.doc';
    const llmLogger = createLLMCallLogger({
      db: supabase,
      tenantId: payload.tenant_id,
      caller: callerForFacet,
      triggerRunId: ctx.run.id,
      source: 'trigger:extract-attachment',
    });

    // Registry-driven model selection. Query public.extractor_metadata for the
    // cheapest active extractor whose facet matches. Falls back to the per-
    // extractor hardcoded default (e.g. AUDIO_DEFAULT_MODEL in audio.ts) if
    // the registry lookup fails OR returns no match — preserves prior behavior
    // when the registry is unseeded/down/misconfigured.
    let modelOverride: string | undefined;
    let registryToolKey: string | undefined;
    try {
      const { data: tool } = await supabase
        .from('extractor_metadata')
        .select('id, pricing_model')
        .eq('intended_status', 'active')
        .eq('direction', 'extract')
        .eq('facet', facet)
        .order('pricing_model->>usd_per_hour', { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (tool?.id) {
        // Registry id format: '<provider>:<model>@<version>' OR
        // '<plain-name>@<version>' for in-process tools (no colon, skipped here
        // since in-process tools don't return network model strings).
        const m = tool.id.match(/^([^:]+):(.+)@(.+)$/);
        if (m) {
          modelOverride = m[2];        // e.g. 'openai/whisper-large-v3-turbo'
          registryToolKey = tool.id;   // full registry id for audit
        }
      }
    } catch (err) {
      // Defensive: never let registry-lookup failure break extraction.
      // Audit trail captures the error; hardcoded default kicks in below.
      logger.warn(`registry lookup failed (using hardcoded default): ${(err as Error).message}`);
    }

    // Dispatch
    const t0 = Date.now();
    const result = await dispatchExtract(
      { buf, filename: payload.filename, mime: payload.mime },
      {
        openrouterApiKey: process.env.OPENROUTER_API_KEY,
        logger: llmLogger,
        modelOverride,
        scopeKind: 'l0_artifact',
        scopeKey: payload.artifact_id,
        // Forwarded to OpenRouter Broadcast → OTLP → openrouter-webhook
        // so the webhook can find the matching llm_call_log row to fill in
        // billing data, even for callers we haven't directly instrumented.
        callerMetadata: {
          tenant_id: payload.tenant_id,
          caller: callerForFacet,
          scope_kind: 'l0_artifact',
          scope_key: payload.artifact_id,
          trigger_run_id: ctx.run.id,
          trigger_task_id: ctx.task.id,
          source: 'trigger:extract-attachment',
          facet,
          channel_id: payload.channel_id ?? null,
          actor_id: payload.actor_id ?? null,
          // Registry-driven model selection metadata for audit.
          registry_tool_key: registryToolKey ?? null,
        },
      },
    );
    const wallMs = Date.now() - t0;

    if (!result) {
      return { skipped: true, reason: 'unsupported-mime', mime: payload.mime };
    }

    // Insert l1_extraction_run
    const { data: runIns, error: runErr } = await supabase
      .from('l1_extraction_runs')
      .insert({
        tenant_id: payload.tenant_id,
        artifact_id: payload.artifact_id,
        facet,
        extractor: result.extractor,
        version: result.version,
        parameters: { route: routeOf(result.extractor), source_mime: payload.mime },
        is_deterministic: result.is_deterministic,
        status: 'ok',
        started_at: new Date(t0).toISOString(),
        completed_at: new Date().toISOString(),
        metrics: { wall_ms: wallMs, ...result.metrics },
      })
      .select('id')
      .single();
    if (runErr || !runIns) throw new Error(`run insert: ${runErr?.message}`);
    const runId = runIns.id as string;

    // Insert l1_event
    const modality = result.kind === 'transcript' ? 'voice'
      : result.kind === 'image_caption' ? 'image'
      : result.kind === 'video_transcript' ? 'video'
      : 'file';

    const { error: evErr } = await supabase.from('l1_events').insert({
      tenant_id: payload.tenant_id,
      artifact_id: payload.artifact_id,
      extraction_run_id: runId,
      facet,
      event_at: payload.origin_at,
      position: 0,
      actor_id: payload.actor_id,
      channel_id: payload.channel_id,
      modality,
      content: result.text,
      ts_start_s: result.duration_s != null ? 0 : null,
      ts_end_s: result.duration_s,
      confidence: null,
      extraction_method: `${result.extractor}@${result.version}`,
      metadata: {
        filename: payload.filename,
        mime_type: payload.mime,
        kind: result.kind,
        language: result.language,
        duration_s: result.duration_s,
        chars: result.text.length,
        n_segments: result.segments.length,
        warnings: result.warnings,
        // Embed segments inline for now; if they grow large per type, split into l1_doc_chunks.
        segments: result.segments,
      },
    });
    if (evErr) throw new Error(`event insert: ${evErr.message}`);

    // For multi-page docs, also write l1_doc_chunks
    if (result.kind === 'doc_text' && result.segments.length > 1) {
      const chunkRows = result.segments.map((s: typeof result.segments[number], i: number) => ({
        tenant_id: payload.tenant_id,
        artifact_id: payload.artifact_id,
        extraction_run_id: runId,
        chunk_no: i,
        content: s.text,
        page: s.page ?? null,
        metadata: { filename: payload.filename },
      }));
      const { error: chErr } = await supabase.from('l1_doc_chunks').insert(chunkRows);
      if (chErr) console.error(`chunks insert failed: ${chErr.message}`);
    }

    // Promote as active extraction
    await supabase.from('l1_active_extraction').upsert({
      tenant_id: payload.tenant_id,
      artifact_id: payload.artifact_id,
      facet,
      active_run_id: runId,
      promoted_by: 'auto',
      reason: 'first-extract',
    });

    return {
      skipped: false,
      run_id: runId,
      facet,
      kind: result.kind,
      extractor: result.extractor,
      chars: result.text.length,
      wall_ms: wallMs,
    };
  },
});

function inferFacet(mime: string, filename: string): string {
  const m = mime.toLowerCase();
  const f = filename.toLowerCase();
  if (m.startsWith('audio/') || /\.(opus|ogg|mp3|wav|m4a|flac)$/.test(f)) return 'transcription';
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/.test(f)) return 'image_caption';
  return 'doc_text';
}

function routeOf(extractor: string): string {
  if (extractor.includes('whisper')) return 'openrouter/audio/transcriptions';
  if (extractor.startsWith('google/') || extractor.startsWith('openai/') || extractor.startsWith('anthropic/')) {
    return 'openrouter/chat-completions';
  }
  return 'in-process';
}
