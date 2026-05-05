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
import { createHash } from 'node:crypto';
import { scopeByDay } from './scopers/day.js';
import { buildDayPrompt } from './prompts/day.js';
import { resolveCitations } from './citation-parser.js';
import { preparePayloadForLog } from '../utils/redact.js';
const PROMPT_VERSION_DAY = 'day-prompt-v2-deep';
function sha256(s) {
    return createHash('sha256').update(s).digest('hex');
}
export async function synthesize(deps, opts) {
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
            llm_call_id: null,
            latency_ms: 0,
            model_used: '',
            provider_name: '',
            generation_id: null,
        };
    }
    // ── 2. Prompt ──────────────────────────────────────────────────────
    const { systemPrompt, userPrompt, codeMap } = dispatchPromptBuilder(scopeKind, scopeKey, events);
    // ── 3. LLM ─────────────────────────────────────────────────────────
    const model = opts.modelOverride ?? 'anthropic/claude-opus-4-5';
    const promptVersion = scopeKind === 'day' ? PROMPT_VERSION_DAY : 'unknown';
    const params = { max_tokens: 16384, temperature: 0.2 };
    // 3a. Open llm_call_log row (status='pending')
    const { data: callRow } = await db
        .from('llm_call_log')
        .insert({
        tenant_id: tenantId,
        caller: `synthesizer.${scopeKind}`,
        prompt_version: promptVersion,
        scope_kind: scopeKind,
        scope_key: scopeKey,
        model_requested: model,
        parameters: params,
        system_prompt_hash: sha256(systemPrompt),
        user_prompt_hash: sha256(userPrompt),
        user_prompt_chars: userPrompt.length,
        raw_request: preparePayloadForLog({ system: systemPrompt, user: userPrompt }),
        status: 'running',
    })
        .select('id')
        .single();
    const llmCallId = callRow?.id ?? null;
    const t0 = Date.now();
    let completion;
    try {
        completion = await llm({
            model,
            systemPrompt,
            userPrompt,
            maxTokens: params.max_tokens,
            temperature: params.temperature,
        });
    }
    catch (err) {
        if (llmCallId) {
            await db.from('llm_call_log').update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                latency_ms: Date.now() - t0,
                error_message: err instanceof Error ? err.message : String(err),
            }).eq('id', llmCallId);
        }
        throw err;
    }
    const latencyMs = Date.now() - t0;
    // 3b. Close llm_call_log row with token usage + cost (computed client-side)
    if (llmCallId) {
        const usage = (completion.usage ?? {});
        const promptTokens = (usage.prompt_tokens ?? usage.input_tokens);
        const completionTokens = (usage.completion_tokens ?? usage.output_tokens);
        const reasoningTokens = (usage.reasoning_tokens ?? null);
        const cachedTokens = (usage.cached_tokens ?? null);
        const totalTokens = (usage.total_tokens ?? ((promptTokens ?? 0) + (completionTokens ?? 0)));
        await db.from('llm_call_log').update({
            status: 'ok',
            completed_at: new Date().toISOString(),
            latency_ms: latencyMs,
            model_used: completion.model_used,
            provider_name: completion.provider_name,
            generation_id: completion.generation_id,
            finish_reason: completion.finish_reason,
            prompt_tokens: promptTokens ?? null,
            completion_tokens: completionTokens ?? null,
            reasoning_tokens: reasoningTokens,
            cached_tokens: cachedTokens,
            total_tokens: totalTokens,
            raw_response: preparePayloadForLog({ body: completion.body, usage }),
        }).eq('id', llmCallId);
    }
    // ── 4. Resolve citations ───────────────────────────────────────────
    const parsed = resolveCitations(completion.body, codeMap);
    // ── 5. Insert L2 (DB trigger validates citation integrity) ─────────
    let insertedId = null;
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
        if (error)
            throw new Error(`l2_syntheses insert: ${error.message}`);
        insertedId = data.id;
        // Back-link the llm_call_log row to the inserted l2_synthesis
        if (llmCallId && insertedId) {
            await db.from('llm_call_log').update({ caller_ref: insertedId }).eq('id', llmCallId);
        }
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
        llm_call_id: llmCallId,
        latency_ms: latencyMs,
        model_used: completion.model_used,
        provider_name: completion.provider_name,
        generation_id: completion.generation_id,
    };
}
// ────────────────────────────────────────────────────────────────────
// Scope-kind dispatch (extend here as more scopers ship)
// ────────────────────────────────────────────────────────────────────
async function dispatchScoper(kind, input, db) {
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
function dispatchPromptBuilder(kind, scopeKey, events) {
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
//# sourceMappingURL=synthesizer.js.map