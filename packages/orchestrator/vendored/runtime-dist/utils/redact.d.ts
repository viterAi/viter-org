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
export declare function redactSecrets(text: string): string;
/**
 * Whether to retain full payloads in DB / logs.
 * Default off — only lengths + redacted previews persisted.
 * Set LLM_DEBUG_PAYLOADS=1 to capture full bodies (development only).
 */
export declare function payloadDebugEnabled(): boolean;
/**
 * Encode a payload for DB persistence. When debug is off, returns a stub
 * with length only. When on, returns the full body with secrets redacted.
 */
export declare function preparePayloadForLog(payload: unknown): Record<string, unknown>;
//# sourceMappingURL=redact.d.ts.map