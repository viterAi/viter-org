/**
 * ConversationView — center pane content.
 *
 * Server component. Loads the initial messages and hands them to
 * MessageStream (client) which renders bubbles + maintains the realtime
 * subscription. Bubble rendering moved entirely to the client so that
 * derivations arriving via realtime can attach to their parent in place
 * (no router.refresh).
 */

import { Composer } from './Composer';
import { MessageStream } from './MessageStream';
import { loadMessages } from '@/lib/chat/queries';
import type { Channel } from '@/lib/chat/types';

interface ConversationViewProps {
  channel: Channel;
}

export async function ConversationView({ channel }: ConversationViewProps) {
  const initialMessages = await loadMessages(channel.id);

  const cleanName = (channel.display_name ?? channel.identifier).replace(/^WhatsApp · /, '');
  const isGroup = (channel.metadata as { is_group?: boolean }).is_group === true;
  const renderableCount = initialMessages.filter(
    (m) => m.facet !== 'transcription' && m.facet !== 'image_caption' && m.facet !== 'doc_text',
  ).length;

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
          {renderableCount} messages
        </div>
      </div>

      {/* Scrollable message stream */}
      <div className="chat-bg chat-scroll min-h-0 flex-1 overflow-y-auto">
        <MessageStream channelId={channel.id} initialMessages={initialMessages} />
      </div>

      <Composer channelId={channel.id} targetLabel={cleanName} />
    </div>
  );
}
