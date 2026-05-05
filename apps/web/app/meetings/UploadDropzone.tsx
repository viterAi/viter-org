'use client';

/**
 * Meeting-audio upload dropzone.
 *
 * Visually inspired by the Supabase UI Dropzone block. Self-contained
 * (no extra deps): native drag-and-drop + Tailwind v4 + the existing
 * browser supabase client. Files go to `inbox/<tenant>/meetings/<slug>/<file>`.
 *
 * Flow:
 *   1. User picks a meeting slug + optional display name → submit
 *      → server action `ensureMeetingChannel` creates the row, returns
 *        the canonical upload prefix.
 *   2. Drop zone uploads each file via supabase.storage.from('inbox').upload
 *      with `upsert: false` so the inbox-webhook fires once per file.
 *   3. The Trigger.dev `ingest-meeting` task picks up each upload and
 *      writes l0_artifact + l1_extraction_run + l1_events.
 */

import { useState, useCallback, useTransition, type DragEvent } from 'react';
import { getBrowserClient } from '@/lib/supabase/browser';
import { ensureMeetingChannel, suggestMeetingSlug } from './actions';

interface FileState {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progressBytes: number;
  totalBytes: number;
  error?: string;
}

const ACCEPTED_TYPES = [
  'audio/m4a', 'audio/mp4', 'audio/x-m4a',
  'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav',
  'audio/ogg', 'audio/opus',
  'video/mp4', 'video/quicktime',
];
const ACCEPTED_EXTS = ['.m4a', '.mp4', '.mp3', '.wav', '.opus', '.ogg', '.mov'];
const MAX_BYTES = 524_288_000;        // 500 MB — matches inbox bucket limit

function isAcceptableFile(f: File): boolean {
  if (f.size > MAX_BYTES) return false;
  if (ACCEPTED_TYPES.includes(f.type)) return true;
  const lower = f.name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface UploadDropzoneProps {
  initialSlug: string;
}

export default function UploadDropzone({ initialSlug }: UploadDropzoneProps) {
  const [meetingSlug, setMeetingSlug] = useState(initialSlug);
  const [displayName, setDisplayName] = useState('');
  const [location, setLocation] = useState('');
  const [uploadPrefix, setUploadPrefix] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileState[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isConfirming, startConfirm] = useTransition();

  const handleConfirm = useCallback(() => {
    setConfirmError(null);
    startConfirm(async () => {
      const r = await ensureMeetingChannel({
        meeting_slug: meetingSlug,
        display_name: displayName || undefined,
        location: location || undefined,
      });
      if (!r.ok) {
        setConfirmError(r.error ?? 'unknown error');
        return;
      }
      setUploadPrefix(r.upload_prefix ?? null);
      setTenantSlug(r.tenant_slug ?? null);
    });
  }, [meetingSlug, displayName, location]);

  const handleNewMeeting = useCallback(async () => {
    const fresh = await suggestMeetingSlug();
    setMeetingSlug(fresh);
    setDisplayName('');
    setLocation('');
    setUploadPrefix(null);
    setTenantSlug(null);
    setFiles([]);
    setConfirmError(null);
  }, []);

  const uploadOne = useCallback(async (idx: number, file: File, prefix: string) => {
    const supabase = getBrowserClient();
    setFiles((prev) => prev.map((f, i) => i === idx ? { ...f, status: 'uploading' } : f));

    try {
      const path = `${prefix}${file.name}`;
      // The supabase-js v2 storage upload takes a File/Blob/ArrayBuffer; it
      // doesn't expose per-byte progress, so we just flip status when done.
      const { error } = await supabase.storage
        .from('inbox')
        .upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
          cacheControl: '3600',
        });
      if (error) {
        const msg = error.message ?? 'upload failed';
        setFiles((prev) => prev.map((f, i) => i === idx ? { ...f, status: 'error', error: msg } : f));
        return;
      }
      setFiles((prev) => prev.map((f, i) =>
        i === idx ? { ...f, status: 'done', progressBytes: file.size } : f
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'upload threw';
      setFiles((prev) => prev.map((f, i) => i === idx ? { ...f, status: 'error', error: msg } : f));
    }
  }, []);

  const handleFiles = useCallback((picked: FileList | File[]) => {
    if (!uploadPrefix) return;
    const accepted = Array.from(picked).filter(isAcceptableFile);
    if (accepted.length === 0) return;
    const baseIdx = files.length;
    const next: FileState[] = accepted.map((f) => ({
      file: f,
      status: 'pending',
      progressBytes: 0,
      totalBytes: f.size,
    }));
    setFiles((prev) => [...prev, ...next]);
    accepted.forEach((f, i) => { void uploadOne(baseIdx + i, f, uploadPrefix); });
  }, [uploadPrefix, files.length, uploadOne]);

  const onDragOver = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
  }, []);
  const onDrop = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const totalBytes = files.reduce((s, f) => s + f.totalBytes, 0);
  const doneCount = files.filter((f) => f.status === 'done').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  return (
    <div className="space-y-6">
      {/* ── 1. Meeting metadata ── */}
      <section className={`rounded-lg border p-5 ${
        uploadPrefix
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
      }`}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          1 · Meeting
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">slug</span>
            <input
              type="text"
              value={meetingSlug}
              disabled={!!uploadPrefix}
              onChange={(e) => setMeetingSlug(e.target.value)}
              placeholder="ahiya-2026-05-05"
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-900"
            />
          </label>
          <label className="block text-xs sm:col-span-2">
            <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">display name (optional)</span>
            <input
              type="text"
              value={displayName}
              disabled={!!uploadPrefix}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ahiya HaShiloni Street meeting · 2026-05-05"
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-900"
            />
          </label>
          <label className="block text-xs sm:col-span-3">
            <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">location (optional)</span>
            <input
              type="text"
              value={location}
              disabled={!!uploadPrefix}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ahiya HaShiloni Street, Beit Shemesh"
              className="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:disabled:bg-zinc-900"
            />
          </label>
        </div>

        {confirmError && (
          <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{confirmError}</p>
        )}

        {!uploadPrefix ? (
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isConfirming}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-800 dark:hover:bg-emerald-700"
            >
              {isConfirming ? 'Creating…' : 'Confirm meeting'}
            </button>
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-between gap-2 text-xs">
            <span className="text-emerald-700 dark:text-emerald-300">
              ✓ Channel ready · upload to <code className="font-mono">{uploadPrefix}</code>
            </span>
            <button
              type="button"
              onClick={handleNewMeeting}
              className="rounded border border-zinc-300 px-2 py-1 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              New meeting
            </button>
          </div>
        )}
      </section>

      {/* ── 2. Drop zone ── */}
      <section className={`${uploadPrefix ? '' : 'pointer-events-none opacity-50'}`}>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          2 · Audio
        </h2>
        <label
          htmlFor="meeting-file-input"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`block cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragOver
              ? 'border-emerald-500 bg-emerald-50/60 dark:border-emerald-600 dark:bg-emerald-950/30'
              : 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800'
          }`}
        >
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Drop audio files here, or click to browse
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            m4a · mp3 · wav · mp4 · opus · ogg · mov — up to 500 MB each
          </p>
          <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            Files upload to <code className="font-mono">inbox</code> →
            ingest-meeting picks up automatically.
          </p>
          <input
            id="meeting-file-input"
            type="file"
            multiple
            accept={[...ACCEPTED_TYPES, ...ACCEPTED_EXTS].join(',')}
            disabled={!uploadPrefix}
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.currentTarget.value = ''; }}
            className="hidden"
          />
        </label>
      </section>

      {/* ── 3. Per-file status ── */}
      {files.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
            <h2 className="font-semibold uppercase tracking-wide">3 · Files ({files.length})</h2>
            <span>
              {doneCount} done · {errorCount} failed · {fmtBytes(totalBytes)} total
            </span>
          </div>
          <ul className="space-y-2">
            {files.map((f, i) => (
              <li
                key={`${f.file.name}-${i}`}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs ${
                  f.status === 'done'
                    ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                    : f.status === 'error'
                      ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/20'
                      : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-zinc-900 dark:text-zinc-100">{f.file.name}</p>
                  {f.status === 'error' && f.error && (
                    <p className="mt-0.5 truncate text-rose-700 dark:text-rose-300">{f.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                  <span>{fmtBytes(f.totalBytes)}</span>
                  <span className={`inline-flex h-5 items-center rounded px-2 text-[10px] font-semibold uppercase tracking-wide ${
                    f.status === 'done'
                      ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100'
                      : f.status === 'uploading'
                        ? 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100'
                        : f.status === 'error'
                          ? 'bg-rose-200 text-rose-900 dark:bg-rose-800 dark:text-rose-100'
                          : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}>{f.status}</span>
                </div>
              </li>
            ))}
          </ul>
          {doneCount > 0 && tenantSlug && (
            <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              Once Whisper finishes, transcripts land at{' '}
              <code className="font-mono">channel: meeting:{meetingSlug}</code>{' '}
              (visible in /chat).
            </p>
          )}
        </section>
      )}
    </div>
  );
}
