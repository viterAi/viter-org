/**
 * Next.js 16 Proxy (formerly Middleware) — refreshes the Supabase session
 * cookie on every navigation so server components see a current `user`.
 *
 * Auth gate: any /chat/* or /settings/* request without a session is
 * redirected to /login?next=<path>. Public paths: /login, /auth/*, /_next,
 * /api/media (signed URLs are tenant-internal but the signed URL itself
 * is the auth bearer for the redirect target — Phase B will tighten).
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATTERNS = [
  /^\/login(\/.*)?$/,
  /^\/auth(\/.*)?$/,
  /^\/_next\//,
  /^\/favicon/,
  /^\/api\/media(\/.*)?$/,
];

const GATED_PATTERNS = [
  /^\/$/,
  /^\/chat(\/.*)?$/,
  /^\/settings(\/.*)?$/,
  /^\/spaces(\/.*)?$/,
  // Note: /audit uses its own password cookie (apps/web/app/audit/actions.ts).
  // Don't add it here — it does NOT use a Supabase session.
];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_PATTERNS.some((re) => re.test(pathname))) {
    return refreshSession(req);
  }

  if (!GATED_PATTERNS.some((re) => re.test(pathname))) {
    return refreshSession(req);
  }

  // Gated path: refresh + check user
  const { res, user } = await refreshSessionWithUser(req);
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  return res;
}

async function refreshSession(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return res;
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });
  await sb.auth.getUser();  // forces refresh of expiring cookies
  return res;
}

async function refreshSessionWithUser(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { res, user: null };
  const sb = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });
  const { data } = await sb.auth.getUser();
  return { res, user: data.user };
}

export const config = {
  // Match everything except static assets. The function decides per-path
  // whether it's gated.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)'],
};
