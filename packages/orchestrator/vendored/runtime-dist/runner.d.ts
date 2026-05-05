/**
 * Runner — drives one L0 artifact through the registered extractors and inserts L1.
 *
 * Lifecycle for `ingestFile`:
 *   1. Read file bytes, compute sha256.
 *   2. Upsert l0_artifacts row (sha256-deduped per tenant). If an existing row
 *      already has the same sha and `forceReextract=false`, return early — idempotent.
 *   3. Look up source_type's default facets (or use override from opts).
 *   4. For each facet:
 *      a. Insert l1_extraction_runs (status='running').
 *      b. Stream events from the registered extractor.
 *      c. Bulk-insert events (chunked).
 *      d. Mark run.status='ok' with metrics.
 *      e. Upsert l1_active_extraction (audit trigger fires on flip).
 *   5. Return summary.
 *
 * On any error during a single facet, the run is marked status='failed' with
 * the error message; the next facet still runs. Other artifacts unaffected.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UUID } from './types.js';
export interface IngestOptions {
    sourceType: string;
    filePath: string;
    channel: {
        kind: string;
        identifier: string;
        displayName?: string;
    };
    /** principals.canonical_id of the human user who produced this L0 (optional override) */
    userCanonicalId?: string;
    /** Subset of facets to run; defaults to source_type's `default_facets` from registry */
    facets?: string[];
    /** Re-run extractors even if the artifact (by sha256) already exists */
    forceReextract?: boolean;
    /** Override origin_at; defaults to file mtime */
    originAt?: Date;
    /** Inline content into the row (true) vs. leave null and use storage_url later (false) */
    inlineContent?: boolean;
    /** Extra metadata merged onto the artifact row */
    extraMetadata?: Record<string, unknown>;
}
export interface IngestResult {
    artifactId: UUID;
    sha256: string;
    alreadyExisted: boolean;
    runs: Array<{
        facet: string;
        runId: UUID | null;
        eventCount: number;
        status: 'ok' | 'failed' | 'skipped';
        error?: string;
    }>;
}
export declare class Runner {
    readonly db: SupabaseClient;
    readonly tenantId: UUID;
    constructor(db: SupabaseClient, tenantId: UUID);
    /** Convenience: typecheck + connectivity smoke. */
    ping(): Promise<{
        tenant_slug: string;
    }>;
    ingestFile(opts: IngestOptions): Promise<IngestResult>;
    private upsertArtifact;
    private getDefaultFacets;
    private startRun;
    private bulkInsertEvents;
    private completeRun;
    private flipActive;
}
//# sourceMappingURL=runner.d.ts.map