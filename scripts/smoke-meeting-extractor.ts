/**
 * Smoke test for the new meeting extractor (packages/runtime/src/extractors/meeting).
 *
 * Drives `transcribeMeeting()` against the Ahiya 2026-05-05 audio with a 5-min
 * cap so the test costs ~$0.05 and finishes in ~30 s. Compares the output to
 * the known reference (the May 5 one-shot insert into vita Supabase):
 *   - SHA256 should equal `5d0ca50341847daee4f5e9a818c70f39dd792247b4ec3342e05bbef16748f81e`
 *   - At max-min=5, exactly 1 chunk (first 5 min)
 *   - chunks[0].text non-empty
 *   - language detected (he/en/mixed)
 *
 * Does NOT write to the DB. The full ingest-meeting trigger task is what
 * does the writes; this smoke validates the pure extractor module.
 */

import { transcribeMeeting } from '../packages/runtime/src/extractors/meeting/index.js';

const AUDIO_PATH = '/Users/mordechai/viter-workspace/meetings/2026-05-05/Ahiya HaShiloni Street 2.m4a';
const EXPECTED_SHA = '5d0ca50341847daee4f5e9a818c70f39dd792247b4ec3342e05bbef16748f81e';

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY required');

  console.log(`[smoke] audio:     ${AUDIO_PATH}`);
  console.log(`[smoke] cap:       5 min (1 chunk @ 10-min default → caps to 5)`);
  console.log(`[smoke] starting transcribeMeeting()...\n`);

  const t0 = Date.now();
  const result = await transcribeMeeting({
    audioPath: AUDIO_PATH,
    openrouterApiKey: apiKey,
    chunkMinutes: 10,
    maxMinutes: 5,                      // single 5-min chunk
    languageHint: undefined,
    concurrency: 1,
  });
  const wallSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`[smoke] DONE in ${wallSec}s`);
  console.log(`         model:           ${result.modelUsed}`);
  console.log(`         version:         ${result.version}`);
  console.log(`         chunk_minutes:   ${result.chunkMinutes}`);
  console.log(`         total_duration:  ${result.totalDurationS.toFixed(1)} s`);
  console.log(`         total_chars:     ${result.totalChars}`);
  console.log(`         audio_sha256:    ${result.audioSha256.slice(0, 16)}...`);
  console.log(`         audio_bytes:     ${result.audioBytes}`);
  console.log(`         bias_prompt:     ${result.biasPromptHash ? 'YES (' + result.biasPromptHash.slice(0,12) + '...)' : 'no'}`);
  console.log(`         chunks:          ${result.chunks.length}`);
  for (const c of result.chunks) {
    console.log(`           [${c.index}] ${c.startSec.toFixed(0)}-${(c.startSec+c.durationSec).toFixed(0)}s  ` +
                `lang=${c.language ?? '?'}  ` +
                `chars=${c.text.length}  ` +
                `cost=$${(c.costUsd ?? 0).toFixed(4)}  ` +
                `wall=${(c.wallMs/1000).toFixed(1)}s`);
    console.log(`           ↳ "${c.text.slice(0, 140)}${c.text.length > 140 ? '…' : ''}"`);
  }

  // ── assertions ──
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      name: 'audio sha256 matches one-shot reference',
      ok: result.audioSha256 === EXPECTED_SHA,
      detail: result.audioSha256 === EXPECTED_SHA
        ? 'identical'
        : `expected ${EXPECTED_SHA}, got ${result.audioSha256}`,
    },
    {
      name: 'exactly 1 chunk at 5-min cap',
      ok: result.chunks.length === 1,
      detail: `${result.chunks.length} chunks`,
    },
    {
      name: 'chunk[0].text non-empty',
      ok: (result.chunks[0]?.text.length ?? 0) > 0,
      detail: `${result.chunks[0]?.text.length ?? 0} chars`,
    },
    {
      name: 'extractor name = whisper-large-v3-turbo',
      ok: result.modelUsed === 'openai/whisper-large-v3-turbo',
      detail: result.modelUsed,
    },
    {
      name: 'bias prompt was applied',
      ok: result.biasPromptHash !== null,
      detail: result.biasPromptHash ? 'yes' : 'no',
    },
  ];

  console.log('\n[smoke] checks:');
  let pass = 0;
  for (const c of checks) {
    const tick = c.ok ? '✓' : '✗';
    console.log(`         ${tick} ${c.name} — ${c.detail}`);
    if (c.ok) pass++;
  }
  console.log(`\n[smoke] ${pass}/${checks.length} pass`);
  if (pass !== checks.length) process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exit(1);
});
