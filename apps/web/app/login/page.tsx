/**
 * /login — request a magic link.
 *
 * Email-only. No password. Allowlist enforced server-side; same generic
 * "check your email" message either way so we don't leak membership.
 */

import Link from 'next/link';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string }>;
}) {
  const { next, sent } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col bg-stone-100 dark:bg-zinc-950">
      <header className="flex h-12 items-center bg-emerald-700 px-4 text-emerald-50">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:text-white">
          vita
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Sign in to vita
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Enter your email — we&apos;ll send you a magic link.
          </p>

          {sent ? (
            <div className="mt-5 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
              <p>📬 Check <span className="font-semibold">{sent}</span> for the link.</p>
              <p className="mt-1 text-xs opacity-80">It expires in 1 hour. Same link works once.</p>
            </div>
          ) : (
            <LoginForm next={next} />
          )}
        </div>
      </main>
    </div>
  );
}
