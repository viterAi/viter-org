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

export interface OpenRouterTranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  model?: string;
  provider?: string;
  id?: string;
  error?: { message?: string; code?: string } | string;
}

export async function postTranscription(args: {
  apiKey: string;
  model: string;
  audioB64: string;
  format: 'wav' | 'mp3' | 'opus' | 'm4a' | 'flac';
}): Promise<OpenRouterTranscriptionResponse> {
  const res = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      ...COMMON_HEADERS,
    },
    body: JSON.stringify({
      model: args.model,
      input_audio: { data: args.audioB64, format: args.format },
    }),
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
}): Promise<OpenRouterChatResponse> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      ...COMMON_HEADERS,
    },
    body: JSON.stringify({ model: args.model, ...args.body }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as OpenRouterChatResponse;
  if (data.error) {
    const m = typeof data.error === 'string' ? data.error : data.error.message ?? data.error.code;
    throw new Error(`openrouter error: ${m}`);
  }
  return data;
}
