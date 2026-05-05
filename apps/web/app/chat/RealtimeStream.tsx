'use client';

/**
 * RealtimeStream — client component that wraps the bubble list and
 * subscribes to new l1_events for the active channel.
 *
 * Receives the initial server-rendered bubble HTML as `initialContent`
 * (so the first paint is instant) plus a list of message ids already
 * rendered (to dedupe). Then opens a postgres_changes subscription
 * filtered by channel_id and prepends new bubbles below.
 *
 * Auto-scrolls to bottom on first mount + on each new message UNLESS
 * the user has scrolled up — then shows a "↓ N new" pill.
 */

import { useEffect, useRef, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import type { MessageEvent } from '@/lib/chat/types';
import { getBrowserClient } from '@/lib/supabase/browser';

interface RealtimeStreamProps {
  channelId: string;
  /** Server-rendered initial messages — already grouped/displayed above this component. */
  initialIds: string[];
}

export function RealtimeStream({ channelId, initialIds }: RealtimeStreamProps) {
  const [newMessages, setNewMessages] = useState<MessageEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const seenIds = useRef<Set<string>>(new Set(initialIds));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickyBottomRef = useRef(true);

  // Detect whether the user is at the bottom of the scroll container
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

  // Open the realtime subscription
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
          if (!['messages', 'transcription', 'reaction', 'edit'].includes(row.facet as string)) return;
          seenIds.current.add(id);

          const meta = (row.metadata ?? {}) as Record<string, unknown>;
          const m: MessageEvent = {
            id,
            event_at: row.event_at as string,
            facet: row.facet as string,
            modality: row.modality as string,
            content: (row.content as string | null) ?? null,
            channel_id: row.channel_id as string,
            artifact_id: (row.artifact_id as string | null) ?? null,
            metadata: meta,
            from_me: (meta as { from_me?: boolean }).from_me === true,
            push_name: ((meta as { push_name?: string }).push_name) ?? null,
          };

          setNewMessages((prev) => [...prev, m]);
          if (!stickyBottomRef.current) {
            setUnread((n) => n + 1);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelId]);

  // Auto-scroll to bottom when sticky
  useEffect(() => {
    if (!stickyBottomRef.current) return;
    const scroller = document.querySelector<HTMLElement>('.chat-scroll');
    if (!scroller) return;
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  }, [newMessages.length]);

  // Don't render transcripts as separate bubbles — fold them into the
  // matching parent message inline.
  const transcriptIdx = new Map<string, MessageEvent>();
  const renderable: MessageEvent[] = [];
  for (const m of newMessages) {
    if (m.facet === 'transcription' && m.artifact_id) {
      transcriptIdx.set(m.artifact_id, m);
    } else {
      renderable.push(m);
    }
  }

  if (newMessages.length === 0 && unread === 0) return null;

  return (
    <>
      <div ref={containerRef} className="space-y-1">
        {renderable.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            showSender={i === 0 || renderable[i - 1]?.from_me !== m.from_me}
            isTail
            transcript={m.artifact_id ? transcriptIdx.get(m.artifact_id) : undefined}
          />
        ))}
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
