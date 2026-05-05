/**
 * Webhook envelope + per-event payload schema tests.
 *
 * Uses realistic fixtures to confirm:
 *   1. parseWebhook discriminates events correctly
 *   2. Schema rejects malformed payloads
 *   3. Optional fields are truly optional
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GowaWebhookEnvelopeSchema,
  parseWebhook,
} from '../src/types.js';

const baseEnvelope = (event: string, data: unknown) => ({
  event,
  device_id: 'dev-mordechai-1',
  timestamp: '2026-05-05T13:30:00.000Z',
  data,
});

test('envelope: accepts a well-formed message event', () => {
  const env = baseEnvelope('message', {
    id: 'wamid:abc123',
    chat_id: '447000000000@s.whatsapp.net',
    from_id: '447000000000@s.whatsapp.net',
    from_me: false,
    push_name: 'Shaul Levine',
    timestamp: '2026-05-05T13:30:00.000Z',
    is_group: false,
    message_type: 'text',
    text: 'hello',
  });
  const parsed = GowaWebhookEnvelopeSchema.parse(env);
  assert.equal(parsed.event, 'message');
});

test('envelope: rejects unknown event', () => {
  const env = baseEnvelope('not.a.real.event', {});
  assert.throws(() => GowaWebhookEnvelopeSchema.parse(env));
});

test('parseWebhook discriminates a text message', () => {
  const env = baseEnvelope('message', {
    id: 'wamid:abc',
    chat_id: '447000000000@s.whatsapp.net',
    from_id: '447000000000@s.whatsapp.net',
    timestamp: '2026-05-05T13:30:00.000Z',
    message_type: 'text',
    text: 'hi',
  });
  const parsed = GowaWebhookEnvelopeSchema.parse(env);
  const out = parseWebhook(parsed);
  assert.equal(out.event, 'message');
  if (out.event === 'message') {
    assert.equal(out.data.message_type, 'text');
    assert.equal(out.data.text, 'hi');
  }
});

test('parseWebhook discriminates a media message with voice note', () => {
  const env = baseEnvelope('message', {
    id: 'wamid:audio1',
    chat_id: '447000000000@s.whatsapp.net',
    from_id: '447000000000@s.whatsapp.net',
    timestamp: '2026-05-05T13:30:00.000Z',
    message_type: 'audio',
    media: {
      url: 'https://gowa.viter.ai/media/abc.opus',
      mime_type: 'audio/ogg; codecs=opus',
      filename: 'voice-note.opus',
      bytes: 12345,
      duration_seconds: 12.5,
    },
  });
  const parsed = GowaWebhookEnvelopeSchema.parse(env);
  const out = parseWebhook(parsed);
  assert.equal(out.event, 'message');
  if (out.event === 'message') {
    assert.equal(out.data.message_type, 'audio');
    assert.equal(out.data.media?.duration_seconds, 12.5);
  }
});

test('parseWebhook discriminates a reaction event', () => {
  const env = baseEnvelope('message.reaction', {
    id: 'react-1',
    target_message_id: 'wamid:abc',
    from_id: '447000000000@s.whatsapp.net',
    emoji: '👍',
    timestamp: '2026-05-05T13:31:00.000Z',
  });
  const parsed = GowaWebhookEnvelopeSchema.parse(env);
  const out = parseWebhook(parsed);
  assert.equal(out.event, 'message.reaction');
  if (out.event === 'message.reaction') {
    assert.equal(out.data.emoji, '👍');
  }
});

test('parseWebhook discriminates a device.connection.update event', () => {
  const env = baseEnvelope('device.connection.update', {
    device_id: 'dev-1',
    state: 'connected',
    phone_number: '447000000000',
    last_seen_at: '2026-05-05T13:30:00.000Z',
  });
  const parsed = GowaWebhookEnvelopeSchema.parse(env);
  const out = parseWebhook(parsed);
  assert.equal(out.event, 'device.connection.update');
  if (out.event === 'device.connection.update') {
    assert.equal(out.data.state, 'connected');
    assert.equal(out.data.phone_number, '447000000000');
  }
});

test('parseWebhook handles unknown event types as pass-through', () => {
  // Force-construct an envelope we know parses but uses a non-handled event
  const env = {
    event: 'group.participants',
    device_id: 'dev-1',
    timestamp: '2026-05-05T13:30:00.000Z',
    data: { whatever: true },
  } as const;
  const parsed = GowaWebhookEnvelopeSchema.parse(env);
  const out = parseWebhook(parsed);
  assert.equal(out.event, 'group.participants');
  // Unknown events keep raw data
  assert.deepEqual(out.data, { whatever: true });
});
