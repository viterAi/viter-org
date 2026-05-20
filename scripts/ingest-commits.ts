/**
 * scripts/ingest-commits.ts
 *
 * Ingest viter git commits into vita Supabase as l1_events with facet='commit_message'.
 *
 * For each commit:
 *   a) l0_artifact (source_type='git_commit', sha256=git SHA)
 *   b) l1_extraction_run (facet='commit_message', extractor='git:log@2026')
 *   c) l1_event (facet='commit_message', content=full commit message)
 *   d) l1_active_extraction
 *
 * Idempotent: sha256 dedup on l0_artifacts means re-runs are safe.
 *
 * Usage (run from vita root):
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/ingest-commits.ts
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID       = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';
const MORDECHAI_ID    = 'c42a9ba5-0aa7-4426-82e8-712db87f9710';
const VITER_REPO      = '/Users/mordechai/viter-workspace/code';
const FACET           = 'commit_message';
const EXTRACTOR       = 'git:log@2026';
const EXTRACTOR_VER   = '2026';
const SOURCE_TYPE     = 'git_commit';
const BATCH_SIZE      = 50;

// ── Supabase client ──────────────────────────────────────────────────────────

function makeClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Git log parsing ──────────────────────────────────────────────────────────

interface Commit {
  sha: string;
  date: string;     // YYYY-MM-DD
  isoDate: string;  // full ISO 8601
  subject: string;
  body: string;
}

function parseGitLog(raw: string): Commit[] {
  const blocks = raw.split('---COMMIT---').filter((b) => b.trim());
  const commits: Commit[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const sha     = lines[0].trim();
    const date    = lines[1].trim();    // %as → YYYY-MM-DD
    const isoDate = lines[2].trim();    // %aI → full ISO
    const subject = lines[3]?.trim() ?? '';
    const body    = lines.slice(4).join('\n').trim();

    if (!sha || sha.length < 40) continue;

    commits.push({ sha, date, isoDate, subject, body });
  }

  return commits;
}

// ── Bootstrap: ensure source_type + channel exist ───────────────────────────

async function ensureSourceType(sb: SupabaseClient): Promise<void> {
  // l0_source_types has no tenant_id — it's a global registry
  const { error } = await sb.from('l0_source_types').upsert(
    {
      source_type: SOURCE_TYPE,
      description: 'Git commit from a source repository',
      default_facets: ['commit_message'],
      metadata: {},
    },
    { onConflict: 'source_type', ignoreDuplicates: true },
  );
  if (error) throw new Error(`ensureSourceType: ${error.message}`);
  console.log(`  source_type '${SOURCE_TYPE}' ready`);
}

async function ensureChannel(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from('channels')
    .upsert(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        kind: 'repository',
        identifier: 'viter-git',
        display_name: 'Viter Git History',
        scope: 'tenant',
        metadata: { repo: 'viter', source: 'git:log@2026' },
      },
      { onConflict: 'tenant_id,kind,identifier', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) throw new Error(`ensureChannel: ${error.message}`);
  const channelId = (data as { id: string }).id;
  console.log(`  channel 'viter-git' → ${channelId}`);
  return channelId;
}

// ── Per-commit ingest ────────────────────────────────────────────────────────

interface IngestResult {
  sha: string;
  isNew: boolean;
  eventId?: string;
}

async function ingestBatch(
  sb: SupabaseClient,
  commits: Commit[],
  channelId: string,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];

  for (const commit of commits) {
    // ── a) l0_artifact ──────────────────────────────────────────────────────
    const { data: artData, error: artErr } = await sb
      .from('l0_artifacts')
      .upsert(
        {
          id: randomUUID(),
          tenant_id: TENANT_ID,
          source_type: SOURCE_TYPE,
          source_uri: `git://viter/${commit.sha}`,
          sha256: commit.sha,                       // git SHA is the content hash
          origin_at: commit.isoDate,
          captured_at: new Date().toISOString(),
          creator: MORDECHAI_ID,
          upstream_status: 'live',
          promoted: false,
          metadata: {
            repo: 'viter',
            commit_sha: commit.sha,
            subject: commit.subject,
          },
        },
        { onConflict: 'tenant_id,sha256', ignoreDuplicates: false },
      )
      .select('id, created_at')
      .single();

    if (artErr) throw new Error(`l0_artifact (${commit.sha.slice(0, 8)}): ${artErr.message}`);
    const artifactId = (artData as { id: string; created_at: string }).id;

    // Detect "new" by checking whether this artifact already had an l1_event
    const { count: existingEventCount } = await sb
      .from('l1_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_ID)
      .eq('artifact_id', artifactId)
      .eq('facet', FACET);

    const isNew = (existingEventCount ?? 0) === 0;

    if (!isNew) {
      results.push({ sha: commit.sha, isNew: false });
      continue;
    }

    // ── b) l1_extraction_run ────────────────────────────────────────────────
    const now = new Date().toISOString();
    const { data: runData, error: runErr } = await sb
      .from('l1_extraction_runs')
      .upsert(
        {
          id: randomUUID(),
          tenant_id: TENANT_ID,
          artifact_id: artifactId,
          facet: FACET,
          extractor: EXTRACTOR,
          version: EXTRACTOR_VER,
          parameters: {},
          is_deterministic: true,
          status: 'ok',
          representation: ['text/commit'],
          started_at: now,
          completed_at: now,
          metrics: { commit_sha: commit.sha },
        },
        {
          onConflict: 'tenant_id,artifact_id,facet,extractor,version,parameters',
          ignoreDuplicates: false,
        },
      )
      .select('id')
      .single();

    if (runErr) throw new Error(`l1_extraction_run (${commit.sha.slice(0, 8)}): ${runErr.message}`);
    const runId = (runData as { id: string }).id;

    // ── c) l1_event ─────────────────────────────────────────────────────────
    const content = commit.body
      ? `${commit.subject}\n\n${commit.body}`.trim()
      : commit.subject;

    const eventId = randomUUID();
    const { error: evErr } = await sb.from('l1_events').insert({
      id: eventId,
      tenant_id: TENANT_ID,
      artifact_id: artifactId,
      extraction_run_id: runId,
      facet: FACET,
      event_at: commit.isoDate,
      position: 0,
      actor_id: MORDECHAI_ID,
      channel_id: channelId,
      modality: 'text',
      content,
      extraction_method: EXTRACTOR,
      metadata: {
        commit_sha: commit.sha,
        commit_date: commit.date,
        subject: commit.subject,
        body_preview: commit.body.slice(0, 200),
      },
    });

    if (evErr) {
      // 23505 = unique violation — race condition, treat as duplicate
      if (evErr.code === '23505') {
        results.push({ sha: commit.sha, isNew: false });
        continue;
      }
      throw new Error(`l1_event (${commit.sha.slice(0, 8)}): ${evErr.message}`);
    }

    // ── d) l1_active_extraction ─────────────────────────────────────────────
    const { error: activeErr } = await sb.from('l1_active_extraction').upsert(
      {
        tenant_id: TENANT_ID,
        artifact_id: artifactId,
        facet: FACET,
        active_run_id: runId,
        promoted_by: 'ingest-commits',
        reason: `first-promote: git commit ${commit.sha.slice(0, 12)}`,
      },
      { onConflict: 'tenant_id,artifact_id,facet' },
    );

    if (activeErr) throw new Error(`l1_active_extraction (${commit.sha.slice(0, 8)}): ${activeErr.message}`);

    results.push({ sha: commit.sha, isNew: true, eventId });
  }

  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[ingest-commits] starting\n');

  // 1. Parse git log — use $'\n' so the shell expands real newlines in the format
  const raw = execSync(
    `git -C ${VITER_REPO} log --no-merges $'--format=---COMMIT---\\n%H\\n%as\\n%aI\\n%s\\n%b' -300`,
    { encoding: 'utf-8', shell: '/bin/bash' },
  );
  const commits = parseGitLog(raw);
  console.log(`Parsed ${commits.length} commits from viter git log\n`);

  const sb = makeClient();

  // 2. Bootstrap
  console.log('Bootstrap:');
  await ensureSourceType(sb);
  const channelId = await ensureChannel(sb);
  console.log('');

  // 3. Process in batches
  let nNew = 0;
  let nDup = 0;
  const newCommits: Commit[] = [];

  for (let i = 0; i < commits.length; i += BATCH_SIZE) {
    const batch = commits.slice(i, i + BATCH_SIZE);
    const results = await ingestBatch(sb, batch, channelId);

    for (const r of results) {
      if (r.isNew) {
        nNew++;
        const c = commits.find((x) => x.sha === r.sha)!;
        newCommits.push(c);
      } else {
        nDup++;
      }
    }

    const end = Math.min(i + BATCH_SIZE, commits.length);
    console.log(`  processed ${end}/${commits.length} — new=${nNew} dup=${nDup}`);
  }

  // 4. Summary
  const recent5 = commits.slice(0, 5);

  console.log(`
╔═══════════════════════════════════════════════════╗
║  ingest-commits — REPORT                          ║
╠═══════════════════════════════════════════════════╣
║  Total commits processed : ${String(commits.length).padEnd(22)}║
║  New (ingested)          : ${String(nNew).padEnd(22)}║
║  Already existed (dedup) : ${String(nDup).padEnd(22)}║
╚═══════════════════════════════════════════════════╝

5 most recent commits:
`);

  for (const c of recent5) {
    const isNew = newCommits.some((x) => x.sha === c.sha);
    const tag = isNew ? '[new]' : '[dup]';
    console.log(`  ${tag} ${c.sha.slice(0, 8)}  ${c.date}  ${c.subject.slice(0, 72)}`);
  }

  console.log('');
}

main().catch((err) => {
  console.error('[ingest-commits] fatal:', err);
  process.exit(1);
});
