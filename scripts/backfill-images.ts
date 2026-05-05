/**
 * scripts/backfill-images.ts
 *
 * One-shot backfill: run Phase 5 image OCR (gemini-3.1-flash-lite-preview)
 * on every whatsapp_attachment(kind='image') that has no image_caption
 * extraction_run.
 *
 * Re-uses the SAME dispatcher the Trigger.dev extractAttachment task uses,
 * so behaviour is identical to a fresh prod ingest. Going forward, prod
 * runs Phase 5 automatically — this script is only needed once for chats
 * ingested before Phase 5 was live.
 *
 * Idempotent: skips artifacts that already have a successful run.
 *
 * Usage:
 *   tsx scripts/backfill-images.ts                  # all chats
 *   tsx scripts/backfill-images.ts --chat shaul-direct
 *   tsx scripts/backfill-images.ts --limit 3        # smoke test
 *
 * Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENROUTER_API_KEY
 */

import { dispatchExtract } from '../packages/runtime/src/extractors/attachments/dispatcher.js';
import { createServiceRoleClient } from '../packages/runtime/src/db.js';

interface Args {
  chat?: string;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { limit: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chat') out.chat = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || 0;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required');

  const db = createServiceRoleClient();

  // Find image attachments missing an image_caption extraction
  let q = db
    .from('l0_artifacts')
    .select('id, metadata, source_uri, origin_at, tenant_id')
    .eq('source_type', 'whatsapp_attachment')
    .eq('metadata->>kind', 'image');
  if (args.chat) q = q.eq('metadata->>chat_slug', args.chat);
  const { data: candidates } = await q.order('origin_at', { ascending: true });
  if (!candidates) {
    console.log('no candidates');
    return;
  }

  // Filter out ones already extracted
  const ids = candidates.map((c) => c.id as string);
  const done = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: runs } = await db
      .from('l1_extraction_runs')
      .select('artifact_id')
      .eq('facet', 'image_caption')
      .eq('status', 'ok')
      .in('artifact_id', ids.slice(i, i + 200));
    for (const r of runs ?? []) done.add(r.artifact_id as string);
  }
  const pending = candidates.filter((c) => !done.has(c.id as string));
  console.log(`[backfill] ${candidates.length} image attachments · ${done.size} already done · ${pending.length} pending`);

  // Pre-load actor_id + event_at + channel_id from originating message events
  // (one query per chat since the metadata->attachment_filenames is jsonb).
  const filenameToActor = new Map<string, string | null>();
  const filenameToEventAt = new Map<string, string>();
  const chatToChannelId = new Map<string, string>();
  {
    const chatSlugs = new Set(pending.map((p) => (p.metadata as { chat_slug: string }).chat_slug));
    for (const slug of chatSlugs) {
      const { data: ch } = await db
        .from('channels')
        .select('id, tenant_id')
        .eq('kind', 'whatsapp')
        .eq('identifier', slug)
        .single();
      if (ch) chatToChannelId.set(slug, ch.id as string);
    }

    const channelIds = [...chatToChannelId.values()];
    for (const cid of channelIds) {
      const { data: events } = await db
        .from('l1_events')
        .select('actor_id, event_at, metadata')
        .eq('channel_id', cid)
        .eq('facet', 'messages');
      for (const e of events ?? []) {
        const md = e.metadata as { attachment_filenames?: string[] };
        for (const fn of md.attachment_filenames ?? []) {
          filenameToActor.set(fn, e.actor_id as string | null);
          filenameToEventAt.set(fn, e.event_at as string);
        }
      }
    }
  }

  const target = args.limit > 0 ? Math.min(pending.length, args.limit) : pending.length;
  let nDone = 0;
  let nErr = 0;

  for (let i = 0; i < target; i++) {
    const a = pending[i]!;
    const meta = a.metadata as { filename: string; chat_slug: string; tenant_slug: string; mime_type: string };
    const tenantId = a.tenant_id as string;
    const channelId = chatToChannelId.get(meta.chat_slug);
    if (!channelId) {
      nErr++;
      console.error(`  ✗ no channel for ${meta.chat_slug}`);
      continue;
    }

    const remotePath = `${meta.tenant_slug}/${meta.chat_slug}/${meta.filename}`;
    process.stdout.write(`  [${(i + 1).toString().padStart(3)}/${target}] ${meta.filename} … `);

    const t0 = Date.now();
    try {
      const { data: blob, error: dErr } = await db.storage.from('l0-whatsapp').download(remotePath);
      if (dErr || !blob) throw new Error(`download: ${dErr?.message}`);
      const buf = Buffer.from(await blob.arrayBuffer());

      const result = await dispatchExtract(
        { buf, filename: meta.filename, mime: meta.mime_type },
        { openrouterApiKey: apiKey },
      );
      const wallMs = Date.now() - t0;

      if (!result || result.kind !== 'image_caption') {
        nErr++;
        console.log(`✗ unexpected kind: ${result?.kind ?? 'null'}`);
        continue;
      }

      // Insert l1_extraction_run
      const { data: runIns, error: runErr } = await db
        .from('l1_extraction_runs')
        .insert({
          tenant_id: tenantId,
          artifact_id: a.id,
          facet: 'image_caption',
          extractor: result.extractor,
          version: result.version,
          parameters: { route: 'openrouter/chat-completions', source_mime: meta.mime_type, backfill: true },
          is_deterministic: result.is_deterministic,
          status: 'ok',
          started_at: new Date(t0).toISOString(),
          completed_at: new Date().toISOString(),
          metrics: { wall_ms: wallMs, ...result.metrics },
        })
        .select('id')
        .single();
      if (runErr || !runIns) throw new Error(`run insert: ${runErr?.message}`);
      const runId = runIns.id as string;

      const actorId = filenameToActor.get(meta.filename) ?? null;
      const eventAt = filenameToEventAt.get(meta.filename) ?? (a.origin_at as string);

      const { error: evErr } = await db.from('l1_events').insert({
        tenant_id: tenantId,
        artifact_id: a.id,
        extraction_run_id: runId,
        facet: 'image_caption',
        event_at: eventAt,
        position: 0,
        actor_id: actorId,
        channel_id: channelId,
        modality: 'image',
        content: result.text,
        confidence: null,
        extraction_method: `${result.extractor}@${result.version}`,
        metadata: {
          filename: meta.filename,
          mime_type: meta.mime_type,
          kind: result.kind,
          language: result.language,
          chars: result.text.length,
          n_segments: result.segments.length,
          segments: result.segments,
          backfill: true,
        },
      });
      if (evErr) throw new Error(`event insert: ${evErr.message}`);

      await db.from('l1_active_extraction').upsert({
        tenant_id: tenantId,
        artifact_id: a.id,
        facet: 'image_caption',
        active_run_id: runId,
        promoted_by: 'auto',
        reason: 'backfill',
      });

      nDone++;
      const preview = result.text.replace(/\s+/g, ' ').slice(0, 60);
      console.log(`✓ ${(wallMs / 1000).toFixed(1)}s  ${result.text.length}c  "${preview}"`);
    } catch (err) {
      nErr++;
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('');
  console.log(`[backfill] DONE`);
  console.log(`  candidates:        ${candidates.length}`);
  console.log(`  already done:      ${done.size}`);
  console.log(`  newly extracted:   ${nDone}`);
  console.log(`  errors:            ${nErr}`);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
