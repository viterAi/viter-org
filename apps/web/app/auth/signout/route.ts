/**
 * POST /auth/signout — kill the session and redirect to /login.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const res = NextResponse.redirect(new URL('/login', url.origin), { status: 303 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supaUrl || !anon) return res;

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
  await sb.auth.signOut();
  return res;
}
