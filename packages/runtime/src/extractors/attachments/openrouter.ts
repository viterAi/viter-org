/**
 * Shared OpenRouter helpers for the LLM-routed attachment extractors.
 *
 * One key, three endpoints:
 *   - /v1/audio/transcriptions   (whisper-class models, JSON body w/ input_audio)
 *   - /v1/chat/completions       (multimodal models — gemini family for PDF/image)
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const COMMON_HEADERS = {
  'HTTP-Referer': 'https://vita.viter.ai',
  'X-OpenRouter-Title': 'vita extract-attachment',
};

function stripUndef(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

export interface OpenRouterTranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  model?: string;
  provider?: string;
  id?: string;
  // Whisper bills per audio-second (no tokens). Both fields are returned
  // by the OR /audio/transcriptions endpoint per shootout 2026-05-02.
  usage?: { seconds?: number; cost?: number };
  error?: { message?: string; code?: string } | string;
}

export async function postTranscription(args: {
  apiKey: string;
  model: string;
  audioB64: string;
  format: 'wav' | 'mp3' | 'opus' | 'm4a' | 'flac';
  /**
   * Caller metadata forwarded to OpenRouter as request-level `metadata`. OR's
   * Broadcast feature surfaces these as `trace.metadata.*` OTLP attributes —
   * the openrouter-webhook reads them to stamp the llm_call_log row with
   * tenant_id / caller / scope / trigger_run_id. Pass at minimum tenant_id.
   */
  callerMetadata?: Record<string, string | number | null | undefined>;
  /** Whisper vocab biasing — seeds Whisper with proper nouns (best on noisy mixed-language audio). */
  prompt?: string;
  /** ISO 639-1 language hint, e.g. 'en' or 'he'. */
  language?: string;
}): Promise<OpenRouterTranscriptionResponse> {
  const body: Record<string, unknown> = {
    model: args.model,
    input_audio: { data: args.audioB64, format: args.format },
    response_format: 'verbose_json',
  };
  if (args.prompt) body.prompt = args.prompt;
  if (args.language) body.language = args.language;
  if (args.callerMetadata) body.metadata = stripUndef(args.callerMetadata);
  const res = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      ...COMMON_HEADERS,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as OpenRouterTranscriptionResponse;
  if (data.error) {
    const m = typeof data.error === 'string' ? data.error : data.error.message ?? data.error.code;
    throw new Error(`openrouter error: ${m}`);
  }
  return data;
}

export interface OpenRouterChatResponse {
  id?: string;
  model?: string;
  provider?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; code?: string } | string;
}

export async function postChatCompletion(args: {
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  callerMetadata?: Record<string, string | number | null | undefined>;
}): Promise<OpenRouterChatResponse> {
  const fullBody: Record<string, unknown> = { model: args.model, ...args.body };
  if (args.callerMetadata) fullBody.metadata = stripUndef(args.callerMetadata);
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      ...COMMON_HEADERS,
    },
    body: JSON.stringify(fullBody),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as OpenRouterChatResponse;
  if (data.error) {
    const m = typeof data.error === 'string' ? data.error : data.error.message ?? data.error.code;
    throw new Error(`openrouter error: ${m}`);
  }
  return data;
}
