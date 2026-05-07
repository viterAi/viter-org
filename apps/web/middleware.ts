/**
 * Auth middleware — redirect unauthenticated requests to /login.
 *
 * Uses @supabase/ssr to read the session cookie without blocking on a
 * full session refresh (getUser() would make a network round-trip;
 * getSession() reads from the cookie — fine for redirects).
 *
 * Public paths: /login, /auth/*, and Next internals (_next).
 * Everything else requires a valid session cookie.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PREFIXES = ['/login', '/auth/', '/_next/', '/favicon'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let public paths through immediately.
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supaUrl || !anon) {
    // Misconfigured — let requests through rather than hard-blocking.
    return NextResponse.next();
  }

  const res = NextResponse.next();

  const sb = createServerClient(supaUrl, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  // getSession() reads the cookie — no network round-trip.
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // Match all paths except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
