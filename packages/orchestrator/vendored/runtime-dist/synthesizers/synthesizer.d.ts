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
import type { LLMClient, SynthesisResult, SynthesizeOptions } from './types.js';
import type { UUID } from '../types.js';
export interface SynthesizerDeps {
    db: SupabaseClient;
    llm: LLMClient;
    tenantId: UUID;
}
export declare function synthesize(deps: SynthesizerDeps, opts: SynthesizeOptions): Promise<SynthesisResult>;
//# sourceMappingURL=synthesizer.d.ts.map