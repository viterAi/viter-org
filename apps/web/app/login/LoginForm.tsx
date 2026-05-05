'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendMagicLink } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await sendMagicLink(email, next);
      if (!res.ok) {
        setError(res.error ?? 'unable to send');
        return;
      }
      const params = new URLSearchParams();
      if (res.email) params.set('sent', res.email);
      if (next) params.set('next', next);
      router.replace(`/login?${params.toString()}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3">
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Email
      </label>
      <input
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-600/20 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800"
      />
      {error && (
        <div className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={pending || !email}
        className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {pending ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}
