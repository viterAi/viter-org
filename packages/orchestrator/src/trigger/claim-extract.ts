/**
 * claimExtract — extract typed claim_facet events from a source l1_event.
 *
 * Triggered by upstream tasks IMMEDIATELY after they insert source events:
 *   - wa-message-fan-out (after inserting facet='messages')
 *   - extract-attachment (after inserting facet='transcription')
 *   - ingest-meeting    (after inserting transcription/diarization)
 *   - ingest-commits    (after inserting facet='commit_message')
 *   - parse-chat        (after inserting facet='turn_text')
 *
 * Each upstream task's tail becomes:
 *   await tasks.trigger('claim-extract', { event_id, facet }, { tags: [...] })
 *
 * This task: calls gemini-3.1-flash-lite, inserts 0..n claim_facet events,
 * then chains to embedClaim for each one.
 *
 * Idempotent: dedup query checks for existing claim_facet events with
 * metadata.source_event_id=<id> before extraction.
 *
 * Cost: ~$0.0002 per event. ~$0.50/active-user/day at current message volume.
 */

import { schemaTask, tasks, logger, tags, metadata } from '@trigger.dev/sdk';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';

const Payload = z.object({
  event_id: z.string().uuid(),
  source_facet: z.enum(['commit_message', 'messages', 'transcription', 'turn_text']),
  // Optional override — if upstream already knows the tenant, save a query.
  tenant_id: z.string().uuid().optional(),
});

const EXTRACTOR_ID = 'openrouter:google/gemini-3.1-flash-lite@2026-05-11-claim';
const MODEL        = 'google/gemini-3.1-flash-lite-preview';

// (System prompts identical to scripts/backfill-claim-facets.ts — keep in sync,
// or extract to @viter-org/runtime/extractors/claim-prompts.ts if preferred.)
const SYS_EVENT  = '...';  // see backfill script
const SYS_COMMIT = '...';

export const claimExtract = schemaTask({
  id: 'claim-extract',
  schema: Payload,
  maxDuration: 60,
  retry: { maxAttempts: 3, factor: 2 },
  run: async ({ event_id, source_facet, tenant_id: tenantHint }, { ctx }) => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const apiKey = process.env.OPENROUTER_API_KEY!;

    // 1. Idempotency check — already extracted from this source?
    const { count: alreadyDone } = await sb
      .from('l1_events')
      .select('id', { count: 'exact', head: true })
      .eq('facet', 'claim_facet')
      .eq('metadata->>source_event_id', event_id);
    if (alreadyDone && alreadyDone > 0) {
      logger.info('skip — already extracted', { event_id, alreadyDone });
      return { skipped: true, claims: 0 };
    }

    // 2. Fetch source event
    const { data: src, error: fetchErr } = await sb
      .from('l1_events')
      .select('id, event_at, tenant_id, actor_id, channel_id, artifact_id, content, metadata')
      .eq('id', event_id)
      .maybeSingle();
    if (fetchErr || !src) {
      throw new Error(`source event ${event_id} not found: ${fetchErr?.message}`);
    }
    if (!src.content || src.content.trim().length < 40) {
      logger.info('skip — too short', { event_id, len: src.content?.length ?? 0 });
      return { skipped: true, claims: 0 };
    }

    // 3. Call gemini-flash-lite
    const isCommit = source_facet === 'commit_message';
    const sys = isCommit ? SYS_COMMIT : SYS_EVENT;
    const openrouter = createOpenRouter({ apiKey });
    const { text } = await generateText({
      model: openrouter.chat(MODEL),
      system: sys,
      prompt: src.content.slice(0, 6000),
      maxTokens: 800,
      temperature: 0,
    });

    // 4. Parse + filter (same logic as backfill script — see for spec)
    const claims = parseAndFilter(text, isCommit);
    if (claims.length === 0) {
      return { skipped: false, claims: 0 };
    }

    // 5. Create extraction run + insert claim events + fan-out to embedder
    const runId = randomUUID();
    await sb.from('l1_extraction_runs').insert({
      id: runId, tenant_id: src.tenant_id, artifact_id: src.artifact_id,
      facet: 'claim_facet', extractor: EXTRACTOR_ID, version: '2026-05-11',
      is_deterministic: false, status: 'ok',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      representation: ['text/structured'],
      metrics: { source_event_id: event_id, claims_extracted: claims.length },
    });

    const inserted: { id: string; event_at: string }[] = [];
    for (const claim of claims) {
      const claimId = randomUUID();
      await sb.from('l1_events').insert({
        id: claimId, tenant_id: src.tenant_id, artifact_id: src.artifact_id,
        extraction_run_id: runId, facet: 'claim_facet',
        event_at: src.event_at, actor_id: src.actor_id, channel_id: src.channel_id,
        modality: 'signal', content: claim.text, confidence: claim.confidence,
        extraction_method: EXTRACTOR_ID,
        metadata: {
          claim_kind: claim.kind, confidence: claim.confidence,
          source_event_id: event_id, source_facet, source_kind: isCommit ? 'commit' : 'event',
          ...(isCommit && { commit_sha: src.metadata?.commit_sha }),
        },
      });
      inserted.push({ id: claimId, event_at: src.event_at });
    }

    // 6. Fan-out to embedder (parallel — each runs independently)
    await tasks.batchTrigger('embed-claim', inserted.map((c) => ({
      payload: { event_id: c.id, event_at: c.event_at, run_id: runId, tenant_id: src.tenant_id },
      options: { tags: tags(['claim_facet', `source:${source_facet}`]) },
    })));

    return { skipped: false, claims: claims.length, claim_ids: inserted.map((i) => i.id) };
  },
});

function parseAndFilter(raw: string, isCommit: boolean): { kind: string; text: string; confidence: number }[] {
  // Same as scripts/backfill-claim-facets.ts. Returns [] on parse failure.
  // ...elided in sketch; copy from backfill script
  return [];
}
