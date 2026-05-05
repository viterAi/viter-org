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

/**
 * Resolve which tenant the current page should display.
 *
 * v0.2: lookup waterfall
 *   1. auth session → tenant_members (first row, ordered admin > member)
 *   2. fallback to env VITA_DEFAULT_TENANT_SLUG (defaults to 'viter')
 *
 * Webhook + cron paths run without an auth session — they fall through
 * to the env-default. Page renders run with the cookie session.
 */
export async function getCurrentTenantId(): Promise<string> {
  const db = getServiceRoleClient();

  // Prefer the signed-in user's tenant.
  try {
    const { getCurrentUser } = await import('./server-auth');
    const user = await getCurrentUser();
    if (user) {
      const { data: membership } = await db
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .order('role', { ascending: true })  // 'admin' < 'member' < 'viewer' alphabetically
        .limit(1)
        .maybeSingle();
      if (membership) return membership.tenant_id as string;
    }
  } catch {
    // No request context (background job / webhook). Fall through.
  }

  const slug = process.env.VITA_DEFAULT_TENANT_SLUG ?? 'viter';
  const { data, error } = await db.from('tenants').select('id').eq('slug', slug).single();
  if (error || !data) throw new Error(`default tenant '${slug}' not found: ${error?.message}`);
  return data.id as string;
}
