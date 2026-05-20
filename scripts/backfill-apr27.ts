/**
 * Backfill ingestion for Apr 27 MacWhisper sessions (files 3-7).
 * For each session: channel → l0_artifact → l1_extraction_run → l1_events → l1_active_extraction → synthesize
 */

import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TENANT_ID = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';
const EXTRACTOR = 'macwhisper:openai_whisper-large-v3-v20240930@2026';
const FACET = 'transcription';

const SPEAKER_MAP: Record<string, { principalId: string; name: string }> = {
  '17187271E0494E91B3F80D0ED2230A07': { principalId: 'c42a9ba5-0aa7-4426-82e8-712db87f9710', name: 'Mordechai' },
  '0824217D04AF4D4096A54B1EC1C68DD9': { principalId: '7f17cd49-6091-4b52-aea1-0f2662e3412e', name: 'Shaul' },
  '660B67A1711049AD94372B2DB58B7603': { principalId: 'da66f06e-7e64-48af-9564-daab1ad3e9b5', name: 'Jeffrey' },
};

// Best (named-speaker) session per file
const SESSIONS = [
  { file: '3', sessionHex: 'A23767EAC95A4970B63D88602E2E65F5', sha256: '569ee61d40ee849f33ee23424d7101fa1bdf702c33796028cd46638234f92fb3', dateCreated: '2026-04-27T18:36:03.426Z' },
  { file: '4', sessionHex: 'C9FF714F9BD54E4D8F1D034B9102863A', sha256: 'c7939f6aa42a3102b53a94b2e3ba93f3a1f1b0f722c966704eac617d7aa76384', dateCreated: '2026-04-27T18:41:36.170Z' },
  { file: '5', sessionHex: '5C144E650CDA48F9BFE176F2BFBFBCDB', sha256: '2a63d82eb6e34d219d886a86c5a9f09afaa1fded0928885ae75c1810617d68cf', dateCreated: '2026-04-27T18:49:37.838Z' },
  { file: '6', sessionHex: '41EF2B35DF8B463082A077617AD281BE', sha256: '3a2d067a2c9d5b1cb6f6f1842225d7a4f00ce362169955d323dc7f9a9db94b4f', dateCreated: '2026-04-27T18:58:16.769Z' },
  { file: '7', sessionHex: 'A84E2BD511B047DF952A1B6EBE6C0CD0', sha256: '96430c661f24501f3dc0fca7fbf55a8aa1247906b25a17c8879271d5e73fc273', dateCreated: '2026-04-27T19:02:20.372Z' },
];

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mw = new Database('/Users/mordechai/Library/Application Support/MacWhisper/Database/main.sqlite', { readonly: true });

async function ingestSession(s: typeof SESSIONS[0]) {
  const channelId = `meeting-2026-04-27-part-${s.file}`;
  console.log(`\n── File ${s.file} (${channelId}) ──`);

  // 1. Channel
  const { data: ch, error: chErr } = await db.from('channels')
    .upsert({ id: randomUUID(), tenant_id: TENANT_ID, kind: 'meeting', identifier: channelId,
      display_name: `Apr 27 — Part ${s.file}`,
      metadata: { speakers: {
        Mordechai: { principal_id: 'c42a9ba5-0aa7-4426-82e8-712db87f9710' },
        Shaul:     { principal_id: '7f17cd49-6091-4b52-aea1-0f2662e3412e' },
        Jeffrey:   { principal_id: 'da66f06e-7e64-48af-9564-daab1ad3e9b5' },
      }},
    }, { onConflict: 'tenant_id,kind,identifier', ignoreDuplicates: false })
    .select('id').single();
  if (chErr) throw new Error(`channel: ${chErr.message}`);
  console.log(`  channel: ${ch!.id}`);

  // 2. L0 artifact
  const rows = mw.prepare(`
    SELECT tl."end" FROM transcriptline tl
    WHERE tl.sessionId = X'${s.sessionHex}' ORDER BY tl."end" DESC LIMIT 1
  `).all() as { end: number }[];
  const durationMs = rows[0]?.end ?? 0;

  const { data: art, error: artErr } = await db.from('l0_artifacts')
    .upsert({ id: randomUUID(), tenant_id: TENANT_ID, source_type: 'meeting_audio',
      source_uri: `macwhisper://session/${s.sessionHex}`,
      sha256: s.sha256, origin_at: s.dateCreated, captured_at: new Date().toISOString(),
      creator: 'c42a9ba5-0aa7-4426-82e8-712db87f9710',
      upstream_status: 'live', promoted: false,
      metadata: { macwhisper_session_id: s.sessionHex, duration_ms: durationMs, original_filename: s.file },
    }, { onConflict: 'tenant_id,sha256', ignoreDuplicates: false })
    .select('id').single();
  if (artErr) throw new Error(`artifact: ${artErr.message}`);
  console.log(`  artifact: ${art!.id}`);

  // 3. Extraction run
  const { data: run, error: runErr } = await db.from('l1_extraction_runs')
    .upsert({ id: randomUUID(), tenant_id: TENANT_ID, artifact_id: art!.id,
      facet: FACET, extractor: EXTRACTOR, version: '20240930',
      parameters: { model: 'openai_whisper-large-v3', diarization: true },
      is_deterministic: true, status: 'ok',
      representation: ['audio/whisper', 'diarized'],
      started_at: s.dateCreated, completed_at: s.dateCreated,
      metrics: { duration_ms: durationMs },
    }, { onConflict: 'tenant_id,artifact_id,facet,extractor,version,parameters', ignoreDuplicates: false })
    .select('id').single();
  if (runErr) throw new Error(`run: ${runErr.message}`);
  console.log(`  run: ${run!.id}`);

  // 4. L1 events
  const sessionStart = new Date(s.dateCreated).getTime();
  const lines = mw.prepare(`
    SELECT hex(tl.id) as line_id, tl.start, tl."end", tl.text, hex(tl.speakerID) as speaker_hex
    FROM transcriptline tl
    WHERE tl.sessionId = X'${s.sessionHex}'
    ORDER BY tl.start, tl.id
  `).all() as { line_id: string; start: number; end: number; text: string; speaker_hex: string }[];

  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH).map((l, j) => {
      const spk = SPEAKER_MAP[l.speaker_hex];
      const eventAt = new Date(sessionStart + l.start).toISOString();
      return {
        id: randomUUID(),
        event_at: eventAt,
        tenant_id: TENANT_ID,
        artifact_id: art!.id,
        extraction_run_id: run!.id,
        channel_id: ch!.id,
        facet: FACET,
        position: i + j,
        actor_id: spk?.principalId ?? null,
        modality: 'voice',
        ts_start_s: l.start / 1000,
        ts_end_s: l.end / 1000,
        extraction_method: EXTRACTOR,
        content: l.text ?? '',
        metadata: {
          speaker_name: spk?.name ?? 'Unknown',
          macwhisper_line_id: l.line_id,
          utterance_start_ms: l.start,
          utterance_end_ms: l.end,
        },
      };
    });
    const { error } = await db.from('l1_events').insert(chunk);
    if (error) throw new Error(`events batch ${i}: ${error.message}`);
    inserted += chunk.length;
  }
  console.log(`  events: ${inserted}`);

  // 5. Active extraction
  const { error: activeErr } = await db.from('l1_active_extraction')
    .upsert({ tenant_id: TENANT_ID, artifact_id: art!.id, facet: FACET,
      active_run_id: run!.id, promoted_by: 'backfill:macwhisper',
      reason: `first-promote: Apr 27 file ${s.file} (MacWhisper Tier 1)`,
    }, { onConflict: 'tenant_id,artifact_id,facet' });
  if (activeErr) throw new Error(`active: ${activeErr.message}`);
  console.log(`  active extraction set`);

  return channelId;
}

async function main() {
  for (const s of SESSIONS) {
    const channelId = await ingestSession(s);
    // Synthesize
    console.log(`  synthesizing...`);
    try {
      execSync(
        `pnpm tsx scripts/synthesize.ts meeting "meeting:${channelId}"`,
        { cwd: '/Users/mordechai/viter-workspace/vita', stdio: 'pipe',
          env: { ...process.env } }
      );
      console.log(`  ✓ L2 inserted`);
    } catch (e: any) {
      console.error(`  ✗ synthesis failed: ${e.stderr?.toString().slice(0, 200)}`);
    }
  }
  console.log('\nDone.');
  mw.close();
}

main().catch(e => { console.error(e); process.exit(1); });
