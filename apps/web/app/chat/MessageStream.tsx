'use client';

/**
 * MessageStream — client-side bubble list with realtime attach-in-place.
 *
 * Replaces the prior split between server-rendered bubbles + a tail-only
 * RealtimeStream. The split forced a router.refresh() whenever a derivation
 * (transcription / image_caption / doc_text) arrived for an SSR'd parent —
 * heavy and lossy (scroll position, focus).
 *
 * This unified component:
 *   1. Receives the initial messages from the server (still loaded via the
 *      RSC, so first paint is fast and SEO-friendly)
 *   2. Holds them in client state alongside any new messages from realtime
 *   3. Maintains a single derivation map keyed by artifact_id — covers BOTH
 *      SSR'd bubbles AND newly-arrived ones
 *   4. When a derivation event lands, updates the map; React re-renders the
 *      affected bubble in place. No refresh, no scroll jump.
 *
 * Auto-scroll behavior matches the prior RealtimeStream: stick to bottom
 * unless the user scrolls up, then show "↓ N new" pill.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { groupByDay, groupConsecutive } from '@/lib/chat/format';
import { getBrowserClient } from '@/lib/supabase/browser';
import type { MessageEvent } from '@/lib/chat/types';

interface MessageStreamProps {
  channelId: string;
  initialMessages: MessageEvent[];
}

const DERIVED_FACETS = new Set(['transcription', 'image_caption', 'doc_text']);
const RENDER_FACETS = new Set(['messages', 'transcription', 'reaction', 'edit', 'image_caption', 'doc_text']);

function isDerived(facet: string): boolean {
  return DERIVED_FACETS.has(facet);
}

function rowToMessage(row: Record<string, unknown>): MessageEvent {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const fromMe = (meta as { from_me?: boolean }).from_me === true;
  const rawPush = (meta as { push_name?: string }).push_name ?? null;
  const senderRaw = (meta as { sender_raw?: string }).sender_raw ?? null;
  const pushName = rawPush ?? senderRaw ?? (fromMe ? 'Mordechai' : null);
  return {
    id: row.id as string,
    event_at: row.event_at as string,
    facet: row.facet as string,
    modality: row.modality as string,
    content: (row.content as string | null) ?? null,
    channel_id: row.channel_id as string,
    artifact_id: (row.artifact_id as string | null) ?? null,
    metadata: meta,
    from_me: fromMe,
    push_name: pushName,
  };
}

export function MessageStream({ channelId, initialMessages }: MessageStreamProps) {
  // Single source of truth for both initial-load and realtime-arrived messages.
  const [messages, setMessages] = useState<MessageEvent[]>(initialMessages);
  const [unread, setUnread] = useState(0);
  const seenIds = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  const stickyBottomRef = useRef(true);

  // Stick-to-bottom detection
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.chat-scroll');
    if (!scroller) return;
    const onScroll = () => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickyBottomRef.current = distance < 80;
      if (stickyBottomRef.current) setUnread(0);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // Realtime subscription — every l1_events INSERT for this channel.
  // Both 'messages' (parent) and derived ('transcription' / 'image_caption' /
  // 'doc_text') flow through the same path; React re-derives the rendering
  // because both update `messages`.
  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`l1-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'l1_events', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const id = row.id as string;
          if (seenIds.current.has(id)) return;
          if (!RENDER_FACETS.has(row.facet as string)) return;
          seenIds.current.add(id);

          const m = rowToMessage(row);
          setMessages((prev) => {
            // Insert in event_at order so derivations that arrive with an
            // earlier timestamp than newer messages stay positioned correctly.
            // For derivations, position doesn't matter for the rendered output
            // (they fold into their parent), but we keep the array clean.
            const next = [...prev, m];
            next.sort((a, b) => a.event_at.localeCompare(b.event_at));
            return next;
          });

          if (!isDerived(m.facet) && !stickyBottomRef.current) {
            setUnread((n) => n + 1);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelId]);

  // Auto-scroll on new messages when sticky
  useEffect(() => {
    if (!stickyBottomRef.current) return;
    const scroller = document.querySelector<HTMLElement>('.chat-scroll');
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  }, [messages.length]);

  // Build the derivation map fresh from messages every render. Cheap (O(n))
  // and avoids stale-state bugs that an incrementally-maintained map would
  // be vulnerable to.
  const { renderable, derivedIdx } = useMemo(() => {
    const idx = new Map<string, MessageEvent>();
    const rest: MessageEvent[] = [];
    for (const m of messages) {
      if (isDerived(m.facet) && m.artifact_id) {
        idx.set(m.artifact_id, m);
      } else {
        rest.push(m);
      }
    }
    return { renderable: rest, derivedIdx: idx };
  }, [messages]);

  const blocks = useMemo(() => groupByDay(renderable), [renderable]);

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-1 px-4 py-6">
        {blocks.length === 0 ? (
          <div className="rounded-md bg-white/60 px-4 py-6 text-center text-sm text-zinc-700 shadow-sm dark:bg-zinc-900/60 dark:text-zinc-400">
            No messages in this channel yet — waiting for the first WhatsApp event.
          </div>
        ) : (
          blocks.map((block) => (
            <div key={block.dayKey} className="mb-4">
              <div className="my-3 flex justify-center">
                <span className="rounded-full bg-white/70 px-3 py-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-600 shadow-sm backdrop-blur dark:bg-zinc-900/70 dark:text-zinc-300">
                  {block.dayLabel}
                </span>
              </div>
              {groupConsecutive(block.messages).map((run, runIdx) => (
                <div key={runIdx} className="mb-2 space-y-0.5">
                  {run.map((m, i) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      showSender={i === 0}
                      isTail={i === run.length - 1}
                      transcript={m.artifact_id ? derivedIdx.get(m.artifact_id) : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {unread > 0 && (
        <button
          onClick={() => {
            const scroller = document.querySelector<HTMLElement>('.chat-scroll');
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
            setUnread(0);
          }}
          className="fixed bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          ↓ {unread} new {unread === 1 ? 'message' : 'messages'}
        </button>
      )}
    </>
  );
}
