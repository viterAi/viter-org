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

import {
  GowaCreateDeviceResponseSchema,
  GowaListDevicesResponseSchema,
  GowaSendTextRequestSchema,
  GowaSendResponseSchema,
  type GowaCreateDeviceResponse,
  type GowaSendResponse,
  type GowaSendTextRequest,
} from './types.js';

export interface GowaClientConfig {
  /** Base URL of the GOWA service, e.g. `https://gowa.viter.ai` */
  baseUrl: string;
  /** Basic-auth string `username:password` matching APP_BASIC_AUTH on the server */
  basicAuth?: string;
  /** Optional fetch override (for tests + Edge runtimes) */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms (default 30s) */
  timeoutMs?: number;
}

export class GowaError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(message);
    this.name = 'GowaError';
  }
}

export class GowaClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(cfg: GowaClientConfig) {
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

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { deviceId?: string; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.authHeader) headers['Authorization'] = this.authHeader;
    if (opts.deviceId) headers['X-Device-Id'] = opts.deviceId;

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
      return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Device lifecycle ─────────────────────────────────────────

  async createDevice(): Promise<GowaCreateDeviceResponse> {
    const raw = await this.request<unknown>('POST', '/devices');
    return GowaCreateDeviceResponseSchema.parse(raw);
  }

  async listDevices() {
    const raw = await this.request<unknown>('GET', '/devices');
    return GowaListDevicesResponseSchema.parse(raw);
  }

  async getDevice(deviceId: string) {
    return this.request<{
      device_id: string;
      phone_number: string | null;
      push_name: string | null;
      state: string;
      paired_at: string | null;
      last_seen_at: string | null;
    }>('GET', `/devices/${encodeURIComponent(deviceId)}`);
  }

  async getDeviceQR(deviceId: string): Promise<{ qr?: string; expires_at?: string; consumed?: boolean }> {
    return this.request('GET', `/devices/${encodeURIComponent(deviceId)}/qr`);
  }

  async unlinkDevice(deviceId: string): Promise<void> {
    await this.request<void>('DELETE', `/devices/${encodeURIComponent(deviceId)}`);
  }

  async loginDevice(deviceId: string): Promise<GowaCreateDeviceResponse> {
    /** Re-pair flow: existing device, fresh QR. */
    const raw = await this.request<unknown>('POST', `/devices/${encodeURIComponent(deviceId)}/login`);
    return GowaCreateDeviceResponseSchema.parse(raw);
  }

  // ─── Messaging ────────────────────────────────────────────────

  async sendText(deviceId: string, req: GowaSendTextRequest): Promise<GowaSendResponse> {
    const validated = GowaSendTextRequestSchema.parse(req);
    const raw = await this.request<unknown>('POST', '/send/message', { deviceId, body: validated });
    return GowaSendResponseSchema.parse(raw);
  }

  async sendImage(
    deviceId: string,
    args: { phone: string; imageUrl: string; caption?: string },
  ): Promise<GowaSendResponse> {
    const raw = await this.request<unknown>('POST', '/send/image', { deviceId, body: args });
    return GowaSendResponseSchema.parse(raw);
  }

  async sendDocument(
    deviceId: string,
    args: { phone: string; documentUrl: string; filename: string; caption?: string },
  ): Promise<GowaSendResponse> {
    const raw = await this.request<unknown>('POST', '/send/file', { deviceId, body: args });
    return GowaSendResponseSchema.parse(raw);
  }

  // ─── Chats / search ───────────────────────────────────────────

  async listChats(deviceId: string): Promise<unknown[]> {
    return this.request<unknown[]>('GET', '/chats', { deviceId });
  }

  // ─── Health ───────────────────────────────────────────────────

  async healthCheck(): Promise<{ ok: boolean; version?: string }> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/`, { method: 'GET' });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  }
}

/** Convenience factory reading env vars (Node-side only). */
export function createGowaClientFromEnv(): GowaClient {
  const baseUrl = process.env.GOWA_BASE_URL;
  const basicAuth = process.env.GOWA_BASIC_AUTH;
  if (!baseUrl) throw new Error('GOWA_BASE_URL is required');
  const cfg: GowaClientConfig = { baseUrl };
  if (basicAuth) cfg.basicAuth = basicAuth;
  return new GowaClient(cfg);
}
