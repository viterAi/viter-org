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

import type { SupabaseClient } from '@supabase/supabase-js';

import { getExtractor } from './extractors/index.js';
import { CachedResolver } from './resolver.js';
import type {
  ExtractionRun,
  ExtractorContext,
  L0Artifact,
  L1EventInsert,
  UUID,
} from './types.js';

export interface IngestOptions {
  sourceType: string;
  filePath: string;
  channel: { kind: string; identifier: string; displayName?: string };
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

const EVENT_CHUNK_SIZE = 500;

export class Runner {
  constructor(
    public readonly db: SupabaseClient,
    public readonly tenantId: UUID,
  ) {}

  /** Convenience: typecheck + connectivity smoke. */
  async ping(): Promise<{ tenant_slug: string }> {
    const { data, error } = await this.db
      .from('tenants')
      .select('slug')
      .eq('id', this.tenantId)
      .single();
    if (error) throw new Error(`ping: ${error.message}`);
    return { tenant_slug: data.slug as string };
  }

  async ingestFile(opts: IngestOptions): Promise<IngestResult> {
    // 1. Hash the file
    const buf = await readFile(opts.filePath);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const fileStat = await stat(opts.filePath);
    const originAt = (opts.originAt ?? fileStat.mtime).toISOString();

    // 2. Upsert artifact (dedup by sha256)
    const resolver = new CachedResolver(this.db, this.tenantId);
    const channelId = await resolver.upsertChannel(
      opts.channel.kind,
      opts.channel.identifier,
      opts.channel.displayName,
    );

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
    const artifact: L0Artifact = {
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

    const ctx: ExtractorContext = {
      resolveActor: (canon) => resolver.resolveActor(canon),
      resolveChannel: (kind, identifier) => resolver.resolveChannel(kind, identifier),
      fetchContent: async (a) => a.inline_text ?? '',
    };

    const runResults: IngestResult['runs'] = [];
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

      const run: ExtractionRun = {
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
        const events: L1EventInsert[] = [];
        for await (const ev of entry.extractor(artifact, run, ctx)) events.push(ev);

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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.completeRun(runId, { status: 'failed', error: msg });
        runResults.push({ facet, runId, eventCount: 0, status: 'failed', error: msg });
      }
    }

    return { artifactId, sha256, alreadyExisted, runs: runResults };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private async upsertArtifact(input: {
    sourceType: string;
    sourceUri: string;
    sha256: string;
    bytes: number;
    originAt: string;
    inlineText: string | null;
    metadata: Record<string, unknown>;
  }): Promise<{ artifactId: UUID; alreadyExisted: boolean }> {
    // Try to find existing by (tenant_id, sha256)
    const { data: existing } = await this.db
      .from('l0_artifacts')
      .select('id')
      .eq('tenant_id', this.tenantId)
      .eq('sha256', input.sha256)
      .maybeSingle();

    if (existing?.id) {
      return { artifactId: existing.id as UUID, alreadyExisted: true };
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

    if (error) throw new Error(`upsertArtifact: ${error.message}`);
    return { artifactId: data.id as UUID, alreadyExisted: false };
  }

  private async getDefaultFacets(sourceType: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('l0_source_types')
      .select('default_facets')
      .eq('source_type', sourceType)
      .single();
    if (error) throw new Error(`getDefaultFacets(${sourceType}): ${error.message}`);
    return (data.default_facets as string[]) ?? [];
  }

  private async startRun(input: {
    artifactId: UUID;
    facet: string;
    extractor: string;
    version: string;
    parameters: Record<string, unknown>;
    isDeterministic: boolean;
  }): Promise<UUID> {
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

    if (existing?.id) return existing.id as UUID;

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

    if (error) throw new Error(`startRun: ${error.message}`);
    return data.id as UUID;
  }

  private async bulkInsertEvents(
    artifactId: UUID,
    runId: UUID,
    events: L1EventInsert[],
  ): Promise<void> {
    if (events.length === 0) return;

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
      if (error) throw new Error(`bulkInsertEvents [${i}..]: ${error.message}`);
    }
  }

  private async completeRun(
    runId: UUID,
    update: { status: 'ok' | 'failed'; metrics?: Record<string, unknown>; error?: string },
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      status: update.status,
      completed_at: new Date().toISOString(),
    };
    if (update.metrics) patch.metrics = update.metrics;
    if (update.error) patch.error = update.error;

    const { error } = await this.db.from('l1_extraction_runs').update(patch).eq('id', runId);
    if (error) throw new Error(`completeRun: ${error.message}`);
  }

  private async flipActive(artifactId: UUID, facet: string, runId: UUID): Promise<void> {
    const { error } = await this.db.from('l1_active_extraction').upsert(
      {
        tenant_id: this.tenantId,
        artifact_id: artifactId,
        facet,
        active_run_id: runId,
        promoted_by: 'auto',
        promoted_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,artifact_id,facet' },
    );
    if (error) throw new Error(`flipActive: ${error.message}`);
  }
}
