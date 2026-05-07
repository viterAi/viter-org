'use client';

/**
 * MeetingL2Panel — rendered L2 meeting brief above the transcript.
 *
 * Parses the YAML front matter into a stat bar, then renders the markdown
 * body with react-markdown. Collapsible — starts expanded.
 */

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface MeetingL2PanelProps {
  body: string;
  generated_at: string;
  scope_key: string;
}

interface FrontMatter {
  meeting?: string;
  speakers?: string;
  duration_min?: string;
  utterances?: string;
  decisions?: string;
  open_threads?: string;
}

function parseFrontMatter(body: string): { meta: FrontMatter; content: string } {
  const match = body.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: body };

  const yamlLines = (match[1] ?? '').split('\n');
  const meta: FrontMatter = {};
  for (const line of yamlLines) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      (meta as Record<string, string>)[key.trim()] = rest.join(':').trim();
    }
  }
  return { meta, content: (match[2] ?? '').trim() };
}

export function MeetingL2Panel({ body, generated_at, scope_key }: MeetingL2PanelProps) {
  const [expanded, setExpanded] = useState(true);
  const { meta, content } = parseFrontMatter(body);
  const age = formatAge(generated_at);
  const label = scope_key.replace(/^meeting:/, '');

  // Parse speakers list: "[Mordechai, Shaul]" → ["Mordechai", "Shaul"]
  const speakerList = meta.speakers
    ? meta.speakers.replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <div className="rounded-xl border border-emerald-200 bg-white shadow-sm dark:border-emerald-900/50 dark:bg-zinc-900">

        {/* Header bar */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              L2
            </span>
            <span className="h-3.5 w-px bg-emerald-200 dark:bg-emerald-800" />
            <span className="truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Meeting brief
            </span>
            {speakerList.length > 0 && (
              <span className="hidden sm:flex items-center gap-1">
                {speakerList.map((s) => (
                  <span key={s} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                    {s}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">
            {meta.duration_min && <span>{meta.duration_min} min</span>}
            {meta.utterances && <span>{meta.utterances} utterances</span>}
            <span>{age}</span>
            <span className="text-xs text-zinc-400">{expanded ? '▲' : '▼'}</span>
          </div>
        </button>

        {/* Body */}
        {expanded && (
          <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert
              prose-headings:font-semibold prose-headings:tracking-tight
              prose-h2:text-sm prose-h2:uppercase prose-h2:tracking-widest prose-h2:text-zinc-500 prose-h2:mt-5 prose-h2:mb-2
              prose-h1:text-base prose-h1:text-zinc-800
              prose-p:text-xs prose-p:leading-relaxed prose-p:text-zinc-700
              prose-li:text-xs prose-li:text-zinc-700
              prose-strong:text-zinc-800 prose-strong:font-semibold
              prose-blockquote:border-l-2 prose-blockquote:border-emerald-400 prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:text-zinc-600 prose-blockquote:not-italic
              prose-code:text-[10px] prose-code:bg-zinc-100 prose-code:px-1 prose-code:rounded
              dark:prose-p:text-zinc-300 dark:prose-li:text-zinc-300 dark:prose-strong:text-zinc-200
              dark:prose-blockquote:text-zinc-400 dark:prose-code:bg-zinc-800">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
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
