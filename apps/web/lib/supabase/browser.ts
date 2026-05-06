/**
 * Browser-side Supabase client (cookie-bound to the user's session).
 *
 * Uses @supabase/ssr's `createBrowserClient` so the auth cookie set by
 * /auth/callback is automatically attached to every request — including
 * Realtime websocket auth. Without this, Realtime authenticates as the
 * anon role; RLS policies on l1_events / channels reference auth.uid()
 * and tenant_memberships, so anon receives nothing → live updates would
 * silently fail.
 *
 * Why not the bare `createClient` with `persistSession: false`: that path
 * never reads the session cookie, so realtime auth defaults to anon even
 * after a successful login.
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing');
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY (or PUBLISHABLE_KEY) missing');
  cached = createBrowserClient(url, key, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return cached;
}
