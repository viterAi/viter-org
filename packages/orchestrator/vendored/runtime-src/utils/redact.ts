/**
 * Secret-redaction utility.
 *
 * Ported from Knowledge-Agent's `agent_logging.py::_SECRET_PATTERNS`.
 * Used before any prompt / response payload is persisted to Supabase or logged
 * to file, so leaked keys in user content don't sit in `llm_call_log.raw_request`.
 *
 * The patterns target known credential shapes — they're approximate, not perfect.
 * Real defense is "don't log full payloads in production" (LLM_DEBUG_PAYLOADS=0).
 */

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,                                              // OpenAI / OpenRouter
  /\b(?:eyJ)[A-Za-z0-9_\-.]{10,}\b/g,                                        // JWT (any header.payload.sig starts eyJ)
  /\bBearer\s+[A-Za-z0-9_\-.]{8,}\b/gi,                                      // Authorization: Bearer ...
  /\b(?:ak_cr|sb_(?:publishable|secret)|supabase_service_role)[A-Za-z0-9_\-.]{8,}\b/g, // Supabase keys
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,                                       // GitHub fine-grained PAT
  /\bghp_[A-Za-z0-9]{20,}\b/g,                                               // GitHub personal access token
  /\bAKIA[A-Z0-9]{16}\b/g,                                                   // AWS access-key id
];

const REDACTED = '[REDACTED]';

export function redactSecrets(text: string): string {
  let out = text;
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat, REDACTED);
  }
  return out;
}

/**
 * Whether to retain full payloads in DB / logs.
 * Default off — only lengths + redacted previews persisted.
 * Set LLM_DEBUG_PAYLOADS=1 to capture full bodies (development only).
 */
export function payloadDebugEnabled(): boolean {
  const v = (process.env.LLM_DEBUG_PAYLOADS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Encode a payload for DB persistence. When debug is off, returns a stub
 * with length only. When on, returns the full body with secrets redacted.
 */
export function preparePayloadForLog(payload: unknown): Record<string, unknown> {
  if (payloadDebugEnabled()) {
    const json = JSON.stringify(payload);
    return { full: redactSecrets(json), full_chars: json.length, redacted: true };
  }
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { length: json?.length ?? 0, truncated: true };
}
