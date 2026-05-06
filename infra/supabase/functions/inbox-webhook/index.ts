/**
 * inbox-webhook — Supabase Edge Function (Deno runtime).
 *
 * Fires on Storage object-created events for objects under `inbox/`.
 * Dispatches to the right Trigger.dev task based on the path shape:
 *
 *   3-part: `inbox/<tenant>/<chat>/<filename>.zip`
 *     → triggers `ingest-zip` (WhatsApp archive)
 *
 *   4-part w/ "meetings" lane:
 *     `inbox/<tenant>/meetings/<slug>/<filename>.<ext>`  (audio/m4a, mp3, wav, mp4 …)
 *     → triggers `ingest-meeting` (long-form audio)
 *
 * Anything else → no-op (so misnamed drops don't fail loudly during human use).
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

const AUDIO_EXTENSIONS = new Set([
  'm4a', 'mp4', 'mp3', 'wav', 'opus', 'ogg', 'mov', 'webm',
]);

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

  if (payload.schema !== 'storage' || payload.table !== 'objects') {
    return jsonResp({ skipped: true, reason: 'not-storage-objects', got: { schema: payload.schema, table: payload.table } });
  }

  const bucketId = payload.record?.bucket_id;
  if (bucketId !== 'inbox') {
    return jsonResp({ skipped: true, reason: 'wrong-bucket', bucket: bucketId });
  }

  const objectPath = payload.record?.name ?? '';
  if (!objectPath) {
    return jsonResp({ skipped: true, reason: 'no-path' });
  }

  const triggerKey = Deno.env.get('TRIGGER_SECRET_KEY');
  if (!triggerKey) return new Response('TRIGGER_SECRET_KEY not set', { status: 500 });

  const parts = objectPath.split('/');
  const lower = objectPath.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';

  // ── Path-shape dispatch ──
  // 4-part meeting path takes precedence: <tenant>/meetings/<slug>/<file>
  if (parts.length >= 4 && parts[1] === 'meetings') {
    if (!AUDIO_EXTENSIONS.has(ext)) {
      return jsonResp({ skipped: true, reason: 'meeting-path-but-not-audio', path: objectPath, ext });
    }
    const tenant_slug = parts[0]!;
    const meeting_slug = parts[2]!;
    return await triggerTask(triggerKey, 'ingest-meeting', {
      tenant_slug,
      meeting_slug,
      inbox_path: objectPath,
      inbox_bucket: 'inbox',
    }, { idempotencyKey: `inbox:${objectPath}`, route: { tenant_slug, meeting_slug, path: objectPath } });
  }

  // 3-part WhatsApp zip path: <tenant>/<chat>/<file>.zip
  if (parts.length >= 3 && lower.endsWith('.zip')) {
    const tenant_slug = parts[0]!;
    const chat_slug = parts[1]!;
    return await triggerTask(triggerKey, 'ingest-zip', {
      tenant_slug,
      chat_slug,
      inbox_path: objectPath,
      inbox_bucket: 'inbox',
    }, { idempotencyKey: `inbox:${objectPath}`, route: { tenant_slug, chat_slug, path: objectPath } });
  }

  return jsonResp({ skipped: true, reason: 'unrecognized-path-shape', path: objectPath, parts: parts.length });
});

async function triggerTask(
  secretKey: string,
  taskId: string,
  payload: Record<string, unknown>,
  meta: { idempotencyKey: string; route: Record<string, unknown> },
): Promise<Response> {
  const triggerRes = await fetch(`${TRIGGER_API_BASE}/tasks/${taskId}/trigger`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      'Trigger-Version': '2024-12-19',
    },
    body: JSON.stringify({
      payload,
      options: { idempotencyKey: meta.idempotencyKey },
    }),
  });

  if (!triggerRes.ok) {
    const body = await triggerRes.text();
    return new Response(`trigger.dev ${triggerRes.status} on ${taskId}: ${body}`, { status: 502 });
  }

  const triggerData = await triggerRes.json();
  return jsonResp({
    ok: true,
    task: taskId,
    triggered_run: triggerData,
    routed: meta.route,
  });
}

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
