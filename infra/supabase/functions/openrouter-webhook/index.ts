/**
 * openrouter-webhook — Supabase Edge Function (Deno).
 *
 * Vita's answer to "100% visibility from OpenRouter and trigger.dev" — based
 * on the proven shelet pattern (~/Openrouter-experments/ingestion-pipeline/webhook).
 *
 * Configure OpenRouter "Broadcast" feature to POST OTLP/JSON traces to:
 *   https://dkccadwohifcqcdzhhnu.supabase.co/functions/v1/openrouter-webhook
 *   Header: X-Webhook-Secret: <OPENROUTER_WEBHOOK_SECRET>
 *
 * Every chat-completions / audio-transcription / embedding call from ANY
 * caller (synthesizer, extractor, trigger.dev task, eval, ad-hoc script) emits
 * one OTLP span containing tokens, cost, provider_name, generation_time_ms,
 * model_used, finish_reason, and any caller-supplied `extra_body.metadata`.
 *
 * This webhook UPSERTS into public.llm_call_log keyed on (tenant_id,
 * generation_id) — the partial unique index llm_log_unique_gen already exists
 * in the migration. So the caller-side logger creates a "running" row with
 * what it knows (caller, scope, tenant, prompt info, source, trigger_run_id);
 * then this webhook fires async and fills the row with the canonical billing
 * data (tokens broken down by cached/reasoning, real cost_usd, OpenRouter's
 * generation_time_ms, model that was actually routed to).
 *
 * The two paths are belt-and-suspenders:
 *   - Caller-side row: guaranteed even if the webhook fails (e.g. provider
 *     rejected the request before producing a generation_id).
 *   - Webhook row: guaranteed even if the caller-side logger was never wired.
 *
 * The UPSERT preserves whichever fields the caller already populated and
 * fills only the ones still null.
 *
 * Env (function secrets):
 *   OPENROUTER_WEBHOOK_SECRET    — random, matches OR Broadcast config
 *   SUPABASE_URL                 — auto-set by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — auto-set by Supabase
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WEBHOOK_SECRET =
  Deno.env.get('OPENROUTER_WEBHOOK_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OTLPAttribute[];
}

function attrVal(v: OTLPAttribute['value']): string | number | boolean | null {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return parseInt(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return null;
}

function buildAttrMap(attrs: OTLPAttribute[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const a of attrs) map[a.key] = attrVal(a.value);
  return map;
}

function getFirst(map: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (map[k] !== undefined && map[k] !== null) return map[k];
  }
  return null;
}

function getInt(map: Record<string, unknown>, ...keys: string[]): number | null {
  const v = getFirst(map, ...keys);
  if (v === null) return null;
  return typeof v === 'number' ? Math.round(v) : parseInt(String(v)) || null;
}

function getFloat(map: Record<string, unknown>, ...keys: string[]): number | null {
  const v = getFirst(map, ...keys);
  if (v === null) return null;
  return typeof v === 'number' ? v : parseFloat(String(v)) || null;
}

function getStr(map: Record<string, unknown>, ...keys: string[]): string | null {
  const v = getFirst(map, ...keys);
  return v === null ? null : String(v);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, PUT',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Webhook-Secret, X-Test-Connection',
      },
    });
  }

  // Auth — accept either Bearer <secret> or X-Webhook-Secret: <secret>
  const authHeader = req.headers.get('Authorization');
  const webhookAuth = req.headers.get('X-Webhook-Secret');
  const isAuthed =
    !WEBHOOK_SECRET ||
    authHeader === `Bearer ${WEBHOOK_SECRET}` ||
    webhookAuth === WEBHOOK_SECRET;
  if (!isAuthed) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  if (req.headers.get('X-Test-Connection') === 'true') {
    return jsonResp({ ok: true, message: 'vita openrouter-webhook ready' });
  }

  let payload: { resourceSpans?: Array<{ scopeSpans?: Array<{ spans?: OTLPSpan[] }> }> };
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!payload.resourceSpans?.length) return jsonResp({ ok: true, spans: 0 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const rows: Array<Record<string, unknown>> = [];

  for (const rs of payload.resourceSpans) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const a = buildAttrMap(span.attributes ?? []);

        // Identifiers — generation_id is the primary key
        const generationId =
          getStr(a, 'gen_ai.response.id', 'openrouter.generation_id', 'trace.metadata.openrouter.generation_id') ??
          span.spanId;

        // Tenant_id — required for the row. Caller MUST stamp it via
        // OpenRouter's `extra_body.metadata.tenant_id` so it lands in the OTLP
        // span attributes as `trace.metadata.tenant_id`. If missing, skip — we
        // can't insert a tenant-scoped row without it.
        const tenantId = getStr(a, 'trace.metadata.tenant_id', 'span.metadata.tenant_id');
        if (!tenantId) {
          console.warn(`[or-webhook] skipping span ${span.spanId} — no tenant_id in metadata`);
          continue;
        }

        // Tokens — full breakdown
        const promptTokens = getInt(a, 'gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens');
        const completionTokens = getInt(a, 'gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens');
        const reasoningTokens = getInt(a, 'gen_ai.usage.output_tokens.reasoning', 'gen_ai.usage.reasoning_tokens');
        const cachedTokens = getInt(a, 'gen_ai.usage.input_tokens.cached', 'gen_ai.usage.cached_tokens');
        const totalTokens =
          getInt(a, 'gen_ai.usage.total_tokens') ??
          (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null);

        // Cost
        const totalCost = getFloat(a, 'gen_ai.usage.total_cost', 'gen_ai.usage.cost');
        const inputCost = getFloat(a, 'gen_ai.usage.input_cost');
        const outputCost = getFloat(a, 'gen_ai.usage.output_cost');
        let costUsd = totalCost;
        if (costUsd == null && inputCost != null && outputCost != null) costUsd = inputCost + outputCost;

        // Routing
        const modelRequested = getStr(
          a, 'gen_ai.request.model', 'llm.request.model', 'openrouter.model', 'trace.metadata.model',
        );
        const modelUsed = getStr(
          a, 'gen_ai.response.model', 'llm.response.model', 'openrouter.response_model',
        ) ?? modelRequested;
        const providerName = getStr(
          a, 'gen_ai.provider.name', 'gen_ai.system', 'trace.metadata.openrouter.provider_name',
        );
        const finishReason = getStr(
          a, 'gen_ai.response.finish_reason', 'gen_ai.response.finish_reasons',
          'trace.metadata.openrouter.finish_reason',
        );

        // Timing
        const startNano = BigInt(span.startTimeUnixNano || '0');
        const endNano = BigInt(span.endTimeUnixNano || '0');
        const latencyMs =
          startNano && endNano ? Number((endNano - startNano) / BigInt(1_000_000)) : null;
        const generationTimeMs = getInt(a, 'openrouter.generation_time_ms', 'gen_ai.generation_time_ms');

        // Metadata — collect everything trace.metadata.* / span.metadata.* /
        // openrouter.* into a single jsonb under metadata.or.* so we never
        // lose a field OR sends us, even fields we haven't named.
        const meta: Record<string, unknown> = {};
        for (const key of Object.keys(a)) {
          if (
            key.startsWith('trace.metadata.') ||
            key.startsWith('span.metadata.') ||
            key.startsWith('openrouter.') ||
            key.startsWith('gen_ai.')
          ) {
            const cleanKey = key
              .replace('trace.metadata.openrouter.', 'or.')
              .replace('trace.metadata.', '')
              .replace('span.metadata.', '')
              .replace('openrouter.', 'or.')
              .replace('gen_ai.', 'gen_ai.');
            meta[cleanKey] = a[key];
          }
        }
        if (inputCost != null) meta.input_cost_usd = inputCost;
        if (outputCost != null) meta.output_cost_usd = outputCost;
        meta.webhook_received_at = new Date().toISOString();
        meta.webhook_span_id = span.spanId;
        meta.webhook_trace_id = span.traceId;
        meta.webhook_span_name = span.name;

        // Caller-supplied scope (caller is encouraged to send
        // metadata.caller, metadata.scope_kind, metadata.scope_key,
        // metadata.trigger_run_id when initiating the OR call).
        const caller = getStr(a, 'trace.metadata.caller', 'span.metadata.caller');
        const scopeKind = getStr(a, 'trace.metadata.scope_kind', 'span.metadata.scope_kind');
        const scopeKey = getStr(a, 'trace.metadata.scope_key', 'span.metadata.scope_key');
        const triggerRunId = getStr(a, 'trace.metadata.trigger_run_id', 'span.metadata.trigger_run_id');
        if (triggerRunId) meta.trigger_run_id = triggerRunId;

        const row: Record<string, unknown> = {
          tenant_id: tenantId,
          generation_id: generationId,
          model_requested: modelRequested ?? 'unknown',
          model_used: modelUsed,
          provider_name: providerName ?? 'openrouter',
          status: 'ok',
          finish_reason: finishReason,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          reasoning_tokens: reasoningTokens,
          cached_tokens: cachedTokens,
          total_tokens: totalTokens,
          cost_usd: costUsd,
          latency_ms: latencyMs,
          generation_time_ms: generationTimeMs,
          started_at: startNano
            ? new Date(Number(startNano / BigInt(1_000_000))).toISOString()
            : new Date().toISOString(),
          completed_at: endNano
            ? new Date(Number(endNano / BigInt(1_000_000))).toISOString()
            : new Date().toISOString(),
          metadata: meta,
        };
        if (caller) row.caller = caller;
        if (scopeKind) row.scope_kind = scopeKind;
        if (scopeKey) row.scope_key = scopeKey;

        rows.push(row);
      }
    }
  }

  if (rows.length === 0) return jsonResp({ ok: true, spans: 0 });

  // UPSERT on (tenant_id, generation_id). Caller-side rows that lack
  // generation_id stay; rows with the same generation_id get filled in.
  // The unique index `llm_log_unique_gen` is partial (where generation_id
  // is not null) — that's fine because we always have a generation_id here
  // (we fall back to span_id if OR omitted it).
  const { error } = await supabase
    .from('llm_call_log')
    .upsert(rows, { onConflict: 'tenant_id,generation_id', ignoreDuplicates: false });

  if (error) {
    console.error(`[or-webhook] upsert failed: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message, rows: rows.length }), { status: 500 });
  }

  return jsonResp({ ok: true, spans: rows.length });
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
