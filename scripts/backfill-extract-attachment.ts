/**
 * scripts/backfill-extract-attachment.ts
 *
 * One-shot backfill for the wa-message-fan-out lookback gap.
 *
 * Context (2026-05-06):
 *   wa-message-fan-out had a path bug — it passed the GOWA URL as
 *   `remote_path` instead of the bucket-relative path stripped from
 *   `l0_artifacts.source_uri`. Fixed in v20260506.2 deploy. ~170 live
 *   WhatsApp artifacts (audio + image + doc) accumulated in `l0-whatsapp/`
 *   bucket but never produced a successful l1_extraction_run because
 *   extract-attachment kept failing with "download failed: Object not found"
 *   while the bug was live.
 *
 *   The fix is deployed but those artifacts are now beyond fan-out's
 *   1-hour lookback window. This script dispatches `extract-attachment`
 *   for each stuck artifact with the corrected payload (bucket-relative
 *   remote_path) so the deployed task can transcribe / caption / parse
 *   them and emit l1_extraction_runs.
 *
 * Usage:
 *   cd ~/viter-workspace/vita/packages/orchestrator
 *   pnpm tsx ../../scripts/backfill-extract-attachment.ts                 # all stuck
 *   pnpm tsx ../../scripts/backfill-extract-attachment.ts --limit 10      # smoke test
 *   pnpm tsx ../../scripts/backfill-extract-attachment.ts --dry-run       # report only
 *
 * Env:
 *   SUPABASE_URL                — vita Supabase URL (dkccadwohifcqcdzhhnu)
 *   SUPABASE_SERVICE_ROLE_KEY   — service role key (RLS bypass for query)
 *   TRIGGER_SECRET_KEY          — Trigger.dev prod env API key
 *
 * Idempotency:
 *   - Skips artifacts that already have status='ok' l1_extraction_runs
 *   - Trigger.dev's task signature is keyed on (tenant, artifact, facet,
 *     extractor, version, parameters) — re-running this script after a
 *     successful pass is a no-op (skipped at the task level too).
 */

import { createClient } from '@supabase/supabase-js';
import { tasks } from '@trigger.dev/sdk';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const BUCKET_PREFIX = 'l0-whatsapp/';

interface StuckArtifact {
  id: string;
  tenant_id: string;
  source_uri: string;
  metadata: Record<string, unknown>;
  origin_at: string;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  if (!process.env.TRIGGER_SECRET_KEY) {
    throw new Error('TRIGGER_SECRET_KEY required (Trigger.dev prod env API key)');
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitFlag = args.find((a) => a.startsWith('--limit='));
  const limit = limitFlag ? Number(limitFlag.split('=')[1]) : 0;

  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Find stuck artifacts (live, l0-whatsapp/ source_uri, no ok extraction run)
  let q = db
    .from('l0_artifacts')
    .select('id, tenant_id, source_uri, metadata, origin_at')
    .eq('source_type', 'whatsapp_message_live')
    .like('source_uri', 'l0-whatsapp/%')
    .order('origin_at', { ascending: true });
  if (limit > 0) q = q.limit(limit);

  const { data: candidates, error } = await q;
  if (error) throw error;
  if (!candidates || candidates.length === 0) {
    console.log('[backfill] no candidates found');
    return;
  }

  // 2. Filter out ones that already have status='ok' l1_extraction_runs
  const candidateIds = candidates.map((c) => c.id);
  const { data: doneRuns } = await db
    .from('l1_extraction_runs')
    .select('artifact_id')
    .in('artifact_id', candidateIds)
    .eq('status', 'ok');
  const done = new Set((doneRuns ?? []).map((r) => r.artifact_id as string));

  const stuck = (candidates as StuckArtifact[]).filter((a) => !done.has(a.id));
  console.log(`[backfill] candidates:${candidates.length} already-ok:${done.size} stuck:${stuck.length}`);

  if (stuck.length === 0) {
    console.log('[backfill] nothing to dispatch');
    return;
  }

  // 3. Build payloads with corrected bucket-relative remote_path
  const payloads = stuck.map((art) => {
    const meta = art.metadata as { media?: { mime_type?: string; filename?: string } };
    const media = meta.media ?? {};
    const remotePath = art.source_uri.startsWith(BUCKET_PREFIX)
      ? art.source_uri.slice(BUCKET_PREFIX.length)
      : art.source_uri; // unexpected — log + try anyway
    return {
      payload: {
        tenant_id: art.tenant_id,
        artifact_id: art.id,
        filename: media.filename ?? `wa-${art.id}.bin`,
        mime: media.mime_type ?? 'application/octet-stream',
        remote_path: remotePath,
        channel_id: null,
        origin_at: art.origin_at,
        actor_id: null,
      },
      options: {
        tags: ['backfill:2026-05-06', `artifact:${art.id}`],
        idempotencyKey: `backfill-2026-05-06-${art.id}`,
        idempotencyKeyTTL: '7d',
      },
    };
  });

  if (dryRun) {
    console.log('[backfill] DRY RUN — not dispatching. Sample payload:');
    console.log(JSON.stringify(payloads[0], null, 2));
    console.log(`[backfill] would dispatch ${payloads.length} extract-attachment runs`);
    return;
  }

  // 4. Batch trigger (max 1000 per batch per Trigger.dev v4 limits)
  const BATCH_SIZE = 500;
  let dispatched = 0;
  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const slice = payloads.slice(i, i + BATCH_SIZE);
    const handle = await tasks.batchTrigger('extract-attachment', slice);
    dispatched += slice.length;
    console.log(`[backfill] dispatched batch ${i / BATCH_SIZE + 1}: ${slice.length} runs (batch_id=${handle.batchId ?? 'n/a'}). total=${dispatched}/${payloads.length}`);
  }

  console.log(`[backfill] DONE — dispatched ${dispatched} extract-attachment runs to Trigger.dev prod.`);
  console.log('[backfill] Watch progress: https://cloud.trigger.dev/projects/v3/proj_hvcfyxehhvtsodxlicvb/runs?env=prod');
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
