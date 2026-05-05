/**
 * /chat — fixed-viewport 3-pane chat shell.
 *
 * Layout: header strip + (rail | conversation pane).
 * The right info pane is intentionally absent in Phase 1.
 */

import Link from 'next/link';
import { ChannelRail } from './ChannelRail';
import { loadChannelGroups } from '@/lib/chat/queries';

export const dynamic = 'force-dynamic';

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const groups = await loadChannelGroups();

  return (
    <div className="flex h-dvh flex-col bg-stone-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* App header — full-width, separates the chat from the rest of vita */}
      <header className="flex h-12 items-center justify-between border-b border-zinc-200 bg-emerald-700 px-4 text-emerald-50 dark:border-zinc-800 dark:bg-emerald-900">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold tracking-tight hover:text-white">
            vita
          </Link>
          <span className="text-xs text-emerald-200/80">·</span>
          <span className="text-xs uppercase tracking-widest text-emerald-100/80">chat</span>
        </div>
        <nav className="flex items-center gap-2 text-xs">
          <Link href="/" className="rounded px-2 py-1 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-800">
            Dashboard
          </Link>
          <Link href="/settings/whatsapp" className="rounded px-2 py-1 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-800">
            Devices
          </Link>
          <form action="/auth/signout" method="post" className="contents">
            <button
              type="submit"
              className="rounded px-2 py-1 text-emerald-100 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-800"
              title="Sign out"
            >
              Sign out
            </button>
          </form>
        </nav>
      </header>

      {/* Body — rail | conversation */}
      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <ChannelRail groups={groups} />
        </aside>
        <main className="min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
