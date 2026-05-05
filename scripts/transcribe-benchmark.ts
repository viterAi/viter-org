/**
 * scripts/transcribe-benchmark.ts
 *
 * Benchmark OpenRouter Whisper variants against a known-good reference
 * transcript (the `Ahiya HaShiloni Street 2.md` benchmark for now).
 *
 * Pipeline:
 *   1. ffprobe duration
 *   2. ffmpeg → N-minute mono 16-kHz wav chunks (default 10 min, --max-min for partial)
 *   3. POST each chunk to OpenRouter /v1/audio/transcriptions
 *   4. Concatenate, normalize, compute WER + CER vs the reference
 *   5. Persist run output to scripts/transcribe-benchmark-out/<model>-<ts>/
 *   6. Log every API call to public.llm_call_log
 *      (caller='transcription.benchmark', scope_kind='meeting_audio', scope_key=basename)
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/transcribe-benchmark.ts \
 *     --audio "Ahiya HaShiloni Street 2.m4a" \
 *     --reference "Ahiya HaShiloni Street 2.md" \
 *     --model openai/whisper-large-v3-turbo \
 *     --chunk-min 10 \
 *     --max-min 10                # smoke test — 1 chunk
 *
 * Env: OPENROUTER_API_KEY (required)
 *      SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (optional — skip log if missing)
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { createServiceRoleClient } from '../packages/runtime/src/db.js';

interface Args {
  audio: string;
  reference: string;
  model: string;
  chunkMin: number;
  maxMin: number;          // 0 = whole file
  out: string;
  tenantSlug: string;
  scopeKey: string;        // defaults to basename(audio)
  prompt: string;          // optional whisper biasing prompt
  language: string;        // optional ISO 639-1 (en, he, …)
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    audio: '',
    reference: '',
    model: 'openai/whisper-large-v3-turbo',
    chunkMin: 10,
    maxMin: 0,
    out: '',
    tenantSlug: 'viter',
    scopeKey: '',
    prompt: '',
    language: '',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audio') out.audio = argv[++i] ?? '';
    else if (a === '--reference') out.reference = argv[++i] ?? '';
    else if (a === '--model') out.model = argv[++i] ?? out.model;
    else if (a === '--chunk-min') out.chunkMin = Number(argv[++i] ?? '10') || 10;
    else if (a === '--max-min') out.maxMin = Number(argv[++i] ?? '0') || 0;
    else if (a === '--out') out.out = argv[++i] ?? '';
    else if (a === '--tenant') out.tenantSlug = argv[++i] ?? 'viter';
    else if (a === '--scope-key') out.scopeKey = argv[++i] ?? '';
    else if (a === '--prompt') out.prompt = argv[++i] ?? '';
    else if (a === '--prompt-file') out.prompt = readFileSync(argv[++i] ?? '', 'utf8');
    else if (a === '--language') out.language = argv[++i] ?? '';
  }
  if (!out.audio || !out.reference) {
    console.error('Usage: tsx --env-file=.env.local scripts/transcribe-benchmark.ts --audio <path> --reference <md> [--model slug] [--chunk-min 10] [--max-min 0] [--out dir]');
    process.exit(2);
  }
  if (!out.scopeKey) out.scopeKey = basename(out.audio);
  if (!out.out) {
    const slug = out.model.replace(/[^A-Za-z0-9]+/g, '-');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const tag = `chunk${out.chunkMin}m` + (out.prompt ? '_prompted' : '') + (out.language ? `_${out.language}` : '');
    out.out = join('scripts', 'transcribe-benchmark-out', `${slug}__${tag}__${ts}`);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// audio split
// ────────────────────────────────────────────────────────────────────

function ffprobeDurationSec(path: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr?.toString()}`);
  return Number(r.stdout.toString().trim());
}

interface Chunk {
  index: number;
  startSec: number;
  durationSec: number;
  wavPath: string;
}

function splitToChunks(audioPath: string, chunkMin: number, maxMin: number, outDir: string, totalSec: number): Chunk[] {
  const chunkSec = chunkMin * 60;
  const cap = maxMin > 0 ? Math.min(maxMin * 60, totalSec) : totalSec;
  const chunks: Chunk[] = [];
  for (let i = 0; i * chunkSec < cap; i++) {
    const startSec = i * chunkSec;
    const dur = Math.min(chunkSec, cap - startSec);
    const wavPath = join(outDir, `chunk-${String(i).padStart(3, '0')}.wav`);
    chunks.push({ index: i, startSec, durationSec: dur, wavPath });
  }
  for (const c of chunks) {
    if (existsSync(c.wavPath)) continue;
    const r = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', String(c.startSec),
      '-t', String(c.durationSec),
      '-i', audioPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      c.wavPath,
    ]);
    if (r.status !== 0) throw new Error(`ffmpeg chunk ${c.index}: ${r.stderr?.toString().slice(0, 300)}`);
  }
  return chunks;
}

// ────────────────────────────────────────────────────────────────────
// OpenRouter transcription (logged)
// ────────────────────────────────────────────────────────────────────

interface TranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  model?: string;
  provider?: string;
  id?: string;
  error?: { message?: string; code?: string } | string;
  // Whisper's /audio/transcriptions: bills per audio second, not per token.
  // `cost` is in USD, `seconds` is the audio duration that was billed.
  usage?: {
    seconds?: number;
    cost?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

async function transcribeChunk(args: {
  apiKey: string;
  model: string;
  wavBuf: Buffer;
  prompt?: string;
  language?: string;
}): Promise<TranscriptionResponse> {
  const audioB64 = args.wavBuf.toString('base64');
  const body: Record<string, unknown> = {
    model: args.model,
    input_audio: { data: audioB64, format: 'wav' },
    response_format: 'verbose_json',
  };
  if (args.prompt) body.prompt = args.prompt;
  if (args.language) body.language = args.language;
  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vita.viter.ai',
      'X-OpenRouter-Title': 'vita transcription benchmark',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`openrouter ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = (await res.json()) as TranscriptionResponse;
  if (data.error) {
    const m = typeof data.error === 'string' ? data.error : data.error.message ?? data.error.code;
    throw new Error(`openrouter error: ${m}`);
  }
  return data;
}

// ────────────────────────────────────────────────────────────────────
// reference-md normalization
// ────────────────────────────────────────────────────────────────────

/** Strip the speaker-label markdown into raw spoken text for WER. */
function extractReferenceText(mdPath: string, maxSec: number): string {
  const md = readFileSync(mdPath, 'utf8');
  const lines = md.split('\n');
  const out: string[] = [];
  let lastTsSec = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const m = ln.match(/^\*(\d{1,2}):(\d{2})(?::(\d{2}))?\*$/);
    if (m) {
      const [_, a, b, c] = m;
      lastTsSec = c
        ? Number(a) * 3600 + Number(b) * 60 + Number(c)
        : Number(a) * 60 + Number(b);
      continue;
    }
    if (maxSec > 0 && lastTsSec >= maxSec) break;
    const sm = ln.match(/^\*\*[^*]+\*\*:\s*(.*)$/);
    if (!sm) continue;
    let speech = sm[1]!.trim();
    if (speech.startsWith('-')) speech = speech.slice(1).trim();
    if (!speech) continue;
    out.push(speech);
  }
  return out.join(' ');
}

// ────────────────────────────────────────────────────────────────────
// WER + CER
// ────────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[‘’“”]/g, "'")
    .replace(/[.,!?;:"()\[\]{}—–\-–—…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein<T>(a: T[], b: T[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Int32Array(m + 1);
  let curr = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]!;
}

function computeWerCer(reference: string, hypothesis: string) {
  const refN = normalize(reference);
  const hypN = normalize(hypothesis);
  const refW = refN.split(' ').filter(Boolean);
  const hypW = hypN.split(' ').filter(Boolean);
  const wDist = levenshtein(refW, hypW);
  const cDist = levenshtein(refN.split(''), hypN.split(''));
  return {
    refWords: refW.length,
    hypWords: hypW.length,
    refChars: refN.length,
    hypChars: hypN.length,
    wer: refW.length === 0 ? 0 : wDist / refW.length,
    cer: refN.length === 0 ? 0 : cDist / refN.length,
    wDist, cDist,
  };
}

// ────────────────────────────────────────────────────────────────────
// llm_call_log helpers
// ────────────────────────────────────────────────────────────────────

async function getTenantId(db: ReturnType<typeof createServiceRoleClient>, slug: string): Promise<string | null> {
  const { data } = await db.from('tenants').select('id').eq('slug', slug).single();
  return (data?.id as string) ?? null;
}

async function logCallStart(
  db: ReturnType<typeof createServiceRoleClient>,
  args: {
    tenantId: string; model: string; scopeKey: string; chunkIndex: number;
    bytes: number; durationSec: number;
    audioSha256: string;
    sessionId: string;
    callerRef?: string | null;
    promptText?: string;
    languageHint?: string;
    rawRequestBody: Record<string, unknown>;
  },
): Promise<string | null> {
  const promptHash = args.promptText
    ? createHash('sha256').update(args.promptText).digest('hex')
    : null;
  const { data, error } = await db.from('llm_call_log').insert({
    tenant_id: args.tenantId,
    caller: 'transcription.benchmark',
    caller_ref: args.callerRef ?? null,
    prompt_version: 'whisper-benchmark-v1',
    scope_kind: 'meeting_audio',
    scope_key: args.scopeKey,
    model_requested: args.model,
    parameters: {
      route: 'openrouter/audio/transcriptions',
      input_format: 'wav',
      response_format: 'verbose_json',
      chunk_index: args.chunkIndex,
      audio_duration_s: args.durationSec,
      audio_bytes: args.bytes,
      language_hint: args.languageHint ?? null,
    },
    // For audio calls we re-purpose the prompt-hash columns:
    //   system_prompt_hash = sha256 of the Whisper vocab `prompt` (if any)
    //   user_prompt_hash   = sha256 of the audio buffer (the actual "user input")
    //   user_prompt_chars  = number of audio milliseconds (analog of "prompt size")
    system_prompt_hash: promptHash,
    user_prompt_hash: args.audioSha256,
    user_prompt_chars: Math.round(args.durationSec * 1000),
    status: 'running',
    started_at: new Date().toISOString(),
    metadata: { source: 'scripts/transcribe-benchmark.ts' },
    raw_request: redactRawRequest(args.rawRequestBody),
    audio_format: 'wav',
    audio_bytes: args.bytes,
    audio_seconds: args.durationSec,
    audio_language: args.languageHint ?? null,
    output_kind: 'transcript',
    environment: process.env.NODE_ENV ?? 'dev',
    session_id: args.sessionId,
    tags: ['transcription', 'benchmark'],
  }).select('id').single();
  if (error) {
    console.warn(`[log] start insert failed: ${error.message}`);
    return null;
  }
  return data.id as string;
}

/** Strip the base64 audio bytes out of the request body but keep its metadata. */
function redactRawRequest(body: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'input_audio' && v && typeof v === 'object') {
      const ia = v as { data?: string; format?: string };
      safe.input_audio = {
        format: ia.format,
        data_bytes: ia.data ? Math.round((ia.data.length * 3) / 4) : null,  // base64 → bytes
        data_redacted: true,
      };
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

async function logCallFinish(
  db: ReturnType<typeof createServiceRoleClient>,
  callId: string,
  args: {
    status: 'ok' | 'failed';
    modelUsed?: string | null;
    providerName?: string | null;
    generationId?: string | null;
    finishReason?: string | null;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number | null;
    latencyMs: number;
    errorMessage?: string;
    rawResponse?: Record<string, unknown> | null;
    metricsExtra?: Record<string, unknown>;
  },
) {
  const completedAt = new Date().toISOString();
  const m = args.metricsExtra ?? {};
  // Only write fields we actually have — don't clobber values set on start
  // with nulls from the response (e.g. /audio/transcriptions usually omits
  // the detected language even when we passed `language: en` on input).
  const update: Record<string, unknown> = {
    status: args.status,
    completed_at: completedAt,
    latency_ms: args.latencyMs,
    metadata: { ...m },
  };
  if (args.modelUsed != null) update.model_used = args.modelUsed;
  if (args.providerName != null) update.provider_name = args.providerName;
  if (args.generationId != null) update.generation_id = args.generationId;
  if (args.finishReason != null) update.finish_reason = args.finishReason;
  if (args.promptTokens != null) update.prompt_tokens = args.promptTokens;
  if (args.completionTokens != null) update.completion_tokens = args.completionTokens;
  if (args.totalTokens != null) update.total_tokens = args.totalTokens;
  if (args.costUsd != null) {
    update.cost_usd = args.costUsd;
    update.cost_source = 'caller';
  }
  if (args.errorMessage != null) update.error_message = args.errorMessage;
  if (args.rawResponse != null) update.raw_response = args.rawResponse;
  if (typeof m.chars === 'number') update.output_chars = m.chars;
  if (typeof m.api_duration_s === 'number') update.audio_seconds = m.api_duration_s;
  if (typeof m.n_segments === 'number') update.audio_n_segments = m.n_segments;
  if (typeof m.language === 'string') update.audio_language = m.language;
  const { error } = await db.from('llm_call_log').update(update).eq('id', callId);
  if (error) console.warn(`[log] finish update failed: ${error.message}`);
}

// ────────────────────────────────────────────────────────────────────
// main
// ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required');

  const audioAbs = resolve(args.audio);
  const refAbs = resolve(args.reference);
  if (!existsSync(audioAbs)) throw new Error(`audio not found: ${audioAbs}`);
  if (!existsSync(refAbs)) throw new Error(`reference not found: ${refAbs}`);

  mkdirSync(args.out, { recursive: true });
  const chunksDir = join(args.out, 'chunks');
  mkdirSync(chunksDir, { recursive: true });

  const totalSec = ffprobeDurationSec(audioAbs);
  console.log(`[bench] audio: ${audioAbs}`);
  console.log(`[bench] duration: ${(totalSec / 60).toFixed(1)} min`);
  console.log(`[bench] model: ${args.model}`);
  console.log(`[bench] chunks: ${args.chunkMin}-min` + (args.maxMin > 0 ? ` (max ${args.maxMin} min)` : ' (full file)'));
  console.log(`[bench] out: ${args.out}`);

  // 1. split
  process.stdout.write('[bench] splitting audio … ');
  const chunks = splitToChunks(audioAbs, args.chunkMin, args.maxMin, chunksDir, totalSec);
  console.log(`${chunks.length} chunk(s)`);

  // 2. log setup
  let db: ReturnType<typeof createServiceRoleClient> | null = null;
  let tenantId: string | null = null;
  if ((process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      db = createServiceRoleClient();
      tenantId = await getTenantId(db, args.tenantSlug);
      if (!tenantId) console.warn(`[log] tenant '${args.tenantSlug}' not found — skipping llm_call_log writes`);
    } catch (err) {
      console.warn(`[log] supabase init failed — skipping llm_call_log writes: ${(err as Error).message}`);
      db = null;
    }
  } else {
    console.log('[log] no SUPABASE_URL/key in env — llm_call_log writes skipped');
  }

  // 2b. one session id per benchmark run — links every chunk back together
  const sessionId = `bench:${randomUUID()}`;

  // 3. transcribe each chunk
  type ChunkResult = {
    index: number;
    startSec: number;
    durationSec: number;
    text: string;
    language?: string;
    apiDurationS?: number;
    segments: Array<{ start: number; end: number; text: string }>;
    modelUsed?: string;
    generationId?: string;
    latencyMs: number;
    bytes: number;
  };
  const results: ChunkResult[] = [];
  for (const c of chunks) {
    const wavBuf = readFileSync(c.wavPath);
    process.stdout.write(`  [${c.index + 1}/${chunks.length}] ${(c.startSec / 60).toFixed(1)}–${((c.startSec + c.durationSec) / 60).toFixed(1)} min · ${(wavBuf.length / 1024 / 1024).toFixed(1)} MB … `);

    const audioSha256 = createHash('sha256').update(wavBuf).digest('hex');
    const requestBody: Record<string, unknown> = {
      model: args.model,
      input_audio: { format: 'wav', data: '<base64-redacted>' },
      response_format: 'verbose_json',
    };
    if (args.prompt) requestBody.prompt = args.prompt;
    if (args.language) requestBody.language = args.language;

    let logId: string | null = null;
    if (db && tenantId) {
      logId = await logCallStart(db, {
        tenantId, model: args.model, scopeKey: args.scopeKey,
        chunkIndex: c.index, bytes: wavBuf.length, durationSec: c.durationSec,
        audioSha256,
        sessionId,
        promptText: args.prompt || undefined,
        languageHint: args.language || undefined,
        rawRequestBody: requestBody,
      });
    }

    const t0 = Date.now();
    try {
      const data = await transcribeChunk({
        apiKey, model: args.model, wavBuf,
        prompt: args.prompt || undefined,
        language: args.language || undefined,
      });
      const latencyMs = Date.now() - t0;
      const text = (data.text ?? '').trim();
      const segments = (data.segments ?? []).map((s) => ({
        start: s.start + c.startSec,
        end: s.end + c.startSec,
        text: s.text,
      }));
      results.push({
        index: c.index, startSec: c.startSec, durationSec: c.durationSec,
        text, language: data.language, apiDurationS: data.duration, segments,
        modelUsed: data.model, generationId: data.id, latencyMs, bytes: wavBuf.length,
      });
      if (logId && db) {
        // raw_response: keep small + safe. Whisper response is just text +
        // usage + duration + (sometimes) language + (sometimes) segments.
        // None of it is sensitive — it's the same content the caller sees.
        const rawResponse: Record<string, unknown> = {
          text_chars: text.length,
          duration: data.duration ?? null,
          language: data.language ?? null,
          model: data.model ?? null,
          provider: data.provider ?? null,
          id: data.id ?? null,
          usage: data.usage ?? null,
          n_segments: segments.length,
        };

        await logCallFinish(db, logId, {
          status: 'ok',
          modelUsed: data.model ?? args.model,            // OR /audio/transcriptions doesn't echo the model name
          providerName: data.provider ?? 'openrouter',    // ditto for provider
          generationId: data.id ?? null,                  // /audio/transcriptions does NOT return an id
          finishReason: 'stop',
          latencyMs,
          // Whisper bills per audio-second; capture both cost + seconds.
          costUsd: data.usage?.cost ?? null,
          rawResponse,
          metricsExtra: {
            chars: text.length,
            n_segments: segments.length,
            api_duration_s: data.usage?.seconds ?? data.duration ?? null,
            audio_seconds: data.usage?.seconds ?? data.duration ?? null,
            language: data.language ?? null,
            usage_seconds: data.usage?.seconds ?? null,
            usage_cost_usd: data.usage?.cost ?? null,
          },
        });
      }
      console.log(`✓ ${(latencyMs / 1000).toFixed(1)}s · ${text.length} chars · "${text.slice(0, 60).replace(/\s+/g, ' ')}…"`);
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      if (logId && db) {
        await logCallFinish(db, logId, { status: 'failed', latencyMs, errorMessage: msg });
      }
      console.log(`✗ ${msg}`);
      throw err;
    }
  }

  // 4. assemble
  const fullText = results.map((r) => r.text).join('\n\n');
  const allSegments = results.flatMap((r) => r.segments);
  writeFileSync(join(args.out, 'transcript.txt'), fullText);
  writeFileSync(join(args.out, 'segments.json'), JSON.stringify(allSegments, null, 2));
  writeFileSync(join(args.out, 'chunks.json'), JSON.stringify(results.map((r) => ({
    index: r.index, startSec: r.startSec, durationSec: r.durationSec, latencyMs: r.latencyMs,
    bytes: r.bytes, modelUsed: r.modelUsed, generationId: r.generationId,
    chars: r.text.length, language: r.language,
  })), null, 2));

  // 5. WER vs reference
  const maxSec = args.maxMin > 0 ? args.maxMin * 60 : totalSec;
  const reference = extractReferenceText(refAbs, maxSec);
  writeFileSync(join(args.out, 'reference-extracted.txt'), reference);
  const score = computeWerCer(reference, fullText);

  const report = {
    model: args.model,
    audio: audioAbs,
    reference: refAbs,
    durationMinutes: Number((totalSec / 60).toFixed(2)),
    coveredMinutes: Number((maxSec / 60).toFixed(2)),
    chunkMinutes: args.chunkMin,
    nChunks: chunks.length,
    totalLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0),
    totalBytes: results.reduce((s, r) => s + r.bytes, 0),
    refWords: score.refWords,
    hypWords: score.hypWords,
    wer: Number(score.wer.toFixed(4)),
    cer: Number(score.cer.toFixed(4)),
    wDist: score.wDist,
    cDist: score.cDist,
  };
  writeFileSync(join(args.out, 'report.json'), JSON.stringify(report, null, 2));

  console.log('');
  console.log(`[bench] DONE`);
  console.log(`  ref words:    ${score.refWords}`);
  console.log(`  hyp words:    ${score.hypWords}`);
  console.log(`  WER:          ${(score.wer * 100).toFixed(2)}%`);
  console.log(`  CER:          ${(score.cer * 100).toFixed(2)}%`);
  console.log(`  total wall:   ${((report.totalLatencyMs) / 1000).toFixed(1)}s`);
  console.log(`  output:       ${args.out}`);
}

main().catch((err) => {
  console.error('[bench] fatal:', err);
  process.exit(1);
});
