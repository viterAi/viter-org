/**
 * scripts/whatsapp-phase3-transcribe.ts
 *
 * Phase 3 of WhatsApp ingest — transcribe voice notes via OpenRouter.
 *
 * Mirrors viter-app's /api/transcribe pattern: OpenRouter chat completions
 * + input_audio multimodal content + format='opus'. Same OPENROUTER_API_KEY.
 *
 * Per the May 4 audio benchmark in this chat:
 *   whisper-large-v3      WER 0.311 — most reliable, $0.58/5h    (no chat-completions route)
 *   gpt-audio-mini        WER 0.489 — chat-completions, cheap   ✓ proven in viter app
 *   gpt-4o-mini-transcribe WER 0.470 — chat-completions
 * Voice notes are short (< 60s typical) so gpt-audio-mini accuracy is fine.
 *
 * For each l0_artifact(source_type='whatsapp_attachment', metadata.kind='audio')
 * in the target chat:
 *   1. Skip if l1_extraction_run(facet='transcription', status='ok') already exists.
 *   2. Download bytes from l0-whatsapp/<tenant>/<chat>/<filename>.
 *   3. POST to OpenRouter /v1/chat/completions with input_audio content.
 *   4. Insert l1_extraction_run + l1_event (modality='voice', content=transcript).
 *   5. Promote run as active extraction.
 *
 * Idempotent. Use --limit N for smoke tests.
 *
 * Usage:
 *   tsx scripts/whatsapp-phase3-transcribe.ts --tenant viter --chat shaul-direct --limit 3
 *   tsx scripts/whatsapp-phase3-transcribe.ts --tenant viter --chat shaul-direct
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENROUTER_API_KEY
 *      VITER_STT_MODEL (optional, default 'openai/gpt-audio-mini')
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServiceRoleClient } from '../packages/runtime/src/db.js';

interface Args {
  tenant: string;
  chat: string;
  limit: number;
  model: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    tenant: '',
    chat: '',
    limit: 0,
    model: process.env.VITER_STT_MODEL ?? 'openai/whisper-large-v3-turbo',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') out.tenant = argv[++i] ?? '';
    else if (a === '--chat') out.chat = argv[++i] ?? '';
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || 0;
    else if (a === '--model') out.model = argv[++i] ?? out.model;
  }
  if (!out.tenant || !out.chat) {
    console.error('Usage: tsx scripts/whatsapp-phase3-transcribe.ts --tenant <slug> --chat <slug> [--limit N] [--model <slug>]');
    process.exit(2);
  }
  return out;
}


interface TranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  error?: { message?: string; code?: string } | string;
  model?: string;
  provider?: string;
  id?: string;
}

/**
 * Convert an opus voice note to 16-bit 16 kHz mono WAV via ffmpeg.
 * OpenRouter's audio/transcriptions endpoint expects format: wav (per docs example).
 */
function opusToWav(input: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'wa-phase3-'));
  const inPath = join(dir, 'in.opus');
  const outPath = join(dir, 'out.wav');
  try {
    writeFileSync(inPath, input);
    const r = spawnSync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-i', inPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      outPath,
    ]);
    if (r.status !== 0) {
      throw new Error(`ffmpeg ${r.status}: ${r.stderr?.toString().slice(0, 300)}`);
    }
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function transcribeViaOpenRouter(
  audioBuf: Buffer,
  filename: string,
  apiKey: string,
  model: string,
): Promise<{
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  modelUsed: string;
  provider: string;
  generationId: string;
}> {
  // OpenRouter's docs example shows format='wav'. Transcode opus → wav.
  const wav = filename.toLowerCase().endsWith('.opus') ? opusToWav(audioBuf) : audioBuf;
  const audioB64 = wav.toString('base64');

  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vita.viter.ai',
      'X-OpenRouter-Title': 'vita whatsapp ingest phase3',
    },
    body: JSON.stringify({
      model,
      input_audio: { data: audioB64, format: 'wav' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as TranscriptionResponse;
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : data.error.message ?? data.error.code;
    throw new Error(`openrouter error: ${msg}`);
  }
  const text = (data.text ?? '').trim();
  if (!text) throw new Error('empty transcript');

  return {
    text,
    language: data.language,
    duration: data.duration,
    segments: data.segments,
    modelUsed: data.model ?? model,
    provider: data.provider ?? 'openrouter',
    generationId: data.id ?? '',
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required');

  console.log(`[phase3] model=${args.model} · tenant=${args.tenant} · chat=${args.chat}` + (args.limit ? ` · limit=${args.limit}` : ''));

  const db = createServiceRoleClient();

  const { data: tenantRow } = await db.from('tenants').select('id').eq('slug', args.tenant).single();
  if (!tenantRow) throw new Error(`tenant '${args.tenant}' not found`);
  const tenantId = tenantRow.id as string;

  const { data: channelRow } = await db
    .from('channels')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('kind', 'whatsapp')
    .eq('identifier', args.chat)
    .single();
  if (!channelRow) throw new Error(`channel 'whatsapp:${args.chat}' not found`);
  const channelId = channelRow.id as string;

  // 1. Find audio attachments (oldest first)
  const { data: audios } = await db
    .from('l0_artifacts')
    .select('id, source_uri, metadata, bytes, origin_at')
    .eq('tenant_id', tenantId)
    .eq('source_type', 'whatsapp_attachment')
    .eq('metadata->>chat_slug', args.chat)
    .eq('metadata->>kind', 'audio')
    .order('origin_at', { ascending: true });

  if (!audios || audios.length === 0) {
    console.log('[phase3] no audio attachments found');
    return;
  }
  console.log(`[phase3] ${audios.length} audio attachments`);

  // 2. Skip already-transcribed
  const audioIds = audios.map((a) => a.id as string);
  const done = new Set<string>();
  for (let i = 0; i < audioIds.length; i += 200) {
    const { data: runs } = await db
      .from('l1_extraction_runs')
      .select('artifact_id')
      .eq('tenant_id', tenantId)
      .eq('facet', 'transcription')
      .eq('status', 'ok')
      .in('artifact_id', audioIds.slice(i, i + 200));
    for (const r of runs ?? []) done.add(r.artifact_id as string);
  }
  console.log(`[phase3] ${done.size} already transcribed; ${audios.length - done.size} new`);

  // 3. Build filename → originating-message actor_id (and event_at) map
  const filenameToActor = new Map<string, string | null>();
  const filenameToEventAt = new Map<string, string>();
  {
    const { data: msgEvents } = await db
      .from('l1_events')
      .select('actor_id, event_at, metadata')
      .eq('tenant_id', tenantId)
      .eq('channel_id', channelId)
      .eq('facet', 'messages');
    for (const e of msgEvents ?? []) {
      const md = e.metadata as { attachment_filenames?: string[] };
      for (const fn of md.attachment_filenames ?? []) {
        filenameToActor.set(fn, e.actor_id as string | null);
        filenameToEventAt.set(fn, e.event_at as string);
      }
    }
  }
  console.log(`[phase3] resolved ${filenameToActor.size} filename→actor mappings`);

  // 4. Process each audio
  let nDone = 0;
  let nErr = 0;
  let totalBytes = 0;
  const remoteBase = `${args.tenant}/${args.chat}`;

  const pending = audios.filter((a) => !done.has(a.id as string));
  const target = args.limit > 0 ? Math.min(pending.length, args.limit) : pending.length;

  for (let i = 0; i < target; i++) {
    const a = pending[i]!;
    const attempt = i + 1;

    const filename = (a.metadata as { filename: string }).filename;
    const remotePath = `${remoteBase}/${filename}`;
    const sizeKB = ((a.bytes as number) / 1024).toFixed(1);
    process.stdout.write(`  [${attempt.toString().padStart(3)}/${target}] ${filename} (${sizeKB}K) … `);

    const t0 = Date.now();
    try {
      // Download
      const { data: blob, error: dErr } = await db.storage.from('l0-whatsapp').download(remotePath);
      if (dErr || !blob) throw new Error(`download: ${dErr?.message}`);
      const buf = Buffer.from(await blob.arrayBuffer());
      totalBytes += buf.length;

      // Transcribe via OpenRouter chat completions (whisper accepts opus directly)
      const r = await transcribeViaOpenRouter(buf, filename, apiKey, args.model);
      const wallMs = Date.now() - t0;

      // Insert extraction run
      const { data: runIns, error: runErr } = await db
        .from('l1_extraction_runs')
        .insert({
          tenant_id: tenantId,
          artifact_id: a.id,
          facet: 'transcription',
          extractor: args.model,
          version: '2026-05-04',
          parameters: { route: 'openrouter/chat-completions', input_format: 'opus' },
          is_deterministic: false,
          status: 'ok',
          started_at: new Date(t0).toISOString(),
          completed_at: new Date().toISOString(),
          metrics: {
            wall_ms: wallMs,
            chars: r.text.length,
            duration_s: r.duration ?? null,
            language: r.language ?? null,
            n_segments: r.segments?.length ?? 0,
            model_used: r.modelUsed,
            provider: r.provider,
            generation_id: r.generationId,
          },
        })
        .select('id')
        .single();
      if (runErr || !runIns) throw new Error(`run insert: ${runErr?.message}`);
      const runId = runIns.id as string;

      // Inherit actor + origin_at from originating message
      const actorId = filenameToActor.get(filename) ?? null;
      const eventAt = filenameToEventAt.get(filename) ?? (a.origin_at as string);

      // Insert event
      const { error: evErr } = await db.from('l1_events').insert({
        tenant_id: tenantId,
        artifact_id: a.id,
        extraction_run_id: runId,
        facet: 'transcription',
        event_at: eventAt,
        position: 0,
        actor_id: actorId,
        channel_id: channelId,
        modality: 'voice',
        content: r.text,
        confidence: null,
        extraction_method: `${args.model}@2026-05-04`,
        metadata: {
          filename,
          model_used: r.modelUsed,
          provider: r.provider,
          generation_id: r.generationId,
          language: r.language ?? null,
          duration_s: r.duration ?? null,
          chars: r.text.length,
          segments: r.segments ?? [],
        },
      });
      if (evErr) throw new Error(`event insert: ${evErr.message}`);

      // Promote as active extraction
      await db.from('l1_active_extraction').upsert({
        tenant_id: tenantId,
        artifact_id: a.id,
        facet: 'transcription',
        active_run_id: runId,
        promoted_by: 'auto',
        reason: 'first-transcription',
      });

      nDone++;
      const preview = r.text.replace(/\s+/g, ' ').slice(0, 70);
      console.log(`✓ ${(wallMs / 1000).toFixed(1)}s  "${preview}"`);
    } catch (err) {
      nErr++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg}`);
    }
  }

  console.log('');
  console.log(`[phase3] DONE`);
  console.log(`  audio attachments:    ${audios.length}`);
  console.log(`  already transcribed:  ${done.size}`);
  console.log(`  newly transcribed:    ${nDone}`);
  console.log(`  errors:               ${nErr}`);
  console.log(`  bytes streamed:       ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error('[phase3] fatal:', err);
  process.exit(1);
});
