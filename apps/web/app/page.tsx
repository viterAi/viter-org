/**
 * Home dashboard — vita
 *
 * Single-page server-rendered overview. Pulls live state from Supabase:
 *   - Paired WhatsApp devices + health
 *   - Recent l1_events across all WhatsApp channels
 *   - Channel list with last-message timestamps
 *
 * No GOWA dependency on this page (so it renders even if the Railway service
 * is down). Per-action GOWA calls live in /settings/whatsapp.
 */

import Link from 'next/link';
import { getServiceRoleClient, getCurrentTenantId } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface DeviceHealthRow {
  id: string;
  gowa_device_id: string;
  phone_number: string | null;
  display_name: string | null;
  status: string;
  health_score: number;
  last_seen_at: string | null;
  days_until_re_pair: number | null;
  latest_message_at: string | null;
}

interface MessageRow {
  id: string;
  event_at: string;
  facet: string;
  modality: string;
  content: string | null;
  channel_id: string;
  metadata: Record<string, unknown>;
}

interface ChannelRow {
  id: string;
  identifier: string;
  display_name: string | null;
  kind: string;
  metadata: Record<string, unknown>;
}

async function loadDashboard() {
  const tenantId = await getCurrentTenantId();
  const db = getServiceRoleClient();

  const [devicesRes, messagesRes, channelsRes] = await Promise.all([
    db.from('whatsapp_device_health').select('*').eq('tenant_id', tenantId).order('health_score', { ascending: true }).limit(8),
    db
      .from('l1_events')
      .select('id, event_at, facet, modality, content, channel_id, metadata')
      .eq('tenant_id', tenantId)
      .in('facet', ['messages', 'transcription'])
      .order('event_at', { ascending: false })
      .limit(20),
    db.from('channels').select('id, identifier, display_name, kind, metadata').eq('tenant_id', tenantId).eq('kind', 'whatsapp'),
  ]);

  const devices = (devicesRes.data ?? []) as DeviceHealthRow[];
  const messages = (messagesRes.data ?? []) as MessageRow[];
  const channels = (channelsRes.data ?? []) as ChannelRow[];

  const [{ count: l0Count }, { count: l1Count }, { count: liveCount }] = await Promise.all([
    db.from('l0_artifacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    db.from('l1_events').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    db.from('l0_artifacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('source_type', 'whatsapp_message_live'),
  ]);

  return {
    devices,
    messages,
    channels,
    counts: { l0: l0Count ?? 0, l1: l1Count ?? 0, live: liveCount ?? 0, channels: channels.length },
  };
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ageS = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (ageS < 5) return 'just now';
  if (ageS < 60) return `${ageS}s ago`;
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
  if (ageS < 86_400) return `${Math.floor(ageS / 3600)}h ago`;
  return `${Math.floor(ageS / 86_400)}d ago`;
}

function fmtNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function StatusDot({ status, score }: { status: string; score: number }) {
  const colour =
    status === 'linked' && score >= 70 ? 'bg-emerald-500' :
    status === 'linked' ? 'bg-amber-500' :
    status === 'banned' ? 'bg-red-500' :
    status === 'pending' ? 'bg-blue-500' :
    'bg-zinc-400';
  return <span className={`inline-block size-2 rounded-full ${colour}`} aria-hidden />;
}

export default async function Dashboard() {
  let dash;
  try {
    dash = await loadDashboard();
  } catch (err) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">vita</h1>
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          Could not load dashboard: <code className="font-mono">{(err as Error).message}</code>
          <br />
          <span className="text-xs">
            Likely cause: missing <code>SUPABASE_URL</code> or <code>SUPABASE_SERVICE_ROLE_KEY</code> in this environment.
          </span>
        </p>
      </div>
    );
  }

  const { devices, messages, channels, counts } = dash;
  const channelById = new Map(channels.map((c) => [c.id, c]));

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Header */}
        <header className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400">vita · substrate</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Overview</h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
              Live ingest pipeline: WhatsApp → GOWA → vita Supabase → L0 → L1.
              Every paired phone shows up here with health + recent activity.
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/settings/whatsapp"
              className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Devices
            </Link>
            <a
              href="https://supabase.com/dashboard/project/dkccadwohifcqcdzhhnu"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Supabase ↗
            </a>
            <a
              href="https://railway.app/dashboard"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Railway ↗
            </a>
          </nav>
        </header>

        {/* Stat cards */}
        <section className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Paired devices" value={fmtNumber(devices.length)} sublabel={`${devices.filter((d) => d.status === 'linked').length} linked`} />
          <StatCard label="WhatsApp channels" value={fmtNumber(counts.channels)} sublabel="auto-created" />
          <StatCard label="L0 artifacts" value={fmtNumber(counts.l0)} sublabel={`${fmtNumber(counts.live)} live · ${fmtNumber(counts.l0 - counts.live)} batch`} />
          <StatCard label="L1 events" value={fmtNumber(counts.l1)} sublabel="text · transcripts · captions" />
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Devices */}
          <section className="lg:col-span-1">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">Devices</h2>
              <Link href="/settings/whatsapp" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">manage →</Link>
            </div>
            {devices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                No paired WhatsApp devices yet.
                <br />
                <Link href="/settings/whatsapp" className="mt-2 inline-block underline">Pair one →</Link>
              </div>
            ) : (
              <ul className="space-y-2">
                {devices.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot status={d.status} score={d.health_score} />
                      <p className="flex-1 truncate text-sm font-medium">
                        {d.display_name || d.gowa_device_id}
                      </p>
                      <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{d.health_score}/100</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {d.phone_number ?? '—'} · last seen {fmtRelative(d.last_seen_at)}
                      {d.days_until_re_pair != null && <> · re-pair {d.days_until_re_pair}d</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Live message feed */}
          <section className="lg:col-span-2">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">Live messages</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">last {messages.length}</span>
            </div>
            {messages.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                No messages ingested yet. Send a WhatsApp message from a paired device — it&apos;ll appear here within ~500ms.
              </div>
            ) : (
              <ul className="space-y-2">
                {messages.map((m) => {
                  const ch = channelById.get(m.channel_id);
                  const isFromMe = (m.metadata as { from_me?: boolean }).from_me === true;
                  const sender = isFromMe ? 'you' : ((m.metadata as { push_name?: string }).push_name ?? '—');
                  return (
                    <li
                      key={m.id}
                      className={`rounded-lg border p-3 text-sm ${
                        isFromMe
                          ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40'
                          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">{sender}</span>
                          {ch && (
                            <Link href={`/spaces/${ch.identifier}/inbox`} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                              {ch.display_name?.replace(/^WhatsApp · /, '') ?? ch.identifier}
                            </Link>
                          )}
                          <span className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] dark:border-zinc-700">{m.modality}</span>
                          {m.facet !== 'messages' && (
                            <span className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{m.facet}</span>
                          )}
                        </span>
                        <span className="tabular-nums">{fmtRelative(m.event_at)}</span>
                      </div>
                      <p className="line-clamp-3 whitespace-pre-wrap break-words text-zinc-900 dark:text-zinc-100">
                        {m.content ?? <em className="text-zinc-500">— no content —</em>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Channels */}
        <section className="mt-12">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">Channels</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{channels.length} total</span>
          </div>
          {channels.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No channels yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {channels.map((c) => (
                <Link
                  key={c.id}
                  href={`/spaces/${c.identifier}/inbox`}
                  className="rounded-lg border border-zinc-200 bg-white p-3 text-sm transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                >
                  <p className="truncate font-medium">{c.display_name ?? c.identifier}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    <code className="font-mono">{c.identifier}</code>
                    {(c.metadata as { is_group?: boolean }).is_group && <span className="ml-2 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800">group</span>}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="mt-16 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <p>
            vita v0.1 · TypeScript monorepo · Vercel + Railway + Supabase ·{' '}
            <a href="https://github.com/viterAi/vita" target="_blank" rel="noreferrer noopener" className="underline hover:text-zinc-700 dark:hover:text-zinc-200">github.com/viterAi/vita</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sublabel && <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{sublabel}</p>}
    </div>
  );
}
