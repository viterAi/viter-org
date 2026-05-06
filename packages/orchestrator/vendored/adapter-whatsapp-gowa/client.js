/**
 * Typed REST client for GOWA (go-whatsapp-web-multidevice v8.4.0).
 *
 * Wraps the 70+ endpoints in a single class. Every method validates request
 * + response with zod schemas from `./types.ts`. Device-scoped calls take a
 * `deviceId` argument and stamp it as the `X-Device-Id` header per v8.
 *
 * Used by:
 *   - packages/orchestrator/src/trigger/wa-pair-init  → createDevice + getQR
 *   - packages/orchestrator/src/trigger/wa-pair-poll  → getDeviceState
 *   - packages/orchestrator/src/trigger/wa-send       → sendText / sendMedia
 *   - apps/web (server actions)                       → listDevices, unlink
 */
import { GowaCreateDeviceResponseSchema, GowaListDevicesResponseSchema, GowaSendTextRequestSchema, GowaSendResponseSchema, } from './types.js';
/**
 * GOWA's actual /send/* response shape:
 *   { code: 'SUCCESS' | 'XXX', message: string, results: { message_id, status } }
 * Our public type expects the flat shape from types.ts. Normalize here so
 * callers don't have to know the envelope.
 */
function normalizeSendResponse(raw) {
    // Already-flat shape (in case the server changes back) — try first.
    const flat = GowaSendResponseSchema.safeParse(raw);
    if (flat.success)
        return flat.data;
    if (raw && typeof raw === 'object') {
        const r = raw;
        const ok = r.code === 'SUCCESS';
        const msgId = r.results?.message_id;
        if (msgId) {
            return {
                message_id: msgId,
                status: ok ? 'sent' : 'failed',
                timestamp: new Date().toISOString(),
                ...(ok ? {} : { error: r.message ?? r.error ?? r.code ?? 'unknown' }),
            };
        }
    }
    throw new Error(`unexpected GOWA send response: ${JSON.stringify(raw).slice(0, 200)}`);
}
export class GowaError extends Error {
    status;
    body;
    path;
    constructor(message, status, body, path) {
        super(message);
        this.status = status;
        this.body = body;
        this.path = path;
        this.name = 'GowaError';
    }
}
export class GowaClient {
    baseUrl;
    authHeader;
    fetchImpl;
    timeoutMs;
    constructor(cfg) {
        this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
        this.fetchImpl = cfg.fetchImpl ?? fetch;
        this.timeoutMs = cfg.timeoutMs ?? 30_000;
        if (cfg.basicAuth) {
            // Encode `user:pass` to base64 for the Authorization header.
            const encoded = typeof Buffer !== 'undefined'
                ? Buffer.from(cfg.basicAuth).toString('base64')
                : btoa(cfg.basicAuth);
            this.authHeader = `Basic ${encoded}`;
        }
    }
    async request(method, path, opts = {}) {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
        if (this.authHeader)
            headers['Authorization'] = this.authHeader;
        if (opts.deviceId)
            headers['X-Device-Id'] = opts.deviceId;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method,
                headers,
                body: opts.body ? JSON.stringify(opts.body) : null,
                signal: controller.signal,
            });
            const text = await res.text();
            if (!res.ok) {
                throw new GowaError(`GOWA ${method} ${path} failed: ${res.status}`, res.status, text.slice(0, 500), path);
            }
            return text ? JSON.parse(text) : undefined;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    // ─── Device lifecycle ─────────────────────────────────────────
    async createDevice() {
        const raw = await this.request('POST', '/devices');
        return GowaCreateDeviceResponseSchema.parse(raw);
    }
    async listDevices() {
        const raw = await this.request('GET', '/devices');
        return GowaListDevicesResponseSchema.parse(raw);
    }
    async getDevice(deviceId) {
        return this.request('GET', `/devices/${encodeURIComponent(deviceId)}`);
    }
    async getDeviceQR(deviceId) {
        return this.request('GET', `/devices/${encodeURIComponent(deviceId)}/qr`);
    }
    async unlinkDevice(deviceId) {
        await this.request('DELETE', `/devices/${encodeURIComponent(deviceId)}`);
    }
    async loginDevice(deviceId) {
        /** Re-pair flow: existing device, fresh QR. */
        const raw = await this.request('POST', `/devices/${encodeURIComponent(deviceId)}/login`);
        return GowaCreateDeviceResponseSchema.parse(raw);
    }
    // ─── Messaging ────────────────────────────────────────────────
    async sendText(deviceId, req) {
        const validated = GowaSendTextRequestSchema.parse(req);
        const raw = await this.request('POST', '/send/message', { deviceId, body: validated });
        return normalizeSendResponse(raw);
    }
    async sendImage(deviceId, args) {
        const raw = await this.request('POST', '/send/image', { deviceId, body: args });
        return normalizeSendResponse(raw);
    }
    async sendDocument(deviceId, args) {
        const raw = await this.request('POST', '/send/file', { deviceId, body: args });
        return normalizeSendResponse(raw);
    }
    // ─── Chats / search ───────────────────────────────────────────
    async listChats(deviceId) {
        return this.request('GET', '/chats', { deviceId });
    }
    // ─── Health ───────────────────────────────────────────────────
    async healthCheck() {
        try {
            const res = await this.fetchImpl(`${this.baseUrl}/`, { method: 'GET' });
            return { ok: res.ok };
        }
        catch {
            return { ok: false };
        }
    }
}
/** Convenience factory reading env vars (Node-side only). */
export function createGowaClientFromEnv() {
    const baseUrl = process.env.GOWA_BASE_URL;
    const basicAuth = process.env.GOWA_BASIC_AUTH;
    if (!baseUrl)
        throw new Error('GOWA_BASE_URL is required');
    const cfg = { baseUrl };
    if (basicAuth)
        cfg.basicAuth = basicAuth;
    return new GowaClient(cfg);
}
//# sourceMappingURL=client.js.map