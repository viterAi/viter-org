/**
 * Smoke test for the new meeting diarization extractor (content-cue v0.1).
 *
 * Pulls vita's existing 5-chunk transcription for the 2026-04-30 supercut
 * meeting, runs `diarizeMeeting()` with the M/S/Y speaker hints (mirroring
 * the manual heuristic from speaker-confidence.md), and compares the
 * speaker distribution to the supercut.json reference (the real diarization).
 *
 * Cost: ~$0.05–0.10 (5 chunks × Sonnet chat). No DB writes.
 */

import { readFileSync } from 'node:fs';
import { diarizeMeeting, type SpeakerHint } from '../packages/runtime/src/extractors/meeting/diarize.js';
import { createServiceRoleClient } from '../packages/runtime/src/db.js';

const MEETING_SLUG = 'shaul-yitzhak-car-ikea-2026-04-30';
const REFERENCE_PATH = '/Users/mordechai/viter-workspace/meetings/2026-04-30/shaul-yitzhak-car-ikea-supercut.json';

const SPEAKERS: SpeakerHint[] = [
  {
    id: 'M',
    display: 'Mordechai Potash',
    cues: 'technical L0/L1/L2/L3 talk, JSON↔markdown↔graph framing, "bully an LLM with scaffolding", context-window math, Plunet/Playwright/Cloud product-eng pitches, "sibling not version" framing, river-meandering metaphor for prompt routing.',
  },
  {
    id: 'S',
    display: 'Shaul Levine',
    cues: 'strategic timekeeper / challenger — "I want Mordechai to present first", "10-minute stopwatch", "We have 8 minutes", "What\'s the pain point?", "Q&A five minutes now", billion-dollar framing, "you have to introduce a module", asks pushy questions, summarizes the room.',
  },
  {
    id: 'Y',
    display: 'Yitzchak Brown',
    cues: 'quieter, infra/agent comments — "agent agent instead of skill", references Sumo / Dr Shinzo lectures, modular ontology + axiom templates ("17 templates cover 93%"), lost-in-the-middle pushback, intent → retrieve → reason → compose → validate breakdown.',
  },
];

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required');

  const db = createServiceRoleClient();

  const { data: ch, error: chErr } = await db
    .from('channels').select('id').eq('identifier', MEETING_SLUG).single();
  if (chErr || !ch) throw new Error(`channel not found: ${chErr?.message}`);

  const { data: events, error: evErr } = await db
    .from('l1_events')
    .select('position, content, ts_start_s, ts_end_s')
    .eq('channel_id', ch.id)
    .eq('facet', 'transcription')
    .order('position');
  if (evErr || !events) throw new Error(`events fetch: ${evErr?.message}`);

  console.log(`[diarize-smoke] loaded ${events.length} transcription chunks for ${MEETING_SLUG}`);
  console.log(`[diarize-smoke] running content-cue diarization (Sonnet 4.6 via OpenRouter)...\n`);

  const chunks = events.map((e) => ({
    index: Number(e.position),
    startSec: Number(e.ts_start_s),
    durationSec: Number(e.ts_end_s) - Number(e.ts_start_s),
    text: String(e.content ?? ''),
  }));

  const t0 = Date.now();
  const result = await diarizeMeeting({
    openrouterApiKey: apiKey,
    chunks,
    speakers: SPEAKERS,
    concurrency: 2,
    scopeKey: MEETING_SLUG,
  });
  const wallSec = ((Date.now() - t0) / 1000).toFixed(1);

  const dist: Record<string, number> = {};
  let totalChars = 0;
  for (const seg of result.segments) {
    dist[seg.speaker] = (dist[seg.speaker] ?? 0) + 1;
    totalChars += seg.text.length;
  }
  console.log(`[diarize-smoke] DONE in ${wallSec}s · model: ${result.modelUsed}`);
  console.log(`[diarize-smoke] segments emitted: ${result.segments.length} · total chars: ${totalChars.toLocaleString()}`);
  for (const c of result.perChunk) {
    if (c.warning) console.log(`  ⚠ chunk warning: ${c.warning}`);
  }
  console.log(`\nVITA content-cue diarization (this script):`);
  for (const k of Object.keys(dist).sort()) {
    console.log(`  ${k}: ${dist[k]} segments`);
  }

  // Compare to reference
  const ref = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')) as Array<{ speaker: string }>;
  const refDist: Record<string, number> = {};
  for (const r of ref) refDist[r.speaker] = (refDist[r.speaker] ?? 0) + 1;
  console.log(`\nREFERENCE (supercut.json — acoustic diarization):`);
  for (const k of Object.keys(refDist).sort()) {
    console.log(`  ${k}: ${refDist[k]} segments`);
  }

  // Quick alignment metric: compare share of M/S/Y after lowercasing keys
  const norm = (k: string) => {
    const c = k.toLowerCase();
    if (c.startsWith('m')) return 'M';
    if (c.startsWith('s') && !c.startsWith('sp')) return 'S';
    if (c.startsWith('y')) return 'Y';
    return 'unknown';
  };
  const refShare = (target: string) => {
    let n = 0, total = 0;
    for (const [k, v] of Object.entries(refDist)) { if (norm(k) === target) n += v; total += v; }
    return n / total;
  };
  const hypShare = (target: string) => {
    let n = 0, total = 0;
    for (const [k, v] of Object.entries(dist)) { if (norm(k) === target) n += v; total += v; }
    return n / total;
  };
  console.log(`\nspeaker share (segment-count basis):`);
  for (const k of ['M', 'S', 'Y']) {
    const r = refShare(k), h = hypShare(k);
    const drift = Math.abs(r - h) * 100;
    console.log(`  ${k}: ref=${(r * 100).toFixed(1)}%  hyp=${(h * 100).toFixed(1)}%  drift=${drift.toFixed(1)}pp`);
  }
}

main().catch((err) => {
  console.error('[diarize-smoke] fatal:', err);
  process.exit(1);
});
