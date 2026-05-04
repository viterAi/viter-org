/**
 * L2 synthesizer types.
 *
 * Pipeline: Scoper → Prompt → LLM → CitationParser → DB insert (gate-validated).
 */

import type { UUID, ISOTimestamp } from '../types.js';

export type ScopeKind = 'day' | 'meeting' | 'thread' | 'concept' | 'person' | 'arbitrary';

/** A scoper resolves (tenant_id, scope_key) into the L1 events that feed L2. */
export interface ScoperInput {
  tenantId: UUID;
  scopeKey: string;
}

/** Lean L1 event shape returned by scopers — joins principals + channels for the prompt. */
export interface L1EventForPrompt {
  id: UUID;
  extraction_run_id: UUID;
  event_at: ISOTimestamp;
  facet: string;
  modality: string;
  content: string | null;
  position: number;
  actor_canonical: string | null;
  actor_display: string | null;
  channel_kind: string | null;
  channel_identifier: string | null;
  artifact_id: UUID;
  metadata: Record<string, unknown>;
}

/** Scoper signature — tenant + scope_key → events feeding L2. */
export type Scoper = (
  input: ScoperInput,
  db: import('@supabase/supabase-js').SupabaseClient,
) => Promise<L1EventForPrompt[]>;

/** LLM completion request shape (provider-agnostic). */
export interface LLMCompletionRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMCompletionResult {
  body: string;
  generator: string;        // 'claude-opus-4-7' etc — matches principals.canonical_id
  generator_params: Record<string, unknown>;
  usage?: Record<string, unknown>;
}

/** LLM client signature — provider-agnostic. */
export type LLMClient = (req: LLMCompletionRequest) => Promise<LLMCompletionResult>;

export interface SynthesizeOptions {
  scopeKind: ScopeKind;
  scopeKey: string;
  /** If true, skip L2 insert and return the synthesis (for testing) */
  dryRun?: boolean;
  /** Override default model for this synthesis */
  modelOverride?: string;
}

export interface SynthesisResult {
  scope_kind: ScopeKind;
  scope_key: string;
  body: string;
  cited_event_ids: UUID[];
  cited_extraction_runs: UUID[];
  generator: string;
  inserted_id: UUID | null;     // null if dryRun, OR if zero events found
  events_in_scope: number;
  events_cited: number;
  unresolved_codes: string[];   // [eN] codes the LLM cited but the parser couldn't map (signal for hallucination)
}
