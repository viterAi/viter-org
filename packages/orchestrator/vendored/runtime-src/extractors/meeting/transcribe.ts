/**
 * Long-form audio transcription, chunked.
 *
 * The single-file `attachments/audio.ts` extractor is fine for WhatsApp voice
 * notes (≤2 min). Meetings are 30–120 min and overflow Whisper's per-call
 * envelope, so we chunk with ffmpeg first, then transcribe chunks
 * sequentially (or with bounded parallelism), then stitch.
 *
 * Config baked in from the 2026-05-05 morning bake-off:
 *   - extractor:    openai/whisper-large-v3-turbo
 *   - chunk size:   10 minutes (best WER vs cost trade-off in benchmark)
 *   - bias prompt:  proper-noun seed (Mordechai, Shaul, Yitzchak, …)
 *   - input format: 16-kHz mono pcm_s16le wav (transcoded from any source)
 *
 * Reference benchmark on Ahiya 2026-05-05: WER 12.58 / CER 9.73 on 90 min.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { postTranscription, type OpenRouterTranscriptionResponse } from '../attachments/openrouter.js';
import { withLLMCallLog } from '../../llm-log/index.js';
import type { LLMCallLogger } from '../../llm-log/index.js';

export const MEETING_DEFAULT_MODEL = 'openai/whisper-large-v3-turbo';
export const MEETING_EXTRACTOR_VERSION = '2026-05-05';
export const MEETING_DEFAULT_CHUNK_MIN = 10;

/**
 * Default bias prompt — proper nouns + project vocab. Seeds Whisper so it
 * doesn't transcribe "Yitzchak" as "It's hawk" etc. This is the prompt that
 * won the bake-off when paired with whisper-large-v3-turbo.
 */
export const MEETING_DEFAULT_BIAS_PROMPT =
  'Mordechai, Shaul, Yitzchak, Jeffrey, Aviva, Insperanto, Viter, Persofi. ' +
  'L0, L1, L2, L3, SHELET, Supabase, Trigger.dev, OpenRouter, Whisper.';

export interface MeetingChunk {
  index: number;
  startSec: number;
  durationSec: number;
  /** Local wav path (transient — caller should rmSync the parent dir). */
  wavPath: string;
}

export interface MeetingChunkTranscript {
  index: number;
  startSec: number;
  durationSec: number;
  text: string;
  language: string | null;
  segments: Array<{ start: number; end: number; text: string }>;
  /** Bytes of the wav sent to OpenRouter (post-transcode). */
  wavBytes: number;
  /** sha256 of the wav payload — useful for idempotency / dedup. */
  wavSha256: string;
  /** Provider-reported audio seconds, when present (Whisper bills per-second). */
  audioSeconds: number | null;
  /** Provider-reported cost in USD, when present. */
  costUsd: number | null;
  /** Wall-clock ms for the OpenRouter call. */
  wallMs: number;
}

export interface MeetingTranscribeArgs {
  /** Local path to the audio file (any container ffmpeg can read). */
  audioPath: string;
  openrouterApiKey: string;
  model?: string;
  chunkMinutes?: number;
  /**
   * Cap the transcription at the first N minutes. 0 = full file. Useful for
   * smoke tests. Default 0.
   */
  maxMinutes?: number;
  biasPrompt?: string | null;
  languageHint?: string;
  /**
   * Optional logger — if present, every chunk transcription writes a row to
   * `llm_call_log`. The trigger task constructs one and threads it in.
   */
  logger?: LLMCallLogger;
  /** Caller metadata forwarded to OpenRouter as request `metadata`. */
  callerMetadata?: Record<string, string | number | null | undefined>;
  /** Bound the chunk-level concurrency. Default 1 (sequential). */
  concurrency?: number;
  /** Scope key for llm_call_log rows. Caller passes meeting slug or sha. */
  scopeKey?: string;
}

export interface MeetingTranscribeResult {
  chunks: MeetingChunkTranscript[];
  totalDurationS: number;
  totalChars: number;
  modelUsed: string;
  version: string;
  chunkMinutes: number;
  biasPromptHash: string | null;
  audioSha256: string;
  audioBytes: number;
}

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH ?? 'ffmpeg';
}

function ffprobeBin(): string {
  return process.env.FFPROBE_PATH ?? 'ffprobe';
}

function ffprobeDurationSec(path: string): number {
  const r = spawnSync(ffprobeBin(), [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    path,
  ]);
  if (r.status !== 0) {
    throw new Error(`ffprobe failed: ${r.stderr?.toString().slice(0, 300)}`);
  }
  return Number(r.stdout.toString().trim());
}

function chunkAudio(audioPath: string, chunkMin: number, maxMin: number, outDir: string, totalSec: number): MeetingChunk[] {
  const chunkSec = chunkMin * 60;
  const cap = maxMin > 0 ? Math.min(maxMin * 60, totalSec) : totalSec;
  const chunks: MeetingChunk[] = [];
  for (let i = 0; i * chunkSec < cap; i++) {
    const startSec = i * chunkSec;
    const dur = Math.min(chunkSec, cap - startSec);
    const wavPath = join(outDir, `chunk-${String(i).padStart(3, '0')}.wav`);
    chunks.push({ index: i, startSec, durationSec: dur, wavPath });
  }
  for (const c of chunks) {
    if (existsSync(c.wavPath)) continue;
    const r = spawnSync(ffmpegBin(), [
      '-y', '-loglevel', 'error',
      '-ss', String(c.startSec),
      '-t', String(c.durationSec),
      '-i', audioPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      c.wavPath,
    ]);
    if (r.status !== 0) {
      throw new Error(`ffmpeg chunk ${c.index}: ${r.stderr?.toString().slice(0, 300)}`);
    }
  }
  return chunks;
}

async function transcribeOneChunk(args: {
  chunk: MeetingChunk;
  apiKey: string;
  model: string;
  prompt?: string;
  language?: string;
  logger?: LLMCallLogger;
  callerMetadata?: Record<string, string | number | null | undefined>;
  scopeKey?: string;
}): Promise<MeetingChunkTranscript> {
  const wavBuf = readFileSync(args.chunk.wavPath);
  const wavSha = createHash('sha256').update(wavBuf).digest('hex');
  const audioB64 = wavBuf.toString('base64');

  const t0 = Date.now();
  const exec = async (): Promise<OpenRouterTranscriptionResponse> => {
    return await postTranscription({
      apiKey: args.apiKey,
      model: args.model,
      audioB64,
      format: 'wav',
      callerMetadata: args.callerMetadata,
      prompt: args.prompt,
      language: args.language,
    });
  };

  let data: OpenRouterTranscriptionResponse;
  if (args.logger) {
    data = await withLLMCallLog(
      args.logger,
      {
        model: args.model,
        promptVersion: MEETING_EXTRACTOR_VERSION,
        scopeKind: 'meeting_audio',
        scopeKey: args.scopeKey ? `${args.scopeKey}#chunk-${args.chunk.index}` : `chunk-${args.chunk.index}`,
        parameters: {
          route: 'openrouter/audio/transcriptions',
          input_format: 'wav',
          response_format: 'verbose_json',
          chunk_index: args.chunk.index,
          chunk_start_s: args.chunk.startSec,
          chunk_duration_s: args.chunk.durationSec,
          audio_bytes: wavBuf.length,
          audio_sha256: wavSha,
        },
        userPromptHash: wavSha,
        userPromptChars: Math.round(args.chunk.durationSec * 1000),
        systemPromptHash: args.prompt ? createHash('sha256').update(args.prompt).digest('hex') : undefined,
        audioSeconds: args.chunk.durationSec,
        audioFormat: 'wav',
        audioBytes: wavBuf.length,
        audioLanguage: args.language,
        outputKind: 'transcript',
        rawRequest: {
          model: args.model,
          input_audio: { format: 'wav', data_bytes: wavBuf.length, data_redacted: true },
          response_format: 'verbose_json',
          prompt_present: !!args.prompt,
        },
      },
      async () => {
        const d = await exec();
        return {
          result: d,
          finishExtras: {
            modelUsed: d.model ?? args.model,
            providerName: d.provider ?? 'openrouter',
            generationId: d.id ?? null,
            finishReason: 'stop',
            costUsd: d.usage?.cost ?? null,
            metadataExtra: {
              audio_seconds: d.usage?.seconds ?? d.duration ?? null,
              audio_language: d.language ?? null,
              n_segments: (d.segments ?? []).length,
              chars: (d.text ?? '').length,
            },
          },
        };
      },
    );
  } else {
    data = await exec();
  }
  const wallMs = Date.now() - t0;

  return {
    index: args.chunk.index,
    startSec: args.chunk.startSec,
    durationSec: args.chunk.durationSec,
    text: (data.text ?? '').trim(),
    language: data.language ?? null,
    segments: (data.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    })),
    wavBytes: wavBuf.length,
    wavSha256: wavSha,
    audioSeconds: data.usage?.seconds ?? data.duration ?? null,
    costUsd: data.usage?.cost ?? null,
    wallMs,
  };
}

/**
 * Chunk an audio file and transcribe each chunk. Caller is responsible for
 * downloading the audio to a local path and persisting the resulting events.
 */
export async function transcribeMeeting(args: MeetingTranscribeArgs): Promise<MeetingTranscribeResult> {
  const model = args.model ?? MEETING_DEFAULT_MODEL;
  const chunkMin = args.chunkMinutes ?? MEETING_DEFAULT_CHUNK_MIN;
  const maxMin = args.maxMinutes ?? 0;
  const prompt = args.biasPrompt === null ? undefined : args.biasPrompt ?? MEETING_DEFAULT_BIAS_PROMPT;

  const totalSec = ffprobeDurationSec(args.audioPath);
  const audioBuf = readFileSync(args.audioPath);
  const audioSha = createHash('sha256').update(audioBuf).digest('hex');

  const tmpDir = mkdtempSync(join(tmpdir(), 'vita-meeting-'));
  try {
    const chunks = chunkAudio(args.audioPath, chunkMin, maxMin, tmpDir, totalSec);

    const concurrency = Math.max(1, Math.min(args.concurrency ?? 1, 4));
    const transcripts: MeetingChunkTranscript[] = new Array(chunks.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const idx = cursor++;
        if (idx >= chunks.length) return;
        transcripts[idx] = await transcribeOneChunk({
          chunk: chunks[idx]!,
          apiKey: args.openrouterApiKey,
          model,
          prompt,
          language: args.languageHint,
          logger: args.logger,
          callerMetadata: args.callerMetadata,
          scopeKey: args.scopeKey,
        });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const totalChars = transcripts.reduce((s, c) => s + c.text.length, 0);

    return {
      chunks: transcripts,
      totalDurationS: totalSec,
      totalChars,
      modelUsed: model,
      version: MEETING_EXTRACTOR_VERSION,
      chunkMinutes: chunkMin,
      biasPromptHash: prompt ? createHash('sha256').update(prompt).digest('hex') : null,
      audioSha256: audioSha,
      audioBytes: audioBuf.length,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
