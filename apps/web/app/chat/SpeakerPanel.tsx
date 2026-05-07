'use client';

import { useState, useTransition } from 'react';
import { saveSpeakerNames, detectSpeakers } from './meeting-actions';

interface SpeakerPanelProps {
  channelId: string;
  speakers: { code: string; name: string | null }[];
}

export function SpeakerPanel({ channelId, speakers }: SpeakerPanelProps) {
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(speakers.map((s) => [s.code, s.name ?? ''])),
  );
  const [expanded, setExpanded] = useState(() => speakers.some((s) => !s.name));
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (speakers.length === 0) return null;

  function handleDetect() {
    startTransition(async () => {
      setStatus('Detecting…');
      const result = await detectSpeakers(channelId);
      if (result.ok && result.speakers) {
        setNames((prev) => {
          const next = { ...prev };
          for (const [code, { name }] of Object.entries(result.speakers!)) {
            if (name) next[code] = name;
          }
          return next;
        });
        setStatus('Detected — review and save');
      } else {
        setStatus(result.error ?? 'Detection failed');
        setTimeout(() => setStatus(null), 3000);
      }
    });
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveSpeakerNames(channelId, names);
      setStatus(result.ok ? 'Saved' : (result.error ?? 'Error'));
      setTimeout(() => setStatus(null), 2000);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-3">
      <div className="rounded-xl border border-violet-200 bg-white shadow-sm dark:border-violet-900/50 dark:bg-zinc-900">

        {/* Header */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-400">
              Speakers
            </span>
            <span className="h-3.5 w-px bg-violet-200 dark:bg-violet-800" />
            <div className="flex flex-wrap gap-1">
              {speakers.map((s) => {
                const label = names[s.code]?.trim() || `Speaker ${s.code}`;
                const isNamed = !!names[s.code]?.trim();
                return (
                  <span
                    key={s.code}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isNamed
                        ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300'
                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {s.code}: {label}
                  </span>
                );
              })}
            </div>
          </div>
          <span className="shrink-0 text-xs text-zinc-400">{expanded ? '▲' : '▼'}</span>
        </button>

        {/* Body */}
        {expanded && (
          <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <div className="flex flex-col gap-2">
              {speakers.map((s) => (
                <div key={s.code} className="flex items-center gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                    {s.code}
                  </span>
                  <input
                    type="text"
                    value={names[s.code] ?? ''}
                    onChange={(e) => setNames((prev) => ({ ...prev, [s.code]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                    placeholder={`Speaker ${s.code}`}
                    className="flex-1 rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 text-xs outline-none transition focus:border-violet-400 focus:ring-1 focus:ring-violet-200 dark:border-zinc-700 dark:focus:border-violet-600 dark:focus:ring-violet-900/50"
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2">
              {status && (
                <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">{status}</span>
              )}
              <div className={`flex gap-2 ${status ? '' : 'ml-auto'}`}>
                <button
                  type="button"
                  onClick={handleDetect}
                  disabled={isPending}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-violet-300 hover:text-violet-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-violet-700 dark:hover:text-violet-400"
                >
                  Auto-detect
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-700 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
