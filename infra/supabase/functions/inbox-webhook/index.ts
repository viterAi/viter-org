/**
 * inbox-webhook — Supabase Edge Function (Deno runtime).
 *
 * Fires on Storage object-created events for objects under `inbox/`.
 * Validates the path shape (`inbox/<tenant>/<chat>/<filename>.zip`) and
 * triggers the Trigger.dev `ingest-zip` orchestrator.
 *
 * That's it. ~50ms of work. Doesn't touch the bytes; doesn't touch the DB.
 *
 * Wire-up (Supabase dashboard):
 *   Storage → Webhooks → New webhook
 *     - Name: inbox-zip-fires-trigger
 *     - Events: ObjectCreated:*
 *     - Bucket: inbox
 *     - Filter: *.zip
 *     - HTTP endpoint: this function's URL
 *
 * Env required (function secrets):
 *   TRIGGER_SECRET_KEY    — from cloud.trigger.dev → project → API keys (env: dev|prod)
 *   TRIGGER_PROJECT_REF   — defaults to "test-JeHj"
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const TRIGGER_API_BASE = 'https://api.trigger.dev/api/v1';

interface StorageWebhookPayload {
  type: 'OBJECT_CREATED' | 'OBJECT_UPDATED' | 'OBJECT_DELETED' | string;
  table: 'objects';
  schema: 'storage';
  record: {
    bucket_id: string;
    name: string;          // path within bucket, e.g. "viter/shaul-direct/2026-05-04T22.zip"
    owner: string | null;
    metadata?: Record<string, unknown>;
  };
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let payload: StorageWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (payload.record?.bucket_id !== 'inbox') {
    return jsonResp({ skipped: true, reason: 'wrong-bucket', bucket: payload.record?.bucket_id });
  }
  const objectPath = payload.record?.name ?? '';
  if (!objectPath.toLowerCase().endsWith('.zip')) {
    return jsonResp({ skipped: true, reason: 'not-a-zip', path: objectPath });
  }

  // Path shape: <tenant_slug>/<chat_slug>/<filename>.zip
  const parts = objectPath.split('/');
  if (parts.length < 3) {
    return jsonResp({ skipped: true, reason: 'bad-path-shape', path: objectPath });
  }
  const tenant_slug = parts[0]!;
  const chat_slug = parts[1]!;

  const triggerKey = Deno.env.get('TRIGGER_SECRET_KEY');
  if (!triggerKey) return new Response('TRIGGER_SECRET_KEY not set', { status: 500 });

  const triggerRes = await fetch(`${TRIGGER_API_BASE}/tasks/ingest-zip/trigger`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${triggerKey}`,
      'Content-Type': 'application/json',
      'Trigger-Version': '2024-12-19',
    },
    body: JSON.stringify({
      payload: {
        tenant_slug,
        chat_slug,
        inbox_path: objectPath,
        inbox_bucket: 'inbox',
      },
      options: {
        // Idempotency: same zip path → same run; re-uploads dedupe naturally
        idempotencyKey: `inbox:${objectPath}`,
      },
    }),
  });

  if (!triggerRes.ok) {
    const body = await triggerRes.text();
    return new Response(`trigger.dev ${triggerRes.status}: ${body}`, { status: 502 });
  }

  const triggerData = await triggerRes.json();
  return jsonResp({
    ok: true,
    triggered_run: triggerData,
    routed: { tenant_slug, chat_slug, path: objectPath },
  });
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
