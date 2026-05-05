/**
 * GOWA wire types — webhook payloads + REST request/response shapes.
 *
 * Source: `aldinokemal/go-whatsapp-web-multidevice` v8.4.0 OpenAPI + webhook
 * payload reference. Validated at runtime via the zod schemas below; static
 * types are inferred from the schemas so the two stay in sync automatically.
 */
import { z } from 'zod';
export declare const GowaWebhookEventTypeSchema: z.ZodEnum<["message", "message.ack", "message.reaction", "message.revoke", "message.edited", "device.connection.update", "device.disconnected", "device.banned", "pair.qr.consumed", "pair.qr.generated", "group.participants", "newsletter", "call.offer"]>;
export type GowaWebhookEventType = z.infer<typeof GowaWebhookEventTypeSchema>;
/**
 * Every webhook payload from GOWA carries this top-level shape. The
 * `data` field is event-specific and discriminated by `event`.
 */
export declare const GowaWebhookEnvelopeSchema: z.ZodObject<{
    event: z.ZodEnum<["message", "message.ack", "message.reaction", "message.revoke", "message.edited", "device.connection.update", "device.disconnected", "device.banned", "pair.qr.consumed", "pair.qr.generated", "group.participants", "newsletter", "call.offer"]>;
    device_id: z.ZodString;
    timestamp: z.ZodOptional<z.ZodString>;
    data: z.ZodUnknown;
}, "strip", z.ZodTypeAny, {
    event: "message" | "message.ack" | "message.reaction" | "message.revoke" | "message.edited" | "device.connection.update" | "device.disconnected" | "device.banned" | "pair.qr.consumed" | "pair.qr.generated" | "group.participants" | "newsletter" | "call.offer";
    device_id: string;
    timestamp?: string | undefined;
    data?: unknown;
}, {
    event: "message" | "message.ack" | "message.reaction" | "message.revoke" | "message.edited" | "device.connection.update" | "device.disconnected" | "device.banned" | "pair.qr.consumed" | "pair.qr.generated" | "group.participants" | "newsletter" | "call.offer";
    device_id: string;
    timestamp?: string | undefined;
    data?: unknown;
}>;
export type GowaWebhookEnvelope = z.infer<typeof GowaWebhookEnvelopeSchema>;
export declare const GowaMessageMediaSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    mime_type: z.ZodOptional<z.ZodString>;
    filename: z.ZodOptional<z.ZodString>;
    bytes: z.ZodOptional<z.ZodNumber>;
    sha256: z.ZodOptional<z.ZodString>;
    caption: z.ZodOptional<z.ZodString>;
    duration_seconds: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    url?: string | undefined;
    mime_type?: string | undefined;
    filename?: string | undefined;
    bytes?: number | undefined;
    sha256?: string | undefined;
    caption?: string | undefined;
    duration_seconds?: number | undefined;
}, {
    url?: string | undefined;
    mime_type?: string | undefined;
    filename?: string | undefined;
    bytes?: number | undefined;
    sha256?: string | undefined;
    caption?: string | undefined;
    duration_seconds?: number | undefined;
}>;
export declare const GowaMessageDataSchema: z.ZodObject<{
    /** Globally-unique message id from WhatsApp protocol */
    id: z.ZodString;
    chat_id: z.ZodString;
    from_id: z.ZodString;
    from_me: z.ZodOptional<z.ZodBoolean>;
    push_name: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodString;
    is_group: z.ZodOptional<z.ZodBoolean>;
    group_id: z.ZodOptional<z.ZodString>;
    group_subject: z.ZodOptional<z.ZodString>;
    message_type: z.ZodEnum<["text", "image", "audio", "video", "document", "sticker", "location", "contact", "reaction", "revoke", "edited", "poll", "system"]>;
    text: z.ZodOptional<z.ZodString>;
    media: z.ZodOptional<z.ZodObject<{
        url: z.ZodOptional<z.ZodString>;
        mime_type: z.ZodOptional<z.ZodString>;
        filename: z.ZodOptional<z.ZodString>;
        bytes: z.ZodOptional<z.ZodNumber>;
        sha256: z.ZodOptional<z.ZodString>;
        caption: z.ZodOptional<z.ZodString>;
        duration_seconds: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        url?: string | undefined;
        mime_type?: string | undefined;
        filename?: string | undefined;
        bytes?: number | undefined;
        sha256?: string | undefined;
        caption?: string | undefined;
        duration_seconds?: number | undefined;
    }, {
        url?: string | undefined;
        mime_type?: string | undefined;
        filename?: string | undefined;
        bytes?: number | undefined;
        sha256?: string | undefined;
        caption?: string | undefined;
        duration_seconds?: number | undefined;
    }>>;
    quoted_message_id: z.ZodOptional<z.ZodString>;
    mentions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    id: string;
    chat_id: string;
    from_id: string;
    message_type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "reaction" | "revoke" | "edited" | "poll" | "system";
    from_me?: boolean | undefined;
    push_name?: string | undefined;
    is_group?: boolean | undefined;
    group_id?: string | undefined;
    group_subject?: string | undefined;
    text?: string | undefined;
    media?: {
        url?: string | undefined;
        mime_type?: string | undefined;
        filename?: string | undefined;
        bytes?: number | undefined;
        sha256?: string | undefined;
        caption?: string | undefined;
        duration_seconds?: number | undefined;
    } | undefined;
    quoted_message_id?: string | undefined;
    mentions?: string[] | undefined;
}, {
    timestamp: string;
    id: string;
    chat_id: string;
    from_id: string;
    message_type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "reaction" | "revoke" | "edited" | "poll" | "system";
    from_me?: boolean | undefined;
    push_name?: string | undefined;
    is_group?: boolean | undefined;
    group_id?: string | undefined;
    group_subject?: string | undefined;
    text?: string | undefined;
    media?: {
        url?: string | undefined;
        mime_type?: string | undefined;
        filename?: string | undefined;
        bytes?: number | undefined;
        sha256?: string | undefined;
        caption?: string | undefined;
        duration_seconds?: number | undefined;
    } | undefined;
    quoted_message_id?: string | undefined;
    mentions?: string[] | undefined;
}>;
export type GowaMessageData = z.infer<typeof GowaMessageDataSchema>;
export declare const GowaMessageAckDataSchema: z.ZodObject<{
    id: z.ZodString;
    ack: z.ZodEnum<["pending", "server", "delivery", "read", "played"]>;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    id: string;
    ack: "pending" | "server" | "delivery" | "read" | "played";
}, {
    timestamp: string;
    id: string;
    ack: "pending" | "server" | "delivery" | "read" | "played";
}>;
export type GowaMessageAckData = z.infer<typeof GowaMessageAckDataSchema>;
export declare const GowaReactionDataSchema: z.ZodObject<{
    id: z.ZodString;
    target_message_id: z.ZodString;
    from_id: z.ZodString;
    emoji: z.ZodNullable<z.ZodString>;
    timestamp: z.ZodString;
}, "strip", z.ZodTypeAny, {
    timestamp: string;
    id: string;
    from_id: string;
    target_message_id: string;
    emoji: string | null;
}, {
    timestamp: string;
    id: string;
    from_id: string;
    target_message_id: string;
    emoji: string | null;
}>;
export type GowaReactionData = z.infer<typeof GowaReactionDataSchema>;
export declare const GowaDeviceConnectionDataSchema: z.ZodObject<{
    device_id: z.ZodString;
    state: z.ZodEnum<["connected", "connecting", "disconnected", "expired", "banned", "re_pair_required"]>;
    phone_number: z.ZodOptional<z.ZodString>;
    push_name: z.ZodOptional<z.ZodString>;
    last_seen_at: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    device_id: string;
    state: "connected" | "connecting" | "disconnected" | "expired" | "banned" | "re_pair_required";
    push_name?: string | undefined;
    phone_number?: string | undefined;
    last_seen_at?: string | undefined;
    reason?: string | undefined;
}, {
    device_id: string;
    state: "connected" | "connecting" | "disconnected" | "expired" | "banned" | "re_pair_required";
    push_name?: string | undefined;
    phone_number?: string | undefined;
    last_seen_at?: string | undefined;
    reason?: string | undefined;
}>;
export type GowaDeviceConnectionData = z.infer<typeof GowaDeviceConnectionDataSchema>;
export declare const GowaPairQrDataSchema: z.ZodObject<{
    device_id: z.ZodString;
    qr_data: z.ZodOptional<z.ZodString>;
    expires_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    device_id: string;
    qr_data?: string | undefined;
    expires_at?: string | undefined;
}, {
    device_id: string;
    qr_data?: string | undefined;
    expires_at?: string | undefined;
}>;
export type GowaPairQrData = z.infer<typeof GowaPairQrDataSchema>;
export declare const GowaCreateDeviceResponseSchema: z.ZodObject<{
    device_id: z.ZodString;
    qr: z.ZodOptional<z.ZodString>;
    expires_at: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    device_id: string;
    expires_at?: string | undefined;
    qr?: string | undefined;
}, {
    device_id: string;
    expires_at?: string | undefined;
    qr?: string | undefined;
}>;
export type GowaCreateDeviceResponse = z.infer<typeof GowaCreateDeviceResponseSchema>;
export declare const GowaListDevicesResponseSchema: z.ZodArray<z.ZodObject<{
    device_id: z.ZodString;
    phone_number: z.ZodNullable<z.ZodString>;
    push_name: z.ZodNullable<z.ZodString>;
    state: z.ZodEnum<["connected", "connecting", "disconnected", "expired", "banned", "re_pair_required"]>;
    paired_at: z.ZodNullable<z.ZodString>;
    last_seen_at: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    device_id: string;
    push_name: string | null;
    state: "connected" | "connecting" | "disconnected" | "expired" | "banned" | "re_pair_required";
    phone_number: string | null;
    last_seen_at: string | null;
    paired_at: string | null;
}, {
    device_id: string;
    push_name: string | null;
    state: "connected" | "connecting" | "disconnected" | "expired" | "banned" | "re_pair_required";
    phone_number: string | null;
    last_seen_at: string | null;
    paired_at: string | null;
}>, "many">;
export declare const GowaSendTextRequestSchema: z.ZodObject<{
    phone: z.ZodString;
    message: z.ZodString;
    reply_to_message_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    message: string;
    phone: string;
    reply_to_message_id?: string | undefined;
}, {
    message: string;
    phone: string;
    reply_to_message_id?: string | undefined;
}>;
export type GowaSendTextRequest = z.infer<typeof GowaSendTextRequestSchema>;
export declare const GowaSendResponseSchema: z.ZodObject<{
    message_id: z.ZodString;
    status: z.ZodEnum<["queued", "sent", "failed"]>;
    timestamp: z.ZodString;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "queued" | "sent" | "failed";
    timestamp: string;
    message_id: string;
    error?: string | undefined;
}, {
    status: "queued" | "sent" | "failed";
    timestamp: string;
    message_id: string;
    error?: string | undefined;
}>;
export type GowaSendResponse = z.infer<typeof GowaSendResponseSchema>;
export type GowaWebhookParsed = {
    event: 'message';
    device_id: string;
    data: GowaMessageData;
} | {
    event: 'message.ack';
    device_id: string;
    data: GowaMessageAckData;
} | {
    event: 'message.reaction';
    device_id: string;
    data: GowaReactionData;
} | {
    event: 'message.revoke';
    device_id: string;
    data: GowaMessageData;
} | {
    event: 'message.edited';
    device_id: string;
    data: GowaMessageData;
} | {
    event: 'device.connection.update';
    device_id: string;
    data: GowaDeviceConnectionData;
} | {
    event: 'device.disconnected';
    device_id: string;
    data: GowaDeviceConnectionData;
} | {
    event: 'device.banned';
    device_id: string;
    data: GowaDeviceConnectionData;
} | {
    event: 'pair.qr.consumed';
    device_id: string;
    data: GowaPairQrData;
} | {
    event: 'pair.qr.generated';
    device_id: string;
    data: GowaPairQrData;
} | {
    event: GowaWebhookEventType;
    device_id: string;
    data: unknown;
};
export declare function parseWebhook(envelope: GowaWebhookEnvelope): GowaWebhookParsed;
//# sourceMappingURL=types.d.ts.map