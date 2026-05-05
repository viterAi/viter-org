/**
 * inbox-webhook — Supabase Edge Function (Deno runtime).
 *
 * Fires on Storage object-created events for objects under `inbox/`.
 * Validates the path shape (`inbox/<tenant>/<chat>/<filename>.zip`) and
 * triggers the Trigger.dev `ingest-zip` orchestrator.
 *
 * verify_jwt is intentionally disabled — Supabase's database webhook
 * dispatcher does not include the user JWT, only an internal auth header.
 * The function validates the payload shape (table=objects, bucket_id=inbox)
 * before doing any work; the trigger.dev side is gated by the secret key.
 *
 * Env required (function secrets):
 *   TRIGGER_SECRET_KEY  — cloud.trigger.dev → project → API keys (env: dev|prod)
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const TRIGGER_API_BASE = 'https://api.trigger.dev/api/v1';

interface StorageWebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: {
    bucket_id?: string;
    name?: string;
    owner?: string | null;
    metadata?: Record<string, unknown>;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let payload: StorageWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Reject non-storage-objects events (the webhook should be filtered to
  // storage.objects but be defensive).
  if (payload.schema !== 'storage' || payload.table !== 'objects') {
    return jsonResp({ skipped: true, reason: 'not-storage-objects', got: { schema: payload.schema, table: payload.table } });
  }

  const bucketId = payload.record?.bucket_id;
  if (bucketId !== 'inbox') {
    return jsonResp({ skipped: true, reason: 'wrong-bucket', bucket: bucketId });
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
