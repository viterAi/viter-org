/**
 * adapters/file-watcher/src/claude-code.ts
 *
 * Live ingestion of Claude Code JSONL sessions into vita Supabase.
 *
 * Watches `~/.claude/projects/-Users-mordechai-*\/*.jsonl`.
 * On every write event:
 *   - debounce ~5s (Claude Code writes mid-turn; wait for the line to settle)
 *   - hash the file
 *   - call Runner.ingestFile (sha256-deduped, so unchanged files are no-ops)
 *
 * Each session re-extraction is idempotent under the pure-function rule;
 * a growing JSONL produces multiple artifacts (one per content snapshot),
 * each cleanly attributable. Query layer can pick latest by metadata.session_id.
 *
 * Run locally:
 *   pnpm --filter @viter-org/adapter-file-watcher watch
 *
 * Run as a launchd daemon (Mac):
 *   see README.md for the .plist template
 */

import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';

import chokidar from 'chokidar';
import { createServiceRoleClient, Runner } from '@viter-org/runtime';

const DEBOUNCE_MS = 5_000;

interface PendingFile {
  path: string;
  timer: ReturnType<typeof setTimeout>;
}

function deriveChannelIdentifierFromProjectDir(dirName: string): string {
  const cleaned = dirName.replace(/^-/, '');
  const parts = cleaned.split('-');
  if (parts.length >= 2) return parts.slice(-2).join('-');
  return cleaned || 'unknown';
}

function deriveChannelIdentifierFromPath(filePath: string): string {
  // filePath: ~/.claude/projects/-Users-mordechai-viter-workspace-Vita-Platform/abc.jsonl
  // dirname → ~/.claude/projects/-Users-mordechai-viter-workspace-Vita-Platform
  // basename of that → '-Users-mordechai-viter-workspace-Vita-Platform'
  const projectDir = basename(dirname(filePath));
  return deriveChannelIdentifierFromProjectDir(projectDir);
}

async function main() {
  const projectsRoot = join(homedir(), '.claude', 'projects');
  const userCanonical = process.env.VITER_ORG_USER_CANONICAL_ID ?? 'mordechai-potash';

  console.log(`[watcher] starting · projectsRoot=${projectsRoot} · user=${userCanonical}`);

  const db = createServiceRoleClient();

  // Resolve viter tenant_id
  const { data: tenantRow, error: tenantErr } = await db
    .from('tenants')
    .select('id')
    .eq('slug', 'viter')
    .single();
  if (tenantErr || !tenantRow) {
    throw new Error(`tenant 'viter' not found: ${tenantErr?.message}`);
  }
  const tenantId = tenantRow.id as string;
  const runner = new Runner(db, tenantId);

  await runner.ping();
  console.log(`[watcher] connected · tenant=viter (${tenantId})`);

  // Pending file map for debounce
  const pending = new Map<string, PendingFile>();

  function schedule(filePath: string) {
    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => void ingest(filePath), DEBOUNCE_MS);
    pending.set(filePath, { path: filePath, timer });
  }

  async function ingest(filePath: string) {
    pending.delete(filePath);
    const channelIdentifier = deriveChannelIdentifierFromPath(filePath);
    try {
      const result = await runner.ingestFile({
        sourceType: 'claude_code_jsonl',
        filePath,
        channel: {
          kind: 'claude-code',
          identifier: channelIdentifier,
          displayName: `Claude Code · ${channelIdentifier}`,
        },
        userCanonicalId: userCanonical,
        inlineContent: false,
        extraMetadata: { ingested_via: 'file-watcher' },
      });

      if (result.alreadyExisted) {
        console.log(`[watcher] dup     ${channelIdentifier} ${basename(filePath)}  sha=${result.sha256.slice(0, 12)}`);
      } else {
        const summary = result.runs.map((r) => `${r.facet}=${r.status === 'ok' ? r.eventCount : r.status}`).join(' ');
        console.log(`[watcher] new     ${channelIdentifier} ${basename(filePath)}  ${summary}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[watcher] error   ${channelIdentifier} ${basename(filePath)}  ${msg}`);
    }
  }

  // ignoreInitial=true by default: only catch NEW writes after start.
  // Set VITER_ORG_WATCHER_CATCHUP=1 to process all existing files on startup (will run
  // every JSONL through Runner.ingestFile; sha256 dedup makes already-ingested files
  // a no-op but FRESH files get fully ingested — pick scope deliberately).
  const catchUp = process.env.VITER_ORG_WATCHER_CATCHUP === '1';
  const watcher = chokidar.watch(`${projectsRoot}/-Users-mordechai-*/*.jsonl`, {
    persistent: true,
    ignoreInitial: !catchUp,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
  });
  console.log(`[watcher] mode: ${catchUp ? 'catch-up (ALL existing files)' : 'live-only (new writes only)'}`);

  watcher
    .on('add', (p) => {
      console.log(`[watcher] +add    ${basename(p)}`);
      schedule(p);
    })
    .on('change', (p) => {
      console.log(`[watcher] ~change ${basename(p)}`);
      schedule(p);
    })
    .on('error', (err) => {
      console.error(`[watcher] error: ${err}`);
    })
    .on('ready', () => {
      console.log(`[watcher] ready · watching for changes (${DEBOUNCE_MS}ms debounce)`);
    });

  // Graceful shutdown
  function shutdown() {
    console.log(`\n[watcher] shutdown · flushing ${pending.size} pending`);
    for (const p of pending.values()) clearTimeout(p.timer);
    void watcher.close().then(() => process.exit(0));
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[watcher] fatal:', err);
  process.exit(1);
});
