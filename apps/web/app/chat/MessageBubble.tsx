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
import { ExpandableText } from './ExpandableText';

interface BubbleProps {
  message: MessageEvent;
  /** Whether to show the sender's push_name above this bubble (true on first
   *  message of a sender-run inside a date block). */
  showSender: boolean;
  /** Whether this bubble is the last in its run (for tail/rounding). */
  isTail: boolean;
  /**
   * Derived-L1 companion for the same artifact_id (transcription for voice,
   * image_caption for image, doc_text for file). Renders as an italic
   * "✨ derived" block, distinct from verbatim caption text.
   */
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

  // Voice notes: 2-col with the transcript on the right (transcripts are
  // usually 1–3 lines, fits naturally). Images: stacked — image on top
  // full-width, caption + derived L1 below.
  const isTranscription = transcript?.facet === 'transcription';
  const isImageCaption = transcript?.facet === 'image_caption';
  const isDocText = transcript?.facet === 'doc_text';
  const transcriptText = showAudio && isTranscription && transcript?.content ? transcript.content : null;
  const imageDerived = showImage && isImageCaption && transcript?.content ? transcript.content : null;
  const fileDerived = showFile && isDocText && transcript?.content ? transcript.content : null;
  const captionText = showImage ? (caption?.trim() || null) : null;
  const useTwoCol = !!transcriptText;
  const wideBubble = useTwoCol || showImage;

  // "Awaiting derivation" placeholder: voice/image without a derived
  // companion AND younger than 5 minutes shows a transcribing/processing
  // state. Older = derivation likely failed or won't happen; stay quiet.
  const ageMs = Date.now() - new Date(message.event_at).getTime();
  const youngEnough = ageMs < 5 * 60_000;
  const showAudioPending = showAudio && !transcriptText && youngEnough;
  const showImagePending = showImage && !imageDerived && youngEnough;

  // Provenance for the derived companion (transcription / image_caption /
  // doc_text). Distinct from VERBATIM caption text from WhatsApp.
  const derivedFacet = transcript?.facet ?? null;
  const derivedLabel = derivedFacet === 'transcription' ? 'transcription'
    : derivedFacet === 'image_caption' ? 'vision · OCR'
    : derivedFacet === 'doc_text' ? 'document text'
    : 'derived';
  const derivedModel = typeof transcript?.metadata.model_used === 'string'
    ? transcript.metadata.model_used.split('/').pop()
    : null;
  const derivedMethod = typeof transcript?.metadata.extraction_method === 'string'
    ? transcript.metadata.extraction_method
    : null;

  return (
    <div className={`flex w-full ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col gap-0.5 ${wideBubble ? 'max-w-[80%]' : 'max-w-[75%]'}`}>
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
          {useTwoCol ? (
            // Voice + transcript: 2-col, audio left, transcript right.
            // Transcript is DERIVED from L0 audio → italic + provenance header.
            <div className="grid grid-cols-[200px_1fr] gap-3 sm:grid-cols-[240px_1fr]">
              <div className="min-w-0 self-center">
                <audio src={`/api/media/${mediaId}`} controls preload="none" className="w-full" />
              </div>
              <div className="min-w-0 self-center border-l-2 border-dashed border-amber-300/60 pl-3 dark:border-amber-700/60">
                <div
                  className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
                  title={derivedMethod ? `extraction_method: ${derivedMethod}` : undefined}
                >
                  <span>✨ derived · {derivedLabel}</span>
                  {derivedModel && <span className="ml-auto opacity-70">{derivedModel}</span>}
                </div>
                <ExpandableText
                  text={transcriptText!}
                  maxChars={300}
                  className="text-xs italic leading-relaxed text-zinc-700 dark:text-zinc-200"
                />
              </div>
            </div>
          ) : showImage ? (
            // Image: stacked. Image on top full-width, caption below.
            // Caption is VERBATIM from WhatsApp (the user's typed caption) —
            // plain styling, small "caption" prefix for context.
            <div className="flex flex-col gap-1.5">
              <a
                href={`/api/media/${mediaId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block -mx-1 -mt-1"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${mediaId}`}
                  alt={filename ?? 'image'}
                  className="max-h-96 w-full rounded-lg object-contain"
                  loading="lazy"
                />
              </a>
              {captionText && (
                <div>
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    caption · verbatim
                  </div>
                  <ExpandableText
                    text={captionText}
                    maxChars={240}
                    className="text-xs leading-relaxed text-zinc-800 dark:text-zinc-100"
                  />
                </div>
              )}
              {imageDerived && (
                <div className="border-l-2 border-dashed border-amber-300/60 pl-2 dark:border-amber-700/60">
                  <div
                    className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
                    title={derivedMethod ? `extraction_method: ${derivedMethod}` : undefined}
                  >
                    <span>✨ derived · {derivedLabel}</span>
                    {derivedModel && <span className="ml-auto opacity-70">{derivedModel}</span>}
                  </div>
                  <ExpandableText
                    text={imageDerived}
                    maxChars={240}
                    className="text-xs italic leading-relaxed text-zinc-700 dark:text-zinc-200"
                  />
                </div>
              )}
              {showImagePending && (
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-700/70 dark:text-amber-400/70">
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
                  <span>vision · OCR…</span>
                </div>
              )}
            </div>
          ) : (
            <>
              {showAudio && (
                <>
                  <audio
                    src={`/api/media/${mediaId}`}
                    controls
                    preload="none"
                    className="my-0.5 w-full max-w-xs"
                  />
                  {showAudioPending && (
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-700/70 dark:text-amber-400/70">
                      <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
                      <span>transcribing…</span>
                    </div>
                  )}
                </>
              )}

              {showFile && (
                <>
                  <a
                    href={`/api/media/${mediaId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="my-0.5 flex items-center gap-2 rounded-md bg-zinc-100 px-2 py-1.5 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                  >
                    <span className="text-base">📎</span>
                    <span className="truncate text-xs">{filename ?? 'File'}</span>
                  </a>
                  {fileDerived && (
                    <div className="mt-1 border-l-2 border-dashed border-amber-300/60 pl-2 dark:border-amber-700/60">
                      <div
                        className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
                        title={derivedMethod ? `extraction_method: ${derivedMethod}` : undefined}
                      >
                        <span>✨ derived · {derivedLabel}</span>
                        {derivedModel && <span className="ml-auto opacity-70">{derivedModel}</span>}
                      </div>
                      <ExpandableText
                        text={fileDerived}
                        maxChars={240}
                        className="text-xs italic leading-relaxed text-zinc-700 dark:text-zinc-200"
                      />
                    </div>
                  )}
                </>
              )}

              {hasText && (() => {
                // Standalone non-'messages' facets are derived from an L0
                // (image_caption, doc_text, transcription that escaped the
                // companion fold). Mark them visually.
                const isDerivedStandalone =
                  message.facet === 'image_caption' ||
                  message.facet === 'doc_text' ||
                  message.facet === 'transcription';
                if (!isDerivedStandalone) {
                  return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
                }
                const method = typeof message.metadata.extraction_method === 'string'
                  ? message.metadata.extraction_method
                  : null;
                const model = typeof message.metadata.model_used === 'string'
                  ? message.metadata.model_used.split('/').pop()
                  : null;
                return (
                  <div className="border-l-2 border-dashed border-amber-300/60 pl-2 dark:border-amber-700/60">
                    <div
                      className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
                      title={method ? `extraction_method: ${method}` : undefined}
                    >
                      <span>✨ derived · {message.facet.replace('_', ' ')}</span>
                      {model && <span className="ml-auto opacity-70">{model}</span>}
                    </div>
                    <p className="whitespace-pre-wrap break-words italic text-zinc-700 dark:text-zinc-200">
                      {message.content}
                    </p>
                  </div>
                );
              })()}

              {!hasText && !showAudio && !showFile && placeholderLabel && (
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
