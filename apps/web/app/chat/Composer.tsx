'use client';

/**
 * Composer — text input at the bottom of the conversation. Calls the
 * sendChatMessage server action; the optimistic l1_event insert there
 * means RealtimeStream will paint the bubble within ~100ms (or sooner,
 * since revalidatePath also re-renders the SSR list).
 *
 * Phase 3: text-only. Voice/image/file follow in Phase 4 (the L1 substrate
 * already supports them — only the input UX is missing).
 */

import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { sendChatMessage } from './actions';

interface ComposerProps {
  channelId: string;
  /** human-readable target, shown in the placeholder */
  targetLabel: string;
}

export function Composer({ channelId, targetLabel }: ComposerProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  function send() {
    const value = text.trim();
    if (!value || pending) return;
    setError(null);
    setText('');
    startTransition(async () => {
      const res = await sendChatMessage(channelId, value);
      if (!res.ok) {
        setError(res.error ?? 'send failed');
        setText(value);
      }
    });
    // Refocus for fast typing
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send; Shift+Enter for newline (whatsapp-web behavior)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      {error && (
        <div className="mb-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message ${targetLabel}…`}
          rows={1}
          disabled={pending}
          className="min-h-[40px] max-h-[160px] flex-1 resize-none rounded-2xl bg-zinc-100 px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none ring-emerald-600/20 focus:ring-2 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || text.trim().length === 0}
          aria-label="Send message"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-800 disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-500"
        >
          {pending ? (
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3.4 20.4 21 12 3.4 3.6 3 10.5l11 1.5-11 1.5z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
