/**
 * @vita/adapter-whatsapp-gowa
 *
 * Public surface for the GOWA adapter package. Re-exports everything
 * downstream code needs: typed REST client, webhook payload schemas,
 * HMAC verification helpers, and the parser that turns raw envelopes
 * into discriminated-union events.
 */

export {
  GowaClient,
  GowaError,
  createGowaClientFromEnv,
  type GowaClientConfig,
} from './client.js';

export {
  GowaWebhookEnvelopeSchema,
  GowaWebhookEventTypeSchema,
  GowaMessageDataSchema,
  GowaMessageAckDataSchema,
  GowaReactionDataSchema,
  GowaDeviceConnectionDataSchema,
  GowaPairQrDataSchema,
  GowaCreateDeviceResponseSchema,
  GowaSendTextRequestSchema,
  GowaSendResponseSchema,
  parseWebhook,
  type GowaWebhookEnvelope,
  type GowaWebhookEventType,
  type GowaWebhookParsed,
  type GowaMessageData,
  type GowaMessageAckData,
  type GowaReactionData,
  type GowaDeviceConnectionData,
  type GowaPairQrData,
  type GowaCreateDeviceResponse,
  type GowaSendTextRequest,
  type GowaSendResponse,
} from './types.js';

export { signPayload, verifyWebhookSignature } from './auth.js';
