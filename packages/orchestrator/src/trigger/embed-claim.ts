/**
 * embedClaim — embed a single claim_facet event into l1_embeddings.
 *
 * Triggered by claim-extract via batchTrigger after claim insert. Fans
 * out further to link-claim once the embedding lands.
 *
 * Why per-event vs per-batch: claim-extract may produce 0..n claims per
 * source. Per-event keeps retry semantics clean (one bad embedding doesn't
 * block the others). At ~$0.00002 per embedding, batching savings are
 * negligible vs the operational simplicity of per-event retry.
 *
 * Idempotent: PRIMARY KEY (event_id, extraction_run_id) on l1_embeddings.
 *
 * Cost: $0.00002 per claim (text-embedding-3-small @ $0.02/1M tokens, ~50 tok/claim).
 */

import { schemaTask, tasks, logger, tags } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const Payload = z.object({
  event_id: z.string().uuid(),
  event_at: z.string(),                // ISO — composite key with event_id
  run_id:   z.string().uuid(),
  tenant_id: z.string().uuid(),
});

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const OPENROUTER_EMBED_URL = 'https://openrouter.ai/api/v1/embeddings';

export const embedClaim = schemaTask({
  id: 'embed-claim',
  schema: Payload,
  maxDuration: 30,
  retry: { maxAttempts: 3, factor: 2 },
  run: async ({ event_id, event_at, run_id, tenant_id }) => {
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const apiKey = process.env.OPENROUTER_API_KEY!;

    // 1. Fetch the claim text
    const { data: ev, error } = await sb
      .from('l1_events')
      .select('content')
      .eq('id', event_id)
      .maybeSingle();
    if (error || !ev?.content) {
      throw new Error(`claim ${event_id} not found: ${error?.message}`);
    }

    // 2. Idempotency — already embedded?
    const { count: existing } = await sb
      .from('l1_embeddings')
      .select('event_id', { count: 'exact', head: true })
      .eq('event_id', event_id)
      .eq('extraction_run_id', run_id);
    if (existing && existing > 0) {
      logger.info('skip — already embedded', { event_id });
      return { skipped: true };
    }

    // 3. Call OpenRouter embeddings
    const res = await fetch(OPENROUTER_EMBED_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://vita.viter.ai',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: [ev.content] }),
    });
    if (!res.ok) {
      throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    const vector = data.data[0]?.embedding;
    if (!vector) throw new Error('no embedding returned');

    // 4. Insert
    const { error: insErr } = await sb.from('l1_embeddings').insert({
      event_id, event_at, extraction_run_id: run_id, tenant_id,
      embedding: vector as unknown as string,
      metadata: { model: EMBEDDING_MODEL, dim: 1536 },
    });
    if (insErr) throw new Error(`insert embedding: ${insErr.message}`);

    // 5. Fan-out to linker
    await tasks.trigger('link-claim', { event_id, event_at, tenant_id }, {
      tags: tags(['claim_facet']),
    });

    return { embedded: true };
  },
});
