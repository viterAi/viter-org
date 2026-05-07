'use client';

/**
 * MeetingL2Panel — collapsible L2 synthesis panel for meeting channels.
 *
 * Shows the LLM-generated meeting brief (decisions, action items, key moments)
 * at the top of the chat view. Collapsed by default after first read;
 * expands on click. The full transcript is still accessible below via
 * the MessageStream (L1 utterances).
 *
 * The body is markdown — rendered as plain text for now with whitespace
 * preservation. A future pass can add react-markdown.
 */

import { useState } from 'react';

interface MeetingL2PanelProps {
  body: string;
  generated_at: string;
  scope_key: string;
}

export function MeetingL2Panel({ body, generated_at, scope_key }: MeetingL2PanelProps) {
  const [expanded, setExpanded] = useState(true);

  const age = formatAge(generated_at);
  const label = scope_key.replace(/^meeting:/, '');

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20">
        {/* Header */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              L2 · Meeting brief
            </span>
            <span className="truncate text-[11px] font-mono text-zinc-500 dark:text-zinc-500">
              {label}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            <span>{age}</span>
            <span className="text-xs">{expanded ? '▲' : '▼'}</span>
          </div>
        </button>

        {/* Body */}
        {expanded && (
          <div className="border-t border-emerald-200 dark:border-emerald-900/50 px-4 py-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
              {body}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
