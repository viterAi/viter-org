/**
 * scripts/backfill-live-images.ts
 *
 * One-shot: run image vision on every l0_artifact in `l0-whatsapp/live/...`
 * that doesn't yet have a corresponding l1_event(facet='image_caption').
 *
 * Mirrors what the webhook v11 SHOULD do via EdgeRuntime.waitUntil. Use this
 * as a safety net when the in-Edge fanout fails (or until we move that work
 * to Trigger.dev).
 *
 * Usage:
 *   tsx scripts/backfill-live-images.ts                 # all
 *   tsx scripts/backfill-live-images.ts --limit 5
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENROUTER_API_KEY
 */

import { createServiceRoleClient } from '../packages/runtime/src/db.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const MODEL = 'google/gemini-3.1-flash-lite-preview';

const PROMPT =
  'Examine this image. Output JSON with exactly these fields:\n' +
  '  "ocr_text": all text visible in the image, verbatim, in reading order. Empty string if none.\n' +
  '  "description": one paragraph describing the visual content (what it shows, layout, key elements).\n' +
  '  "language": ISO 639-1 code of the dominant text language ("en", "he", etc), or null if no text.\n' +
  '  "regions": array of detected meaningful regions, each {"kind":"chart|table|text_block|face|other", "text":"..."}.\n' +
  'Output JSON only — no preface, no commentary, no fenced code blocks.';

async function main() {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY required');
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0') || 0;
  const db = createServiceRoleClient();

  // 1. Find live l0_artifacts with kind=image
  let q = db
    .from('l0_artifacts')
    .select('id, source_uri, metadata, origin_at, tenant_id')
    .eq('source_type', 'whatsapp_message_live')
    .eq('metadata->>kind', 'image')
    .like('source_uri', 'l0-whatsapp/live/%')
    .order('origin_at', { ascending: true });
  if (limit > 0) q = q.limit(limit);
  const { data: candidates, error } = await q;
  if (error) throw error;
  if (!candidates || candidates.length === 0) {
    console.log('no live images found');
    return;
  }
  console.log(`[backfill] ${candidates.length} live image artifacts`);

  // 2. Find which ones already have image_caption
  const ids = candidates.map((c) => c.id as string);
  const done = new Set<string>();
  const { data: existing } = await db
    .from('l1_events')
    .select('artifact_id')
    .eq('facet', 'image_caption')
    .in('artifact_id', ids);
  for (const r of existing ?? []) done.add(r.artifact_id as string);
  const pending = candidates.filter((c) => !done.has(c.id as string));
  console.log(`[backfill] ${done.size} already done · ${pending.length} pending`);

  // 3. Get channel_id for each via the messages l1_event
  const channelByArtifact = new Map<string, string>();
  if (pending.length > 0) {
    const { data: msgs } = await db
      .from('l1_events')
      .select('artifact_id, channel_id')
      .eq('facet', 'messages')
      .in('artifact_id', pending.map((c) => c.id as string));
    for (const r of msgs ?? []) {
      if (r.channel_id) channelByArtifact.set(r.artifact_id as string, r.channel_id as string);
    }
  }

  // 4. Process each
  let ok = 0;
  let err = 0;
  for (const c of pending) {
    const id = c.id as string;
    const tenant = c.tenant_id as string;
    const channel = channelByArtifact.get(id);
    if (!channel) {
      console.warn(`  ✗ ${id} no channel — skipping`);
      err++;
      continue;
    }
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const filename = (meta.filename as string) ?? `${id}.jpg`;
    const mimeType = (meta.mime_type as string) ?? 'image/jpeg';
    const sourceUri = c.source_uri as string;
    // Parse `<bucket>/<path>`
    const slash = sourceUri.indexOf('/');
    const bucket = sourceUri.slice(0, slash);
    const path = sourceUri.slice(slash + 1);

    try {
      const t0 = Date.now();
      // Download bytes
      const { data: blob, error: dlErr } = await db.storage.from(bucket).download(path);
      if (dlErr || !blob) throw new Error(`download: ${dlErr?.message ?? 'no blob'}`);
      const buf = new Uint8Array(await blob.arrayBuffer());
      const dataUrl = `data:${mimeType};base64,${Buffer.from(buf).toString('base64')}`;

      // OpenRouter call
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://vita-roan.vercel.app',
          'X-Title': 'vita backfill-live-images',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
          response_format: { type: 'json_object' },
          reasoning: { effort: 'minimal' },
        }),
      });
      if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { id?: string; choices?: Array<{ message?: { content?: string } }> };
      const raw = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!raw) throw new Error('empty extraction');
      let parsed: { ocr_text?: string; description?: string; language?: string | null; regions?: Array<{ kind?: string; text?: string }> };
      try { parsed = JSON.parse(raw); } catch { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')); }
      const ocr = (parsed.ocr_text ?? '').trim();
      const desc = (parsed.description ?? '').trim();
      const text = ocr ? `${ocr}\n\n[visual] ${desc}` : `[visual] ${desc}`;
      const segments = (parsed.regions ?? []).filter((r) => (r.text ?? '').trim().length > 0).map((r, i) => ({ start: i, end: i + 1, page: null, text: `[${r.kind ?? 'region'}] ${r.text}` }));

      const { error: insErr } = await db.from('l1_events').insert({
        tenant_id: tenant,
        artifact_id: id,
        extraction_run_id: null,
        facet: 'image_caption',
        event_at: c.origin_at,
        position: 0,
        actor_id: null,
        channel_id: channel,
        modality: 'image',
        content: text,
        confidence: 0.9,
        extraction_method: `${MODEL}@backfill-live`,
        metadata: {
          kind: 'image_caption',
          chars: text.length,
          filename,
          language: parsed.language ?? null,
          segments,
          n_segments: segments.length,
          mime_type: mimeType,
          model_used: MODEL,
          provider: 'openrouter',
          generation_id: data.id ?? null,
          wall_ms: Date.now() - t0,
          backfill: true,
        },
      });
      if (insErr) throw insErr;
      ok++;
      console.log(`  ✓ ${id} chars=${text.length} ms=${Date.now() - t0}`);
    } catch (e) {
      err++;
      console.error(`  ✗ ${id}: ${(e as Error).message}`);
    }
  }
  console.log(`[backfill] done · ok=${ok} err=${err}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
