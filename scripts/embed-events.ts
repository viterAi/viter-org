/**
 * scripts/embed-events.ts
 *
 * Populate l1_embeddings for unembedded l1_events using OpenRouter
 * text-embedding-3-small (1536 dims).
 *
 * Facet priority: structured_requirement → commit_message → messages → transcription
 * Transcription is filtered to Jeffrey's utterances only.
 *
 * Usage:
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/embed-events.ts
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENROUTER_API_KEY
 */

import { createServiceRoleClient } from '../packages/runtime/src/db.js';

// ─── Config ────────────────────────────────────────────────────────────────

const TENANT_ID = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';
const JEFFREY_ACTOR_ID = 'da66f06e-7e64-48af-9564-daab1ad3e9b5';
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
const BATCH_SIZE = 96;
const BATCH_DELAY_MS = 200;
const MAX_CHARS = 2000;
const FETCH_LIMIT = 5000;

const FACETS = ['structured_requirement', 'commit_message', 'messages', 'transcription'] as const;
type Facet = typeof FACETS[number];

// ─── Types ──────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  event_at: string;
  extraction_run_id: string;
  tenant_id: string;
  content: string;
  facet: Facet;
  metadata: Record<string, unknown>;
}

// ─── OpenRouter embeddings ───────────────────────────────────────────────────

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const payload = JSON.stringify({ model: EMBEDDING_MODEL, input: texts });
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vita.viter.ai',
    },
    body: payload,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function elapsed(startMs: number): string {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

function truncate(text: string): string {
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

  const db = createServiceRoleClient();
  const startMs = Date.now();

  // ── 1. Fetch unembedded events ──────────────────────────────────────────────
  console.log('Fetching unembedded events…');

  // Two-query approach: fetch candidates then subtract already-embedded.
  // The composite PK on l1_embeddings is (event_id, extraction_run_id).

  // Step A: fetch candidate events — paginate in chunks of 1000 (Supabase default cap)
  type RawEvent = EventRow & { actor_id: string | null };
  const rawEvents: RawEvent[] = [];
  const PAGE_SIZE = 1000;
  let page = 0;
  while (true) {
    const { data: chunk, error: eventsErr } = await db
      .from('l1_events')
      .select('id, event_at, extraction_run_id, tenant_id, content, facet, metadata, actor_id')
      .eq('tenant_id', TENANT_ID)
      .in('facet', [...FACETS])
      .order('facet')
      .order('event_at', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .returns<RawEvent[]>();

    if (eventsErr) throw new Error(`Fetch events page ${page} failed: ${eventsErr.message}`);
    if (!chunk || chunk.length === 0) break;
    rawEvents.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    page++;
  }
  console.log(`  Scanned ${rawEvents.length} raw events across ${page + 1} page(s)`);

  // Step B: fetch already-embedded event_ids for this tenant
  const { data: embeddedRows, error: embErr } = await db
    .from('l1_embeddings')
    .select('event_id, extraction_run_id')
    .eq('tenant_id', TENANT_ID)
    .returns<{ event_id: string; extraction_run_id: string }[]>();

  if (embErr) throw new Error(`Fetch embeddings failed: ${embErr.message}`);

  const embeddedKeys = new Set(
    (embeddedRows ?? []).map((r) => `${r.event_id}::${r.extraction_run_id}`)
  );

  // Step C: filter
  const facetOrder: Record<Facet, number> = {
    structured_requirement: 1,
    commit_message: 2,
    messages: 3,
    transcription: 4,
  };

  const candidates = (rawEvents ?? [])
    .filter((e) => {
      if (!e.content || e.content.length <= 20) return false;
      if (!e.extraction_run_id) return false; // l1_embeddings.extraction_run_id NOT NULL
      if (embeddedKeys.has(`${e.id}::${e.extraction_run_id}`)) return false;
      if (e.facet === 'transcription' && e.actor_id !== JEFFREY_ACTOR_ID) return false;
      return true;
    })
    .sort((a, b) => {
      const fo = (facetOrder[a.facet] ?? 99) - (facetOrder[b.facet] ?? 99);
      if (fo !== 0) return fo;
      return new Date(a.event_at).getTime() - new Date(b.event_at).getTime();
    })
    .slice(0, FETCH_LIMIT);

  console.log(`Found ${candidates.length} events to embed (${rawEvents.length} scanned, ${embeddedKeys.size} already done)`);

  if (candidates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // ── 2. Batch embed & insert ─────────────────────────────────────────────────
  const errors: string[] = [];
  const countByFacet: Record<string, number> = {};

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const texts = batch.map((e) => truncate(e.content));

    let embeddings: number[][];
    try {
      embeddings = await embedBatch(texts, apiKey);
    } catch (err) {
      const msg = `Batch ${i}–${i + batch.length - 1} embed error: ${err}`;
      console.error(msg);
      errors.push(msg);
      await sleep(BATCH_DELAY_MS);
      continue;
    }

    const rows = batch.map((event, idx) => ({
      event_id: event.id,
      event_at: event.event_at,
      extraction_run_id: event.extraction_run_id,
      tenant_id: event.tenant_id,
      embedding: embeddings[idx] as unknown as string, // Supabase JS accepts number[] for vector
      metadata: {
        model: EMBEDDING_MODEL,
        facet: event.facet,
        chars: texts[idx].length,
      },
    }));

    const { error: upsertErr } = await db
      .from('l1_embeddings')
      .upsert(rows, { onConflict: 'event_id,extraction_run_id' });

    if (upsertErr) {
      const msg = `Batch ${i}–${i + batch.length - 1} upsert error: ${upsertErr.message}`;
      console.error(msg);
      errors.push(msg);
    } else {
      for (const event of batch) {
        countByFacet[event.facet] = (countByFacet[event.facet] ?? 0) + 1;
      }
    }

    // Progress
    const done = Math.min(i + BATCH_SIZE, candidates.length);
    const leadFacet = batch[0].facet;
    console.log(`[${leadFacet}] embedded ${done}/${candidates.length} — ${elapsed(startMs)}`);

    if (i + BATCH_SIZE < candidates.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // ── 3. Summary ──────────────────────────────────────────────────────────────
  console.log('\n─── Summary ───────────────────────────────');
  for (const facet of FACETS) {
    if (countByFacet[facet]) {
      console.log(`  ${facet}: ${countByFacet[facet]} embedded`);
    }
  }
  const totalEmbedded = Object.values(countByFacet).reduce((a, b) => a + b, 0);
  console.log(`  Total: ${totalEmbedded} embedded`);
  console.log(`  Time: ${elapsed(startMs)}`);
  if (errors.length > 0) {
    console.log(`  Errors (${errors.length}):`);
    for (const e of errors) console.log(`    - ${e}`);
  } else {
    console.log('  Errors: none');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
