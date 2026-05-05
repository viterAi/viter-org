/**
 * whatsapp-webhook — Supabase Edge Function (Deno).
 *
 * GOWA fires this on every WhatsApp event for every paired device. Mirrors
 * the security pattern of the existing inbox-webhook + openrouter-webhook
 * functions: HMAC-SHA256 verification, JSON body, tenant resolution, then
 * branch by event type.
 *
 * Hot path:
 *   GOWA → POST /whatsapp-webhook (X-Hub-Signature-256: sha256=…)
 *     → verify HMAC
 *     → look up whatsapp_devices.gowa_device_id → tenant_id + channel_id
 *     → branch by event:
 *         - message       → insert l0_artifact + l1_event (text) OR l0_artifact + fire extract-attachment (media)
 *         - message.ack   → update outbound message delivery status
 *         - message.{reaction,revoke,edited} → append-only mutation event
 *         - device.*      → update whatsapp_devices.status/last_seen_at
 *         - pair.qr.*     → notify pair-poll task
 *
 * Idempotency: insert paths use the partial unique indexes added in
 * migration 012 (l0_artifacts_gowa_msgid_unique, l1_events_gowa_msgid_unique).
 * On conflict we return 200 — GOWA's retries are safe.
 *
 * Env (Supabase function secrets):
 *   GOWA_WEBHOOK_SECRET   — HMAC shared with GOWA
 *   SUPABASE_URL          — auto-set
 *   SUPABASE_SERVICE_ROLE_KEY — auto-set
 *
 * Set webhook URL on the GOWA side:
 *   WHATSAPP_WEBHOOK=https://dkccadwohifcqcdzhhnu.supabase.co/functions/v1/whatsapp-webhook
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WEBHOOK_SECRET = Deno.env.get('GOWA_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ────────────────────────────────────────────────────────────────────
// HMAC verification (inlined to avoid cross-package import in Deno EF)
// ────────────────────────────────────────────────────────────────────

const TE = new TextEncoder();

function bufToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < view.length; i++) hex += view[i]!.toString(16).padStart(2, '0');
  return hex;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyHmac(secret: string, body: string, headerSig: string | null): Promise<boolean> {
  if (!headerSig || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw', TE.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, TE.encode(body));
  return safeEqual(headerSig, `sha256=${bufToHex(sig)}`);
}

// ────────────────────────────────────────────────────────────────────
// Types — minimal envelope (full validation lives in adapter package)
// ────────────────────────────────────────────────────────────────────

interface WebhookEnvelope {
  event: string;
  device_id: string;                 // GOWA sends JID format e.g. '972524814613@s.whatsapp.net'
  timestamp?: string;
  // GOWA's actual field name is `payload`. We accept both for compatibility.
  payload?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

interface MessageData {
  id: string;
  chat_id: string;
  // GOWA uses `from` and `from_lid` rather than `from_id`. Accept all.
  from?: string;
  from_id?: string;
  from_lid?: string;
  from_name?: string;                // GOWA's display-name field
  push_name?: string;                // some events use this
  is_from_me?: boolean;              // GOWA's actual key
  from_me?: boolean;                 // alt
  timestamp: string;
  is_group?: boolean;
  group_id?: string;
  group_subject?: string;
  message_type?: string;             // sometimes absent — infer from `body` vs media
  type?: string;                     // alt
  body?: string;                     // GOWA's text field
  text?: string;                     // alt
  media?: {
    url?: string;
    mime_type?: string;
    filename?: string;
    bytes?: number;
    sha256?: string;
    caption?: string;
    duration_seconds?: number;
  };
  quoted_message_id?: string;
  mentions?: string[];
}

interface DeviceConnectionData {
  device_id: string;
  state: 'connected'|'connecting'|'disconnected'|'expired'|'banned'|'re_pair_required';
  phone_number?: string;
  push_name?: string;
  last_seen_at?: string;
  reason?: string;
}

// ────────────────────────────────────────────────────────────────────
// Tenant resolution
// ────────────────────────────────────────────────────────────────────

interface ResolvedDevice {
  id: string;
  tenant_id: string;
  channel_id: string | null;
  display_name: string | null;
  phone_number: string | null;
  status: string;
}

async function resolveDevice(
  db: SupabaseClient,
  gowaDeviceId: string,
): Promise<ResolvedDevice | null> {
  const { data, error } = await db
    .from('whatsapp_devices')
    .select('id, tenant_id, channel_id, display_name, phone_number, status')
    .eq('gowa_device_id', gowaDeviceId)
    .maybeSingle();
  if (error) {
    console.warn(`[wa-webhook] device lookup failed: ${error.message}`);
    return null;
  }
  return data as ResolvedDevice | null;
}

// ────────────────────────────────────────────────────────────────────
// Channel resolution / creation
// ────────────────────────────────────────────────────────────────────

/**
 * Ensure the WhatsApp channel exists for this chat. Channels are
 * (tenant, kind='whatsapp', identifier=<chat_slug>). chat_id from GOWA
 * is normalized to a stable slug.
 */
async function resolveOrCreateChannel(
  db: SupabaseClient,
  args: { tenantId: string; chatId: string; isGroup: boolean; groupSubject: string | undefined; pushName: string | undefined },
): Promise<string | null> {
  const slug = chatIdToSlug(args.chatId);
  const { data: existing } = await db
    .from('channels')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('kind', 'whatsapp')
    .eq('identifier', slug)
    .maybeSingle();
  if (existing) return existing.id as string;

  const displayName = args.isGroup
    ? `WhatsApp · ${args.groupSubject ?? slug}`
    : `WhatsApp · ${args.pushName ?? slug}`;

  const { data: created, error } = await db
    .from('channels')
    .insert({
      tenant_id: args.tenantId,
      kind: 'whatsapp',
      identifier: slug,
      display_name: displayName,
      metadata: { source: 'gowa', chat_id: args.chatId, is_group: args.isGroup },
    })
    .select('id')
    .single();
  if (error || !created) {
    console.warn(`[wa-webhook] channel create failed: ${error?.message}`);
    return null;
  }
  return created.id as string;
}

function chatIdToSlug(chatId: string): string {
  // '447000000000@s.whatsapp.net' → 'wa-447000000000'
  // 'xxxxx@g.us' → 'wa-group-xxxxx'
  const isGroup = chatId.endsWith('@g.us');
  const local = chatId.replace(/@.*$/, '');
  return isGroup ? `wa-group-${local}` : `wa-${local}`;
}

// ────────────────────────────────────────────────────────────────────
// Event handlers
// ────────────────────────────────────────────────────────────────────

async function handleMessage(
  db: SupabaseClient,
  device: ResolvedDevice,
  msg: MessageData,
  webhookReceivedAt: string,
): Promise<{ ok: true; l0_id: string; l1_id?: string; mediaJob?: string } | { ok: false; error: string }> {
  // 1. Resolve channel
  const channelId = await resolveOrCreateChannel(db, {
    tenantId: device.tenant_id,
    chatId: msg.chat_id,
    isGroup: !!msg.is_group,
    groupSubject: msg.group_subject,
    pushName: msg.push_name,
  });
  if (!channelId) return { ok: false, error: 'channel resolution failed' };

  // 1b. Update device.channel_id on first inbound from this chat (idempotent)
  if (!device.channel_id) {
    await db.from('whatsapp_devices').update({ channel_id: channelId }).eq('id', device.id);
  }

  // 2. Insert l0_artifact (idempotent on (tenant_id, gowa_message_id) per migration 012)
  const sha256 = msg.media?.sha256
    ?? `gowa:${msg.id}`;     // fallback so the not-null constraint is satisfied for text-only msgs
  const bytes = msg.media?.bytes ?? (msg.text ? new TextEncoder().encode(msg.text).length : 0);
  const sourceUri = msg.media?.url ?? `gowa://${device.gowa_device_id}/message/${msg.id}`;

  const inlineText = msg.message_type === 'text' ? (msg.text ?? '') : null;

  const { data: l0Row, error: l0Err } = await db
    .from('l0_artifacts')
    .insert({
      tenant_id: device.tenant_id,
      source_type: 'whatsapp_message_live',
      source_uri: sourceUri,
      sha256,
      bytes,
      origin_at: msg.timestamp,
      captured_at: webhookReceivedAt,
      inline_text: inlineText,
      metadata: {
        gowa_message_id: msg.id,
        gowa_device_id: device.gowa_device_id,
        chat_id: msg.chat_id,
        chat_slug: chatIdToSlug(msg.chat_id),
        from_id: msg.from_id,
        from_me: !!msg.from_me,
        push_name: msg.push_name ?? null,
        message_type: msg.message_type,
        is_group: !!msg.is_group,
        group_id: msg.group_id ?? null,
        group_subject: msg.group_subject ?? null,
        media: msg.media ?? null,
        quoted_message_id: msg.quoted_message_id ?? null,
        mentions: msg.mentions ?? [],
      },
    })
    .select('id')
    .single();

  if (l0Err) {
    // Idempotent path: unique-violation on (tenant_id, gowa_message_id) is OK
    if (l0Err.code === '23505') {
      const { data: existing } = await db
        .from('l0_artifacts')
        .select('id')
        .eq('tenant_id', device.tenant_id)
        .eq('metadata->>gowa_message_id', msg.id)
        .maybeSingle();
      if (existing) return { ok: true, l0_id: existing.id as string };
    }
    return { ok: false, error: `l0 insert failed: ${l0Err.message}` };
  }
  if (!l0Row) return { ok: false, error: 'l0 insert returned no row' };
  const l0Id = l0Row.id as string;

  // 3. Branch by message type
  if (msg.message_type === 'text') {
    // Text → straight to l1_events, no extractor needed
    const { data: l1Row, error: l1Err } = await db
      .from('l1_events')
      .insert({
        tenant_id: device.tenant_id,
        artifact_id: l0Id,
        extraction_run_id: null,                  // text needs no extraction run
        facet: 'messages',
        event_at: msg.timestamp,
        position: 0,
        actor_id: null,                           // alias resolution happens in a backfill job
        channel_id: channelId,
        modality: 'text',
        content: msg.text ?? '',
        confidence: 1.0,                          // raw digital text; perfect fidelity
        extraction_method: 'gowa-webhook@v8.4.0',
        metadata: {
          gowa_message_id: msg.id,
          gowa_device_id: device.gowa_device_id,
          push_name: msg.push_name ?? null,
          from_me: !!msg.from_me,
          chat_id: msg.chat_id,
          quoted_message_id: msg.quoted_message_id ?? null,
        },
      })
      .select('id')
      .single();
    if (l1Err && l1Err.code !== '23505') {
      return { ok: false, error: `l1 insert failed: ${l1Err.message}` };
    }
    return { ok: true, l0_id: l0Id, l1_id: l1Row?.id as string | undefined };
  }

  // Media → fire extract-attachment trigger.dev task
  // For now we record intent; the actual trigger fire is wired by the
  // packages/orchestrator integration (see wa-message-fan-out.ts task).
  // The Edge Function does NOT call trigger.dev directly — too tight a coupling
  // and Deno HTTP rate limits. Instead we mark the l0 row, and the orchestrator's
  // `wa-message-listener` cron-task picks up unprocessed media artifacts.
  return { ok: true, l0_id: l0Id, mediaJob: 'queued-for-extract-attachment' };
}

async function handleMessageAck(db: SupabaseClient, device: ResolvedDevice, ack: { id: string; ack: string; timestamp: string }): Promise<{ ok: true }> {
  // Outbound message ack: update the matching l1_event metadata
  await db
    .from('l1_events')
    .update({ metadata: { last_ack: ack.ack, last_ack_at: ack.timestamp } })
    .eq('tenant_id', device.tenant_id)
    .eq('metadata->>gowa_message_id', ack.id);
  return { ok: true };
}

async function handleMessageReactionRevokeEdit(
  db: SupabaseClient,
  device: ResolvedDevice,
  event: 'message.reaction' | 'message.revoke' | 'message.edited',
  data: Record<string, unknown>,
): Promise<{ ok: true }> {
  // Append-only mutation event linked to original message via metadata
  const facet = event === 'message.reaction' ? 'reaction'
              : event === 'message.revoke'   ? 'revoke'
              :                                 'edit';
  await db.from('l1_events').insert({
    tenant_id: device.tenant_id,
    artifact_id: null,
    extraction_run_id: null,
    facet,
    event_at: (data.timestamp as string) ?? new Date().toISOString(),
    position: 0,
    actor_id: null,
    channel_id: device.channel_id,
    modality: 'text',
    content: facet === 'reaction' ? String(data.emoji ?? '') : null,
    confidence: 1.0,
    extraction_method: 'gowa-webhook@v8.4.0',
    metadata: {
      gowa_event_type: event,
      gowa_target_message_id: data.target_message_id ?? data.id,
      gowa_device_id: device.gowa_device_id,
      raw: data,
    },
  });
  return { ok: true };
}

async function handleDeviceConnectionUpdate(
  db: SupabaseClient,
  device: ResolvedDevice,
  data: DeviceConnectionData,
): Promise<{ ok: true }> {
  const update: Record<string, unknown> = { last_seen_at: data.last_seen_at ?? new Date().toISOString() };
  if (data.state) {
    const mapped = data.state === 'connected' ? 'linked' : data.state;
    update.status = mapped;
    if (mapped === 'banned') update.banned_at = new Date().toISOString();
    if (data.reason) update.last_error = data.reason.slice(0, 500);
  }
  if (data.phone_number) update.phone_number = data.phone_number;
  await db.from('whatsapp_devices').update(update).eq('id', device.id);
  return { ok: true };
}

async function handlePairQrConsumed(
  db: SupabaseClient,
  device: ResolvedDevice,
  data: { phone_number?: string },
): Promise<{ ok: true }> {
  await db.from('whatsapp_devices').update({
    status: 'linked',
    paired_at: new Date().toISOString(),
    phone_number: data.phone_number ?? device.phone_number,
    re_pair_url: null,
    last_error: null,
  }).eq('id', device.id);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// Entrypoint
// ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get('X-Hub-Signature-256');
  if (!(await verifyHmac(WEBHOOK_SECRET, body, sig))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = JSON.parse(body) as WebhookEnvelope;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!envelope.event || !envelope.device_id) {
    return jsonResp({ skipped: true, reason: 'missing event or device_id' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_KEY);

  const device = await resolveDevice(db, envelope.device_id);
  if (!device) {
    // Unknown device — log + acknowledge so GOWA doesn't retry forever.
    return jsonResp({ skipped: true, reason: 'unknown device', device_id: envelope.device_id });
  }

  // Accept both `payload` (GOWA's actual field name) and `data` (our spec).
  const eventData = (envelope.payload ?? envelope.data ?? {}) as Record<string, unknown>;
  const webhookReceivedAt = new Date().toISOString();

  try {
    switch (envelope.event) {
      case 'message': {
        const raw = eventData as unknown as MessageData;
        // Normalize GOWA's field variants to the ones handleMessage expects.
        const msg: MessageData = {
          ...raw,
          from_id: raw.from_id ?? raw.from ?? raw.from_lid ?? '',
          push_name: raw.push_name ?? raw.from_name,
          from_me: raw.from_me ?? raw.is_from_me ?? false,
          message_type: raw.message_type ?? raw.type ?? (raw.body ? 'text' : (raw.media ? 'media' : 'unknown')),
          text: raw.text ?? raw.body,
        };
        const result = await handleMessage(db, device, msg, webhookReceivedAt);
        return jsonResp({ ok: result.ok, ...result });
      }
      case 'message.ack': {
        const result = await handleMessageAck(db, device, eventData as unknown as { id: string; ack: string; timestamp: string });
        return jsonResp(result);
      }
      case 'message.reaction':
      case 'message.revoke':
      case 'message.edited': {
        const result = await handleMessageReactionRevokeEdit(db, device, envelope.event, eventData);
        return jsonResp(result);
      }
      case 'device.connection.update':
      case 'device.disconnected':
      case 'device.banned': {
        const result = await handleDeviceConnectionUpdate(db, device, eventData as unknown as DeviceConnectionData);
        return jsonResp(result);
      }
      case 'pair.qr.consumed': {
        const result = await handlePairQrConsumed(db, device, eventData as { phone_number?: string });
        return jsonResp(result);
      }
      default:
        // Unknown / unhandled events: ack so GOWA doesn't retry, but record
        // them so we can audit what we're missing.
        await db.from('whatsapp_devices').update({
          metadata: { last_unhandled_event: { event: envelope.event, at: webhookReceivedAt, data: eventData } },
        }).eq('id', device.id);
        return jsonResp({ skipped: true, reason: 'unhandled event', event: envelope.event });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[wa-webhook] handler error event=${envelope.event}: ${msg}`);
    return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 300) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
