/**
 * ingestMeeting — long-form audio → L0/L1 in vita Supabase.
 *
 * Triggered by the inbox-webhook Edge Function when an audio file lands at
 * `inbox/<tenant>/meetings/<meeting-slug>/<filename>.<ext>`.
 *
 * Flow (parallel to ingest-zip but for one audio file):
 *   1. Download audio bytes from the inbox bucket
 *   2. Resolve tenant; upsert channel(kind='meeting', identifier=<slug>)
 *   3. Insert l0_artifact(source_type='meeting_audio') — dedup on sha256
 *   4. Insert l1_extraction_run(facet='transcription') in 'running' state
 *   5. ffmpeg-chunk + Whisper-transcribe via runtime/extractors/meeting
 *   6. Insert N × l1_events(facet='transcription', modality='voice')
 *   7. Mark run 'ok' with metrics; promote l1_active_extraction
 *
 * Idempotency:
 *   - Top-level idempotencyKey on the inbox path (set by webhook)
 *   - DB-level via UNIQUE (tenant, sha256) on l0_artifacts
 *   - DB-level via UNIQUE (tenant, artifact, facet, extractor, version, parameters)
 *     on l1_extraction_runs — re-running picks up the same run row
 */

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

import { schemaTask, tasks } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  transcribeMeeting,
  MEETING_DEFAULT_MODEL,
  MEETING_EXTRACTOR_VERSION,
  MEETING_DEFAULT_CHUNK_MIN,
  MEETING_DEFAULT_BIAS_PROMPT,
  transcribeWithAssemblyAI,
  ASSEMBLYAI_EXTRACTOR_VERSION,
  ASSEMBLYAI_MODEL_ID,
} from '@vita/runtime/extractors-meeting';
import { createLLMCallLogger } from '@vita/runtime/llm-log';

const IngestMeetingPayload = z.object({
  tenant_slug: z.string(),
  meeting_slug: z.string(),
  inbox_path: z.string(),                                  // e.g. "viter/meetings/ahiya-2026-05-05/audio.m4a"
  inbox_bucket: z.string().default('inbox'),
  /** Optional override — defaults to MEETING_DEFAULT_CHUNK_MIN. */
  chunk_minutes: z.number().int().min(1).max(60).optional(),
  /** Smoke-test cap. 0 = full file. */
  max_minutes: z.number().int().min(0).max(360).default(0),
  /** ISO 639-1 language hint, e.g. 'en' / 'he'. */
  language: z.string().optional(),
  /** Override the default bias prompt. Pass empty string to disable. */
  bias_prompt: z.string().optional(),
});

type IngestMeetingInput = z.infer<typeof IngestMeetingPayload>;

export const ingestMeeting = schemaTask({
  id: 'ingest-meeting',
  schema: IngestMeetingPayload,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5000 },
  // Whisper chunks dominate runtime; small-2x (1 GB) is plenty since we
  // hold one wav chunk in memory at a time. medium-1x as a safety margin
  // for very long meetings.
  machine: { preset: 'medium-1x' },
  // Generous ceiling: 2-hour meeting × ~15 s/chunk Whisper = ~3 min wall-clock.
  // Add headroom for ffmpeg + retries.
  maxDuration: 1800,

  run: async (payload, { ctx }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const filename = basename(payload.inbox_path);
    const ext = extname(filename).toLowerCase().replace(/^\./, '');

    // ── 1. Resolve tenant ──
    const { data: tenant, error: tErr } = await supabase
      .from('tenants').select('id').eq('slug', payload.tenant_slug).single();
    if (tErr || !tenant) throw new Error(`tenant '${payload.tenant_slug}' not found: ${tErr?.message}`);
    const tenantId = tenant.id as string;

    // ── 2. Upsert channel(kind='meeting') ──
    const { data: chRow, error: chErr } = await supabase
      .from('channels')
      .upsert(
        {
          tenant_id: tenantId,
          kind: 'meeting',
          identifier: payload.meeting_slug,
          scope: 'tenant',
          display_name: `meeting: ${payload.meeting_slug}`,
          metadata: { ingest_source: 'inbox', inbox_path: payload.inbox_path },
        },
        { onConflict: 'tenant_id,kind,identifier' },
      )
      .select('id')
      .single();
    if (chErr || !chRow) throw new Error(`channel upsert: ${chErr?.message}`);
    const channelId = chRow.id as string;

    // ── 3. Download audio to /tmp; ffprobe needs a real file ──
    const tmpDir = mkdtempSync(join(tmpdir(), 'vita-meeting-in-'));
    const localAudioPath = join(tmpDir, filename);

    try {
      const { data: blob, error: dlErr } = await supabase.storage
        .from(payload.inbox_bucket)
        .download(payload.inbox_path);
      if (dlErr || !blob) throw new Error(`download ${payload.inbox_path}: ${dlErr?.message}`);

      const webStream = (blob as Blob).stream() as ReadableStream<Uint8Array>;
      await pipeline(Readable.fromWeb(webStream as never), createWriteStream(localAudioPath));

      // ── 4. l0_artifact (idempotent on sha256) ──
      // We compute sha256 + bytes via the extractor's own readFileSync path
      // (a no-op extra read here is the simplest correct thing; the file is
      // already on local disk, no network).
      // Actually: do it here so the artifact row lands BEFORE transcription.
      const audioBuf = (await import('node:fs')).readFileSync(localAudioPath);
      const audioSha = (await import('node:crypto'))
        .createHash('sha256').update(audioBuf).digest('hex');
      const audioBytes = audioBuf.length;

      const { data: existingArt } = await supabase
        .from('l0_artifacts')
        .select('id, metadata')
        .eq('tenant_id', tenantId)
        .eq('sha256', audioSha)
        .maybeSingle();

      let artifactId: string;
      if (existingArt) {
        artifactId = existingArt.id as string;
      } else {
        const { data: artRow, error: artErr } = await supabase
          .from('l0_artifacts')
          .insert({
            tenant_id: tenantId,
            source_type: 'meeting_audio',
            source_uri: `inbox://${payload.inbox_path}`,
            sha256: audioSha,
            bytes: audioBytes,
            origin_at: new Date().toISOString(),  // best-effort — caller can correct via UI later
            captured_at: new Date().toISOString(),
            storage_url: `${payload.inbox_bucket}/${payload.inbox_path}`,
            metadata: {
              filename,
              format: ext,
              channel_kind: 'meeting',
              channel_identifier: payload.meeting_slug,
              source_note: 'ingested via inbox-webhook',
            },
          })
          .select('id')
          .single();
        if (artErr || !artRow) throw new Error(`l0_artifact insert: ${artErr?.message}`);
        artifactId = artRow.id as string;
      }

      // ── 5. Choose extractor: AssemblyAI (bundled diarization) or Whisper ──
      const assemblyaiKey = process.env.ASSEMBLYAI_API_KEY;
      const useAssemblyAI = !!assemblyaiKey;

      const chunkMinutes = payload.chunk_minutes ?? MEETING_DEFAULT_CHUNK_MIN;
      const biasPrompt = payload.bias_prompt === ''
        ? null
        : (payload.bias_prompt ?? MEETING_DEFAULT_BIAS_PROMPT);

      const runParameters = useAssemblyAI
        ? {
            route: 'assemblyai/v2/transcript',
            speaker_labels: true,
            language: payload.language ?? null,
          }
        : {
            route: 'openrouter/audio/transcriptions',
            input_format: 'wav',
            response_format: 'verbose_json',
            chunk_minutes: chunkMinutes,
            max_minutes: payload.max_minutes,
            bias_prompt_present: !!biasPrompt,
            language: payload.language ?? null,
          };

      const extractor = useAssemblyAI ? ASSEMBLYAI_MODEL_ID : MEETING_DEFAULT_MODEL;
      const version = useAssemblyAI ? ASSEMBLYAI_EXTRACTOR_VERSION : MEETING_EXTRACTOR_VERSION;

      const { data: runRow, error: runErr } = await supabase
        .from('l1_extraction_runs')
        .upsert(
          {
            tenant_id: tenantId,
            artifact_id: artifactId,
            facet: 'transcription',
            extractor,
            version,
            parameters: runParameters,
            is_deterministic: false,
            status: 'running',
            started_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,artifact_id,facet,extractor,version,parameters' },
        )
        .select('id, status')
        .single();
      if (runErr || !runRow) throw new Error(`l1_extraction_run upsert: ${runErr?.message}`);
      const runId = runRow.id as string;

      if (runRow.status === 'ok') {
        return {
          tenant_id: tenantId,
          channel_id: channelId,
          artifact_id: artifactId,
          run_id: runId,
          chunks: 0,
          skipped: true,
          reason: 'run_already_ok',
        };
      }

      // ── 6. Transcribe ──
      const { data: artForOrigin } = await supabase
        .from('l0_artifacts').select('origin_at').eq('id', artifactId).single();
      const originAtMs = artForOrigin
        ? new Date(artForOrigin.origin_at as string).getTime()
        : Date.now();

      let eventRows: object[];
      let totalCost: number;
      let totalChars: number;
      let totalDurationS: number;
      let modelUsed: string;
      let chunkCount: number;

      if (useAssemblyAI) {
        // ── AssemblyAI path — one call, bundled speaker diarization ──
        const aaiResult = await transcribeWithAssemblyAI({
          apiKey: assemblyaiKey,
          audioPath: localAudioPath,
          language: payload.language,
        });

        totalDurationS = aaiResult.duration_s;
        totalChars = aaiResult.text.length;
        totalCost = aaiResult.cost_usd ?? 0;
        modelUsed = ASSEMBLYAI_MODEL_ID;
        chunkCount = aaiResult.utterances.length;

        // Each utterance → one l1_event; speaker label goes in metadata.
        eventRows = aaiResult.utterances.map((u, i) => ({
          tenant_id: tenantId,
          artifact_id: artifactId,
          extraction_run_id: runId,
          facet: 'transcription',
          event_at: new Date(originAtMs + u.start_ms).toISOString(),
          position: i,
          actor_id: null,
          channel_id: channelId,
          modality: 'voice',
          content: u.text,
          ts_start_s: u.start_ms / 1000,
          ts_end_s: u.end_ms / 1000,
          confidence: u.confidence,
          extraction_method: `${ASSEMBLYAI_MODEL_ID}@${ASSEMBLYAI_EXTRACTOR_VERSION}`,
          metadata: {
            speaker: u.speaker,
            utterance_index: i,
            utterance_chars: u.text.length,
            utterance_start_ms: u.start_ms,
            utterance_end_ms: u.end_ms,
            meeting_slug: payload.meeting_slug,
            transcript_id: aaiResult.transcript_id,
            language: aaiResult.language,
            cost_usd: aaiResult.cost_usd,
            wall_ms: aaiResult.wall_ms,
            n_words: u.words.length,
          },
        }));
      } else {
        // ── Whisper path (chunked via OpenRouter) ──
        const logger = createLLMCallLogger({
          db: supabase,
          tenantId,
          caller: 'extractor.meeting',
          triggerRunId: ctx?.run?.id,
          triggerTaskId: 'ingest-meeting',
          source: 'orchestrator/trigger/ingest-meeting.ts',
          environment: process.env.TRIGGER_ENV ?? 'dev',
          tags: ['meeting', `tenant:${payload.tenant_slug}`, `meeting:${payload.meeting_slug}`],
        });

        const openrouterKey = process.env.OPENROUTER_API_KEY;
        if (!openrouterKey) throw new Error('OPENROUTER_API_KEY is required');

        const result = await transcribeMeeting({
          audioPath: localAudioPath,
          openrouterApiKey: openrouterKey,
          chunkMinutes,
          maxMinutes: payload.max_minutes,
          biasPrompt: biasPrompt as string | null | undefined,
          languageHint: payload.language,
          logger,
          callerMetadata: {
            tenant_id: tenantId,
            caller: 'extractor.meeting',
            scope_kind: 'meeting_audio',
            scope_key: payload.meeting_slug,
            trigger_run_id: ctx?.run?.id ?? null,
          },
          scopeKey: payload.meeting_slug,
          concurrency: 2,
        });

        totalDurationS = result.totalDurationS;
        totalChars = result.totalChars;
        totalCost = result.chunks.reduce((s, c) => s + (c.costUsd ?? 0), 0);
        modelUsed = result.modelUsed;
        chunkCount = result.chunks.length;

        eventRows = result.chunks.map((c) => ({
          tenant_id: tenantId,
          artifact_id: artifactId,
          extraction_run_id: runId,
          facet: 'transcription',
          event_at: new Date(originAtMs + c.startSec * 1000).toISOString(),
          position: c.index,
          actor_id: null,
          channel_id: channelId,
          modality: 'voice',
          content: c.text,
          ts_start_s: c.startSec,
          ts_end_s: c.startSec + c.durationSec,
          confidence: null,
          extraction_method: `${result.modelUsed}@${result.version}`,
          metadata: {
            chunk_index: c.index,
            chunk_chars: c.text.length,
            chunk_duration_s: c.durationSec,
            chunk_start_s: c.startSec,
            chunk_end_s: c.startSec + c.durationSec,
            meeting_slug: payload.meeting_slug,
            wav_bytes: c.wavBytes,
            wav_sha256: c.wavSha256,
            audio_seconds_provider: c.audioSeconds,
            cost_usd: c.costUsd,
            wall_ms: c.wallMs,
            language: c.language,
            n_segments: c.segments.length,
            segments: c.segments,
          },
        }));
      }

      // ── 7. Insert l1_events ──
      await supabase.from('l1_events').delete().eq('extraction_run_id', runId);
      if (eventRows.length > 0) {
        const { error: evErr } = await supabase.from('l1_events').insert(eventRows);
        if (evErr) throw new Error(`l1_events insert: ${evErr.message}`);
      }

      // ── 8. Finalize run + promote active ──
      await supabase
        .from('l1_extraction_runs')
        .update({
          status: 'ok',
          completed_at: new Date().toISOString(),
          metrics: {
            chunks: chunkCount,
            chars: totalChars,
            duration_s: totalDurationS,
            cost_usd: totalCost,
            extractor: useAssemblyAI ? 'assemblyai' : 'whisper',
            source: 'orchestrator/trigger/ingest-meeting.ts',
          },
        })
        .eq('id', runId);

      await supabase
        .from('l1_active_extraction')
        .upsert(
          {
            tenant_id: tenantId,
            artifact_id: artifactId,
            facet: 'transcription',
            active_run_id: runId,
            promoted_by: 'auto',
            reason: 'ingest-meeting',
          },
          { onConflict: 'tenant_id,artifact_id,facet' },
        );

      // Fire L2 synthesis after successful transcription — non-blocking.
      await tasks.trigger('synthesize-meeting', {
        tenant_id: tenantId,
        channel_id: channelId,
        force: false,
      });

      return {
        tenant_id: tenantId,
        channel_id: channelId,
        artifact_id: artifactId,
        run_id: runId,
        chunks: chunkCount,
        chars: totalChars,
        duration_s: totalDurationS,
        cost_usd: totalCost,
        model: modelUsed,
        extractor: useAssemblyAI ? 'assemblyai' : 'whisper',
        skipped: false,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
});
