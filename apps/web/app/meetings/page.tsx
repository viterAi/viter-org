/**
 * /meetings — meeting audio upload + recent meetings list.
 *
 * The drop zone uploads files to `inbox/<tenant>/meetings/<slug>/<file>`.
 * The Storage object-created webhook fires the `inbox-webhook` Edge Function,
 * which routes to the `ingest-meeting` Trigger.dev task.
 *
 * The list below shows existing meeting channels with their latest
 * transcription status, so a user can confirm an upload landed.
 */

import Link from 'next/link';
import { getServiceRoleClient, getCurrentTenantId } from '@/lib/supabase/server';
import UploadDropzone from './UploadDropzone';
import { suggestMeetingSlug } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface MeetingRow {
  channel_id: string;
  identifier: string;
  display_name: string | null;
  created_at: string;
  artifact_count: number;
  latest_event_at: string | null;
  latest_run_status: string | null;
}

async function loadRecentMeetings(): Promise<MeetingRow[]> {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  const { data: channels } = await db
    .from('channels')
    .select('id, identifier, display_name, created_at')
    .eq('tenant_id', tenantId)
    .eq('kind', 'meeting')
    .order('created_at', { ascending: false })
    .limit(20);
  if (!channels || channels.length === 0) return [];

  const channelIds = channels.map((c) => c.id as string);

  // Latest event per channel
  const { data: events } = await db
    .from('l1_events')
    .select('channel_id, event_at, artifact_id')
    .in('channel_id', channelIds)
    .eq('facet', 'transcription')
    .order('event_at', { ascending: false });

  const latestByChannel = new Map<string, string>();
  const artifactsByChannel = new Map<string, Set<string>>();
  for (const e of events ?? []) {
    const cid = e.channel_id as string;
    if (!latestByChannel.has(cid)) latestByChannel.set(cid, e.event_at as string);
    if (!artifactsByChannel.has(cid)) artifactsByChannel.set(cid, new Set());
    if (e.artifact_id) artifactsByChannel.get(cid)!.add(e.artifact_id as string);
  }

  // Latest run status per channel (via l1_extraction_runs joined through artifact)
  const allArtifactIds = new Set<string>();
  for (const set of artifactsByChannel.values()) for (const id of set) allArtifactIds.add(id);

  const runStatusByChannel = new Map<string, string>();
  if (allArtifactIds.size > 0) {
    const { data: runs } = await db
      .from('l1_extraction_runs')
      .select('artifact_id, status, started_at')
      .in('artifact_id', [...allArtifactIds])
      .eq('facet', 'transcription')
      .order('started_at', { ascending: false });

    const statusByArtifact = new Map<string, string>();
    for (const r of runs ?? []) {
      if (!statusByArtifact.has(r.artifact_id as string)) {
        statusByArtifact.set(r.artifact_id as string, r.status as string);
      }
    }
    for (const [cid, artifacts] of artifactsByChannel.entries()) {
      // Pick the freshest status across this channel's artifacts.
      for (const aid of artifacts) {
        const st = statusByArtifact.get(aid);
        if (!st) continue;
        if (!runStatusByChannel.has(cid) || st === 'running') {
          runStatusByChannel.set(cid, st);
        }
      }
    }
  }

  return channels.map((c) => ({
    channel_id: c.id as string,
    identifier: c.identifier as string,
    display_name: (c.display_name as string | null) ?? null,
    created_at: c.created_at as string,
    artifact_count: artifactsByChannel.get(c.id as string)?.size ?? 0,
    latest_event_at: latestByChannel.get(c.id as string) ?? null,
    latest_run_status: runStatusByChannel.get(c.id as string) ?? null,
  }));
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function statusPill(status: string | null): { label: string; className: string } {
  if (!status) return { label: '—', className: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' };
  if (status === 'ok') return { label: 'transcribed', className: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100' };
  if (status === 'running') return { label: 'transcribing…', className: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100' };
  if (status === 'failed') return { label: 'failed', className: 'bg-rose-200 text-rose-900 dark:bg-rose-800 dark:text-rose-100' };
  return { label: status, className: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' };
}

export default async function MeetingsPage() {
  const [meetings, initialSlug] = await Promise.all([
    loadRecentMeetings(),
    suggestMeetingSlug(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">vita · meetings</p>
          <h1 className="text-2xl font-semibold tracking-tight">Upload a meeting</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Drop audio · we chunk + Whisper-transcribe · you get cited L1 events.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ← Dashboard
        </Link>
      </header>

      <UploadDropzone initialSlug={initialSlug} />

      <section className="mt-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Recent meetings
        </h2>
        {meetings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No meetings yet — drop one above to get started.
          </p>
        ) : (
          <ul className="space-y-2">
            {meetings.map((m) => {
              const pill = statusPill(m.latest_run_status);
              return (
                <li
                  key={m.channel_id}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {m.display_name ?? m.identifier}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                      meeting:{m.identifier} · created {fmtDate(m.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    <span>{m.artifact_count} file{m.artifact_count === 1 ? '' : 's'}</span>
                    <span className={`inline-flex h-5 items-center rounded px-2 text-[10px] font-semibold uppercase tracking-wide ${pill.className}`}>
                      {pill.label}
                    </span>
                    <Link
                      href={`/chat/${m.identifier}`}
                      className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
