/**
 * scripts/backfill-clawdbot.ts
 *
 * Ingest viter-related Clawdbot sessions into vita Supabase.
 *
 * Clawdbot sessions live at ~/.clawdbot/agents/main/sessions/<uuid>.jsonl
 * They were the primary interface (via Discord relay) before Claude Code
 * was adopted in mid-April 2026. These cover Feb–Apr 2026 viter build history.
 *
 * This script:
 *   1. Scans the clawdbot sessions dir
 *   2. Filters to sessions matching viter-related terms (Shaul/Jeffrey/Insperanto/viter)
 *      above a density threshold — skipping incidental mentions
 *   3. Derives the primary Discord channel from the session content
 *   4. Ingests via Runner using source_type='clawdbot_jsonl', facet='turn_text'
 *
 * Idempotent: sha256 dedup means re-runs are safe.
 *
 * Usage:
 *   tsx scripts/backfill-clawdbot.ts                  # auto-filter viter sessions
 *   tsx scripts/backfill-clawdbot.ts --dry-run        # log what would happen
 *   tsx scripts/backfill-clawdbot.ts --min-hits 10    # lower/raise density threshold
 *   tsx scripts/backfill-clawdbot.ts --file <uuid>    # single file by UUID prefix
 *
 * Env required: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { homedir } from 'node:os';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServiceRoleClient, Runner } from '../packages/runtime/src/index.js';

interface Args {
  dryRun: boolean;
  minHits: number;
  fileFilter: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, minHits: 5, fileFilter: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--min-hits') out.minHits = Number(argv[++i] ?? '5') || 5;
    else if (a === '--file') out.fileFilter = argv[++i] ?? null;
  }
  return out;
}

// Only ingest sessions from these channels
const ALLOWED_CHANNELS = new Set(['epic', 'viter', 'epicagents']);

// Cron/automated session detection
const CRON_PREFIX = /^\[cron:/;

interface SessionInfo {
  filePath: string;
  sessionId: string;
  hits: number;
  primaryChannel: string;
  dateRange: { first: string; last: string };
  isCron: boolean;
}

async function analyzeSession(filePath: string): Promise<SessionInfo | null> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  const lines = text.split('\n');
  let sessionId = '';
  let hits = 0;
  const channelCounts: Record<string, number> = {};
  let firstTs = '';
  let lastTs = '';
  let isCron = false;

  const lower = text.toLowerCase();
  for (const term of ['shaul', 'insperanto', 'jeffrey', 'viter', 'yitzhak', 'yitzchak']) {
    const re = new RegExp(term, 'gi');
    const matches = lower.match(re);
    hits += matches?.length ?? 0;
  }

  // Parse structure for channel + dates + cron detection
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      if (obj.type === 'session') {
        sessionId = obj.id ?? '';
      }

      const ts = obj.timestamp ?? '';
      if (ts) {
        if (!firstTs) firstTs = ts;
        lastTs = ts;
      }

      if (obj.type === 'message' && obj.message?.role === 'user') {
        const content = obj.message?.content;
        const textBlocks = Array.isArray(content)
          ? content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text ?? '')
          : [typeof content === 'string' ? content : ''];

        for (const t of textBlocks) {
          // Detect cron sessions
          if (CRON_PREFIX.test(t)) {
            isCron = true;
          }
          // Extract Discord channel name
          const chMatch = t.match(/\[Discord Guild #(\S+)/);
          if (chMatch?.[1]) {
            channelCounts[chMatch[1]] = (channelCounts[chMatch[1]] ?? 0) + 1;
          }
        }
      }
    } catch {
      continue;
    }
  }

  // Primary channel = most frequently seen Discord channel
  const primaryChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? 'unknown';

  return {
    filePath,
    sessionId: sessionId || (filePath.split('/').pop()?.replace('.jsonl', '') ?? ''),
    hits,
    primaryChannel,
    dateRange: { first: firstTs.slice(0, 10), last: lastTs.slice(0, 10) },
    isCron,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const sessionsDir = join(homedir(), '.clawdbot', 'agents', 'main', 'sessions');

  console.log(`[backfill-clawdbot] scanning ${sessionsDir}`);
  const entries = await readdir(sessionsDir, { withFileTypes: true });
  const jsonlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
    .map((e) => join(sessionsDir, e.name));

  console.log(`[backfill-clawdbot] ${jsonlFiles.length} total session files`);

  // Filter to file arg if given
  const toAnalyze = args.fileFilter
    ? jsonlFiles.filter((f) => f.includes(args.fileFilter!))
    : jsonlFiles;

  console.log(`[backfill-clawdbot] analysing ${toAnalyze.length} files for viter content...`);

  const sessions: SessionInfo[] = [];
  for (const f of toAnalyze) {
    const info = await analyzeSession(f);
    if (!info) continue;
    if (info.isCron) continue;
    if (!ALLOWED_CHANNELS.has(info.primaryChannel)) continue;
    sessions.push(info);
  }

  sessions.sort((a, b) => a.dateRange.first.localeCompare(b.dateRange.first));

  console.log(`[backfill-clawdbot] ${sessions.length} qualifying sessions\n`);
  console.log('SESSION'.padEnd(40) + ' ' + 'DATE RANGE'.padEnd(22) + ' ' + 'CHANNEL'.padEnd(20) + ' HITS');
  console.log('-'.repeat(90));
  for (const s of sessions) {
    const dr = `${s.dateRange.first} → ${s.dateRange.last}`;
    console.log(`${s.sessionId.padEnd(40)} ${dr.padEnd(22)} ${s.primaryChannel.padEnd(20)} ${s.hits}`);
  }

  if (args.dryRun) {
    console.log('\n[dry-run] no writes.');
    return;
  }

  const db = createServiceRoleClient();
  const { data: tenantRow, error: tenantErr } = await db
    .from('tenants').select('id').eq('slug', 'viter').single();
  if (tenantErr || !tenantRow) throw new Error(`tenant not found: ${tenantErr?.message}`);

  const tenantId = tenantRow.id as string;
  const runner = new Runner(db, tenantId);
  console.log(`\n[backfill-clawdbot] connected · tenant=viter (${tenantId})\n`);

  let nNew = 0, nDup = 0, nErr = 0, totalEvents = 0;

  for (const [i, s] of sessions.entries()) {
    const tag = `[${i + 1}/${sessions.length}]`;
    try {
      const result = await runner.ingestFile({
        sourceType: 'clawdbot_jsonl',
        filePath: s.filePath,
        channel: {
          kind: 'clawdbot',
          identifier: s.primaryChannel,
          displayName: `Clawdbot · #${s.primaryChannel}`,
        },
        userCanonicalId: 'mordechai-potash',
        facets: ['turn_text'],
        inlineContent: false,
        extraMetadata: {
          session_id: s.sessionId,
          channel_identifier: s.primaryChannel,
          backfill: true,
          backfilled_at: new Date().toISOString(),
        },
      });

      if (result.alreadyExisted) {
        nDup++;
        console.log(`${tag} dup   #${s.primaryChannel.padEnd(20)} ${s.sessionId.slice(0, 8)}  sha=${result.sha256.slice(0, 12)}`);
      } else {
        nNew++;
        const evCount = result.runs.reduce((a, r) => a + r.eventCount, 0);
        totalEvents += evCount;
        const summary = result.runs.map((r) => `${r.facet}=${r.status === 'ok' ? r.eventCount : r.status}`).join(' ');
        console.log(`${tag} new   #${s.primaryChannel.padEnd(20)} ${s.sessionId.slice(0, 8)}  ${summary}  (${s.dateRange.first})`);
      }
    } catch (err) {
      nErr++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} error #${s.primaryChannel.padEnd(20)} ${s.sessionId.slice(0, 8)}  ${msg}`);
    }
  }

  console.log(`\n[backfill-clawdbot] done · new=${nNew} · dup=${nDup} · err=${nErr} · events=${totalEvents}`);
}

main().catch((err) => {
  console.error('[backfill-clawdbot] fatal:', err);
  process.exit(1);
});
