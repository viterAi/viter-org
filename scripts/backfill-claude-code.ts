/**
 * scripts/backfill-claude-code.ts
 *
 * Walk all `~/.claude/projects/-Users-mordechai-*` directories and ingest every
 * `.jsonl` session file into vita Supabase via the Runner.
 *
 * Idempotent: artifacts dedupe by sha256, so re-running on unchanged files is a no-op.
 *
 * Usage:
 *   tsx scripts/backfill-claude-code.ts                 # all projects
 *   tsx scripts/backfill-claude-code.ts --project viter # only matching dirs
 *   tsx scripts/backfill-claude-code.ts --dry-run       # log what would happen, no writes
 *   tsx scripts/backfill-claude-code.ts --limit 5       # only first N files
 *
 * Env required: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * Optional: VITER_ORG_TENANT_ID (default: viter slug looked up at runtime)
 *           VITER_ORG_USER_CANONICAL_ID (default: 'mordechai-potash')
 */

import { homedir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

import { createServiceRoleClient, Runner } from '../packages/runtime/src/index.js';

interface Args {
  projectFilter: string | null;
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { projectFilter: null, dryRun: false, limit: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.projectFilter = argv[++i] ?? null;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--limit') out.limit = Number(argv[++i] ?? '0') || null;
  }
  return out;
}

/**
 * `~/.claude/projects/-Users-mordechai-viter-workspace-Vita-Platform`
 *  → channel kind='claude-code', identifier='Vita-Platform'
 *
 * Strategy: take last path segment after the user's home prefix.
 *   '-Users-mordechai-viter-workspace-Vita-Platform'
 *   strip leading '-', split on '-Users-mordechai-' to get the cwd path,
 *   then derive a channel identifier from the last path component.
 */
function deriveChannelIdentifierFromProjectDir(dirName: string): string {
  // dirName: '-Users-mordechai-viter-workspace-Vita-Platform'
  // Most reliable: take last segment after the last '-' that looks like a path component
  const cleaned = dirName.replace(/^-/, '');
  // Heuristic: last token containing a capital letter, OR last 1-2 tokens
  const parts = cleaned.split('-');
  // Prefer the last 1-2 parts joined as a slug
  if (parts.length >= 2) {
    const last2 = parts.slice(-2).join('-');
    return last2;
  }
  return cleaned || 'unknown';
}

async function listJsonlFiles(projectsRoot: string, projectFilter: string | null): Promise<Array<{ projectDir: string; channelIdentifier: string; jsonlPath: string }>> {
  const projectDirs = await readdir(projectsRoot, { withFileTypes: true });
  const out: Array<{ projectDir: string; channelIdentifier: string; jsonlPath: string }> = [];

  for (const pd of projectDirs) {
    if (!pd.isDirectory()) continue;
    if (!pd.name.startsWith('-Users-mordechai-')) continue;
    if (projectFilter && !pd.name.toLowerCase().includes(projectFilter.toLowerCase())) continue;

    const channelIdentifier = deriveChannelIdentifierFromProjectDir(pd.name);
    const projectPath = join(projectsRoot, pd.name);
    const files = await readdir(projectPath, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      out.push({
        projectDir: pd.name,
        channelIdentifier,
        jsonlPath: join(projectPath, f.name),
      });
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectsRoot = join(homedir(), '.claude', 'projects');

  console.log(`[backfill] scanning ${projectsRoot}`);
  const allFiles = await listJsonlFiles(projectsRoot, args.projectFilter);
  console.log(`[backfill] found ${allFiles.length} jsonl files${args.projectFilter ? ` matching '${args.projectFilter}'` : ''}`);

  const files = args.limit ? allFiles.slice(0, args.limit) : allFiles;
  if (args.limit) console.log(`[backfill] limiting to first ${files.length}`);

  if (args.dryRun) {
    console.log(`[dry-run] would ingest:`);
    for (const f of files) console.log(`  ${f.channelIdentifier.padEnd(30)} ${basename(f.jsonlPath)}`);
    process.exit(0);
  }

  const db = createServiceRoleClient();

  // Resolve viter tenant_id
  const tenantSlug = 'viter';
  const { data: tenantRow, error: tenantErr } = await db
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single();
  if (tenantErr || !tenantRow) throw new Error(`tenant '${tenantSlug}' not found: ${tenantErr?.message}`);

  const tenantId = tenantRow.id as string;
  const userCanonical = process.env.VITER_ORG_USER_CANONICAL_ID ?? 'mordechai-potash';
  const runner = new Runner(db, tenantId);

  console.log(`[backfill] connected · tenant=${tenantSlug} (${tenantId}) · user=${userCanonical}`);

  let nNew = 0;
  let nDup = 0;
  let nErr = 0;
  let totalEvents = 0;

  for (const [i, f] of files.entries()) {
    const tag = `[${i + 1}/${files.length}]`;
    try {
      const result = await runner.ingestFile({
        sourceType: 'claude_code_jsonl',
        filePath: f.jsonlPath,
        channel: {
          kind: 'claude-code',
          identifier: f.channelIdentifier,
          displayName: `Claude Code · ${f.channelIdentifier}`,
        },
        userCanonicalId: userCanonical,
        inlineContent: false, // skip inline_text for backfill — keeps DB lean
        extraMetadata: {
          backfill: true,
          backfilled_at: new Date().toISOString(),
          project_dir: f.projectDir,
        },
      });

      if (result.alreadyExisted) {
        nDup++;
        console.log(`${tag} dup     ${f.channelIdentifier.padEnd(30)} ${basename(f.jsonlPath)}  sha=${result.sha256.slice(0, 12)}`);
      } else {
        nNew++;
        const evCount = result.runs.reduce((a, r) => a + r.eventCount, 0);
        totalEvents += evCount;
        const statusSummary = result.runs
          .map((r) => `${r.facet}=${r.status === 'ok' ? r.eventCount : r.status}`)
          .join(' ');
        console.log(`${tag} new     ${f.channelIdentifier.padEnd(30)} ${basename(f.jsonlPath)}  ${statusSummary}`);
      }
    } catch (err) {
      nErr++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} error   ${f.channelIdentifier.padEnd(30)} ${basename(f.jsonlPath)}  ${msg}`);
    }
  }

  console.log(`\n[backfill] done · new=${nNew} · dup=${nDup} · err=${nErr} · events=${totalEvents}`);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
