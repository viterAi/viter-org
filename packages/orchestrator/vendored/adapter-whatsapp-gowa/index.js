/**
 * @vita/adapter-whatsapp-gowa
 *
 * Public surface for the GOWA adapter package. Re-exports everything
 * downstream code needs: typed REST client, webhook payload schemas,
 * HMAC verification helpers, and the parser that turns raw envelopes
 * into discriminated-union events.
 */
export { GowaClient, GowaError, createGowaClientFromEnv, } from './client.js';
export { GowaWebhookEnvelopeSchema, GowaWebhookEventTypeSchema, GowaMessageDataSchema, GowaMessageAckDataSchema, GowaReactionDataSchema, GowaDeviceConnectionDataSchema, GowaPairQrDataSchema, GowaCreateDeviceResponseSchema, GowaSendTextRequestSchema, GowaSendResponseSchema, parseWebhook, } from './types.js';
export { signPayload, verifyWebhookSignature } from './auth.js';
//# sourceMappingURL=index.js.map