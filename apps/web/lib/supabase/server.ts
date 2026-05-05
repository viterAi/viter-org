/**
 * Server-side Supabase client (service-role).
 *
 * v0.1: no auth context yet — this client uses service-role for everything,
 * which is acceptable while the app is engineering-only. When auth lands,
 * swap to the @supabase/ssr-flavored cookie-aware client and route per-tenant
 * queries through `current_tenant_id()`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Resolve which tenant the current page should display.
 *  v0.1: hardcode to viter (single-tenant during scaffold).
 *  v0.2: pull from auth session.
 */
export async function getCurrentTenantId(): Promise<string> {
  const db = getServiceRoleClient();
  const { data, error } = await db.from('tenants').select('id').eq('slug', 'viter').single();
  if (error || !data) throw new Error(`tenant 'viter' not found: ${error?.message}`);
  return data.id as string;
}
