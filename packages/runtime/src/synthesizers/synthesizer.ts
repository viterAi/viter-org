/**
 * L2 synthesizer orchestrator.
 *
 * Pipeline:
 *   1. scoper(tenant_id, scope_key) → L1 events for this scope
 *   2. promptBuilder(date|key, events) → systemPrompt + userPrompt + codeMap
 *   3. llmClient(...)                 → markdown body with [eN] citations
 *   4. resolveCitations(body, codeMap) → cited_event_ids + cited_extraction_runs + unresolved
 *   5. db.insert('l2_syntheses', ...)  → DB trigger validates citation integrity
 *
 * Returns SynthesisResult — with the inserted ID (or null on dryRun / empty scope) and diagnostics.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { scopeByDay } from './scopers/day.js';
import { buildDayPrompt } from './prompts/day.js';
import { resolveCitations } from './citation-parser.js';
import type {
  LLMClient,
  ScopeKind,
  SynthesisResult,
  SynthesizeOptions,
} from './types.js';
import type { UUID } from '../types.js';

export interface SynthesizerDeps {
  db: SupabaseClient;
  llm: LLMClient;
  tenantId: UUID;
}

export async function synthesize(
  deps: SynthesizerDeps,
  opts: SynthesizeOptions,
): Promise<SynthesisResult> {
  const { db, llm, tenantId } = deps;
  const { scopeKind, scopeKey } = opts;

  // ── 1. Scoper ──────────────────────────────────────────────────────
  const events = await dispatchScoper(scopeKind, { tenantId, scopeKey }, db);

  if (events.length === 0) {
    return {
      scope_kind: scopeKind,
      scope_key: scopeKey,
      body: '',
      cited_event_ids: [],
      cited_extraction_runs: [],
      generator: '',
      inserted_id: null,
      events_in_scope: 0,
      events_cited: 0,
      unresolved_codes: [],
    };
  }

  // ── 2. Prompt ──────────────────────────────────────────────────────
  const { systemPrompt, userPrompt, codeMap } = dispatchPromptBuilder(scopeKind, scopeKey, events);

  // ── 3. LLM ─────────────────────────────────────────────────────────
  const model = opts.modelOverride ?? 'claude-opus-4-5';
  const completion = await llm({
    model,
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
    temperature: 0.2,
  });

  // ── 4. Resolve citations ───────────────────────────────────────────
  const parsed = resolveCitations(completion.body, codeMap);

  // ── 5. Insert L2 (DB trigger validates citation integrity) ─────────
  let insertedId: UUID | null = null;
  if (!opts.dryRun) {
    const { data, error } = await db
      .from('l2_syntheses')
      .insert({
        tenant_id: tenantId,
        scope_kind: scopeKind,
        scope_key: scopeKey,
        body: completion.body,
        cites_event_ids: parsed.cited_event_ids,
        cites_extraction_runs: parsed.cited_extraction_runs,
        generator: completion.generator,
        generator_params: completion.generator_params,
        metadata: {
          events_in_scope: events.length,
          unresolved_codes: parsed.unresolved_codes,
          usage: completion.usage,
        },
      })
      .select('id')
      .single();

    if (error) throw new Error(`l2_syntheses insert: ${error.message}`);
    insertedId = data.id as UUID;
  }

  return {
    scope_kind: scopeKind,
    scope_key: scopeKey,
    body: completion.body,
    cited_event_ids: parsed.cited_event_ids,
    cited_extraction_runs: parsed.cited_extraction_runs,
    generator: completion.generator,
    inserted_id: insertedId,
    events_in_scope: events.length,
    events_cited: parsed.cited_event_ids.length,
    unresolved_codes: parsed.unresolved_codes,
  };
}

// ────────────────────────────────────────────────────────────────────
// Scope-kind dispatch (extend here as more scopers ship)
// ────────────────────────────────────────────────────────────────────

async function dispatchScoper(
  kind: ScopeKind,
  input: { tenantId: UUID; scopeKey: string },
  db: SupabaseClient,
) {
  switch (kind) {
    case 'day':
      return scopeByDay(input, db);
    case 'meeting':
    case 'thread':
    case 'concept':
    case 'person':
    case 'arbitrary':
      throw new Error(`scope kind '${kind}' not yet implemented`);
  }
}

function dispatchPromptBuilder(
  kind: ScopeKind,
  scopeKey: string,
  events: ReturnType<typeof Array.prototype.slice> extends infer _ ? any : never,
) {
  switch (kind) {
    case 'day':
      return buildDayPrompt(scopeKey, events);
    case 'meeting':
    case 'thread':
    case 'concept':
    case 'person':
    case 'arbitrary':
      throw new Error(`scope kind '${kind}' prompt not yet implemented`);
  }
}
