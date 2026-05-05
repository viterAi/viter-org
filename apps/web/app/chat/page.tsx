/**
 * /chat — empty state when no channel is selected.
 */

import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ChatRoot() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-stone-100 px-8 text-center dark:bg-zinc-950">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
        💬
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Select a channel
      </h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
        Pick a chat from the rail on the left to read the conversation.
        Voice notes auto-transcribed, images OCR&apos;d, every message searchable.
      </p>
      <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
        No channels yet?{' '}
        <Link href="/settings/whatsapp" className="text-emerald-700 underline hover:text-emerald-900 dark:text-emerald-300">
          Pair your WhatsApp
        </Link>
      </p>
    </div>
  );
}
