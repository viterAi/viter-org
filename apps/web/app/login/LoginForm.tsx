'use client';

import { useState, useTransition } from 'react';
import { sendMagicLink, verifyEmailCode } from './actions';

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, startTransition] = useTransition();

  function submitEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await sendMagicLink(email, next);
      if (!res.ok) {
        setError(res.error ?? 'unable to send');
        return;
      }
      setStage('code');
    });
  }

  function submitCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await verifyEmailCode(email, code, next);
      if (res && !res.ok) {
        setError(res.error ?? 'invalid code');
      }
      // On success, server action redirects — we never reach here.
    });
  }

  if (stage === 'code') {
    return (
      <form onSubmit={submitCode} className="mt-5 space-y-3">
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
          📬 We sent a code to <span className="font-semibold">{email}</span>.
        </div>
        <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Code from email
        </label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={10}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="12345678"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-lg tracking-[0.3em] outline-none ring-emerald-600/20 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-800"
        />
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={pending || code.length < 6}
          className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          {pending ? 'Verifying…' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={() => { setStage('email'); setCode(''); setError(null); }}
          className="block w-full text-center text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Use a different email
        </button>
        <p className="pt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          The link in the email also works, but Gmail&apos;s scanner sometimes consumes
          it before you click. The 6-digit code is the safe path.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={submitEmail} className="mt-5 space-y-3">
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
        {pending ? 'Sending…' : 'Send code'}
      </button>
    </form>
  );
}
