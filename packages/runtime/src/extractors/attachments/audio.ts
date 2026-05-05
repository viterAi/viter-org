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
import { withLLMCallLog } from '../../llm-log/index.js';
import { createHash } from 'node:crypto';

export const AUDIO_DEFAULT_MODEL = 'openai/whisper-large-v3-turbo';
export const AUDIO_EXTRACTOR_VERSION = '2026-05-04';

function opusToWav(input: Buffer): Buffer {
  // Trigger.dev's ffmpeg extension sets FFMPEG_PATH; mac dev usually has
  // `ffmpeg` on PATH directly. Honor the env if present.
  const ffmpegBin = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const dir = mkdtempSync(join(tmpdir(), 'vita-audio-'));
  const inPath = join(dir, 'in.opus');
  const outPath = join(dir, 'out.wav');
  try {
    writeFileSync(inPath, input);
    const r = spawnSync(ffmpegBin, [
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

  const audioBytesIn = input.buf.length;
  const audioBytesSent = wav.length;
  const audioSha = createHash('sha256').update(input.buf).digest('hex');

  // Estimate audio duration. We always send 16-bit mono 16-kHz wav (transcoded
  // or not — opusToWav forces these params). 16000 Hz × 2 bytes/sample = 32000 bytes/s.
  // Subtract the typical 44-byte WAV header.
  const estimatedSeconds = Math.max(0, (audioBytesSent - 44) / 32000);

  const rawRequestRedacted: Record<string, unknown> = {
    model,
    input_audio: {
      format: 'wav',
      data_bytes: audioBytesSent,
      data_redacted: true,
    },
    response_format: 'verbose_json',
  };

  const t0 = Date.now();
  const data = await withLLMCallLog(
    ctx.logger,
    {
      model,
      promptVersion: AUDIO_EXTRACTOR_VERSION,
      scopeKind: ctx.scopeKind ?? 'attachment_audio',
      scopeKey: ctx.scopeKey ?? input.filename,
      parameters: {
        route: 'openrouter/audio/transcriptions',
        input_format: 'wav',
        response_format: 'verbose_json',
        transcoded_to_wav: needsTranscode,
        audio_bytes_in: audioBytesIn,
        audio_bytes_sent: audioBytesSent,
        audio_sha256: audioSha,
        filename: input.filename,
        source_mime: input.mime,
        estimated_seconds: estimatedSeconds,
      },
      // For audio calls we re-purpose the prompt-hash columns (Whisper has no
      // text "user prompt"; the audio bytes ARE the user input):
      //   user_prompt_hash  = sha256 of original audio buffer
      //   user_prompt_chars = number of audio milliseconds
      userPromptHash: audioSha,
      userPromptChars: Math.round(estimatedSeconds * 1000),
      systemPromptHash: ctx.biasingPrompt
        ? createHash('sha256').update(ctx.biasingPrompt).digest('hex')
        : undefined,
      // First-class audio columns set on START so the row is dense even
      // before the response lands (and survives if finish fails).
      audioSeconds: estimatedSeconds,
      audioFormat: 'wav',
      audioBytes: audioBytesSent,
      audioLanguage: ctx.languageHint,
      outputKind: 'transcript',
      rawRequest: rawRequestRedacted,
    },
    async () => {
      const data = await postTranscription({
        apiKey: ctx.openrouterApiKey!,
        model,
        audioB64,
        format: 'wav',
        callerMetadata: ctx.callerMetadata,
        prompt: ctx.biasingPrompt,
        language: ctx.languageHint,
      });

      // raw_response: small + safe — no audio bytes are echoed in the
      // /audio/transcriptions response, so we can persist the whole thing.
      const rawResponseRedacted: Record<string, unknown> = {
        text_chars: (data.text ?? '').length,
        duration: data.duration ?? null,
        language: data.language ?? null,
        model: data.model ?? null,
        provider: data.provider ?? null,
        id: data.id ?? null,
        usage: data.usage ?? null,
        n_segments: (data.segments ?? []).length,
      };

      return {
        result: data,
        finishExtras: {
          modelUsed: data.model ?? model,
          providerName: data.provider ?? 'openrouter',
          generationId: data.id ?? null,
          finishReason: 'stop',
          // Whisper bills per second — capture both cost + (sometimes-returned) seconds.
          // /audio/transcriptions response shape per OR docs: `usage.cost`, `usage.seconds`.
          costUsd: data.usage?.cost ?? null,
          rawResponse: rawResponseRedacted,
          metadataExtra: {
            audio_seconds: data.usage?.seconds ?? data.duration ?? null,
            audio_language: data.language ?? null,
            n_segments: (data.segments ?? []).length,
            chars: (data.text ?? '').length,
            transcoded_to_wav: needsTranscode,
            audio_bytes_in: audioBytesIn,
            audio_bytes_sent: audioBytesSent,
            audio_sha256: audioSha,
          },
        },
      };
    },
  );
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
