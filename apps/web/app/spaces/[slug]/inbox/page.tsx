/**
 * /spaces/[slug]/inbox — live message stream for a single channel.
 *
 * Server-rendered list of recent l1_events filtered by channel. Aligned
 * with Yitzchak's May 3 wireframe ("spaces are aggregated views of the
 * sources"). v0.1 = static-rendered with manual refresh; v0.2 will add
 * Supabase Realtime subscription for live updates.
 */

import { getServiceRoleClient, getCurrentTenantId } from '@/lib/supabase/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface MessageRow {
  id: string;
  event_at: string;
  facet: string;
  modality: string;
  content: string | null;
  metadata: Record<string, unknown>;
  channel_kind: string;
  channel_identifier: string;
  channel_display: string | null;
  actor_display: string | null;
}

async function getRecentEvents(channelSlug: string, limit = 100): Promise<MessageRow[]> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  const { data: channel } = await db
    .from('channels')
    .select('id, kind, identifier, display_name')
    .eq('tenant_id', tenantId)
    .eq('identifier', channelSlug)
    .single();
  if (!channel) return [];

  const { data: events, error } = await db
    .from('l1_events')
    .select('id, event_at, facet, modality, content, metadata, actor_id')
    .eq('channel_id', channel.id)
    .in('facet', ['messages', 'transcription'])
    .order('event_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  // Best-effort actor resolution
  const actorIds = [...new Set((events ?? []).map((e) => e.actor_id).filter(Boolean) as string[])];
  const actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: principals } = await db.from('principals').select('id, display_name').in('id', actorIds);
    for (const p of principals ?? []) actorMap.set(p.id as string, p.display_name as string);
  }

  return (events ?? []).map((e) => ({
    id: e.id as string,
    event_at: e.event_at as string,
    facet: e.facet as string,
    modality: e.modality as string,
    content: e.content as string | null,
    metadata: (e.metadata ?? {}) as Record<string, unknown>,
    channel_kind: channel.kind as string,
    channel_identifier: channel.identifier as string,
    channel_display: channel.display_name as string | null,
    actor_display: e.actor_id
      ? actorMap.get(e.actor_id as string) ?? null
      : ((e.metadata as { push_name?: string })?.push_name ?? null),
  }));
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
       + ' · ' + new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export default async function InboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const events = await getRecentEvents(slug);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">space · inbox</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {events[0]?.channel_display ?? slug}
          </h1>
        </div>
        <Link
          href="/settings/whatsapp"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Manage devices
        </Link>
      </header>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          No events yet for channel <code className="font-mono">{slug}</code>.
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => {
            const isFromMe = (e.metadata as { from_me?: boolean }).from_me === true;
            return (
              <li key={e.id} className={`flex flex-col gap-1 rounded-lg border p-3 ${
                isFromMe
                  ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40'
                  : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
              }`}>
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {isFromMe ? 'you' : e.actor_display ?? 'unknown'}
                  </span>
                  <span className="flex items-center gap-2">
                    <span>{e.modality}</span>
                    <span>·</span>
                    <span>{e.facet}</span>
                    <span>·</span>
                    <span>{fmtTime(e.event_at)}</span>
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-zinc-900 dark:text-zinc-100">
                  {e.content ?? <em className="text-zinc-500">— no content —</em>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
