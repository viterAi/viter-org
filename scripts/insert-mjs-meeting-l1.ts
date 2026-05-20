/**
 * One-shot: ingest the 2026-05-11 Mordechai+Jeffrey+Shaul meeting into L0/L1.
 *
 * Source: ~/Documents/meeting m+j+s.json — 1040 diarized turns,
 *   speakers: Mordechai / Shaul / Jeffery. Each row: { speaker, text, timestamp }.
 * The 300MB audio failed to upload, so this script ingests the diarized JSON
 * directly. l0_artifact.sha256 hashes the JSON bytes (the only artifact we have).
 *
 * Inserts:
 *   1. channels(kind='meeting', identifier='mjs-2026-05-11')
 *   2. l0_artifacts(source_type='meeting_audio', sha256, origin_at)
 *      — flagged audio_not_ingested: true in metadata.
 *   3. l1_extraction_runs(facet='transcription', extractor='manual/diarized-json')
 *   4. 1040 × l1_events(facet='transcription', modality='voice', one per turn,
 *      with resolved actor_id for the speaker).
 *   5. l1_active_extraction promote.
 *
 * Idempotent on (tenant, sha256). Safe to re-run.
 * Does NOT queue claim-extract / synthesize-meeting downstream.
 */

import { readFileSync } from 'node:fs';
import { createServiceRoleClient } from '../packages/runtime/src/db.js';

const TENANT_SLUG = 'viter';
const MEETING_SLUG = 'mjs-2026-05-11';
const TRANSCRIPT_PATH = '/Users/mordechai/Documents/meeting m+j+s.json';

// File hash + size (computed via `shasum -a 256` + `stat -f %z`)
const JSON_SHA256 = '853a5df49f44e27ad37c1150330978c6e6be88ba09c517ff2a76fc89d4424193';
const JSON_BYTES = 146831;

// Anchor: meeting was today 2026-05-11 morning IST. JSON mtime = 12:41 IDT.
// Duration ~65 min → meeting started ~11:30 IDT (UTC+3) = 08:30 UTC.
const ORIGIN_AT = '2026-05-11T08:30:00.000Z';

// Speaker name in the JSON → principal canonical_id
const SPEAKER_TO_CANONICAL: Record<string, string> = {
  Mordechai: 'mordechai-potash',
  Shaul: 'shaul-levine',
  Jeffery: 'jeffrey-levine', // note: JSON misspells Jeffrey as "Jeffery"
};

interface TurnRow {
  speaker: string;
  text: string;
  timestamp: string;
}

function parseTime(t: string): number {
  const parts = t.split(':').map(Number);
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  throw new Error(`bad timestamp segment: ${t}`);
}

function parseTimestampRange(s: string): { start: number; end: number } {
  // Format: "MM:SS-MM:SS" or "HH:MM:SS-HH:MM:SS"
  // We can't simply split on '-' because "1-2" inside HH:MM:SS doesn't occur,
  // but to be safe we find the split: it's the last '-' that has digits on both sides.
  const idx = s.lastIndexOf('-');
  if (idx < 0) throw new Error(`bad timestamp range: ${s}`);
  return { start: parseTime(s.slice(0, idx)), end: parseTime(s.slice(idx + 1)) };
}

async function main() {
  const db = createServiceRoleClient();

  // Resolve tenant
  const { data: tenantRow, error: tErr } = await db
    .from('tenants')
    .select('id')
    .eq('slug', TENANT_SLUG)
    .single();
  if (tErr || !tenantRow) throw new Error(`tenant '${TENANT_SLUG}' not found: ${tErr?.message}`);
  const tenantId = tenantRow.id as string;
  console.log(`[insert] tenant '${TENANT_SLUG}' = ${tenantId}`);

  // Resolve principals (3 speakers)
  const canonicalIds = Object.values(SPEAKER_TO_CANONICAL);
  const { data: principals, error: pErr } = await db
    .from('principals')
    .select('id, canonical_id')
    .eq('tenant_id', tenantId)
    .in('canonical_id', canonicalIds);
  if (pErr) throw new Error(`principals lookup: ${pErr.message}`);
  const canonicalToActor = new Map<string, string>(
    (principals ?? []).map((r: { id: string; canonical_id: string }) => [r.canonical_id, r.id]),
  );
  for (const c of canonicalIds) {
    if (!canonicalToActor.has(c)) throw new Error(`principal not found: ${c}`);
  }
  console.log(`[insert] resolved ${canonicalToActor.size} principals`);

  // 1. Channel — kind='meeting'
  const { data: chRow, error: chErr } = await db
    .from('channels')
    .upsert(
      {
        tenant_id: tenantId,
        kind: 'meeting',
        identifier: MEETING_SLUG,
        display_name: 'M+J+S meeting · 2026-05-11',
        metadata: {
          participants_hint: ['mordechai-potash', 'shaul-levine', 'jeffrey-levine'],
          source: 'diarized-json transcript-only ingest',
        },
      },
      { onConflict: 'tenant_id,kind,identifier' },
    )
    .select('id')
    .single();
  if (chErr || !chRow) throw new Error(`channel upsert: ${chErr?.message}`);
  const channelId = chRow.id as string;
  console.log(`[insert] channel ${MEETING_SLUG} = ${channelId}`);

  // 2. L0 artifact — meeting_audio (audio bytes missing, hash is of the JSON)
  const { data: existingArt } = await db
    .from('l0_artifacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sha256', JSON_SHA256)
    .maybeSingle();
  let artifactId: string;
  if (existingArt) {
    artifactId = existingArt.id as string;
    console.log(`[insert] l0_artifact already exists: ${artifactId}`);
  } else {
    const { data: artRow, error: artErr } = await db
      .from('l0_artifacts')
      .insert({
        tenant_id: tenantId,
        source_type: 'meeting_audio',
        source_uri: `local:${TRANSCRIPT_PATH}`,
        sha256: JSON_SHA256,
        bytes: JSON_BYTES,
        origin_at: ORIGIN_AT,
        captured_at: new Date().toISOString(),
        metadata: {
          filename: 'meeting m+j+s.json',
          format: 'diarized_json_v1',
          channel_kind: 'meeting',
          channel_identifier: MEETING_SLUG,
          audio_not_ingested: true,
          audio_size_note: 'source audio ~300MB, not uploaded',
          source_note: 'M+J+S meeting transcript, 2026-05-11 morning',
        },
      })
      .select('id')
      .single();
    if (artErr || !artRow) throw new Error(`l0_artifact insert: ${artErr?.message}`);
    artifactId = artRow.id as string;
    console.log(`[insert] l0_artifact created: ${artifactId}`);
  }

  // 3. L1 extraction run — transcription via manual diarized JSON
  const { data: existingRun } = await db
    .from('l1_extraction_runs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('artifact_id', artifactId)
    .eq('facet', 'transcription')
    .eq('status', 'ok')
    .maybeSingle();
  let runId: string;
  if (existingRun) {
    runId = existingRun.id as string;
    console.log(`[insert] l1_extraction_run already exists: ${runId}`);
  } else {
    const { data: runRow, error: runErr } = await db
      .from('l1_extraction_runs')
      .insert({
        tenant_id: tenantId,
        artifact_id: artifactId,
        facet: 'transcription',
        extractor: 'manual/diarized-json',
        version: '2026-05-11',
        parameters: {
          input_format: 'diarized_json_v1',
          turns: 1040,
          speakers: ['Mordechai', 'Shaul', 'Jeffery'],
        },
        is_deterministic: true,
        status: 'ok',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        metrics: {
          source: 'scripts/insert-mjs-meeting-l1.ts',
        },
      })
      .select('id')
      .single();
    if (runErr || !runRow) throw new Error(`l1_extraction_run insert: ${runErr?.message}`);
    runId = runRow.id as string;
    console.log(`[insert] l1_extraction_run created: ${runId}`);
  }

  // 4. L1 events — one per turn
  const { data: existingEvents } = await db
    .from('l1_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('artifact_id', artifactId)
    .eq('facet', 'transcription');
  if ((existingEvents?.length ?? 0) > 0) {
    console.log(
      `[insert] ${existingEvents!.length} l1_events already exist for this artifact — skipping`,
    );
    console.log('[insert] DONE (no-op)');
    return;
  }

  const turns: TurnRow[] = JSON.parse(readFileSync(TRANSCRIPT_PATH, 'utf8'));
  if (turns.length !== 1040) {
    console.warn(`[insert] expected 1040 turns, got ${turns.length}`);
  }

  const originMs = new Date(ORIGIN_AT).getTime();
  const eventRows = turns.map((turn, i) => {
    const canonical = SPEAKER_TO_CANONICAL[turn.speaker];
    if (!canonical) throw new Error(`unknown speaker at turn ${i}: '${turn.speaker}'`);
    const actorId = canonicalToActor.get(canonical)!;
    const { start, end } = parseTimestampRange(turn.timestamp);
    const eventAt = new Date(originMs + start * 1000).toISOString();
    return {
      tenant_id: tenantId,
      artifact_id: artifactId,
      extraction_run_id: runId,
      facet: 'transcription',
      event_at: eventAt,
      position: i,
      actor_id: actorId,
      channel_id: channelId,
      modality: 'voice',
      content: turn.text,
      ts_start_s: start,
      ts_end_s: end,
      confidence: null,
      extraction_method: 'manual/diarized-json@2026-05-11',
      metadata: {
        speaker: turn.speaker,
        timestamp_range: turn.timestamp,
        meeting_slug: MEETING_SLUG,
        turn_index: i,
      },
    };
  });

  // Bulk insert in batches of 500 (Supabase POST limit safety)
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < eventRows.length; i += BATCH) {
    const slice = eventRows.slice(i, i + BATCH);
    const { error: evErr } = await db.from('l1_events').insert(slice);
    if (evErr) throw new Error(`l1_events insert (batch ${i}): ${evErr.message}`);
    inserted += slice.length;
    console.log(`[insert]   l1_events batch: ${inserted}/${eventRows.length}`);
  }

  // 5. Promote as active extraction
  await db.from('l1_active_extraction').upsert(
    {
      tenant_id: tenantId,
      artifact_id: artifactId,
      facet: 'transcription',
      active_run_id: runId,
      promoted_by: 'auto',
      reason: 'first-transcription',
    },
    { onConflict: 'tenant_id,artifact_id,facet' },
  );

  console.log('[insert] DONE');
  console.log(`  channel:     meeting:${MEETING_SLUG} (${channelId})`);
  console.log(`  l0_artifact: ${artifactId}`);
  console.log(`  l1_run:      ${runId}`);
  console.log(`  l1_events:   ${inserted}`);
}

main().catch((err) => {
  console.error('[insert] fatal:', err);
  process.exit(1);
});
