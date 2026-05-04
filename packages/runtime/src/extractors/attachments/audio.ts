/**
 * Audio transcription via OpenRouter `openai/whisper-large-v3-turbo`.
 *
 * Input: opus / wav / mp3 bytes. opus gets transcoded to wav with ffmpeg first
 * (the OpenRouter endpoint accepts only wav/mp3 from the openai whisper
 * provider per testing on 2026-05-04).
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtractionInput, ExtractionResult, ExtractorContext } from './types';
import { postTranscription } from './openrouter';

export const AUDIO_DEFAULT_MODEL = 'openai/whisper-large-v3-turbo';
export const AUDIO_EXTRACTOR_VERSION = '2026-05-04';

function opusToWav(input: Buffer): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'vita-audio-'));
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

export async function extractAudio(
  input: ExtractionInput,
  ctx: ExtractorContext,
): Promise<ExtractionResult> {
  if (!ctx.openrouterApiKey) throw new Error('OPENROUTER_API_KEY required for audio extractor');

  const model = ctx.modelOverride ?? AUDIO_DEFAULT_MODEL;
  const lower = input.filename.toLowerCase();
  const needsTranscode = lower.endsWith('.opus') || lower.endsWith('.ogg');
  const wav = needsTranscode ? opusToWav(input.buf) : input.buf;
  const audioB64 = wav.toString('base64');

  const t0 = Date.now();
  const data = await postTranscription({
    apiKey: ctx.openrouterApiKey,
    model,
    audioB64,
    format: 'wav',
  });
  const wallMs = Date.now() - t0;

  const text = (data.text ?? '').trim();
  if (!text) throw new Error('empty transcript');

  return {
    kind: 'transcript',
    text,
    language: data.language ?? null,
    duration_s: data.duration ?? null,
    segments: (data.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      page: null,
      text: s.text,
    })),
    extractor: model,
    version: AUDIO_EXTRACTOR_VERSION,
    is_deterministic: false,
    metrics: {
      wall_ms: wallMs,
      chars: text.length,
      transcoded_to_wav: needsTranscode,
      model_used: data.model ?? model,
      provider: data.provider ?? 'openrouter',
      generation_id: data.id ?? '',
    },
    warnings: [],
  };
}
