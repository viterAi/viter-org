import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cookie-bound Supabase client for server components, route handlers, and
 * server actions. Reads NEXT_PUBLIC_SUPABASE_URL + ANON_KEY and uses the
 * incoming session cookie. RLS applies; this client cannot bypass it.
 *
 * Distinct from `getServiceRoleClient()` (in server.ts) — that one is for
 * privileged writes (webhook ingest, composer outbound) where we need to
 * bypass RLS deliberately.
 */
export async function getAuthClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error('NEXT_PUBLIC_SUPABASE_URL/ANON_KEY missing');

  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          try {
            store.set(name, value, options);
          } catch {
            // setAll called from a server component; cookie writes only land
            // in route handlers / server actions / middleware. Ignore here.
          }
        }
      },
    },
  });
}

/** Returns the current authenticated user or null. Cheap; relies on cookie. */
export async function getCurrentUser() {
  const sb = await getAuthClient();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}
