/**
 * MessageBubble — single chat bubble.
 *
 * Renders text plus modality-specific affordances (voice/image/file
 * placeholder). Below the bubble we show transcript chip if a
 * transcription event arrived for the same artifact.
 *
 * Phase 1: we don't fetch media bytes; voice/image/file bubbles show a
 * placeholder + filename if available. The transcription companion (when
 * present) appears as an italic block under the bubble.
 */

import type { MessageEvent } from '@/lib/chat/types';

interface BubbleProps {
  message: MessageEvent;
  /** Whether to show the sender's push_name above this bubble (true on first
   *  message of a sender-run inside a date block). */
  showSender: boolean;
  /** Whether this bubble is the last in its run (for tail/rounding). */
  isTail: boolean;
  /** Transcription companion event for the same artifact, if any. */
  transcript?: MessageEvent | undefined;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
}

function modalityLabel(m: MessageEvent): string | null {
  switch (m.modality) {
    case 'voice': {
      const dur = (m.metadata.duration_s as number | undefined) ?? null;
      return dur ? `🎙️ Voice · ${Math.round(dur)}s` : '🎙️ Voice note';
    }
    case 'image': return '🖼️ Image';
    case 'file': {
      const fn = (m.metadata.filename as string | undefined) ?? '';
      return fn ? `📎 ${fn}` : '📎 File';
    }
    default: return null;
  }
}

/** Returns the l0_artifact id of the actual media bytes for this event. */
function mediaArtifactId(m: MessageEvent): string | null {
  const attached = m.metadata.attachment_artifact_ids as string[] | undefined;
  if (attached && attached.length > 0) return attached[0]!;
  return m.artifact_id;
}

export function MessageBubble({ message, showSender, isTail, transcript }: BubbleProps) {
  const fromMe = message.from_me;
  const placeholderLabel = modalityLabel(message);
  const hasText = !!message.content && message.modality === 'text';
  const ack = message.metadata.last_ack as string | undefined;
  const mediaId = mediaArtifactId(message);
  const showImage = message.modality === 'image' && mediaId;
  const showAudio = message.modality === 'voice' && mediaId;
  const filename = (message.metadata.filename as string | undefined)
    ?? (message.metadata.attachment_filenames as string[] | undefined)?.[0];
  const showFile = message.modality === 'file' && mediaId;
  const caption = (message.metadata.caption as string | undefined)
    ?? (hasText ? null : (message.content || null));

  // 2-col layout: media on the left, L1-derived text companion on the right.
  // Voice → audio + transcript. Image → image + caption (or future OCR/L1
  // image_caption facet). Bubble grows wider when companion is present.
  const companionText = (showAudio && transcript?.content) || (showImage && caption)
    ? (showAudio ? transcript!.content : caption)
    : null;
  const isTwoCol = !!companionText;

  return (
    <div className={`flex w-full ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col gap-0.5 ${isTwoCol ? 'max-w-[92%]' : 'max-w-[75%]'}`}>
        {showSender && !fromMe && message.push_name && (
          <span className="ml-3 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            {message.push_name}
          </span>
        )}

        <div
          className={`relative px-3 py-2 text-sm leading-snug shadow-sm
            ${fromMe
              ? 'rounded-2xl bg-emerald-100 text-zinc-900 dark:bg-emerald-900/50 dark:text-emerald-50'
              : 'rounded-2xl bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'}
            ${isTail
              ? (fromMe ? 'rounded-br-sm' : 'rounded-bl-sm')
              : ''}
          `}
        >
          {isTwoCol ? (
            <div className="grid grid-cols-[180px_1fr] gap-3 sm:grid-cols-[220px_1fr]">
              {/* Left: media */}
              <div className="min-w-0">
                {showImage && (
                  <a href={`/api/media/${mediaId}`} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${mediaId}`}
                      alt={filename ?? 'image'}
                      className="h-44 w-full rounded-lg object-cover"
                      loading="lazy"
                    />
                  </a>
                )}
                {showAudio && (
                  <audio src={`/api/media/${mediaId}`} controls preload="none" className="w-full" />
                )}
              </div>

              {/* Right: L1 text companion */}
              <div className="min-w-0 self-start border-l border-black/5 pl-3 dark:border-white/10">
                <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {showAudio ? (
                    <>
                      <span>📝 transcript</span>
                      {transcript?.metadata.model_used && (
                        <span className="ml-auto opacity-60">{(transcript.metadata.model_used as string).split('/').pop()}</span>
                      )}
                    </>
                  ) : (
                    <span>💬 caption</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-800 dark:text-zinc-100">
                  {companionText}
                </p>
              </div>
            </div>
          ) : (
            <>
              {showImage && (
                <a
                  href={`/api/media/${mediaId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block -mx-1 -mt-1 mb-1"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/media/${mediaId}`}
                    alt={filename ?? 'image'}
                    className="max-h-80 w-full rounded-lg object-cover"
                    loading="lazy"
                  />
                </a>
              )}

              {showAudio && (
                <audio
                  src={`/api/media/${mediaId}`}
                  controls
                  preload="none"
                  className="my-0.5 w-full max-w-xs"
                />
              )}

              {showFile && (
                <a
                  href={`/api/media/${mediaId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="my-0.5 flex items-center gap-2 rounded-md bg-zinc-100 px-2 py-1.5 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                >
                  <span className="text-base">📎</span>
                  <span className="truncate text-xs">{filename ?? 'File'}</span>
                </a>
              )}

              {hasText && (
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              )}

              {!hasText && !showImage && !showAudio && !showFile && placeholderLabel && (
                <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
                  <span className="text-base">{placeholderLabel}</span>
                </div>
              )}
            </>
          )}

          {/* Footer: time + ack ticks */}
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
            {(message.metadata.is_edited as boolean | undefined) && (
              <span className="italic">edited</span>
            )}
            <span>{fmtTime(message.event_at)}</span>
            {fromMe && ack && (
              <span title={`ack: ${ack}`} className={ack === 'read' || ack === 'played' ? 'text-sky-500' : ''}>
                {ack === 'pending' ? '🕘' : ack === 'server' ? '✓' : ack === 'delivery' ? '✓✓' : '✓✓'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
