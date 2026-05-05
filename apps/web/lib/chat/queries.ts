/**
 * Server-side queries for the chat surface. All reads via service-role until
 * we wire auth (per the v0.1 single-tenant decision).
 */

import { getServiceRoleClient, getCurrentTenantId } from '@/lib/supabase/server';
import type { Channel, ChannelGroup, MessageEvent } from './types';

const KIND_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  meeting: 'Meetings',
  email: 'Email',
  'claude-code': 'Claude Code',
  'cursor': 'Cursor',
  'screenpipe-app': 'Screenpipe',
  'vita-chat': 'Vita Chat',
};

const KIND_ORDER = ['whatsapp', 'meeting', 'email', 'claude-code', 'cursor', 'screenpipe-app', 'vita-chat'];

/** Load all channels with their latest-message preview, grouped by kind. */
export async function loadChannelGroups(): Promise<ChannelGroup[]> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  const { data: channels, error } = await db
    .from('channels')
    .select('id, identifier, display_name, kind, metadata')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`channels: ${error.message}`);

  if (!channels || channels.length === 0) return [];

  // For each channel, fetch latest event (separate query for clarity; could
  // be folded into a single SQL with lateral joins later).
  const enriched: Channel[] = await Promise.all(
    channels.map(async (c) => {
      const { data: latest } = await db
        .from('l1_events')
        .select('event_at, content, modality, facet, metadata')
        .eq('channel_id', c.id)
        .in('facet', ['messages', 'transcription'])
        .order('event_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        id: c.id as string,
        identifier: c.identifier as string,
        display_name: c.display_name as string | null,
        kind: c.kind as string,
        metadata: (c.metadata ?? {}) as Record<string, unknown>,
        latest_event_at: (latest?.event_at as string | undefined) ?? null,
        latest_preview: latest ? buildPreview(latest as { content: string | null; modality: string; facet: string; metadata: Record<string, unknown> }) : null,
      };
    }),
  );

  // Group by kind
  const byKind = new Map<string, Channel[]>();
  for (const c of enriched) {
    if (!byKind.has(c.kind)) byKind.set(c.kind, []);
    byKind.get(c.kind)!.push(c);
  }

  // Sort channels within each group: latest first, then alphabetical
  for (const list of byKind.values()) {
    list.sort((a, b) => {
      if (a.latest_event_at && b.latest_event_at) return b.latest_event_at.localeCompare(a.latest_event_at);
      if (a.latest_event_at) return -1;
      if (b.latest_event_at) return 1;
      return (a.display_name ?? a.identifier).localeCompare(b.display_name ?? b.identifier);
    });
  }

  // Sort groups by KIND_ORDER, unknown kinds at end alphabetically
  const groups: ChannelGroup[] = [];
  for (const k of KIND_ORDER) {
    if (byKind.has(k)) groups.push({ kind: k, label: KIND_LABELS[k] ?? k, channels: byKind.get(k)! });
  }
  for (const k of [...byKind.keys()].sort()) {
    if (!KIND_ORDER.includes(k)) groups.push({ kind: k, label: KIND_LABELS[k] ?? k, channels: byKind.get(k)! });
  }

  return groups;
}

/** Build a preview string for the channel rail. */
function buildPreview(latest: { content: string | null; modality: string; facet: string; metadata: Record<string, unknown> }): string {
  if (latest.facet === 'transcription') {
    const text = latest.content?.trim() ?? '';
    return `🎙️ ${text.slice(0, 70)}${text.length > 70 ? '…' : ''}`;
  }
  if (latest.modality === 'voice') return '🎙️ Voice note';
  if (latest.modality === 'image') return '🖼️ Image';
  if (latest.modality === 'file') return '📎 File';
  const text = latest.content?.trim() ?? '';
  return text.slice(0, 90) + (text.length > 90 ? '…' : '');
}

/** Find a channel by URL slug (its identifier). */
export async function loadChannelBySlug(slug: string): Promise<Channel | null> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();
  const { data } = await db
    .from('channels')
    .select('id, identifier, display_name, kind, metadata')
    .eq('tenant_id', tenantId)
    .eq('identifier', slug)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    identifier: data.identifier as string,
    display_name: data.display_name as string | null,
    kind: data.kind as string,
    metadata: (data.metadata ?? {}) as Record<string, unknown>,
    latest_event_at: null,
    latest_preview: null,
  };
}

/** Load message events for a channel, oldest-first (for natural chat reading). */
export async function loadMessages(channelId: string, limit = 200): Promise<MessageEvent[]> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  const { data, error } = await db
    .from('l1_events')
    .select('id, event_at, facet, modality, content, channel_id, artifact_id, metadata')
    .eq('tenant_id', tenantId)
    .eq('channel_id', channelId)
    .in('facet', ['messages', 'transcription', 'reaction', 'edit', 'image_caption', 'doc_text'])
    .order('event_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`messages: ${error.message}`);

  // Reverse so the UI reads oldest → newest top-to-bottom
  const rows = (data ?? []).reverse();
  return rows.map((e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    return {
      id: e.id as string,
      event_at: e.event_at as string,
      facet: e.facet as string,
      modality: e.modality as string,
      content: e.content as string | null,
      channel_id: e.channel_id as string,
      artifact_id: e.artifact_id as string | null,
      metadata: meta,
      from_me: (meta as { from_me?: boolean }).from_me === true,
      push_name: (meta as { push_name?: string }).push_name ?? null,
    };
  });
}

/** Group messages by date, returning blocks separated by date dividers. */
export interface MessageBlock {
  dayKey: string;     // 'YYYY-MM-DD' UTC for sort
  dayLabel: string;   // 'Today' / 'Yesterday' / 'Mon, May 5'
  messages: MessageEvent[];
}

export function groupByDay(messages: MessageEvent[], tz = 'Asia/Jerusalem'): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const today = formatDayKey(new Date(), tz);
  const yesterday = formatDayKey(new Date(Date.now() - 86_400_000), tz);

  for (const m of messages) {
    const d = new Date(m.event_at);
    const dayKey = formatDayKey(d, tz);
    let block = blocks.find((b) => b.dayKey === dayKey);
    if (!block) {
      const dayLabel =
        dayKey === today ? 'Today' :
        dayKey === yesterday ? 'Yesterday' :
        d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
      block = { dayKey, dayLabel, messages: [] };
      blocks.push(block);
    }
    block.messages.push(m);
  }
  return blocks;
}

function formatDayKey(d: Date, tz: string): string {
  // YYYY-MM-DD in the given tz.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return parts;
}

/**
 * Group consecutive messages from the same sender into "bubble groups" so the
 * UI can show the sender label only on the first bubble of each run.
 */
export function groupConsecutive(messages: MessageEvent[]): MessageEvent[][] {
  const groups: MessageEvent[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && bubbleSiblings(last[last.length - 1]!, m)) {
      last.push(m);
    } else {
      groups.push([m]);
    }
  }
  return groups;
}

function bubbleSiblings(a: MessageEvent, b: MessageEvent): boolean {
  if (a.from_me !== b.from_me) return false;
  if ((a.push_name ?? '') !== (b.push_name ?? '')) return false;
  // Consecutive if within 2 minutes
  return new Date(b.event_at).getTime() - new Date(a.event_at).getTime() < 120_000;
}
