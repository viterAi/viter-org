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
import { type GowaCreateDeviceResponse, type GowaSendResponse, type GowaSendTextRequest } from './types.js';
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
export declare class GowaError extends Error {
    status: number;
    body: string;
    path: string;
    constructor(message: string, status: number, body: string, path: string);
}
export declare class GowaClient {
    private readonly baseUrl;
    private readonly authHeader;
    private readonly fetchImpl;
    private readonly timeoutMs;
    constructor(cfg: GowaClientConfig);
    private request;
    createDevice(): Promise<GowaCreateDeviceResponse>;
    listDevices(): Promise<{
        device_id: string;
        push_name: string | null;
        state: "connected" | "connecting" | "disconnected" | "expired" | "banned" | "re_pair_required";
        phone_number: string | null;
        last_seen_at: string | null;
        paired_at: string | null;
    }[]>;
    getDevice(deviceId: string): Promise<{
        device_id: string;
        phone_number: string | null;
        push_name: string | null;
        state: string;
        paired_at: string | null;
        last_seen_at: string | null;
    }>;
    getDeviceQR(deviceId: string): Promise<{
        qr?: string;
        expires_at?: string;
        consumed?: boolean;
    }>;
    unlinkDevice(deviceId: string): Promise<void>;
    loginDevice(deviceId: string): Promise<GowaCreateDeviceResponse>;
    sendText(deviceId: string, req: GowaSendTextRequest): Promise<GowaSendResponse>;
    sendImage(deviceId: string, args: {
        phone: string;
        imageUrl: string;
        caption?: string;
    }): Promise<GowaSendResponse>;
    sendDocument(deviceId: string, args: {
        phone: string;
        documentUrl: string;
        filename: string;
        caption?: string;
    }): Promise<GowaSendResponse>;
    listChats(deviceId: string): Promise<unknown[]>;
    healthCheck(): Promise<{
        ok: boolean;
        version?: string;
    }>;
}
/** Convenience factory reading env vars (Node-side only). */
export declare function createGowaClientFromEnv(): GowaClient;
//# sourceMappingURL=client.d.ts.map