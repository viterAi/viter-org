/**
 * Live WhatsApp message extractor.
 *
 * Companion to the Edge Function `whatsapp-webhook`. The EF does the hot-path
 * insert directly (for low latency); this module exposes the same logic as a
 * pure TypeScript function so:
 *   - tests can exercise it without spinning up a Deno EF
 *   - backfill scripts can replay raw webhook payloads from a log
 *   - future cron jobs (e.g. alias backfill) can re-process events
 *
 * The Edge Function copy and this module should produce identical row shapes.
 * If they diverge, this is the canonical reference; mirror back to the EF.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAlias } from '../../principals/alias-resolver.js';

export interface WhatsAppLiveMessageInput {
  tenantId: string;
  /** Resolved channel id (already created/looked up by the caller) */
  channelId: string;
  /** GOWA device id this message came in on */
  gowaDeviceId: string;
  /** Raw GOWA message data (passes through as l1_event.metadata.raw) */
  msg: {
    id: string;
    chat_id: string;
    from_id: string;
    from_me?: boolean;
    push_name?: string;
    timestamp: string;
    is_group?: boolean;
    group_id?: string;
    group_subject?: string;
    message_type: string;
    text?: string;
    media?: {
      url?: string;
      mime_type?: string;
      filename?: string;
      bytes?: number;
      sha256?: string;
      caption?: string;
      duration_seconds?: number;
    };
    quoted_message_id?: string;
    mentions?: string[];
  };
}

export interface WhatsAppLiveMessageResult {
  l0_artifact_id: string;
  l1_event_id?: string | undefined;
  needs_extraction: boolean;
  resolved_actor_id: string | null;
}

/**
 * Process one live WhatsApp message: insert l0_artifact, attempt principal
 * alias resolution for the sender, insert l1_event if text (no extractor
 * needed) or mark needs_extraction=true if media (caller fires the extractor).
 *
 * Idempotent: if (tenant_id, gowa_message_id) already exists, returns the
 * existing l0 row id. Safe to replay.
 */
export async function ingestLiveMessage(
  db: SupabaseClient,
  input: WhatsAppLiveMessageInput,
): Promise<WhatsAppLiveMessageResult> {
  const { tenantId, channelId, gowaDeviceId, msg } = input;

  // 1. Resolve sender → principal (best-effort, alias-based)
  const aliasMatch = msg.from_me
    ? null                                  // outbound messages: actor is the tenant; resolve via channel
    : await resolveAlias(db, { tenantId, raw: msg.push_name ?? msg.from_id });
  const actorId = aliasMatch?.principal_id ?? null;

  // 2. Insert l0_artifact (idempotent via partial unique index from migration 012)
  const sha256 = msg.media?.sha256 ?? `gowa:${msg.id}`;
  const bytes = msg.media?.bytes ?? (msg.text ? new TextEncoder().encode(msg.text).length : 0);
  const sourceUri = msg.media?.url ?? `gowa://${gowaDeviceId}/message/${msg.id}`;
  const inlineText = msg.message_type === 'text' ? (msg.text ?? '') : null;

  const l0Insert = await db.from('l0_artifacts').insert({
    tenant_id: tenantId,
    source_type: 'whatsapp_message_live',
    source_uri: sourceUri,
    sha256,
    bytes,
    origin_at: msg.timestamp,
    captured_at: new Date().toISOString(),
    inline_text: inlineText,
    metadata: {
      gowa_message_id: msg.id,
      gowa_device_id: gowaDeviceId,
      chat_id: msg.chat_id,
      from_id: msg.from_id,
      from_me: !!msg.from_me,
      push_name: msg.push_name ?? null,
      message_type: msg.message_type,
      is_group: !!msg.is_group,
      group_id: msg.group_id ?? null,
      group_subject: msg.group_subject ?? null,
      media: msg.media ?? null,
      quoted_message_id: msg.quoted_message_id ?? null,
      mentions: msg.mentions ?? [],
    },
  }).select('id').single();

  let l0Id: string;
  if (l0Insert.error) {
    if (l0Insert.error.code === '23505') {
      // Already exists — fetch existing
      const { data } = await db
        .from('l0_artifacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('metadata->>gowa_message_id', msg.id)
        .single();
      if (!data) throw new Error('l0 idempotency conflict but no existing row found');
      l0Id = data.id as string;
    } else {
      throw new Error(`l0 insert: ${l0Insert.error.message}`);
    }
  } else {
    l0Id = l0Insert.data!.id as string;
  }

  // 3. Branch by modality
  if (msg.message_type === 'text') {
    const { data: l1Row, error: l1Err } = await db.from('l1_events').insert({
      tenant_id: tenantId,
      artifact_id: l0Id,
      extraction_run_id: null,
      facet: 'messages',
      event_at: msg.timestamp,
      position: 0,
      actor_id: actorId,
      channel_id: channelId,
      modality: 'text',
      content: msg.text ?? '',
      confidence: 1.0,
      extraction_method: 'whatsapp-message-live@v0.1',
      metadata: {
        gowa_message_id: msg.id,
        gowa_device_id: gowaDeviceId,
        push_name: msg.push_name ?? null,
        from_me: !!msg.from_me,
        chat_id: msg.chat_id,
        quoted_message_id: msg.quoted_message_id ?? null,
        alias_match: aliasMatch ? { type: aliasMatch.match_type, alias: aliasMatch.matched_alias } : null,
      },
    }).select('id').single();

    if (l1Err && l1Err.code !== '23505') {
      throw new Error(`l1 insert: ${l1Err.message}`);
    }
    return {
      l0_artifact_id: l0Id,
      l1_event_id: (l1Row?.id as string | undefined),
      needs_extraction: false,
      resolved_actor_id: actorId,
    };
  }

  // Media → caller fires the extractor (extract-attachment trigger task)
  return {
    l0_artifact_id: l0Id,
    needs_extraction: true,
    resolved_actor_id: actorId,
  };
}
