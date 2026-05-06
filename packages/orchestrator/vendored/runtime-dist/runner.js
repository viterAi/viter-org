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
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { getExtractor } from './extractors/index.js';
import { CachedResolver } from './resolver.js';
const EVENT_CHUNK_SIZE = 500;
export class Runner {
    db;
    tenantId;
    constructor(db, tenantId) {
        this.db = db;
        this.tenantId = tenantId;
    }
    /** Convenience: typecheck + connectivity smoke. */
    async ping() {
        const { data, error } = await this.db
            .from('tenants')
            .select('slug')
            .eq('id', this.tenantId)
            .single();
        if (error)
            throw new Error(`ping: ${error.message}`);
        return { tenant_slug: data.slug };
    }
    async ingestFile(opts) {
        // 1. Hash the file
        const buf = await readFile(opts.filePath);
        const sha256 = createHash('sha256').update(buf).digest('hex');
        const fileStat = await stat(opts.filePath);
        const originAt = (opts.originAt ?? fileStat.mtime).toISOString();
        // 2. Upsert artifact (dedup by sha256)
        const resolver = new CachedResolver(this.db, this.tenantId);
        const channelId = await resolver.upsertChannel(opts.channel.kind, opts.channel.identifier, opts.channel.displayName);
        const { artifactId, alreadyExisted } = await this.upsertArtifact({
            sourceType: opts.sourceType,
            sourceUri: opts.filePath,
            sha256,
            bytes: fileStat.size,
            originAt,
            inlineText: opts.inlineContent === false ? null : buf.toString('utf-8'),
            metadata: {
                channel_kind: opts.channel.kind,
                channel_identifier: opts.channel.identifier,
                channel_id: channelId,
                ...(opts.userCanonicalId ? { user_canonical_id: opts.userCanonicalId } : {}),
                ...(opts.extraMetadata ?? {}),
            },
        });
        if (alreadyExisted && !opts.forceReextract) {
            return { artifactId, sha256, alreadyExisted: true, runs: [] };
        }
        // 3. Determine facets
        const facets = opts.facets ?? (await this.getDefaultFacets(opts.sourceType));
        // 4. Run extractors
        const artifact = {
            id: artifactId,
            tenant_id: this.tenantId,
            source_type: opts.sourceType,
            source_uri: opts.filePath,
            sha256,
            bytes: fileStat.size,
            origin_at: originAt,
            captured_at: new Date().toISOString(),
            storage_url: null,
            inline_text: buf.toString('utf-8'),
            metadata: {
                channel_kind: opts.channel.kind,
                channel_identifier: opts.channel.identifier,
                ...(opts.userCanonicalId ? { user_canonical_id: opts.userCanonicalId } : {}),
                ...(opts.extraMetadata ?? {}),
            },
        };
        const ctx = {
            resolveActor: (canon) => resolver.resolveActor(canon),
            resolveChannel: (kind, identifier) => resolver.resolveChannel(kind, identifier),
            fetchContent: async (a) => a.inline_text ?? '',
        };
        const runResults = [];
        for (const facet of facets) {
            const entry = getExtractor(opts.sourceType, facet);
            if (!entry) {
                runResults.push({ facet, runId: null, eventCount: 0, status: 'skipped' });
                continue;
            }
            const runId = await this.startRun({
                artifactId,
                facet,
                extractor: entry.name,
                version: entry.version,
                parameters: entry.default_parameters,
                isDeterministic: entry.is_deterministic,
            });
            const run = {
                id: runId,
                tenant_id: this.tenantId,
                artifact_id: artifactId,
                facet,
                extractor: entry.name,
                version: entry.version,
                parameters: entry.default_parameters,
                is_deterministic: entry.is_deterministic,
                status: 'running',
            };
            const startedAt = Date.now();
            try {
                const events = [];
                for await (const ev of entry.extractor(artifact, run, ctx))
                    events.push(ev);
                await this.bulkInsertEvents(artifactId, runId, events);
                await this.completeRun(runId, {
                    status: 'ok',
                    metrics: {
                        n_events: events.length,
                        runtime_ms: Date.now() - startedAt,
                    },
                });
                await this.flipActive(artifactId, facet, runId);
                runResults.push({ facet, runId, eventCount: events.length, status: 'ok' });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await this.completeRun(runId, { status: 'failed', error: msg });
                runResults.push({ facet, runId, eventCount: 0, status: 'failed', error: msg });
            }
        }
        return { artifactId, sha256, alreadyExisted, runs: runResults };
    }
    // ── Helpers ────────────────────────────────────────────────────────
    async upsertArtifact(input) {
        // Try to find existing by (tenant_id, sha256)
        const { data: existing } = await this.db
            .from('l0_artifacts')
            .select('id')
            .eq('tenant_id', this.tenantId)
            .eq('sha256', input.sha256)
            .maybeSingle();
        if (existing?.id) {
            return { artifactId: existing.id, alreadyExisted: true };
        }
        const { data, error } = await this.db
            .from('l0_artifacts')
            .insert({
            tenant_id: this.tenantId,
            source_type: input.sourceType,
            source_uri: input.sourceUri,
            sha256: input.sha256,
            bytes: input.bytes,
            origin_at: input.originAt,
            inline_text: input.inlineText,
            metadata: input.metadata,
        })
            .select('id')
            .single();
        if (error)
            throw new Error(`upsertArtifact: ${error.message}`);
        return { artifactId: data.id, alreadyExisted: false };
    }
    async getDefaultFacets(sourceType) {
        const { data, error } = await this.db
            .from('l0_source_types')
            .select('default_facets')
            .eq('source_type', sourceType)
            .single();
        if (error)
            throw new Error(`getDefaultFacets(${sourceType}): ${error.message}`);
        return data.default_facets ?? [];
    }
    async startRun(input) {
        // Pure-function key: same (artifact, facet, extractor, version, parameters) → same row
        const { data: existing } = await this.db
            .from('l1_extraction_runs')
            .select('id, status')
            .eq('tenant_id', this.tenantId)
            .eq('artifact_id', input.artifactId)
            .eq('facet', input.facet)
            .eq('extractor', input.extractor)
            .eq('version', input.version)
            .eq('parameters', input.parameters)
            .maybeSingle();
        if (existing?.id)
            return existing.id;
        const { data, error } = await this.db
            .from('l1_extraction_runs')
            .insert({
            tenant_id: this.tenantId,
            artifact_id: input.artifactId,
            facet: input.facet,
            extractor: input.extractor,
            version: input.version,
            parameters: input.parameters,
            is_deterministic: input.isDeterministic,
            status: 'running',
            started_at: new Date().toISOString(),
        })
            .select('id')
            .single();
        if (error)
            throw new Error(`startRun: ${error.message}`);
        return data.id;
    }
    async bulkInsertEvents(artifactId, runId, events) {
        if (events.length === 0)
            return;
        const rows = events.map((e) => ({
            tenant_id: this.tenantId,
            artifact_id: artifactId,
            extraction_run_id: runId,
            facet: e.facet,
            event_at: e.event_at,
            position: e.position,
            actor_id: e.actor_id,
            channel_id: e.channel_id,
            modality: e.modality,
            content: e.content,
            ts_start_s: e.ts_start_s,
            ts_end_s: e.ts_end_s,
            byte_offset: e.byte_offset,
            line_no: e.line_no,
            page: e.page,
            confidence: e.confidence,
            extraction_method: e.extraction_method,
            metadata: e.metadata,
        }));
        for (let i = 0; i < rows.length; i += EVENT_CHUNK_SIZE) {
            const chunk = rows.slice(i, i + EVENT_CHUNK_SIZE);
            const { error } = await this.db.from('l1_events').insert(chunk);
            if (error)
                throw new Error(`bulkInsertEvents [${i}..]: ${error.message}`);
        }
    }
    async completeRun(runId, update) {
        const patch = {
            status: update.status,
            completed_at: new Date().toISOString(),
        };
        if (update.metrics)
            patch.metrics = update.metrics;
        if (update.error)
            patch.error = update.error;
        const { error } = await this.db.from('l1_extraction_runs').update(patch).eq('id', runId);
        if (error)
            throw new Error(`completeRun: ${error.message}`);
    }
    async flipActive(artifactId, facet, runId) {
        const { error } = await this.db.from('l1_active_extraction').upsert({
            tenant_id: this.tenantId,
            artifact_id: artifactId,
            facet,
            active_run_id: runId,
            promoted_by: 'auto',
            promoted_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,artifact_id,facet' });
        if (error)
            throw new Error(`flipActive: ${error.message}`);
    }
}
//# sourceMappingURL=runner.js.map