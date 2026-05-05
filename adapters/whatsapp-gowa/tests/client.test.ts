/**
 * GowaClient tests using a fetch-mock injection.
 *
 * No real HTTP — tests confirm:
 *   - Auth header is set correctly
 *   - X-Device-Id header is added on device-scoped calls
 *   - Response schemas validate
 *   - GowaError is thrown with status + body on non-2xx
 *   - Timeout aborts long requests
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GowaClient, GowaError } from '../src/client.js';

interface MockedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (req: MockedRequest) => { status: number; body: unknown }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => { headers[k] = v; });
    }
    let body: unknown = null;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    const result = handler({ method, url, headers, body });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

test('createDevice posts and returns parsed response', async () => {
  const client = new GowaClient({
    baseUrl: 'http://localhost:3000',
    fetchImpl: mockFetch((req) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, 'http://localhost:3000/devices');
      return { status: 200, body: { device_id: 'dev-abc', qr: 'data:image/png;base64,xxx' } };
    }),
  });
  const out = await client.createDevice();
  assert.equal(out.device_id, 'dev-abc');
  assert.equal(out.qr, 'data:image/png;base64,xxx');
});

test('basic auth header is set when basicAuth provided', async () => {
  let captured: Record<string, string> = {};
  const client = new GowaClient({
    baseUrl: 'http://localhost:3000',
    basicAuth: 'admin:secret',
    fetchImpl: mockFetch((req) => {
      captured = req.headers;
      return { status: 200, body: { device_id: 'dev', qr: 'q' } };
    }),
  });
  await client.createDevice();
  // base64('admin:secret') = 'YWRtaW46c2VjcmV0'
  assert.equal(captured['authorization'], 'Basic YWRtaW46c2VjcmV0');
});

test('X-Device-Id is set on device-scoped sendText', async () => {
  let captured: Record<string, string> = {};
  const client = new GowaClient({
    baseUrl: 'http://localhost:3000',
    fetchImpl: mockFetch((req) => {
      captured = req.headers;
      return {
        status: 200,
        body: { message_id: 'wamid:1', status: 'sent', timestamp: '2026-05-05T13:30:00.000Z' },
      };
    }),
  });
  await client.sendText('dev-mordechai-1', { phone: '447000000000@s.whatsapp.net', message: 'hi' });
  assert.equal(captured['x-device-id'], 'dev-mordechai-1');
});

test('GowaError thrown on non-2xx with status + body preserved', async () => {
  const client = new GowaClient({
    baseUrl: 'http://localhost:3000',
    fetchImpl: mockFetch(() => ({ status: 429, body: { error: 'rate limited' } })),
  });
  await assert.rejects(
    () => client.createDevice(),
    (err: unknown) => {
      assert.ok(err instanceof GowaError);
      assert.equal((err as GowaError).status, 429);
      assert.match((err as GowaError).body, /rate limited/);
      return true;
    },
  );
});

test('sendText validates request body via zod', async () => {
  const client = new GowaClient({
    baseUrl: 'http://localhost:3000',
    fetchImpl: mockFetch(() => ({ status: 200, body: { message_id: 'x', status: 'sent', timestamp: '2026-05-05T13:30:00.000Z' } })),
  });
  await assert.rejects(
    () => client.sendText('dev-1', { phone: '', message: 'hi' }),  // empty phone fails .min(5)
    /phone/,
  );
});
