/**
 * linkClaim — find related claims for a newly-embedded claim, write l1_relations.
 *
 * Triggered by embed-claim after the embedding lands. Runs cosine similarity
 * + temporal window join against existing claim_facet embeddings, writes
 * top-N matches into l1_relations.
 *
 * Direction matters:
 *   - If THIS claim is from a 'commit' (kind ∈ feature/fix/refactor/scope_shift/infra)
 *     → look BACKWARD for matching event claims (directive/decision/pain/scope_shift)
 *       within ±14d. Write l1_relations(from=event, to=commit, relation_type='implements').
 *   - If THIS claim is from an 'event' (kind ∈ directive/decision/pain/...)
 *     → look FORWARD for matching commit claims within ±14d.
 *       Write l1_relations(from=this, to=commit, relation_type='implements').
 *
 * Uses 'discusses' (lower bar) for any other cross-claim semantic match
 * within ±2d that doesn't fit 'implements'.
 *
 * Idempotent: l1_relations has UNIQUE(from_event_id, to_event_id, relation_type)
 * (assumed — check schema; if not, add it; this task relies on it).
 *
 * Cost: 1 cosine query per insert. Negligible. Postgres pgvector handles it.
 */

import { schemaTask, logger } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const Payload = z.object({
  event_id:  z.string().uuid(),
  event_at:  z.string(),
  tenant_id: z.string().uuid(),
});

const SIMILARITY_THRESHOLD = 0.65;
const TEMPORAL_WINDOW_DAYS = 14;
const MAX_LINKS_PER_CLAIM  = 10;

export const linkClaim = schemaTask({
  id: 'link-claim',
  schema: Payload,
  maxDuration: 30,
  retry: { maxAttempts: 2 },
  run: async ({ event_id, event_at, tenant_id }) => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Fetch this claim's metadata to know its source_kind + claim_kind
    const { data: claim } = await sb
      .from('l1_events')
      .select('id, metadata')
      .eq('id', event_id)
      .maybeSingle();
    if (!claim) throw new Error(`claim ${event_id} not found`);

    const meta = claim.metadata as { source_kind?: string; claim_kind?: string };
    const isCommit = meta.source_kind === 'commit';

    // 2. Run the similarity + temporal join in one SQL roundtrip.
    //    We use a stored function for the cosine search OR raw SQL. Sketch
    //    shows raw SQL via .rpc — implement as a Postgres function for speed.
    const { data: matches, error } = await sb.rpc('find_related_claims', {
      p_event_id:  event_id,
      p_event_at:  event_at,
      p_tenant_id: tenant_id,
      p_target_source_kind: isCommit ? 'event' : 'commit',
      p_threshold: SIMILARITY_THRESHOLD,
      p_window_days: TEMPORAL_WINDOW_DAYS,
      p_limit: MAX_LINKS_PER_CLAIM,
    });
    if (error) throw new Error(`find_related: ${error.message}`);

    if (!matches || matches.length === 0) {
      return { linked: 0 };
    }

    // 3. For each match, decide relation_type.
    //    'implements' = directive/scope_shift on event side ↔ feature/fix/scope_shift on commit side
    //    'discusses'  = anything else within window
    const rows = matches.map((m: any) => ({
      tenant_id,
      from_event_id: isCommit ? m.matched_event_id : event_id,
      to_event_id:   isCommit ? event_id           : m.matched_event_id,
      relation_type: pickRelationType(meta.claim_kind, m.matched_claim_kind),
      confidence:    m.similarity,
      method:        'embedding' as const,
      metadata: {
        similarity: m.similarity,
        lag_days:   m.lag_days,
        window_days: TEMPORAL_WINDOW_DAYS,
        extractor: 'openrouter:google/gemini-3.1-flash-lite@2026-05-11-claim',
      },
    }));

    // 4. Upsert relations (UNIQUE constraint silently dedupes)
    const { error: insErr } = await sb
      .from('l1_relations')
      .upsert(rows, { onConflict: 'from_event_id,to_event_id,relation_type', ignoreDuplicates: true });
    if (insErr) throw new Error(`insert relations: ${insErr.message}`);

    logger.info('linked', { event_id, linked: rows.length });
    return { linked: rows.length };
  },
});

const IMPL_PAIRS = new Set([
  'directive→feature', 'directive→fix', 'directive→scope_shift',
  'pain→fix', 'pain→feature',
  'scope_shift→scope_shift', 'scope_shift→feature', 'scope_shift→fix',
  'decision→feature', 'decision→infra',
]);

function pickRelationType(myKind?: string, theirKind?: string): 'implements' | 'discusses' {
  if (!myKind || !theirKind) return 'discusses';
  return IMPL_PAIRS.has(`${myKind}→${theirKind}`) || IMPL_PAIRS.has(`${theirKind}→${myKind}`)
    ? 'implements'
    : 'discusses';
}
