/**
 * Browser-side Supabase client (uses the publishable / anon key).
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or the
 * newer publishable-key alias). Used only for Realtime subscriptions and
 * future browser-side queries.
 *
 * v0.1 security note: with no auth + permissive anon read policy, this
 * client sees everything. Replace when Supabase Auth lands.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing');
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY (or PUBLISHABLE_KEY) missing');
  cached = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 10 } },
    auth: { persistSession: false },
  });
  return cached;
}
