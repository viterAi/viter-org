/**
 * AssemblyAI Universal — bundled transcription + speaker diarization.
 *
 * Validated 2026-05-05 against the 04-30 "shaul-yitzhak-car-ikea" supercut:
 *   WER 22.77% · speaker share drift 0.3/0.9/1.3 pp · 6 s wall for 41 min
 *   Cost $0.116 for 41 min ($0.17/hr bundled: $0.15 transcription + $0.02 diarization)
 *
 * One API call (no chunking needed). AssemblyAI handles audio of any length
 * server-side. Returns utterances with per-word speaker labels.
 *
 * Flow:
 *   1. Upload audio bytes → upload_url
 *   2. POST /v2/transcript { audio_url, speaker_labels, speakers_expected? }
 *   3. Poll /v2/transcript/{id} until status=completed|error
 *   4. Return utterances (speaker-attributed segments) + full text
 */

export const ASSEMBLYAI_EXTRACTOR_VERSION = '2026-05-05';
export const ASSEMBLYAI_MODEL_ID = 'assemblyai:universal@2026-05-05';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com';

export interface AssemblyAIUtterance {
  speaker: string;       // 'A', 'B', 'C', …
  text: string;
  start_ms: number;      // milliseconds from audio start
  end_ms: number;
  confidence: number;    // 0-1
  words: Array<{
    text: string;
    start: number;       // ms
    end: number;         // ms
    confidence: number;
    speaker: string;
  }>;
}

export interface AssemblyAITranscribeArgs {
  apiKey: string;
  /** Local file path or readable buffer. */
  audioPath: string;
  /** Optional hint for number of speakers (improves diarization accuracy). */
  speakersExpected?: number;
  /** ISO 639-1 language code. Default: auto-detect. */
  language?: string;
  /** Poll interval in ms. Default 2000. */
  pollIntervalMs?: number;
  /** Max total wait seconds. Default 600 (10 min). */
  maxWaitSec?: number;
}

export interface AssemblyAITranscribeResult {
  transcript_id: string;
  text: string;
  utterances: AssemblyAIUtterance[];
  /** Total audio duration in seconds. */
  duration_s: number;
  /** Language detected or passed in. */
  language: string | null;
  /** Wall-clock ms for the whole operation. */
  wall_ms: number;
  /** Approximate cost in USD. */
  cost_usd: number | null;
}

export async function transcribeWithAssemblyAI(
  args: AssemblyAITranscribeArgs,
): Promise<AssemblyAITranscribeResult> {
  const t0 = Date.now();
  const pollMs = args.pollIntervalMs ?? 2000;
  const maxMs = (args.maxWaitSec ?? 600) * 1000;

  // ── 1. Upload audio ──
  const { readFileSync } = await import('node:fs');
  const audioBuf = readFileSync(args.audioPath);

  const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/v2/upload`, {
    method: 'POST',
    headers: {
      Authorization: args.apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: audioBuf,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '');
    throw new Error(`AssemblyAI upload failed ${uploadRes.status}: ${body.slice(0, 200)}`);
  }
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };

  // ── 2. Submit transcript job ──
  const submitBody: Record<string, unknown> = {
    audio_url: upload_url,
    speaker_labels: true,
  };
  if (args.speakersExpected) submitBody.speakers_expected = args.speakersExpected;
  if (args.language) submitBody.language_code = args.language;

  const submitRes = await fetch(`${ASSEMBLYAI_BASE}/v2/transcript`, {
    method: 'POST',
    headers: {
      Authorization: args.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(submitBody),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`AssemblyAI submit failed ${submitRes.status}: ${body.slice(0, 200)}`);
  }
  const { id: transcriptId } = (await submitRes.json()) as { id: string };

  // ── 3. Poll until done ──
  const pollUrl = `${ASSEMBLYAI_BASE}/v2/transcript/${transcriptId}`;
  let result: AssemblyAIRawTranscript | null = null;

  while (Date.now() - t0 < maxMs) {
    await sleep(pollMs);
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: args.apiKey },
    });
    if (!pollRes.ok) continue;
    const data = (await pollRes.json()) as AssemblyAIRawTranscript;
    if (data.status === 'error') {
      throw new Error(`AssemblyAI transcription error: ${data.error ?? 'unknown'}`);
    }
    if (data.status === 'completed') {
      result = data;
      break;
    }
  }

  if (!result) throw new Error(`AssemblyAI timed out after ${args.maxWaitSec ?? 600}s`);

  // ── 4. Normalise output ──
  const utterances: AssemblyAIUtterance[] = (result.utterances ?? []).map((u) => ({
    speaker: u.speaker,
    text: u.text,
    start_ms: u.start,
    end_ms: u.end,
    confidence: u.confidence,
    words: (u.words ?? []).map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      speaker: w.speaker,
    })),
  }));

  const duration_s = result.audio_duration ?? 0;
  // AssemblyAI pricing: $0.37/hr transcription + $0.04/hr speaker diarization
  const cost_usd = duration_s > 0 ? (duration_s / 3600) * 0.41 : null;

  return {
    transcript_id: transcriptId,
    text: result.text ?? '',
    utterances,
    duration_s,
    language: result.language_code ?? null,
    wall_ms: Date.now() - t0,
    cost_usd,
  };
}

// ── Internal types (AssemblyAI raw response shape) ──

interface AssemblyAIRawTranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  error?: string;
  audio_duration?: number;
  language_code?: string;
  utterances?: Array<{
    speaker: string;
    text: string;
    start: number;
    end: number;
    confidence: number;
    words?: Array<{
      text: string;
      start: number;
      end: number;
      confidence: number;
      speaker: string;
    }>;
  }>;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
