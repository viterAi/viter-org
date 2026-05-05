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
import { createClient } from '@supabase/supabase-js';
export function createServiceRoleClient() {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) {
        throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is required');
    }
    if (!key) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required. Fetch it at:\n' +
            'https://supabase.com/dashboard/project/dkccadwohifcqcdzhhnu/settings/api');
    }
    return createClient(url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}
//# sourceMappingURL=db.js.map