/**
 * ConversationView — center pane content.
 *
 * Server component. Pulls messages, groups by day, renders bubbles with
 * sender labels on first-of-run, attaches transcript companions to voice.
 */

import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { RealtimeStream } from './RealtimeStream';
import { groupByDay, groupConsecutive, loadMessages } from '@/lib/chat/queries';
import type { Channel, MessageEvent } from '@/lib/chat/types';

interface ConversationViewProps {
  channel: Channel;
}

/**
 * Build a lookup: artifact_id → derived L1 event (transcription /
 * image_caption / doc_text). These L1s are *derived* from an L0 (vs the
 * source L1 that IS the message). They render as companions to their
 * parent media bubble, never standalone.
 */
function buildDerivedL1Index(messages: MessageEvent[]): Map<string, MessageEvent> {
  const idx = new Map<string, MessageEvent>();
  for (const m of messages) {
    if (
      (m.facet === 'transcription' || m.facet === 'image_caption' || m.facet === 'doc_text') &&
      m.artifact_id
    ) {
      idx.set(m.artifact_id, m);
    }
  }
  return idx;
}

function pickRenderable(messages: MessageEvent[]): MessageEvent[] {
  // Drop derived-L1 rows — they appear as companions under their parent
  // media bubble, not as standalone bubbles.
  return messages.filter((m) =>
    m.facet !== 'transcription' && m.facet !== 'image_caption' && m.facet !== 'doc_text',
  );
}

export async function ConversationView({ channel }: ConversationViewProps) {
  const messages = await loadMessages(channel.id);
  const derivedIdx = buildDerivedL1Index(messages);
  const renderable = pickRenderable(messages);
  const blocks = groupByDay(renderable);

  const cleanName = (channel.display_name ?? channel.identifier).replace(/^WhatsApp · /, '');
  const isGroup = (channel.metadata as { is_group?: boolean }).is_group === true;

  return (
    <div className="flex h-full flex-col">
      {/* Conversation header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-sm font-semibold text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
          {cleanName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 2) || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{cleanName}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {channel.kind} · <code className="font-mono">{channel.identifier}</code>
            {isGroup && <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800">group</span>}
          </p>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {renderable.length} messages
        </div>
      </div>

      {/* Scrollable message stream */}
      <div className="chat-bg chat-scroll min-h-0 flex-1 overflow-y-auto">
        {blocks.length === 0 ? (
          <div className="mx-auto max-w-3xl px-4 py-6">
            <div className="rounded-md bg-white/60 px-4 py-6 text-center text-sm text-zinc-700 shadow-sm dark:bg-zinc-900/60 dark:text-zinc-400">
              No messages in this channel yet — waiting for the first WhatsApp event.
            </div>
            <RealtimeStream channelId={channel.id} initialIds={[]} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-1 px-4 py-6">
            {blocks.map((block) => (
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
            ))}
            <RealtimeStream
              channelId={channel.id}
              initialIds={renderable.map((m) => m.id)}
            />
          </div>
        )}
      </div>

      <Composer channelId={channel.id} targetLabel={cleanName} />
    </div>
  );
}
