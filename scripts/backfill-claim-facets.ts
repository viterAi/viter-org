/**
 * scripts/backfill-claim-facets.ts
 *
 * Extracts typed claim_facet events from existing l1_events.
 *
 * Reads source events of facet ∈ {commit_message, messages, transcription, turn_text},
 * calls gemini-3.1-flash-lite (per migration 022 extractor_metadata row) to extract
 * 0..n claims per event, inserts new l1_events with facet='claim_facet', then embeds
 * them via OpenRouter text-embedding-3-small.
 *
 * Each derived claim event:
 *   - facet='claim_facet'
 *   - modality='signal'
 *   - actor_id=<inherited from source>
 *   - channel_id=<inherited from source>
 *   - event_at=<source.event_at>
 *   - extraction_run_id=<this run>
 *   - extraction_method='openrouter:google/gemini-3.1-flash-lite@2026-05-11-claim'
 *   - content=<canonical extracted claim text>
 *   - metadata={
 *       claim_kind: 'directive'|'decision'|'pain'|'question'|'scope_shift'   (for events)
 *                   'feature'|'fix'|'refactor'|'scope_shift'|'infra'         (for commits)
 *       source_event_id: <originating l1_event.id>
 *       source_facet:    <original facet>
 *       source_kind:     'event' | 'commit'
 *       commit_sha:      <commit.sha>     (commit only)
 *       confidence:      0.0..1.0
 *     }
 *
 * Idempotent: skips source events that already have any claim_facet derived from them.
 *
 * Usage:
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/backfill-claim-facets.ts --since 2026-04-01 --dry-run
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/backfill-claim-facets.ts --since 2026-04-01 --facet commit_message --limit 50
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENROUTER_API_KEY
 */

import { randomUUID } from 'node:crypto';
import { createServiceRoleClient } from '../packages/runtime/src/db.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';

const EXTRACTOR_ID    = 'openrouter:google/gemini-3.1-flash-lite@2026-05-11-claim';
const EXTRACTOR_NAME  = 'gemini-3.1-flash-lite-claim';
const EXTRACTOR_VER   = '2026-05-11';
const CLAIM_FACET     = 'claim_facet';

const OPENROUTER_CHAT_URL  = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_EMBED_URL = 'https://openrouter.ai/api/v1/embeddings';
const CLAIM_MODEL          = 'google/gemini-3.1-flash-lite-preview';
const EMBEDDING_MODEL      = 'openai/text-embedding-3-small';
const EMBED_BATCH          = 96;

const SOURCE_FACETS = ['commit_message', 'messages', 'transcription', 'turn_text'] as const;
type SourceFacet = typeof SOURCE_FACETS[number];

// Allowed claim_kinds by source kind
const KINDS_FOR_EVENT  = ['directive', 'decision', 'pain', 'question', 'scope_shift'] as const;
const KINDS_FOR_COMMIT = ['feature', 'fix', 'refactor', 'scope_shift', 'infra'] as const;

const MIN_CONTENT_CHARS = 40;
const MAX_CONTENT_CHARS = 6000;

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINCE   = argValue('--since')  ?? '2026-04-01';
const UNTIL   = argValue('--until')  ?? new Date().toISOString().slice(0, 10);
const LIMIT   = parseInt(argValue('--limit') ?? '500', 10);
const FACET_FILTER = argValue('--facet') as SourceFacet | undefined;
const SKIP_EMBED   = args.includes('--no-embed');

function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SYS_EVENT = `You extract typed claims from one short prose snippet.

Allowed claim_kinds:
- directive   = an explicit ask or instruction the speaker is giving someone
- decision    = an explicit choice, ruling, or commitment ("we will X", "let's go with Y")
- pain        = an explicit complaint, blocker, frustration, or named broken thing
- question    = an unresolved question the speaker is posing
- scope_shift = an addition, removal, or reframing of project scope

Rules:
- Return STRICT JSON: {"claims":[{"kind": "...", "text": "...", "confidence": 0.0..1.0}]}
- 0 claims is COMMON. Most chitchat / acks / "ok cool" / "lol" / greetings have NO claims. Return {"claims":[]} freely.
- Each claim "text" is the canonical, cleaned, third-person statement of the claim. NOT a quote.
  Example input: "can you ship the recon thing by tuesday"
  Example claim: {"kind":"directive","text":"Ship the reconciliation feature by Tuesday","confidence":0.85}
- Do NOT invent. If the snippet is too vague to extract a typed claim with >0.6 confidence, return {"claims":[]}.
- Return ONLY the JSON object. No prose, no markdown fences.`;

const SYS_COMMIT = `You extract typed claims from one git commit (subject + body + optional file changes).

Allowed claim_kinds:
- feature     = adds new user-visible capability
- fix         = repairs broken behavior or fixes a bug
- refactor    = rearranges code without behavior change
- scope_shift = expands, removes, or reframes the project's scope
- infra       = build, CI, tooling, dependencies, or deployment changes only

Rules:
- Return STRICT JSON: {"claims":[{"kind": "...", "text": "...", "confidence": 0.0..1.0}]}
- A commit can have multiple kinds (a feature + an infra). Return all that apply.
- Each claim "text" is the canonical, cleaned, third-person statement of WHAT the commit does, in plain English. NOT the commit subject verbatim.
  Example input: "feat(recon): preserve original currency per supplier\\n\\nAdds currency_original column..."
  Example claim: {"kind":"feature","text":"Preserve each supplier's original invoice currency in the reconciliation pipeline","confidence":0.95}
- Merge commits, formatting-only commits, version bumps → {"claims":[]}.
- Return ONLY the JSON object. No prose, no markdown fences.`;

// ─── Source event types ──────────────────────────────────────────────────────

interface SourceEvent {
  id: string;
  event_at: string;
  tenant_id: string;
  facet: SourceFacet;
  actor_id: string | null;
  channel_id: string | null;
  artifact_id: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface ExtractedClaim {
  kind: string;
  text: string;
  confidence: number;
}

// ─── OpenRouter calls ────────────────────────────────────────────────────────

async function extractClaims(
  apiKey: string,
  source: SourceEvent
): Promise<ExtractedClaim[]> {
  const isCommit = source.facet === 'commit_message';
  const sys = isCommit ? SYS_COMMIT : SYS_EVENT;
  const allowedKinds = isCommit ? KINDS_FOR_COMMIT : KINDS_FOR_EVENT;

  const userContent = source.content.slice(0, MAX_CONTENT_CHARS);

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vita.viter.ai',
    },
    body: JSON.stringify({
      model: CLAIM_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.0,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '{}';

  let parsed: { claims?: ExtractedClaim[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`  ⚠ JSON parse fail, treating as 0 claims: ${raw.slice(0, 100)}`);
    return [];
  }

  const claims = (parsed.claims ?? []).filter(
    (c) =>
      c &&
      typeof c.kind === 'string' &&
      typeof c.text === 'string' &&
      typeof c.confidence === 'number' &&
      (allowedKinds as readonly string[]).includes(c.kind) &&
      c.confidence >= 0.6 &&
      c.text.trim().length >= 5
  );

  return claims;
}

async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  const res = await fetch(OPENROUTER_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://vita.viter.ai',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embed ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    data: { index: number; embedding: number[] }[];
  };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required');
  const sb = createServiceRoleClient();

  console.log(
    `=== backfill-claim-facets ===\n` +
      `mode=${DRY_RUN ? 'DRY-RUN' : 'WRITE'}  since=${SINCE}  until=${UNTIL}  limit=${LIMIT}` +
      `  facet=${FACET_FILTER ?? '<all>'}  embed=${SKIP_EMBED ? 'no' : 'yes'}`
  );

  // Step 1 — find source events that need claim extraction
  const facetsToProcess = FACET_FILTER ? [FACET_FILTER] : [...SOURCE_FACETS];
  const allSources: SourceEvent[] = [];

  for (const facet of facetsToProcess) {
    const { data, error } = await sb
      .from('l1_events')
      .select(
        'id, event_at, tenant_id, facet, actor_id, channel_id, artifact_id, content, metadata'
      )
      .eq('tenant_id', TENANT_ID)
      .eq('facet', facet)
      .gte('event_at', `${SINCE}T00:00:00Z`)
      .lte('event_at', `${UNTIL}T23:59:59Z`)
      .not('content', 'is', null)
      .order('event_at', { ascending: false })
      .limit(LIMIT);

    if (error) throw new Error(`fetch ${facet}: ${error.message}`);
    if (data) allSources.push(...(data as SourceEvent[]));
  }

  console.log(`  fetched ${allSources.length} source events`);

  // Step 2 — filter out ones that already have claim_facet derived from them
  const sourceIds = allSources.map((s) => s.id);
  let alreadyDone = new Set<string>();
  if (sourceIds.length > 0) {
    // chunk so we don't blow URL length
    for (let i = 0; i < sourceIds.length; i += 200) {
      const chunk = sourceIds.slice(i, i + 200);
      const { data, error } = await sb
        .from('l1_events')
        .select('metadata')
        .eq('tenant_id', TENANT_ID)
        .eq('facet', CLAIM_FACET)
        .in('metadata->>source_event_id', chunk);
      if (error) throw new Error(`dedup query: ${error.message}`);
      for (const row of data ?? []) {
        const sid = (row as { metadata: { source_event_id?: string } }).metadata?.source_event_id;
        if (sid) alreadyDone.add(sid);
      }
    }
  }

  const todo = allSources.filter(
    (s) => !alreadyDone.has(s.id) && s.content.trim().length >= MIN_CONTENT_CHARS
  );
  console.log(`  ${alreadyDone.size} already done, ${todo.length} to process`);

  if (todo.length === 0) {
    console.log('nothing to do');
    return;
  }

  // Step 3 — for each source event, extract → insert claim events
  let runId: string | null = null;
  if (!DRY_RUN) {
    runId = randomUUID();
    const { error } = await sb.from('l1_extraction_runs').insert({
      id: runId,
      tenant_id: TENANT_ID,
      // artifact_id is NOT NULL but we're a multi-source batch run
      // → use the first source's artifact_id as the canonical reference
      artifact_id: todo[0].artifact_id,
      facet: CLAIM_FACET,
      extractor: EXTRACTOR_ID,
      version: EXTRACTOR_VER,
      parameters: { since: SINCE, until: UNTIL, facet: FACET_FILTER, limit: LIMIT },
      is_deterministic: false,
      status: 'running',
      started_at: new Date().toISOString(),
      representation: ['text/structured'],
    });
    if (error) throw new Error(`insert run: ${error.message}`);
  }

  let totalClaims = 0;
  let processed = 0;
  let zeroClaims = 0;
  const claimEventIds: { id: string; event_at: string; text: string }[] = [];

  for (const source of todo) {
    processed++;
    const isCommit = source.facet === 'commit_message';

    let claims: ExtractedClaim[] = [];
    try {
      claims = await extractClaims(apiKey, source);
    } catch (err) {
      console.warn(`  ⚠ ${source.id.slice(0, 8)}: ${(err as Error).message}`);
      continue;
    }

    if (claims.length === 0) {
      zeroClaims++;
    } else {
      totalClaims += claims.length;
    }

    if (processed % 25 === 0 || claims.length > 0) {
      console.log(
        `  [${processed}/${todo.length}] ${source.facet} ${source.event_at.slice(0, 10)} → ${claims.length} claim(s)` +
          (claims.length > 0 ? ` [${claims.map((c) => c.kind).join(', ')}]` : '')
      );
    }

    if (DRY_RUN || claims.length === 0) continue;

    // Insert each claim as new l1_event
    for (const claim of claims) {
      const claimId = randomUUID();
      const claimMeta: Record<string, unknown> = {
        claim_kind: claim.kind,
        confidence: claim.confidence,
        source_event_id: source.id,
        source_facet: source.facet,
        source_kind: isCommit ? 'commit' : 'event',
      };
      if (isCommit) {
        claimMeta.commit_sha = (source.metadata as { commit_sha?: string })?.commit_sha ?? null;
      }

      const { error } = await sb.from('l1_events').insert({
        id: claimId,
        tenant_id: TENANT_ID,
        artifact_id: source.artifact_id,
        extraction_run_id: runId,
        facet: CLAIM_FACET,
        event_at: source.event_at, // inherit timestamp from source
        position: 0,
        actor_id: source.actor_id,
        channel_id: source.channel_id,
        modality: 'signal',
        content: claim.text,
        confidence: claim.confidence,
        extraction_method: EXTRACTOR_ID,
        metadata: claimMeta,
      });
      if (error) {
        console.warn(`  ⚠ insert claim ${claimId.slice(0, 8)}: ${error.message}`);
        continue;
      }
      claimEventIds.push({ id: claimId, event_at: source.event_at, text: claim.text });
    }
  }

  if (!DRY_RUN && runId) {
    await sb
      .from('l1_extraction_runs')
      .update({
        status: 'ok',
        completed_at: new Date().toISOString(),
        metrics: {
          source_events_processed: processed,
          claims_extracted: totalClaims,
          zero_claim_sources: zeroClaims,
        },
      })
      .eq('id', runId);
  }

  console.log(
    `\n  → ${processed} source events processed`,
    `\n  → ${zeroClaims} produced 0 claims (chitchat / boilerplate)`,
    `\n  → ${totalClaims} claims extracted total`
  );

  // Step 4 — embed all newly inserted claim events
  if (DRY_RUN || SKIP_EMBED || claimEventIds.length === 0) {
    console.log(`  skipping embeddings (dry=${DRY_RUN} skip=${SKIP_EMBED} n=${claimEventIds.length})`);
    return;
  }

  console.log(`\n=== embedding ${claimEventIds.length} claims ===`);
  let embedded = 0;
  for (let i = 0; i < claimEventIds.length; i += EMBED_BATCH) {
    const batch = claimEventIds.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(apiKey, batch.map((b) => b.text));
    for (let j = 0; j < batch.length; j++) {
      const { error } = await sb.from('l1_embeddings').insert({
        event_id: batch[j].id,
        event_at: batch[j].event_at,
        extraction_run_id: runId,
        tenant_id: TENANT_ID,
        embedding: vectors[j] as unknown as string, // pgvector accepts JSON array
        metadata: { model: EMBEDDING_MODEL, dim: 1536 },
      });
      if (error) {
        console.warn(`  ⚠ embed ${batch[j].id.slice(0, 8)}: ${error.message}`);
        continue;
      }
      embedded++;
    }
    console.log(`  embedded ${embedded}/${claimEventIds.length}`);
  }

  console.log(`\n✅ done. ${totalClaims} claims, ${embedded} embedded.`);
  console.log(`\nQuick check:\n  SELECT facet, count(*) FROM l1_events GROUP BY facet ORDER BY 2 DESC;\n  SELECT * FROM v_claim_to_commit ORDER BY similarity DESC NULLS LAST LIMIT 10;`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
