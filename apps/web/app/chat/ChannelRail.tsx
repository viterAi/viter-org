'use client';

/**
 * Channel rail — left pane.
 *
 * Client component (uses usePathname for active-state highlighting).
 * Receives pre-grouped channels as a prop from the server layout.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ChannelGroup } from '@/lib/chat/types';

interface ChannelRailProps {
  groups: ChannelGroup[];
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '';
  const ageS = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (ageS < 60) return 'now';
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m`;
  if (ageS < 86_400) return `${Math.floor(ageS / 3600)}h`;
  if (ageS < 86_400 * 7) return `${Math.floor(ageS / 86_400)}d`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function avatarFor(label: string): { initials: string; bg: string } {
  const cleaned = label.replace(/^WhatsApp · /, '').trim();
  const words = cleaned.split(/\s+/).slice(0, 2);
  const initials = words.map((w) => w[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 2) || '?';
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const palettes = [
    'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
    'bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100',
    'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
    'bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100',
    'bg-violet-200 text-violet-900 dark:bg-violet-900 dark:text-violet-100',
    'bg-teal-200 text-teal-900 dark:bg-teal-900 dark:text-teal-100',
  ];
  return { initials, bg: palettes[Math.abs(h) % palettes.length]! };
}

export function ChannelRail({ groups }: ChannelRailProps) {
  const pathname = usePathname() ?? '';
  const activeSlug = pathname.startsWith('/chat/') ? decodeURIComponent(pathname.replace(/^\/chat\//, '').split('/')[0] ?? '') : '';
  const totalChannels = groups.reduce((n, g) => n + g.channels.length, 0);

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold tracking-tight">Channels</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{totalChannels} active</p>
      </div>

      {totalChannels === 0 ? (
        <div className="px-4 py-12 text-center text-xs text-zinc-500 dark:text-zinc-400">
          No channels yet. Pair a WhatsApp device in <Link href="/settings/whatsapp" className="underline">Settings</Link> and send a message.
        </div>
      ) : (
        <div className="pb-6">
          {groups.map((group) => (
            <section key={group.kind} className="mt-2">
              <h3 className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                {group.label}
                <span className="ml-1 font-normal text-zinc-400 dark:text-zinc-500">· {group.channels.length}</span>
              </h3>
              <ul>
                {group.channels.map((c) => {
                  const { initials, bg } = avatarFor(c.display_name ?? c.identifier);
                  const isActive = c.identifier === activeSlug;
                  const cleanName = (c.display_name ?? c.identifier).replace(/^WhatsApp · /, '');
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/chat/${c.identifier}`}
                        className={`flex items-start gap-3 px-4 py-3 transition ${
                          isActive
                            ? 'bg-emerald-50 dark:bg-emerald-950/30'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <div className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${bg}`}>
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className={`truncate text-sm ${isActive ? 'font-semibold' : 'font-medium'}`}>
                              {cleanName}
                            </p>
                            {c.latest_event_at && (
                              <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                                {fmtRelative(c.latest_event_at)}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {c.latest_preview ?? <span className="italic text-zinc-400">— no messages yet —</span>}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
