/**
 * HMAC signing + verification round-trip tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signPayload, verifyWebhookSignature } from '../src/auth.js';

const SECRET = 'test-secret-32-bytes-no-spaces-here';

test('signPayload produces a sha256= prefixed hex digest', async () => {
  const sig = await signPayload(SECRET, '{"event":"message"}');
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
});

test('verifyWebhookSignature accepts a freshly signed payload', async () => {
  const body = JSON.stringify({ event: 'message', device_id: 'dev-1', data: {} });
  const sig = await signPayload(SECRET, body);
  const ok = await verifyWebhookSignature(SECRET, body, sig);
  assert.equal(ok, true);
});

test('verifyWebhookSignature rejects a tampered body', async () => {
  const original = JSON.stringify({ event: 'message', device_id: 'dev-1', data: {} });
  const sig = await signPayload(SECRET, original);
  const tampered = original.replace('dev-1', 'dev-2');
  const ok = await verifyWebhookSignature(SECRET, tampered, sig);
  assert.equal(ok, false);
});

test('verifyWebhookSignature rejects when signature uses a different secret', async () => {
  const body = '{"x":1}';
  const sig = await signPayload('other-secret', body);
  const ok = await verifyWebhookSignature(SECRET, body, sig);
  assert.equal(ok, false);
});

test('verifyWebhookSignature rejects null / empty signature', async () => {
  assert.equal(await verifyWebhookSignature(SECRET, 'body', null), false);
  assert.equal(await verifyWebhookSignature(SECRET, 'body', ''), false);
  assert.equal(await verifyWebhookSignature(SECRET, 'body', undefined), false);
});

test('verifyWebhookSignature rejects when secret is empty', async () => {
  const body = '{"x":1}';
  const sig = await signPayload(SECRET, body);
  const ok = await verifyWebhookSignature('', body, sig);
  assert.equal(ok, false);
});

test('signPayload is constant-time-comparable (same input → same output)', async () => {
  const body = '{"event":"message","device_id":"dev-1"}';
  const sig1 = await signPayload(SECRET, body);
  const sig2 = await signPayload(SECRET, body);
  assert.equal(sig1, sig2);
});
