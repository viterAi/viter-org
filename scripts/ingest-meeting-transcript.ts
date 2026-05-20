/**
 * Ingest a diarized transcript (with speaker labels) as a meeting into vita L0/L1.
 *
 * Generalized from scripts/insert-mjs-meeting-l1.ts (2026-05-11 M+J+S).
 *
 * Input format — JSON array of turns:
 *   [{"speaker": "Mordechai", "text": "...", "timestamp": "MM:SS-MM:SS"}, ...]
 *   timestamp may also be "HH:MM:SS-HH:MM:SS". A single "MM:SS" point is treated as both start and end.
 *
 * Inserts:
 *   1. channels(kind='meeting', identifier=<slug>)
 *   2. l0_artifacts(source_type='meeting_audio', sha256 = sha256(transcript bytes))
 *   3. l1_extraction_runs(facet='transcription', extractor='manual/diarized-json')
 *   4. l1_events (one per turn, modality='voice', actor_id resolved per speaker)
 *   5. l1_active_extraction promote
 *
 * Idempotent on (tenant, sha256): re-running with the same file is a no-op for events.
 *
 * Usage:
 *   pnpm tsx scripts/ingest-meeting-transcript.ts \
 *     --transcript /path/to/diarized.json \
 *     --slug mjs-2026-05-13 \
 *     --display-name "M+J+S meeting · 2026-05-13" \
 *     --origin-at 2026-05-13T07:30:00Z \
 *     --speakers "Mordechai=mordechai-potash,Shaul=shaul-levine,Jeffery=jeffrey-levine" \
 *     [--tenant viter]
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createServiceRoleClient } from '../packages/runtime/src/db.js';

interface Args {
  transcript: string;
  slug: string;
  displayName: string;
  originAt: string;
  speakers: Record<string, string>;
  tenant: string;
}

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> & { speakers?: Record<string, string> } = { tenant: 'viter' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !v) throw new Error(`missing value for ${k}`);
    switch (k) {
      case '--transcript': a.transcript = v; break;
      case '--slug': a.slug = v; break;
      case '--display-name': a.displayName = v; break;
      case '--origin-at': a.originAt = v; break;
      case '--tenant': a.tenant = v; break;
      case '--speakers': {
        a.speakers = {};
        for (const pair of v.split(',')) {
          const [speaker, canonical] = pair.split('=').map((s) => s.trim());
          if (!speaker || !canonical) throw new Error(`bad --speakers pair: '${pair}'`);
          a.speakers[speaker] = canonical;
        }
        break;
      }
      default: throw new Error(`unknown arg: ${k}`);
    }
  }
  for (const req of ['transcript', 'slug', 'displayName', 'originAt', 'speakers'] as const) {
    if (a[req] === undefined) throw new Error(`missing required arg --${req.replace(/([A-Z])/g, '-$1').toLowerCase()}`);
  }
  return a as Args;
}

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
  const idx = s.lastIndexOf('-');
  if (idx < 0) {
    const t = parseTime(s);
    return { start: t, end: t };
  }
  return { start: parseTime(s.slice(0, idx)), end: parseTime(s.slice(idx + 1)) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const bytes = readFileSync(args.transcript);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fileBytes = statSync(args.transcript).size;
  console.log(`[ingest] file: ${args.transcript}`);
  console.log(`[ingest]   sha256=${sha256}`);
  console.log(`[ingest]   bytes=${fileBytes}`);

  const turns: TurnRow[] = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(turns) || turns.length === 0) throw new Error('transcript JSON must be a non-empty array');
  console.log(`[ingest]   turns=${turns.length}`);
  for (const t of turns) {
    if (typeof t.speaker !== 'string' || typeof t.text !== 'string' || typeof t.timestamp !== 'string') {
      throw new Error(`bad turn shape: ${JSON.stringify(t).slice(0, 120)}`);
    }
    if (!args.speakers[t.speaker]) throw new Error(`speaker '${t.speaker}' not in --speakers map`);
  }

  const db = createServiceRoleClient();

  const { data: tenantRow, error: tErr } = await db
    .from('tenants').select('id').eq('slug', args.tenant).single();
  if (tErr || !tenantRow) throw new Error(`tenant '${args.tenant}' not found: ${tErr?.message}`);
  const tenantId = tenantRow.id as string;
  console.log(`[ingest] tenant '${args.tenant}' = ${tenantId}`);

  const canonicalIds = [...new Set(Object.values(args.speakers))];
  const { data: principals, error: pErr } = await db
    .from('principals').select('id, canonical_id')
    .eq('tenant_id', tenantId).in('canonical_id', canonicalIds);
  if (pErr) throw new Error(`principals lookup: ${pErr.message}`);
  const canonicalToActor = new Map<string, string>(
    (principals ?? []).map((r: { id: string; canonical_id: string }) => [r.canonical_id, r.id]),
  );
  for (const c of canonicalIds) {
    if (!canonicalToActor.has(c)) throw new Error(`principal not found: canonical_id='${c}' under tenant '${args.tenant}'`);
  }
  console.log(`[ingest] resolved ${canonicalToActor.size} principals`);

  const { data: chRow, error: chErr } = await db
    .from('channels').upsert({
      tenant_id: tenantId,
      kind: 'meeting',
      identifier: args.slug,
      display_name: args.displayName,
      metadata: {
        participants_hint: canonicalIds,
        source: 'diarized-json transcript-only ingest',
      },
    }, { onConflict: 'tenant_id,kind,identifier' })
    .select('id').single();
  if (chErr || !chRow) throw new Error(`channel upsert: ${chErr?.message}`);
  const channelId = chRow.id as string;
  console.log(`[ingest] channel meeting:${args.slug} = ${channelId}`);

  const { data: existingArt } = await db
    .from('l0_artifacts').select('id')
    .eq('tenant_id', tenantId).eq('sha256', sha256).maybeSingle();
  let artifactId: string;
  if (existingArt) {
    artifactId = existingArt.id as string;
    console.log(`[ingest] l0_artifact already exists: ${artifactId}`);
  } else {
    const { data: artRow, error: artErr } = await db
      .from('l0_artifacts').insert({
        tenant_id: tenantId,
        source_type: 'meeting_audio',
        source_uri: `local:${args.transcript}`,
        sha256,
        bytes: fileBytes,
        origin_at: args.originAt,
        captured_at: new Date().toISOString(),
        metadata: {
          filename: args.transcript.split('/').pop(),
          format: 'diarized_json_v1',
          channel_kind: 'meeting',
          channel_identifier: args.slug,
        },
      }).select('id').single();
    if (artErr || !artRow) throw new Error(`l0_artifact insert: ${artErr?.message}`);
    artifactId = artRow.id as string;
    console.log(`[ingest] l0_artifact created: ${artifactId}`);
  }

  const { data: existingRun } = await db
    .from('l1_extraction_runs').select('id')
    .eq('tenant_id', tenantId).eq('artifact_id', artifactId)
    .eq('facet', 'transcription').eq('status', 'ok').maybeSingle();
  let runId: string;
  if (existingRun) {
    runId = existingRun.id as string;
    console.log(`[ingest] l1_extraction_run already exists: ${runId}`);
  } else {
    const { data: runRow, error: runErr } = await db
      .from('l1_extraction_runs').insert({
        tenant_id: tenantId,
        artifact_id: artifactId,
        facet: 'transcription',
        extractor: 'manual/diarized-json',
        version: new Date().toISOString().slice(0, 10),
        parameters: {
          input_format: 'diarized_json_v1',
          turns: turns.length,
          speakers: Object.keys(args.speakers),
        },
        is_deterministic: true,
        status: 'ok',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        metrics: { source: 'scripts/ingest-meeting-transcript.ts' },
      }).select('id').single();
    if (runErr || !runRow) throw new Error(`l1_extraction_run insert: ${runErr?.message}`);
    runId = runRow.id as string;
    console.log(`[ingest] l1_extraction_run created: ${runId}`);
  }

  const { data: existingEvents } = await db
    .from('l1_events').select('id')
    .eq('tenant_id', tenantId).eq('artifact_id', artifactId).eq('facet', 'transcription');
  if ((existingEvents?.length ?? 0) > 0) {
    console.log(`[ingest] ${existingEvents!.length} l1_events already exist — skipping`);
    console.log('[ingest] DONE (no-op)');
    return;
  }

  const originMs = new Date(args.originAt).getTime();
  if (Number.isNaN(originMs)) throw new Error(`bad --origin-at: ${args.originAt}`);

  const eventRows = turns.map((turn, i) => {
    const canonical = args.speakers[turn.speaker]!;
    const actorId = canonicalToActor.get(canonical)!;
    const { start, end } = parseTimestampRange(turn.timestamp);
    return {
      tenant_id: tenantId,
      artifact_id: artifactId,
      extraction_run_id: runId,
      facet: 'transcription',
      event_at: new Date(originMs + start * 1000).toISOString(),
      position: i,
      actor_id: actorId,
      channel_id: channelId,
      modality: 'voice',
      content: turn.text,
      ts_start_s: start,
      ts_end_s: end,
      confidence: null,
      extraction_method: 'manual/diarized-json@2026-05-13',
      metadata: {
        speaker: turn.speaker,
        timestamp_range: turn.timestamp,
        meeting_slug: args.slug,
        turn_index: i,
      },
    };
  });

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < eventRows.length; i += BATCH) {
    const slice = eventRows.slice(i, i + BATCH);
    const { error: evErr } = await db.from('l1_events').insert(slice);
    if (evErr) throw new Error(`l1_events insert (batch ${i}): ${evErr.message}`);
    inserted += slice.length;
    console.log(`[ingest]   l1_events batch: ${inserted}/${eventRows.length}`);
  }

  await db.from('l1_active_extraction').upsert({
    tenant_id: tenantId,
    artifact_id: artifactId,
    facet: 'transcription',
    active_run_id: runId,
    promoted_by: 'auto',
    reason: 'first-transcription',
  }, { onConflict: 'tenant_id,artifact_id,facet' });

  console.log('[ingest] DONE');
  console.log(`  channel:     meeting:${args.slug} (${channelId})`);
  console.log(`  l0_artifact: ${artifactId}`);
  console.log(`  l1_run:      ${runId}`);
  console.log(`  l1_events:   ${inserted}`);
}

main().catch((err) => {
  console.error('[ingest] fatal:', err);
  process.exit(1);
});
