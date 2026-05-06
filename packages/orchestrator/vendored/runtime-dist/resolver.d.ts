/**
 * Cached principal + channel resolution. Backed by Supabase queries; in-memory cache
 * per Runner instance avoids re-querying the same canonical_id over and over.
 *
 * Channels are auto-upserted on miss. Principals are NOT — unknown actors return null
 * (the runner logs them so a human can decide whether to add a principal row).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID } from './types.js';
export declare class CachedResolver {
    private readonly db;
    private readonly tenantId;
    private actorCache;
    private channelCache;
    constructor(db: SupabaseClient, tenantId: UUID);
    resolveActor(canonicalId: string): Promise<UUID | null>;
    resolveChannel(kind: string, identifier: string): Promise<UUID | null>;
    upsertChannel(kind: string, identifier: string, displayName?: string): Promise<UUID>;
}
//# sourceMappingURL=resolver.d.ts.map