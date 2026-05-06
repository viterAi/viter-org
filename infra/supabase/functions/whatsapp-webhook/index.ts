// whatsapp-webhook v14 - v13 (inline vision + breadcrumbs) + group-name correctness
//   - derive is_group from chat_id ('@g.us'); GOWA's flag is unreliable
//   - upgrade existing channel display_name when group_subject finally arrives
//   - never use pushName as a group's display name
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const WEBHOOK_SECRET = Deno.env.get('GOWA_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOWA_BASIC_AUTH = Deno.env.get('GOWA_BASIC_AUTH') ?? '';
const GOWA_BASE_URL = (Deno.env.get('GOWA_BASE_URL') ?? '').replace(/\/+$/, '');
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const MEDIA_BUCKET = 'l0-whatsapp';
const TE = new TextEncoder();

function bufToHex(buf: ArrayBuffer): string { const v = new Uint8Array(buf); let h = ''; for (let i = 0; i < v.length; i++) h += v[i]!.toString(16).padStart(2,'0'); return h; }
function safeEqual(a: string, b: string): boolean { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
async function verifyHmac(secret: string, body: string, headerSig: string | null): Promise<boolean> { if (!headerSig || !secret) return false; const k = await crypto.subtle.importKey('raw', TE.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const s = await crypto.subtle.sign('HMAC', k, TE.encode(body)); return safeEqual(headerSig, `sha256=${bufToHex(s)}`); }

interface WebhookEnvelope { event: string; device_id: string; timestamp?: string; payload?: Record<string, unknown>; data?: Record<string, unknown>; }
interface GowaMediaPayload { url?: string; mime_type?: string; filename?: string; bytes?: number; sha256?: string; caption?: string; duration_seconds?: number; }
interface MessageData { id: string; chat_id: string; from?: string; from_id?: string; from_lid?: string; from_name?: string; push_name?: string; is_from_me?: boolean; from_me?: boolean; timestamp: string; is_group?: boolean; group_id?: string; group_subject?: string; message_type?: string; type?: string; body?: string; text?: string; media?: GowaMediaPayload; image?: GowaMediaPayload | string; audio?: GowaMediaPayload | string; video?: GowaMediaPayload | string; document?: GowaMediaPayload | string; sticker?: GowaMediaPayload | string; video_note?: GowaMediaPayload | string; quoted_message_id?: string; mentions?: string[]; }
interface DeviceConnectionData { device_id: string; state: 'connected'|'connecting'|'disconnected'|'expired'|'banned'|'re_pair_required'; phone_number?: string; push_name?: string; last_seen_at?: string; reason?: string; }
interface ResolvedDevice { id: string; tenant_id: string; channel_id: string | null; display_name: string | null; phone_number: string | null; status: string; gowa_device_id: string; }

// Write breadcrumbs to l0_artifacts.metadata.vision_status so we can audit via SQL
async function bc(db: SupabaseClient, l0Id: string, status: string, extra?: Record<string, unknown>) {
  try {
    const { data: row } = await db.from('l0_artifacts').select('metadata').eq('id', l0Id).maybeSingle();
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    const trace = ((meta.vision_trace as Array<unknown>) ?? []).concat([{ at: new Date().toISOString(), status, ...(extra ?? {}) }]);
    await db.from('l0_artifacts').update({ metadata: { ...meta, vision_status: status, vision_trace: trace } }).eq('id', l0Id);
  } catch (e) { console.warn(`bc fail: ${(e as Error).message}`); }
}

async function resolveDevice(db: SupabaseClient, gowaDeviceId: string): Promise<ResolvedDevice | null> { const { data, error } = await db.from('whatsapp_devices').select('id, tenant_id, channel_id, display_name, phone_number, status, gowa_device_id').eq('gowa_device_id', gowaDeviceId).maybeSingle(); if (error) { console.warn(`[wa-webhook] device lookup failed: ${error.message}`); return null; } return data as ResolvedDevice | null; }
function chatIdToSlug(chatId: string): string { const isGroup = chatId.endsWith('@g.us'); const local = chatId.replace(/@.*$/, ''); return isGroup ? `wa-group-${local}` : `wa-${local}`; }
async function resolveOrCreateChannel(db: SupabaseClient, args: { tenantId: string; chatId: string; isGroup: boolean; groupSubject: string | undefined; pushName: string | undefined }): Promise<string | null> { const slug = chatIdToSlug(args.chatId); const isGroup = args.isGroup || args.chatId.endsWith('@g.us'); const { data: existing } = await db.from('channels').select('id, display_name').eq('tenant_id', args.tenantId).eq('kind', 'whatsapp').eq('identifier', slug).maybeSingle(); if (existing) { if (isGroup && args.groupSubject) { const desired = `WhatsApp · ${args.groupSubject}`; if (existing.display_name !== desired) await db.from('channels').update({ display_name: desired }).eq('id', existing.id); } return existing.id as string; } const displayName = isGroup ? `WhatsApp · ${args.groupSubject ?? slug}` : `WhatsApp · ${args.pushName ?? slug}`; const { data: created, error } = await db.from('channels').insert({ tenant_id: args.tenantId, kind: 'whatsapp', identifier: slug, display_name: displayName, metadata: { source: 'gowa', chat_id: args.chatId, is_group: isGroup } }).select('id').single(); if (error || !created) { console.warn(`[wa-webhook] channel create failed: ${error?.message}`); return null; } return created.id as string; }

async function sha256Hex(bytes: Uint8Array): Promise<string> { const buf = await crypto.subtle.digest('SHA-256', bytes); return bufToHex(buf); }
function mimeToExt(mime: string): string { if (mime.startsWith('image/jpeg')) return 'jpg'; if (mime.startsWith('image/png')) return 'png'; if (mime.startsWith('image/webp')) return 'webp'; if (mime.startsWith('image/gif')) return 'gif'; if (mime.startsWith('audio/ogg')) return 'opus'; if (mime.startsWith('audio/mp4')) return 'm4a'; if (mime.startsWith('audio/mpeg')) return 'mp3'; if (mime.startsWith('audio/')) return 'opus'; if (mime.startsWith('video/')) return 'mp4'; if (mime === 'application/pdf') return 'pdf'; if (mime === 'application/zip') return 'zip'; return 'bin'; }
function mimeToModality(mime: string): 'image' | 'voice' | 'video' | 'file' { if (mime.startsWith('image/')) return 'image'; if (mime.startsWith('audio/')) return 'voice'; if (mime.startsWith('video/')) return 'video'; return 'file'; }

interface StoredMedia { sourceUri: string; storagePath: string; sha256: string; bytes: number; mimeType: string; filename: string; modality: ReturnType<typeof mimeToModality>; buf: Uint8Array; }

async function downloadAndStoreMedia(db: SupabaseClient, device: ResolvedDevice, msg: MessageData, chatSlug: string): Promise<StoredMedia | null> {
  const rawUrl = msg.media?.url; if (!rawUrl) return null;
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${GOWA_BASE_URL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  const mimeType = msg.media?.mime_type ?? 'application/octet-stream';
  const ext = mimeToExt(mimeType);
  const filename = msg.media?.filename ?? `${msg.id}.${ext}`;
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `live/${device.tenant_id}/${chatSlug}/${msg.id}-${safeName}`;
  const authHeader = GOWA_BASIC_AUTH ? `Basic ${btoa(GOWA_BASIC_AUTH)}` : '';
  const headers: Record<string, string> = {}; if (authHeader) headers['Authorization'] = authHeader;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`gowa media fetch ${res.status} ${res.statusText} (${url})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const sha = await sha256Hex(buf);
  const { error: upErr } = await db.storage.from(MEDIA_BUCKET).upload(storagePath, buf, { contentType: mimeType, upsert: false });
  if (upErr) { const m = (upErr.message ?? '').toLowerCase(); if (!m.includes('exists') && !m.includes('duplicate')) throw new Error(`storage upload: ${upErr.message}`); }
  return { sourceUri: `${MEDIA_BUCKET}/${storagePath}`, storagePath, sha256: sha, bytes: buf.length, mimeType, filename, modality: mimeToModality(mimeType), buf };
}

const IMAGE_VISION_MODEL = 'google/gemini-3.1-flash-lite-preview';
const IMAGE_VISION_PROMPT = 'Examine this image. Output JSON with exactly these fields:\n  "ocr_text": all text visible in the image, verbatim, in reading order. Empty string if none.\n  "description": one paragraph describing the visual content (what it shows, layout, key elements).\n  "language": ISO 639-1 code of the dominant text language ("en", "he", etc), or null if no text.\n  "regions": array of detected meaningful regions, each {"kind":"chart|table|text_block|face|other", "text":"..."}.\nOutput JSON only — no preface, no commentary, no fenced code blocks.';

async function processImageVision(db: SupabaseClient, args: { l0Id: string; tenantId: string; channelId: string; eventAt: string; bytes: Uint8Array; mimeType: string; filename: string }) {
  await bc(db, args.l0Id, 'vision-start', { bytes: args.bytes.length, key_present: OPENROUTER_API_KEY.length > 0 });
  if (!OPENROUTER_API_KEY) { await bc(db, args.l0Id, 'vision-no-key'); return; }
  const t0 = Date.now();
  const dataUrl = `data:${args.mimeType};base64,${encodeBase64(args.bytes)}`;
  await bc(db, args.l0Id, 'vision-fetch-start');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://vita-roan.vercel.app', 'X-Title': 'vita whatsapp-webhook image vision' },
    body: JSON.stringify({ model: IMAGE_VISION_MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: IMAGE_VISION_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }], response_format: { type: 'json_object' }, reasoning: { effort: 'minimal' } }),
  });
  await bc(db, args.l0Id, 'vision-fetch-done', { status: res.status });
  if (!res.ok) { const body = await res.text(); throw new Error(`openrouter ${res.status}: ${body.slice(0, 300)}`); }
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!raw) throw new Error('empty extraction');
  let parsed: { ocr_text?: string; description?: string; language?: string | null; regions?: Array<{ kind?: string; text?: string }> };
  try { parsed = JSON.parse(raw); } catch { const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''); parsed = JSON.parse(stripped); }
  const ocr = (parsed.ocr_text ?? '').trim();
  const desc = (parsed.description ?? '').trim();
  const text = ocr ? `${ocr}\n\n[visual] ${desc}` : `[visual] ${desc}`;
  const segments = (parsed.regions ?? []).filter((r) => (r.text ?? '').trim().length > 0).map((r, i) => ({ start: i, end: i + 1, page: null, text: `[${r.kind ?? 'region'}] ${r.text}` }));
  const { error: insErr } = await db.from('l1_events').insert({
    tenant_id: args.tenantId, artifact_id: args.l0Id, extraction_run_id: null, facet: 'image_caption', event_at: args.eventAt, position: 0, actor_id: null, channel_id: args.channelId, modality: 'image',
    content: text, confidence: 0.9, extraction_method: `${IMAGE_VISION_MODEL}@wa-webhook`,
    metadata: { kind: 'image_caption', chars: text.length, filename: args.filename, language: parsed.language ?? null, segments, n_segments: segments.length, mime_type: args.mimeType, model_used: IMAGE_VISION_MODEL, provider: 'openrouter', generation_id: data.id ?? null, wall_ms: Date.now() - t0 },
  });
  if (insErr) { await bc(db, args.l0Id, 'vision-insert-err', { msg: insErr.message }); throw new Error(`l1 image_caption insert: ${insErr.message}`); }
  await bc(db, args.l0Id, 'vision-done', { chars: text.length, ms: Date.now() - t0 });
}

async function handleMessage(db: SupabaseClient, device: ResolvedDevice, msg: MessageData, webhookReceivedAt: string, rawEvent: Record<string, unknown>): Promise<{ ok: true; l0_id: string; l1_id?: string; mediaJob?: string } | { ok: false; error: string }> {
  const channelId = await resolveOrCreateChannel(db, { tenantId: device.tenant_id, chatId: msg.chat_id, isGroup: !!msg.is_group, groupSubject: msg.group_subject, pushName: msg.push_name });
  if (!channelId) return { ok: false, error: 'channel resolution failed' };
  if (!device.channel_id) await db.from('whatsapp_devices').update({ channel_id: channelId }).eq('id', device.id);

  const sha256 = msg.media?.sha256 ?? `gowa:${msg.id}`;
  const bytes = msg.media?.bytes ?? (msg.text ? new TextEncoder().encode(msg.text).length : 0);
  const sourceUri = msg.media?.url ?? `gowa://${device.gowa_device_id}/message/${msg.id}`;
  const inlineText = msg.message_type === 'text' ? (msg.text ?? '') : null;

  const { data: l0Row, error: l0Err } = await db.from('l0_artifacts').insert({
    tenant_id: device.tenant_id, source_type: 'whatsapp_message_live', source_uri: sourceUri, sha256, bytes, origin_at: msg.timestamp, captured_at: webhookReceivedAt, inline_text: inlineText,
    metadata: { gowa_message_id: msg.id, gowa_device_id: device.gowa_device_id, chat_id: msg.chat_id, chat_slug: chatIdToSlug(msg.chat_id), from_id: msg.from_id, from_me: !!msg.from_me, push_name: msg.push_name ?? null, message_type: msg.message_type, is_group: !!msg.is_group, group_id: msg.group_id ?? null, group_subject: msg.group_subject ?? null, media: msg.media ?? null, quoted_message_id: msg.quoted_message_id ?? null, mentions: msg.mentions ?? [], raw_event: msg.message_type === 'unknown' ? rawEvent : null },
  }).select('id').single();

  if (l0Err) {
    if (l0Err.code === '23505') { const { data: existing } = await db.from('l0_artifacts').select('id').eq('tenant_id', device.tenant_id).eq('metadata->>gowa_message_id', msg.id).maybeSingle(); if (existing) return { ok: true, l0_id: existing.id as string }; }
    return { ok: false, error: `l0 insert failed: ${l0Err.message}` };
  }
  if (!l0Row) return { ok: false, error: 'l0 insert returned no row' };
  const l0Id = l0Row.id as string;

  if (msg.message_type === 'text') {
    const { data: l1Row, error: l1Err } = await db.from('l1_events').insert({
      tenant_id: device.tenant_id, artifact_id: l0Id, extraction_run_id: null, facet: 'messages', event_at: msg.timestamp, position: 0, actor_id: null, channel_id: channelId, modality: 'text',
      content: msg.text ?? '', confidence: 1.0, extraction_method: 'gowa-webhook@v8.4.0',
      metadata: { gowa_message_id: msg.id, gowa_device_id: device.gowa_device_id, push_name: msg.push_name ?? null, from_me: !!msg.from_me, chat_id: msg.chat_id, quoted_message_id: msg.quoted_message_id ?? null },
    }).select('id').single();
    if (l1Err && l1Err.code !== '23505') return { ok: false, error: `l1 insert failed: ${l1Err.message}` };
    return { ok: true, l0_id: l0Id, l1_id: l1Row?.id as string | undefined };
  }

  const chatSlug = chatIdToSlug(msg.chat_id);
  let stored: StoredMedia | null = null;
  try { stored = await downloadAndStoreMedia(db, device, msg, chatSlug); } catch (err) { await bc(db, l0Id, 'media-download-fail', { msg: (err as Error).message }); return { ok: true, l0_id: l0Id, mediaJob: 'media-fetch-failed' }; }
  if (!stored) { await bc(db, l0Id, 'media-no-url'); return { ok: true, l0_id: l0Id, mediaJob: 'no-media-url' }; }
  await bc(db, l0Id, 'media-stored', { modality: stored.modality, bytes: stored.bytes, mime: stored.mimeType });

  await db.from('l0_artifacts').update({
    source_uri: stored.sourceUri, sha256: stored.sha256, bytes: stored.bytes,
    metadata: { gowa_message_id: msg.id, gowa_device_id: device.gowa_device_id, chat_id: msg.chat_id, chat_slug: chatSlug, from_id: msg.from_id ?? msg.from ?? msg.from_lid ?? null, from_me: !!msg.from_me, push_name: msg.push_name ?? msg.from_name ?? null, message_type: msg.message_type ?? msg.type ?? null, is_group: !!msg.is_group, group_id: msg.group_id ?? null, group_subject: msg.group_subject ?? null, media: msg.media ?? null, quoted_message_id: msg.quoted_message_id ?? null, mentions: msg.mentions ?? [], kind: stored.modality === 'voice' ? 'audio' : stored.modality, mime_type: stored.mimeType, filename: stored.filename },
  }).eq('id', l0Id);

  const { data: l1Row, error: l1Err } = await db.from('l1_events').insert({
    tenant_id: device.tenant_id, artifact_id: l0Id, extraction_run_id: null, facet: 'messages', event_at: msg.timestamp, position: 0, actor_id: null, channel_id: channelId, modality: stored.modality,
    content: msg.media?.caption ?? null, confidence: 1.0, extraction_method: 'gowa-webhook@v8.4.0',
    metadata: { gowa_message_id: msg.id, gowa_device_id: device.gowa_device_id, push_name: msg.push_name ?? msg.from_name ?? null, from_me: !!msg.from_me, chat_id: msg.chat_id, filename: stored.filename, mime_type: stored.mimeType, caption: msg.media?.caption ?? null, duration_s: msg.media?.duration_seconds ?? null, quoted_message_id: msg.quoted_message_id ?? null },
  }).select('id').single();
  if (l1Err && l1Err.code !== '23505') return { ok: false, error: `l1 insert (media) failed: ${l1Err.message}` };

  await bc(db, l0Id, 'l1-messages-inserted');

  if (stored.modality === 'image') {
    await bc(db, l0Id, 'vision-branch-entered', { key_present: OPENROUTER_API_KEY.length > 0 });
    if (OPENROUTER_API_KEY) {
      try { await processImageVision(db, { l0Id, tenantId: device.tenant_id, channelId, eventAt: msg.timestamp, bytes: stored.buf, mimeType: stored.mimeType, filename: stored.filename }); } catch (err) { await bc(db, l0Id, 'vision-throw', { msg: (err as Error).message }); }
    } else { await bc(db, l0Id, 'vision-skipped-no-key'); }
  } else { await bc(db, l0Id, 'not-image-skipped'); }

  return { ok: true, l0_id: l0Id, l1_id: l1Row?.id as string | undefined, mediaJob: 'stored' };
}

async function handleMessageAck(db: SupabaseClient, device: ResolvedDevice, ack: { id: string; ack: string; timestamp: string }): Promise<{ ok: true }> { await db.from('l1_events').update({ metadata: { last_ack: ack.ack, last_ack_at: ack.timestamp } }).eq('tenant_id', device.tenant_id).eq('metadata->>gowa_message_id', ack.id); return { ok: true }; }
async function handleMessageReactionRevokeEdit(db: SupabaseClient, device: ResolvedDevice, event: 'message.reaction' | 'message.revoke' | 'message.edited', data: Record<string, unknown>): Promise<{ ok: true }> { const facet = event === 'message.reaction' ? 'reaction' : event === 'message.revoke' ? 'revoke' : 'edit'; await db.from('l1_events').insert({ tenant_id: device.tenant_id, artifact_id: null, extraction_run_id: null, facet, event_at: (data.timestamp as string) ?? new Date().toISOString(), position: 0, actor_id: null, channel_id: device.channel_id, modality: 'text', content: facet === 'reaction' ? String(data.emoji ?? '') : null, confidence: 1.0, extraction_method: 'gowa-webhook@v8.4.0', metadata: { gowa_event_type: event, gowa_target_message_id: data.target_message_id ?? data.id, gowa_device_id: device.gowa_device_id, raw: data } }); return { ok: true }; }
async function handleDeviceConnectionUpdate(db: SupabaseClient, device: ResolvedDevice, data: DeviceConnectionData): Promise<{ ok: true }> { const update: Record<string, unknown> = { last_seen_at: data.last_seen_at ?? new Date().toISOString() }; if (data.state) { const mapped = data.state === 'connected' ? 'linked' : data.state; update.status = mapped; if (mapped === 'banned') update.banned_at = new Date().toISOString(); if (data.reason) update.last_error = data.reason.slice(0, 500); } if (data.phone_number) update.phone_number = data.phone_number; await db.from('whatsapp_devices').update(update).eq('id', device.id); return { ok: true }; }
async function handlePairQrConsumed(db: SupabaseClient, device: ResolvedDevice, data: { phone_number?: string }): Promise<{ ok: true }> { await db.from('whatsapp_devices').update({ status: 'linked', paired_at: new Date().toISOString(), phone_number: data.phone_number ?? device.phone_number, re_pair_url: null, last_error: null }).eq('id', device.id); return { ok: true }; }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await req.text();
  const sig = req.headers.get('X-Hub-Signature-256');
  if (!(await verifyHmac(WEBHOOK_SECRET, body, sig))) return new Response('Unauthorized', { status: 401 });
  let envelope: WebhookEnvelope;
  try { envelope = JSON.parse(body) as WebhookEnvelope; } catch { return new Response('Invalid JSON', { status: 400 }); }
  if (!envelope.event || !envelope.device_id) return jsonResp({ skipped: true, reason: 'missing event or device_id' });
  const db = createClient(SUPABASE_URL, SUPABASE_KEY);
  const device = await resolveDevice(db, envelope.device_id);
  if (!device) return jsonResp({ skipped: true, reason: 'unknown device', device_id: envelope.device_id });
  const eventData = (envelope.payload ?? envelope.data ?? {}) as Record<string, unknown>;
  const webhookReceivedAt = new Date().toISOString();
  try {
    switch (envelope.event) {
      case 'message': {
        const raw = eventData as Record<string, unknown> & MessageData;
        const mediaKinds: { key: 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'video_note'; type: string }[] = [{ key: 'image', type: 'image' }, { key: 'audio', type: 'audio' }, { key: 'video', type: 'video' }, { key: 'document', type: 'document' }, { key: 'sticker', type: 'sticker' }, { key: 'video_note', type: 'video' }];
        let inferredType: string | null = null;
        let inferredMedia: GowaMediaPayload | null = raw.media ?? null;
        let inferredKindKey: string | null = null;
        for (const k of mediaKinds) {
          const v = (raw as unknown as Record<string, unknown>)[k.key];
          if (v == null) continue;
          if (typeof v === 'string') { inferredType = k.type; inferredKindKey = k.key; inferredMedia = { url: v }; break; }
          if (typeof v === 'object') {
            const o = v as Record<string, unknown>;
            const url = (o.url ?? o.path) as string | undefined;
            if (url || o.caption || o.filename || o.mime_type) {
              inferredType = k.type; inferredKindKey = k.key;
              inferredMedia = { url, caption: typeof o.caption === 'string' ? o.caption : undefined, filename: typeof o.filename === 'string' ? o.filename : undefined, mime_type: typeof o.mime_type === 'string' ? o.mime_type : undefined, duration_seconds: typeof o.duration_seconds === 'number' ? o.duration_seconds : undefined };
              break;
            }
          }
        }
        if (inferredMedia && !inferredMedia.mime_type && inferredKindKey) {
          const defaults: Record<string, string> = { image: 'image/jpeg', audio: 'audio/ogg', video: 'video/mp4', document: 'application/octet-stream', sticker: 'image/webp', video_note: 'video/mp4' };
          inferredMedia.mime_type = defaults[inferredKindKey];
        }
        const msg: MessageData = { ...raw, from_id: raw.from_id ?? raw.from ?? raw.from_lid ?? '', push_name: raw.push_name ?? raw.from_name, from_me: raw.from_me ?? raw.is_from_me ?? false, message_type: raw.message_type ?? raw.type ?? inferredType ?? (raw.body ? 'text' : 'unknown'), text: raw.text ?? raw.body, media: inferredMedia ?? undefined };
        const result = await handleMessage(db, device, msg, webhookReceivedAt, eventData);
        return jsonResp({ ok: result.ok, ...result });
      }
      case 'message.ack': return jsonResp(await handleMessageAck(db, device, eventData as unknown as { id: string; ack: string; timestamp: string }));
      case 'message.reaction': case 'message.revoke': case 'message.edited': return jsonResp(await handleMessageReactionRevokeEdit(db, device, envelope.event, eventData));
      case 'device.connection.update': case 'device.disconnected': case 'device.banned': return jsonResp(await handleDeviceConnectionUpdate(db, device, eventData as unknown as DeviceConnectionData));
      case 'pair.qr.consumed': return jsonResp(await handlePairQrConsumed(db, device, eventData as { phone_number?: string }));
      default: await db.from('whatsapp_devices').update({ metadata: { last_unhandled_event: { event: envelope.event, at: webhookReceivedAt, data: eventData } } }).eq('id', device.id); return jsonResp({ skipped: true, reason: 'unhandled event', event: envelope.event });
    }
  } catch (err) { const msg = err instanceof Error ? err.message : String(err); console.error(`[wa-webhook] handler error event=${envelope.event}: ${msg}`); return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 300) }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
});

function jsonResp(body: Record<string, unknown>, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
