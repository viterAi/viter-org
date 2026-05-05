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
const TE = new TextEncoder();
async function importKey(secret) {
    return crypto.subtle.importKey('raw', TE.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
function bufToHex(buf) {
    const view = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < view.length; i++)
        hex += view[i].toString(16).padStart(2, '0');
    return hex;
}
/** Sign a payload (used by tests + simulated webhook senders). */
export async function signPayload(secret, body) {
    const key = await importKey(secret);
    const sig = await crypto.subtle.sign('HMAC', key, TE.encode(body));
    return `sha256=${bufToHex(sig)}`;
}
/**
 * Constant-time comparison of two equal-length strings.
 * Prevents timing attacks on signature verification.
 */
function safeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
/**
 * Verify an inbound webhook signature.
 *
 * @param secret - the shared HMAC secret (env: WHATSAPP_WEBHOOK_SECRET)
 * @param body   - the raw request body string (NOT JSON.stringify of parsed JSON)
 * @param headerSignature - the value of X-Hub-Signature-256 header
 * @returns true if the signature is valid
 */
export async function verifyWebhookSignature(secret, body, headerSignature) {
    if (!headerSignature)
        return false;
    if (!secret)
        return false;
    const expected = await signPayload(secret, body);
    return safeEqual(headerSignature, expected);
}
//# sourceMappingURL=auth.js.map