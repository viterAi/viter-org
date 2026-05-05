/**
 * /auth/callback — Supabase magic-link redirect target.
 *
 * Two URL shapes can arrive here:
 *   1. ?code=<pkce>             → exchangeCodeForSession (recommended flow)
 *   2. #access_token=…          → handled client-side by Supabase JS, never
 *                                 reaches this server route. We still redirect.
 *
 * On success: redirect to ?next=<path> (or '/'). On failure: back to /login
 * with ?err.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  // Build a redirect response we can attach cookies to.
  const dest = new URL(next.startsWith('/') ? next : '/', url.origin);
  const res = NextResponse.redirect(dest);

  if (!code) {
    // No code in URL — likely a hash-fragment (implicit) flow. Bounce home;
    // the client will pick up the session.
    return res;
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supaUrl || !anon) {
    return NextResponse.redirect(new URL('/login?err=config', url.origin));
  }

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

  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    const back = new URL('/login', url.origin);
    back.searchParams.set('err', error.message);
    return NextResponse.redirect(back);
  }

  return res;
}
