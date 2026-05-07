/**
 * synthesizeMeeting — generate an L2 synthesis for a completed meeting.
 *
 * Triggered automatically after ingest-meeting completes (see ingest-meeting.ts).
 * Can also be triggered manually to regenerate a stale or missing synthesis.
 *
 * Writes to l2_syntheses with scope_kind='meeting', scope_key='meeting:{identifier}'.
 * The l2_current view exposes the latest non-superseded synthesis for the chat UI.
 *
 * Idempotency: if a fresh (non-stale) synthesis already exists, skips unless
 * force=true is passed. This prevents duplicate LLM calls on retry.
 */

import { schemaTask, logger } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

import { synthesize } from '@vita/runtime/synthesizers';
import { createLLMClient } from '@vita/runtime/synthesizers';

const SynthesizeMeetingPayload = z.object({
  tenant_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  /** Force re-synthesis even if a fresh synthesis already exists. */
  force: z.boolean().default(false),
});

export const synthesizeMeeting = schemaTask({
  id: 'synthesize-meeting',
  schema: SynthesizeMeetingPayload,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5000 },
  machine: { preset: 'small-2x' },
  maxDuration: 300,

  run: async (payload) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Resolve channel identifier for scope_key
    const { data: channel, error: chErr } = await supabase
      .from('channels')
      .select('identifier')
      .eq('id', payload.channel_id)
      .eq('tenant_id', payload.tenant_id)
      .single();
    if (chErr || !channel) throw new Error(`channel ${payload.channel_id} not found`);

    const identifier = channel.identifier as string;
    const scopeKey = `meeting:${identifier}`;

    // Idempotency: skip if a fresh synthesis exists
    if (!payload.force) {
      const { data: existing } = await supabase
        .from('l2_syntheses')
        .select('id, generated_at')
        .eq('tenant_id', payload.tenant_id)
        .eq('scope_kind', 'meeting')
        .eq('scope_key', scopeKey)
        .eq('is_stale', false)
        .is('superseded_by', null)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        logger.info(`synthesis already exists for ${scopeKey}, skipping`, { id: existing.id });
        return { skipped: true, reason: 'already-synthesized', synthesis_id: existing.id };
      }
    }

    const llm = createLLMClient();

    const result = await synthesize(
      { db: supabase, llm, tenantId: payload.tenant_id },
      {
        scopeKind: 'meeting',
        scopeKey,
        modelOverride: 'anthropic/claude-sonnet-4-6',
      },
    );

    if (result.events_in_scope === 0) {
      logger.warn(`no transcription events found for ${scopeKey}`);
      return { skipped: true, reason: 'no-events', scope_key: scopeKey };
    }

    logger.info(`synthesized meeting L2`, {
      scope_key: scopeKey,
      events_in_scope: result.events_in_scope,
      events_cited: result.events_cited,
      chars: result.body.length,
      unresolved: result.unresolved_codes.length,
      latency_ms: result.latency_ms,
    });

    return {
      skipped: false,
      synthesis_id: result.inserted_id,
      scope_key: scopeKey,
      events_in_scope: result.events_in_scope,
      events_cited: result.events_cited,
      chars: result.body.length,
      unresolved_codes: result.unresolved_codes,
      latency_ms: result.latency_ms,
    };
  },
});
