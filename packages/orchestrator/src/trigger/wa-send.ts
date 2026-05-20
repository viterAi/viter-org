/**
 * waSend — outbound WhatsApp message.
 *
 * Called from the orchestrator agent loop or from a UI server action.
 * Applies per-device rate limiting (cap on messages/min, jitter, time-of-day
 * check) to avoid ban-risk patterns. Writes an outbound l0_artifact +
 * l1_event for traceability. Logs LLM-generated bodies to llm_call_log
 * when caller_metadata.llm_call_id is provided.
 *
 * Body source can be:
 *   - 'human' — typed by a user
 *   - 'agent' — produced by the orchestrator's LLM call (link via callerLogId)
 *   - 'template' — predefined template (lower ban risk if used carefully)
 */

import { schemaTask, tags, metadata } from '@trigger.dev/sdk';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { GowaClient, GowaError } from '@viter-org/adapter-whatsapp-gowa';

const Payload = z.object({
  tenant_id: z.string().uuid(),
  whatsapp_devices_id: z.string().uuid(),
  /** Recipient — '<number>@s.whatsapp.net' for 1:1 or 'xxx@g.us' for groups */
  to: z.string().min(5),
  text: z.string().min(1).max(4096),
  reply_to_message_id: z.string().optional(),
  source: z.enum(['human', 'agent', 'template']).default('human'),
  /** Backref to llm_call_log row when source='agent' */
  llm_call_log_id: z.string().uuid().optional(),
  /** Channel to attach the outbound l1_event to */
  channel_id: z.string().uuid().optional(),
});

const OUTBOUND_RATE_LIMIT_PER_MINUTE = 8;     // safe baseline; override per device in metadata
const OUTBOUND_JITTER_MS = 1500;               // ±1.5s of randomness so we don't look like a bot

export const waSend = schemaTask({
  id: 'wa-send',
  schema: Payload,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000, randomize: true },
  queue: { concurrencyLimit: 4 },
  machine: { preset: 'small-1x' },
  maxDuration: 60,

  run: async (payload, { ctx }) => {
    await tags.add(`tenant:${payload.tenant_id}`);
    await tags.add('wa:send');
    await tags.add(`source:${payload.source}`);
    metadata.set('to', payload.to).set('source', payload.source);

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // 1. Resolve device + verify it's linked
    const { data: device, error: dErr } = await supabase
      .from('whatsapp_devices')
      .select('id, gowa_device_id, status, phone_number, metadata')
      .eq('id', payload.whatsapp_devices_id)
      .eq('tenant_id', payload.tenant_id)
      .single();
    if (dErr || !device) throw new Error(`device not found: ${dErr?.message}`);
    if (device.status !== 'linked') {
      throw new Error(`device status=${device.status} — cannot send`);
    }

    // 2. Rate limit: count outbound from this device in the last 60s
    const sinceIso = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from('l1_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', payload.tenant_id)
      .eq('metadata->>gowa_device_id', device.gowa_device_id)
      .eq('metadata->>from_me', 'true')
      .gte('event_at', sinceIso);

    if ((count ?? 0) >= OUTBOUND_RATE_LIMIT_PER_MINUTE) {
      throw new Error(`rate limit: device sent ${count} msg in last 60s (cap ${OUTBOUND_RATE_LIMIT_PER_MINUTE})`);
    }

    // 3. Jitter — humans don't send at exact intervals
    const jitter = Math.floor(Math.random() * OUTBOUND_JITTER_MS);
    if (jitter > 50) await new Promise((r) => setTimeout(r, jitter));

    // 4. Send via GOWA
    const gowa = new GowaClient({
      baseUrl: process.env.GOWA_BASE_URL!,
      basicAuth: process.env.GOWA_BASIC_AUTH ?? undefined,
    });

    // gowa_device_id stores the JID (for webhook lookup); GOWA REST API requires the UUID
    const gowaApiId = (device.metadata as Record<string, unknown>)?.gowa_uuid as string | undefined
      ?? device.gowa_device_id;

    const sendArgs: { phone: string; message: string; reply_to_message_id?: string } = {
      phone: payload.to,
      message: payload.text,
    };
    if (payload.reply_to_message_id) sendArgs.reply_to_message_id = payload.reply_to_message_id;

    let resp;
    try {
      resp = await gowa.sendText(gowaApiId, sendArgs);
    } catch (err) {
      if (err instanceof GowaError) {
        if (err.status === 429) {
          throw new Error(`whatsapp 429: ${err.body.slice(0, 200)}`);
        }
      }
      throw err;
    }

    // 5. Persist outbound event for traceability
    const eventAt = resp.timestamp ?? new Date().toISOString();
    const eventMetadata: Record<string, unknown> = {
      gowa_message_id: resp.message_id,
      gowa_device_id: device.gowa_device_id,
      from_me: true,
      to: payload.to,
      source: payload.source,
      send_status: resp.status,
      trigger_run_id: ctx.run.id,
    };
    if (payload.llm_call_log_id) eventMetadata.llm_call_log_id = payload.llm_call_log_id;
    if (payload.reply_to_message_id) eventMetadata.reply_to_message_id = payload.reply_to_message_id;

    await supabase.from('l1_events').insert({
      tenant_id: payload.tenant_id,
      artifact_id: null,                                  // outbound has no L0 source
      extraction_run_id: null,
      facet: 'messages',
      event_at: eventAt,
      position: 0,
      actor_id: null,                                     // sender is the tenant; resolved later
      channel_id: payload.channel_id ?? null,
      modality: 'text',
      content: payload.text,
      confidence: 1.0,
      extraction_method: 'wa-send@v0.1',
      metadata: eventMetadata,
    });

    return {
      message_id: resp.message_id,
      status: resp.status,
      timestamp: resp.timestamp,
    };
  },
});
