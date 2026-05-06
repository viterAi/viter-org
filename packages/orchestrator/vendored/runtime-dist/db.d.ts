/**
 * Supabase client factory.
 *
 * The runtime always runs as service_role — it inserts into l0/l1 tables that have
 * RLS policies tenant-scoped to authenticated users. The runner is a privileged
 * worker, not an end-user surface.
 *
 * Required env:
 *   SUPABASE_URL                  (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY     (never NEXT_PUBLIC_ prefixed)
 */
import { type SupabaseClient } from '@supabase/supabase-js';
export declare function createServiceRoleClient(): SupabaseClient;
//# sourceMappingURL=db.d.ts.map