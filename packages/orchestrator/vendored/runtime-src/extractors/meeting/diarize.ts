/**
 * Meeting diarization (v0.1: content-cue inference via LLM).
 *
 * Acoustic diarization (pyannote / AssemblyAI / Deepgram) is the gold
 * standard but requires a paid provider key. As an L1 facet that adds value
 * even without that, this module asks an OpenRouter chat model to attribute
 * each sentence in a transcribed chunk to a speaker, given a small set of
 * speaker hints (e.g. "M = technical L-stack talk, S = strategic timekeeper,
 * Y = quieter infra"). The output is a JSON array of `{speaker, text, char_start, char_end}`
 * with a per-segment `confidence` (0-1).
 *
 * This automates exactly what was done by hand on 2026-04-30 to produce
 * `meetings/2026-04-30/shaul-yitzhak-car-ikea-speaker-confidence.md` — the
 * heuristic that was later superseded by real diarization in supercut.json.
 *
 * Two-facet model:
 *   - facet='diarization'         (this module)         — content-cue, cheap
 *   - facet='diarization_acoustic' (future)             — real audio model, slow + paid
 *
 * Both can co-exist on the same artifact. The active pointer flips when a
 * better one lands; staleness propagates to L2 syntheses automatically via
 * the existing `mark_l2_stale_on_active_flip` trigger.
 */

import { createHash } from 'node:crypto';
import { postChatCompletion } from '../attachments/openrouter.js';
import { withLLMCallLog } from '../../llm-log/index.js';
import type { LLMCallLogger } from '../../llm-log/index.js';

export const DIARIZE_DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';
export const DIARIZE_EXTRACTOR_VERSION = '2026-05-05-content-cue';

export interface SpeakerHint {
  /** Short id, ideally one letter or short canonical-id. */
  id: string;
  /** Display name (full). */
  display: string;
  /** Free-text description of how this speaker sounds — used as the LLM's cue. */
  cues: string;
}

export interface DiarizedSegment {
  index: number;
  speaker: string;             // matches a SpeakerHint.id, or 'unknown'
  text: string;
  /** Char offsets within the chunk's input text. */
  char_start: number;
  char_end: number;
  /** Self-reported confidence 0-1. */
  confidence: number;
}

export interface DiarizeChunkArgs {
  openrouterApiKey: string;
  chunkIndex: number;
  /** The transcription text for this 10-min chunk (from transcribeMeeting output). */
  chunkText: string;
  speakers: SpeakerHint[];
  model?: string;
  /** Optional LLM-call logger. */
  logger?: LLMCallLogger;
  callerMetadata?: Record<string, string | number | null | undefined>;
  scopeKey?: string;
}

export interface DiarizeChunkResult {
  segments: DiarizedSegment[];
  modelUsed: string;
  promptCostUsd: number | null;
  completionTokens: number | null;
  wallMs: number;
  warning: string | null;
}

function buildPrompt(speakers: SpeakerHint[], chunkText: string): string {
  const speakerLines = speakers
    .map((s) => `  ${s.id}: ${s.display} — ${s.cues}`)
    .join('\n');
  return `You are diarizing a transcribed meeting fragment using content cues only (no audio). Speakers and their distinguishing cues:\n${speakerLines}\n  unknown: cannot attribute (too short, generic interjection, or ambiguous).\n\nTranscription text:\n"""${chunkText}"""\n\nReturn a JSON array (no prose around it) of segment objects in order, each shaped:\n  { "speaker": "<id>", "text": "<exact substring>", "char_start": <int>, "char_end": <int>, "confidence": <0-1 float> }\n\nRules:\n- Walk the transcription left-to-right. char_start/char_end refer to byte offsets in the input text above.\n- Concatenate consecutive sentences from the same speaker into ONE segment.\n- Use 'unknown' for fragments you cannot confidently attribute. Keep them as their own segment.\n- The text field must be the EXACT substring of the input (no edits, no merges across speakers).\n- Confidence is your subjective certainty for THAT segment — 0.95 for unmistakable cues, 0.5 for plausible, 0.2 for guesswork.\n\nReturn ONLY the JSON array.`;
}

function parseSegments(raw: string, chunkText: string): { segments: DiarizedSegment[]; warning: string | null } {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return { segments: [], warning: 'no JSON array in response' };
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch (err) {
    return { segments: [], warning: `JSON parse: ${(err as Error).message.slice(0, 80)}` };
  }
  if (!Array.isArray(arr)) return { segments: [], warning: 'response was not an array' };

  const out: DiarizedSegment[] = [];
  let warning: string | null = null;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i] as Record<string, unknown>;
    if (typeof r !== 'object' || r === null) continue;
    const speaker = String(r.speaker ?? 'unknown');
    const text = String(r.text ?? '');
    const char_start = Number(r.char_start ?? 0);
    const char_end = Number(r.char_end ?? 0);
    const confidence = Math.max(0, Math.min(1, Number(r.confidence ?? 0)));
    if (!text) continue;
    // Sanity: text should appear in chunkText at the claimed offset (best-effort).
    const slice = chunkText.slice(char_start, char_end);
    if (slice !== text && !chunkText.includes(text)) {
      warning = `segment ${i} text not found in chunk (drift at offset ${char_start})`;
    }
    out.push({ index: i, speaker, text, char_start, char_end, confidence });
  }
  return { segments: out, warning };
}

export async function diarizeChunk(args: DiarizeChunkArgs): Promise<DiarizeChunkResult> {
  const model = args.model ?? DIARIZE_DEFAULT_MODEL;
  const prompt = buildPrompt(args.speakers, args.chunkText);
  const promptHash = createHash('sha256').update(prompt).digest('hex');

  const t0 = Date.now();
  const exec = async () =>
    postChatCompletion({
      apiKey: args.openrouterApiKey,
      model,
      body: {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 16000,
      },
      callerMetadata: args.callerMetadata,
    });

  let resp;
  if (args.logger) {
    resp = await withLLMCallLog(
      args.logger,
      {
        model,
        promptVersion: DIARIZE_EXTRACTOR_VERSION,
        scopeKind: 'meeting_diarization',
        scopeKey: args.scopeKey ? `${args.scopeKey}#chunk-${args.chunkIndex}` : `chunk-${args.chunkIndex}`,
        parameters: {
          route: 'openrouter/chat/completions',
          n_speakers: args.speakers.length,
          chunk_chars: args.chunkText.length,
        },
        userPromptHash: promptHash,
        userPromptChars: args.chunkText.length,
        outputKind: 'chat',
        rawRequest: {
          model,
          messages: [{ role: 'user', content_redacted: true, content_chars: prompt.length }],
        },
      },
      async () => {
        const d = await exec();
        return {
          result: d,
          finishExtras: {
            modelUsed: d.model ?? model,
            providerName: d.provider ?? 'openrouter',
            generationId: d.id ?? null,
            finishReason: d.choices?.[0]?.finish_reason ?? null,
            promptTokens: d.usage?.prompt_tokens ?? null,
            completionTokens: d.usage?.completion_tokens ?? null,
          },
        };
      },
    );
  } else {
    resp = await exec();
  }
  const wallMs = Date.now() - t0;

  const text = resp.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('empty diarization response');
  const { segments, warning } = parseSegments(text, args.chunkText);

  return {
    segments,
    modelUsed: resp.model ?? model,
    promptCostUsd: null,
    completionTokens: resp.usage?.completion_tokens ?? null,
    wallMs,
    warning,
  };
}

/**
 * Diarize a whole meeting by running diarizeChunk over the transcription
 * chunks. Each chunk is independent — segments don't bridge chunk boundaries.
 */
export async function diarizeMeeting(args: {
  openrouterApiKey: string;
  /** Output of transcribeMeeting() — pass `result.chunks`. */
  chunks: Array<{ index: number; startSec: number; durationSec: number; text: string }>;
  speakers: SpeakerHint[];
  model?: string;
  logger?: LLMCallLogger;
  callerMetadata?: Record<string, string | number | null | undefined>;
  scopeKey?: string;
  concurrency?: number;
}): Promise<{
  perChunk: DiarizeChunkResult[];
  /** Flat segment list with chunk-relative offsets remapped to whole-meeting indices. */
  segments: Array<DiarizedSegment & { chunk_index: number; ts_start_s: number; ts_end_s: number }>;
  modelUsed: string;
}> {
  const concurrency = Math.max(1, Math.min(args.concurrency ?? 1, 4));
  const out: DiarizeChunkResult[] = new Array(args.chunks.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= args.chunks.length) return;
      const c = args.chunks[i]!;
      out[i] = await diarizeChunk({
        openrouterApiKey: args.openrouterApiKey,
        chunkIndex: c.index,
        chunkText: c.text,
        speakers: args.speakers,
        model: args.model,
        logger: args.logger,
        callerMetadata: args.callerMetadata,
        scopeKey: args.scopeKey,
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Flatten with timestamp interpolation: a segment at char k of N has
  // ts ≈ chunk.startSec + (k/N) * chunk.durationSec.
  const segments: Array<DiarizedSegment & { chunk_index: number; ts_start_s: number; ts_end_s: number }> = [];
  for (let i = 0; i < args.chunks.length; i++) {
    const chunk = args.chunks[i]!;
    const result = out[i];
    if (!result) continue;
    const N = Math.max(1, chunk.text.length);
    for (const seg of result.segments) {
      const ts_start_s = chunk.startSec + (seg.char_start / N) * chunk.durationSec;
      const ts_end_s = chunk.startSec + (seg.char_end / N) * chunk.durationSec;
      segments.push({ ...seg, chunk_index: chunk.index, ts_start_s, ts_end_s });
    }
  }

  return {
    perChunk: out,
    segments,
    modelUsed: out[0]?.modelUsed ?? (args.model ?? DIARIZE_DEFAULT_MODEL),
  };
}
