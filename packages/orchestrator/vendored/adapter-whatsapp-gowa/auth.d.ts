/**
 * HMAC-SHA256 helpers for the GOWA webhook contract.
 *
 * GOWA signs every webhook POST with HMAC-SHA256 using `WHATSAPP_WEBHOOK_SECRET`.
 * The signature lands in the `X-Hub-Signature-256` header as `sha256=<hex>`.
 *
 * Both sides of the wire share these helpers so verification is identical
 * everywhere (Edge Function, adapter tests, Trigger.dev tasks if they ever
 * proxy webhooks).
 *
 * Implementation uses Web Crypto (universal) so the code runs in:
 *   - Supabase Edge Functions (Deno + Web Crypto)
 *   - Node 22+ runtime (Web Crypto built in)
 *   - Browsers (where applicable)
 */
/** Sign a payload (used by tests + simulated webhook senders). */
export declare function signPayload(secret: string, body: string): Promise<string>;
/**
 * Verify an inbound webhook signature.
 *
 * @param secret - the shared HMAC secret (env: WHATSAPP_WEBHOOK_SECRET)
 * @param body   - the raw request body string (NOT JSON.stringify of parsed JSON)
 * @param headerSignature - the value of X-Hub-Signature-256 header
 * @returns true if the signature is valid
 */
export declare function verifyWebhookSignature(secret: string, body: string, headerSignature: string | null | undefined): Promise<boolean>;
//# sourceMappingURL=auth.d.ts.map