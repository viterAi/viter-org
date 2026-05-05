'use server';

/**
 * Server action: send a text message via GOWA, then write the optimistic
 * l0_artifact + l1_event so the bubble appears immediately on the client.
 *
 * GOWA echoes the message back through the webhook within ~500ms. The
 * webhook insert is idempotent on (tenant_id, gowa_message_id) — see
 * migration 012 — so the echo is a no-op if our optimistic row got there
 * first. The Realtime subscription picks up either source.
 */

import { revalidatePath } from 'next/cache';
import { getCurrentTenantId, getServiceRoleClient } from '@/lib/supabase/server';
import { getGowaClient } from '@/lib/gowa';

export interface SendResult {
  ok: boolean;
  message_id?: string;
  error?: string;
}

export async function sendChatMessage(channelId: string, text: string): Promise<SendResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'empty message' };

  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  // 1. Resolve channel — need the GOWA chat_id (e.g. '972524814613@s.whatsapp.net')
  const { data: channel } = await db
    .from('channels')
    .select('id, identifier, kind, metadata')
    .eq('tenant_id', tenantId)
    .eq('id', channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: 'channel not found' };
  if (channel.kind !== 'whatsapp') return { ok: false, error: 'only whatsapp channels are sendable in v0.1' };

  const meta = (channel.metadata ?? {}) as { chat_id?: string; is_group?: boolean };
  const chatId = meta.chat_id ?? slugToChatId(channel.identifier as string);
  if (!chatId) return { ok: false, error: 'cannot derive chat_id from channel' };

  // 2. Pick a linked device to send from. v0.1: any device for this tenant.
  const { data: device } = await db
    .from('whatsapp_devices')
    .select('id, gowa_device_id, phone_number, metadata')
    .eq('tenant_id', tenantId)
    .eq('status', 'linked')
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!device) return { ok: false, error: 'no linked WhatsApp device — pair one in /settings/whatsapp' };

  // gowa_device_id stores the JID (used for webhook lookup); REST API needs
  // the GOWA UUID, kept in metadata.gowa_uuid. Older rows may have UUID in
  // gowa_device_id directly.
  const dmeta = (device.metadata ?? {}) as { gowa_uuid?: string };
  const gowaRestId = dmeta.gowa_uuid ?? (isUuid(device.gowa_device_id as string) ? (device.gowa_device_id as string) : null);
  if (!gowaRestId) return { ok: false, error: 'device has no gowa_uuid — re-pair via /settings/whatsapp' };

  // 3. Fire GOWA send
  let send;
  try {
    const gowa = getGowaClient();
    send = await gowa.sendText(gowaRestId, { phone: chatId, message: trimmed });
  } catch (err) {
    return { ok: false, error: `gowa send failed: ${(err as Error).message}` };
  }
  if (send.status === 'failed') return { ok: false, error: send.error ?? 'gowa returned failed' };

  // 4. Optimistic l0_artifact + l1_event. Idempotent on (tenant, gowa_message_id).
  const sourceUri = `gowa://${device.gowa_device_id}/message/${send.message_id}`;
  const sha256 = `gowa:${send.message_id}`;

  const { data: l0Row, error: l0Err } = await db
    .from('l0_artifacts')
    .insert({
      tenant_id: tenantId,
      source_type: 'whatsapp_message_live',
      source_uri: sourceUri,
      sha256,
      bytes: new TextEncoder().encode(trimmed).length,
      origin_at: send.timestamp,
      captured_at: new Date().toISOString(),
      inline_text: trimmed,
      metadata: {
        gowa_message_id: send.message_id,
        gowa_device_id: device.gowa_device_id,
        gowa_uuid: gowaRestId,
        chat_id: chatId,
        chat_slug: channel.identifier,
        from_me: true,
        message_type: 'text',
        is_group: meta.is_group === true,
        sent_via: 'apps/web/composer',
      },
    })
    .select('id')
    .single();

  // 23505 = unique-violation: webhook already wrote this. Resolve and continue.
  let l0Id: string | undefined = l0Row?.id as string | undefined;
  if (l0Err) {
    if (l0Err.code === '23505') {
      const { data: existing } = await db
        .from('l0_artifacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('metadata->>gowa_message_id', send.message_id)
        .maybeSingle();
      l0Id = existing?.id as string | undefined;
    } else {
      return { ok: false, error: `l0 insert failed: ${l0Err.message}`, message_id: send.message_id };
    }
  }
  if (!l0Id) return { ok: false, error: 'l0 row missing after insert', message_id: send.message_id };

  const { error: l1Err } = await db
    .from('l1_events')
    .insert({
      tenant_id: tenantId,
      artifact_id: l0Id,
      extraction_run_id: null,
      facet: 'messages',
      event_at: send.timestamp,
      position: 0,
      channel_id: channelId,
      modality: 'text',
      content: trimmed,
      confidence: 1.0,
      extraction_method: 'composer@v0.1',
      metadata: {
        gowa_message_id: send.message_id,
        gowa_device_id: device.gowa_device_id,
        from_me: true,
        chat_id: chatId,
        push_name: 'me',
      },
    });
  if (l1Err && l1Err.code !== '23505') {
    return { ok: false, error: `l1 insert failed: ${l1Err.message}`, message_id: send.message_id };
  }

  revalidatePath(`/chat/${channel.identifier}`);
  return { ok: true, message_id: send.message_id };
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Inverse of chatIdToSlug — fall back when channel.metadata.chat_id is missing. */
function slugToChatId(slug: string): string | null {
  if (slug.startsWith('wa-group-')) {
    return `${slug.slice('wa-group-'.length)}@g.us`;
  }
  if (slug.startsWith('wa-')) {
    return `${slug.slice('wa-'.length)}@s.whatsapp.net`;
  }
  return null;
}
