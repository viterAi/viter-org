/**
 * End-to-end smoke for ingest-meeting business logic.
 *
 * Mirrors the body of orchestrator/src/trigger/ingest-meeting.ts but runs as
 * a standalone tsx script — bypassing trigger.dev (whose deploy path is
 * separately blocked at the moment).
 *
 * Writes to vita Supabase as service_role:
 *   - upsert channel(kind='meeting', identifier=<slug>)
 *   - dedup l0_artifact via sha256 (reuses the existing Ahiya artifact)
 *   - upsert l1_extraction_run with version='2026-05-05' (new run, parallel to one-shot)
 *   - delete + insert l1_events for that run
 *   - promote l1_active_extraction
 *
 * Cap: 5 min (1 chunk @ default 10-min) → ~$0.05, ~6 s.
 *
 * Compares against the existing one-shot run (version='2026-05-04'). The two
 * runs co-exist on the same artifact; staleness trigger only fires if any L2
 * synthesis cited the old run (none does — the L2 sim is in docs/, not DB).
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transcribeMeeting, MEETING_DEFAULT_BIAS_PROMPT } from '../packages/runtime/src/extractors/meeting/index.js';
import { createServiceRoleClient } from '../packages/runtime/src/db.js';
import { createLLMCallLogger } from '../packages/runtime/src/llm-log/index.js';

const TENANT_SLUG = 'viter';
const MEETING_SLUG = 'ahiya-2026-05-05';
const AUDIO_PATH = '/Users/mordechai/viter-workspace/meetings/2026-05-05/Ahiya HaShiloni Street 2.m4a';

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required');

  const db = createServiceRoleClient();

  // Resolve tenant
  const { data: tenant, error: tErr } = await db.from('tenants').select('id').eq('slug', TENANT_SLUG).single();
  if (tErr || !tenant) throw new Error(`tenant '${TENANT_SLUG}' not found: ${tErr?.message}`);
  const tenantId = tenant.id as string;
  console.log(`[e2e] tenant: ${tenantId}`);

  // Upsert channel
  const { data: ch, error: chErr } = await db
    .from('channels')
    .upsert(
      {
        tenant_id: tenantId,
        kind: 'meeting',
        identifier: MEETING_SLUG,
        display_name: 'Ahiya HaShiloni Street meeting · 2026-05-05',
        metadata: { ingest_source: 'smoke-script', smoke: true },
      },
      { onConflict: 'tenant_id,kind,identifier' },
    )
    .select('id')
    .single();
  if (chErr || !ch) throw new Error(`channel upsert: ${chErr?.message}`);
  const channelId = ch.id as string;
  console.log(`[e2e] channel: ${channelId}`);

  // Audio metadata
  const audioBuf = readFileSync(AUDIO_PATH);
  const audioSha = createHash('sha256').update(audioBuf).digest('hex');
  console.log(`[e2e] audio sha: ${audioSha.slice(0, 16)}...  bytes: ${audioBuf.length}`);

  // l0_artifact (dedup on sha256)
  const { data: existingArt } = await db
    .from('l0_artifacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sha256', audioSha)
    .maybeSingle();
  let artifactId: string;
  if (existingArt) {
    artifactId = existingArt.id as string;
    console.log(`[e2e] l0_artifact (existing): ${artifactId}`);
  } else {
    const { data: artRow, error: artErr } = await db
      .from('l0_artifacts')
      .insert({
        tenant_id: tenantId,
        source_type: 'meeting_audio',
        source_uri: `local:${AUDIO_PATH}`,
        sha256: audioSha,
        bytes: audioBuf.length,
        origin_at: '2026-05-05T07:30:00.000Z',
        captured_at: new Date().toISOString(),
        metadata: { filename: 'Ahiya HaShiloni Street 2.m4a', format: 'm4a' },
      })
      .select('id').single();
    if (artErr || !artRow) throw new Error(`l0_artifact insert: ${artErr?.message}`);
    artifactId = artRow.id as string;
    console.log(`[e2e] l0_artifact (new): ${artifactId}`);
  }

  // l1_extraction_run (running)
  const runParameters = {
    route: 'openrouter/audio/transcriptions',
    input_format: 'wav',
    response_format: 'verbose_json',
    chunk_minutes: 10,
    max_minutes: 5,
    bias_prompt_present: true,
    language: null,
  };
  const { data: runRow, error: runErr } = await db
    .from('l1_extraction_runs')
    .upsert(
      {
        tenant_id: tenantId,
        artifact_id: artifactId,
        facet: 'transcription',
        extractor: 'openai/whisper-large-v3-turbo',
        version: '2026-05-05',
        parameters: runParameters,
        is_deterministic: false,
        status: 'running',
        started_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,artifact_id,facet,extractor,version,parameters' },
    )
    .select('id, status').single();
  if (runErr || !runRow) throw new Error(`l1_extraction_run upsert: ${runErr?.message}`);
  const runId = runRow.id as string;
  console.log(`[e2e] l1_extraction_run: ${runId}  (status was: ${runRow.status})`);

  // Transcribe with logger
  const logger = createLLMCallLogger({
    db,
    tenantId,
    caller: 'extractor.meeting',
    triggerTaskId: 'smoke-ingest-meeting-e2e',
    source: 'scripts/smoke-ingest-meeting-e2e.ts',
    environment: 'dev',
    tags: ['smoke', 'meeting', `tenant:${TENANT_SLUG}`, `meeting:${MEETING_SLUG}`],
  });

  console.log(`[e2e] transcribing (5-min cap)...`);
  const result = await transcribeMeeting({
    audioPath: AUDIO_PATH,
    openrouterApiKey: apiKey,
    chunkMinutes: 10,
    maxMinutes: 5,
    biasPrompt: MEETING_DEFAULT_BIAS_PROMPT,
    logger,
    callerMetadata: {
      tenant_id: tenantId,
      caller: 'extractor.meeting',
      scope_kind: 'meeting_audio',
      scope_key: MEETING_SLUG,
    },
    scopeKey: MEETING_SLUG,
    concurrency: 1,
  });

  console.log(`[e2e] chunks: ${result.chunks.length}  total_chars: ${result.totalChars}  duration_s: ${result.totalDurationS}`);

  // Compute origin_at-relative event_at
  const originAtMs = new Date('2026-05-05T07:30:00.000Z').getTime();
  const eventRows = result.chunks.map((c) => ({
    tenant_id: tenantId,
    artifact_id: artifactId,
    extraction_run_id: runId,
    facet: 'transcription',
    event_at: new Date(originAtMs + c.startSec * 1000).toISOString(),
    position: c.index,
    actor_id: null,
    channel_id: channelId,
    modality: 'voice',
    content: c.text,
    ts_start_s: c.startSec,
    ts_end_s: c.startSec + c.durationSec,
    confidence: null,
    extraction_method: `${result.modelUsed}@${result.version}`,
    metadata: {
      chunk_index: c.index,
      chunk_chars: c.text.length,
      chunk_duration_s: c.durationSec,
      meeting_slug: MEETING_SLUG,
      wav_sha256: c.wavSha256,
      cost_usd: c.costUsd,
      wall_ms: c.wallMs,
      language: c.language,
      n_segments: c.segments.length,
    },
  }));

  // Idempotent re-insert
  await db.from('l1_events').delete().eq('extraction_run_id', runId);
  if (eventRows.length > 0) {
    const { error: evErr } = await db.from('l1_events').insert(eventRows);
    if (evErr) throw new Error(`l1_events insert: ${evErr.message}`);
  }
  console.log(`[e2e] l1_events written: ${eventRows.length}`);

  // Finalize run
  const totalCost = result.chunks.reduce((s, c) => s + (c.costUsd ?? 0), 0);
  await db.from('l1_extraction_runs').update({
    status: 'ok',
    completed_at: new Date().toISOString(),
    metrics: {
      chunks: result.chunks.length,
      chars: result.totalChars,
      duration_s: result.totalDurationS,
      cost_usd: totalCost,
      source: 'scripts/smoke-ingest-meeting-e2e.ts',
    },
  }).eq('id', runId);

  // Promote active
  await db.from('l1_active_extraction').upsert(
    { tenant_id: tenantId, artifact_id: artifactId, facet: 'transcription', active_run_id: runId, promoted_by: 'auto', reason: 'smoke-e2e' },
    { onConflict: 'tenant_id,artifact_id,facet' },
  );

  console.log(`\n[e2e] DONE`);
  console.log(`         channel:    ${channelId}`);
  console.log(`         artifact:   ${artifactId}`);
  console.log(`         new run:    ${runId}`);
  console.log(`         events:     ${eventRows.length}`);
  console.log(`         cost:       $${totalCost.toFixed(4)}`);
}

main().catch((err) => {
  console.error('[e2e] fatal:', err);
  process.exit(1);
});
