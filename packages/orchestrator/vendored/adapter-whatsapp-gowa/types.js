/**
 * GOWA wire types — webhook payloads + REST request/response shapes.
 *
 * Source: `aldinokemal/go-whatsapp-web-multidevice` v8.4.0 OpenAPI + webhook
 * payload reference. Validated at runtime via the zod schemas below; static
 * types are inferred from the schemas so the two stay in sync automatically.
 */
import { z } from 'zod';
// ────────────────────────────────────────────────────────────────────
// Webhook event envelope
// ────────────────────────────────────────────────────────────────────
export const GowaWebhookEventTypeSchema = z.enum([
    'message',
    'message.ack',
    'message.reaction',
    'message.revoke',
    'message.edited',
    'device.connection.update',
    'device.disconnected',
    'device.banned',
    'pair.qr.consumed',
    'pair.qr.generated',
    'group.participants',
    'newsletter',
    'call.offer',
]);
/**
 * Every webhook payload from GOWA carries this top-level shape. The
 * `data` field is event-specific and discriminated by `event`.
 */
export const GowaWebhookEnvelopeSchema = z.object({
    event: GowaWebhookEventTypeSchema,
    device_id: z.string().min(1),
    timestamp: z.string().datetime().optional(),
    data: z.unknown(),
});
// ────────────────────────────────────────────────────────────────────
// Per-event payload shapes
// ────────────────────────────────────────────────────────────────────
export const GowaMessageMediaSchema = z.object({
    url: z.string().url().optional(),
    mime_type: z.string().optional(),
    filename: z.string().optional(),
    bytes: z.number().int().nonnegative().optional(),
    sha256: z.string().optional(),
    caption: z.string().optional(),
    duration_seconds: z.number().nonnegative().optional(), // audio/video only
});
export const GowaMessageDataSchema = z.object({
    /** Globally-unique message id from WhatsApp protocol */
    id: z.string(),
    chat_id: z.string(), // e.g. '447000000000@s.whatsapp.net' for 1:1, or 'xxx@g.us' for groups
    from_id: z.string(), // sender's WhatsApp id (always user-scoped)
    from_me: z.boolean().optional(), // GOWA may omit when false
    push_name: z.string().optional(), // sender's display name
    timestamp: z.string().datetime(), // ISO when WhatsApp recorded it
    is_group: z.boolean().optional(), // GOWA may omit for 1:1 chats
    group_id: z.string().optional(),
    group_subject: z.string().optional(),
    message_type: z.enum(['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'reaction', 'revoke', 'edited', 'poll', 'system']),
    text: z.string().optional(), // text body or caption
    media: GowaMessageMediaSchema.optional(),
    quoted_message_id: z.string().optional(),
    mentions: z.array(z.string()).optional(),
});
export const GowaMessageAckDataSchema = z.object({
    id: z.string(), // outbound message id
    ack: z.enum(['pending', 'server', 'delivery', 'read', 'played']),
    timestamp: z.string().datetime(),
});
export const GowaReactionDataSchema = z.object({
    id: z.string(), // reaction event id
    target_message_id: z.string(), // the message being reacted to
    from_id: z.string(),
    emoji: z.string().nullable(), // null = reaction removed
    timestamp: z.string().datetime(),
});
export const GowaDeviceConnectionDataSchema = z.object({
    device_id: z.string(),
    state: z.enum(['connected', 'connecting', 'disconnected', 'expired', 'banned', 're_pair_required']),
    phone_number: z.string().optional(),
    push_name: z.string().optional(),
    last_seen_at: z.string().datetime().optional(),
    reason: z.string().optional(),
});
export const GowaPairQrDataSchema = z.object({
    device_id: z.string(),
    qr_data: z.string().optional(), // base64 PNG or raw QR string
    expires_at: z.string().datetime().optional(),
});
// ────────────────────────────────────────────────────────────────────
// REST request/response shapes (subset most relevant for vita)
// ────────────────────────────────────────────────────────────────────
export const GowaCreateDeviceResponseSchema = z.object({
    device_id: z.string(),
    qr: z.string().optional(), // base64 PNG QR for the UI to render
    expires_at: z.string().datetime().optional(),
});
export const GowaListDevicesResponseSchema = z.array(z.object({
    device_id: z.string(),
    phone_number: z.string().nullable(),
    push_name: z.string().nullable(),
    state: GowaDeviceConnectionDataSchema.shape.state,
    paired_at: z.string().datetime().nullable(),
    last_seen_at: z.string().datetime().nullable(),
}));
export const GowaSendTextRequestSchema = z.object({
    phone: z.string().min(5), // E.164 + suffix (e.g. '447000000000@s.whatsapp.net')
    message: z.string().min(1),
    reply_to_message_id: z.string().optional(),
});
export const GowaSendResponseSchema = z.object({
    message_id: z.string(),
    status: z.enum(['queued', 'sent', 'failed']),
    timestamp: z.string().datetime(),
    error: z.string().optional(),
});
export function parseWebhook(envelope) {
    switch (envelope.event) {
        case 'message':
        case 'message.revoke':
        case 'message.edited':
            return { event: envelope.event, device_id: envelope.device_id, data: GowaMessageDataSchema.parse(envelope.data) };
        case 'message.ack':
            return { event: envelope.event, device_id: envelope.device_id, data: GowaMessageAckDataSchema.parse(envelope.data) };
        case 'message.reaction':
            return { event: envelope.event, device_id: envelope.device_id, data: GowaReactionDataSchema.parse(envelope.data) };
        case 'device.connection.update':
        case 'device.disconnected':
        case 'device.banned':
            return { event: envelope.event, device_id: envelope.device_id, data: GowaDeviceConnectionDataSchema.parse(envelope.data) };
        case 'pair.qr.consumed':
        case 'pair.qr.generated':
            return { event: envelope.event, device_id: envelope.device_id, data: GowaPairQrDataSchema.parse(envelope.data) };
        default:
            // Unknown event types pass through with raw data; caller decides.
            return { event: envelope.event, device_id: envelope.device_id, data: envelope.data };
    }
}
//# sourceMappingURL=types.js.map