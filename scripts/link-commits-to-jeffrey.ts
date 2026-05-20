/**
 * scripts/link-commits-to-jeffrey.ts
 *
 * Regex pass: link viter git commits that cite Jeffrey to their source l1_events
 * in the vita DB. Inserts rows into l1_relations(relation_type='implements').
 *
 * Strategy:
 *   - Parse git log for "Per Jeffrey YYYY-MM-DD [HH:MM] <channel>" citations
 *   - For WhatsApp citations → find nearest l1_event in mvp-dev channel (any actor)
 *     within ±2h of cited time, or same calendar day if no time given
 *   - For meeting/call citations → find Jeffrey's nearest transcription event in
 *     meeting-YYYY-MM-DD-* channel within ±2h, or same day
 *   - from_event_id = Jeffrey/mvp-dev event found
 *   - to_event_id   = commit_message l1_event (skipped — none ingested yet)
 *   - Inserts only when both from_event_id resolves; skips rows with no match
 *   - Idempotent: UNIQUE(from_event_id, to_event_id, relation_type) silences re-runs
 *
 * Usage (run from vita root — use orchestrator's node_modules for supabase-js):
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/link-commits-to-jeffrey.ts
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/link-commits-to-jeffrey.ts --dry-run
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TENANT_ID = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';
const JEFFREY_PRINCIPAL_ID = 'da66f06e-7e64-48af-9564-daab1ad3e9b5';
const VITER_REPO = '/Users/mordechai/viter-workspace/code';
const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000; // ±2 hours

const DRY_RUN = process.argv.includes('--dry-run');

// ── Supabase client ─────────────────────────────────────────────────────────

function makeClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Git log parsing ──────────────────────────────────────────────────────────

interface CommitCitation {
  sha: string;
  commitDate: string; // YYYY-MM-DD
  subject: string;
  body: string;
  citeText: string;
  citedDate: string;        // YYYY-MM-DD
  citedTime: string | null; // HH:MM or null
  channel: 'whatsapp' | 'meeting' | 'call';
}

// Patterns:
//   Per Jeffrey 2026-04-30 call: ...
//   Per Jeffrey 2026-04-30 13:35 WhatsApp ...
//   Per Jeffrey's verbal ask in the 2026-04-27 15:10 meeting
//   Per Jeffrey 2026-04-28 16:22 WhatsApp:
//   Per Jeffrey 2026-04-28 architecture memo (5:52 WhatsApp)
//   Per Jeffrey 2026-05-04 14:35:18 (live WhatsApp QA ...)
const CITE_RE = /Per Jeffrey(?:'s [^,\n]*)?\s+(?:verbal ask (?:in )?the\s+)?(\d{4}-\d{2}-\d{2})[,\s]+(?:\(?\s*(\d{1,2}:\d{2})(?::\d{2})?\s*\)?[,\s]+)?(WhatsApp|meeting|call)/gi;

function parseCommits(raw: string): CommitCitation[] {
  const blocks = raw.split('---COMMIT---').filter((b) => b.trim());
  const results: CommitCitation[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const sha = lines[0].trim();
    const commitDate = lines[1].trim();
    const subject = lines[2].trim();
    const body = lines.slice(3).join('\n');
    const fullText = subject + '\n' + body;

    // Reset lastIndex for each block
    CITE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITE_RE.exec(fullText)) !== null) {
      const citedDate = m[1];
      const rawTime = m[2] ?? null;
      const channelWord = (m[3] ?? '').toLowerCase();
      const channel: 'whatsapp' | 'meeting' | 'call' =
        channelWord === 'whatsapp' ? 'whatsapp' :
        channelWord === 'call'     ? 'call'     : 'meeting';

      // Normalise HH:MM → pad to 2 digits
      let citedTime: string | null = null;
      if (rawTime) {
        const [h, min] = rawTime.split(':');
        citedTime = `${h.padStart(2, '0')}:${min.padStart(2, '0')}`;
      }

      results.push({
        sha,
        commitDate,
        subject,
        body,
        citeText: m[0],
        citedDate,
        citedTime,
        channel,
      });
    }
  }

  return results;
}

// ── DB lookup helpers ────────────────────────────────────────────────────────

interface L1EventRow {
  id: string;
  event_at: string;
  facet: string;
  channel_id: string;
  actor_id: string | null;
}

/** Find the closest l1_event in mvp-dev channel near the cited time (±2h or same day). */
async function findWhatsAppEvent(
  sb: SupabaseClient,
  citedDate: string,
  citedTime: string | null,
): Promise<L1EventRow | null> {
  // Build time window
  let lo: string, hi: string;
  if (citedTime) {
    const centre = new Date(`${citedDate}T${citedTime}:00+03:00`); // IST = UTC+3
    lo = new Date(centre.getTime() - MATCH_WINDOW_MS).toISOString();
    hi = new Date(centre.getTime() + MATCH_WINDOW_MS).toISOString();
  } else {
    lo = `${citedDate}T00:00:00+03:00`;
    hi = `${citedDate}T23:59:59+03:00`;
  }

  const { data, error } = await sb
    .from('l1_events')
    .select('id, event_at, facet, channel_id, actor_id')
    .eq('tenant_id', TENANT_ID)
    .eq('facet', 'messages')
    .gte('event_at', lo)
    .lte('event_at', hi)
    .order('event_at', { ascending: true })
    .limit(50);

  if (error) throw new Error(`WhatsApp query failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  // Filter to mvp-dev channel — need channel_id for mvp-dev
  // We'll fetch the channel id once and cache
  const mvpDevId = await getMvpDevChannelId(sb);
  if (!mvpDevId) return null;

  const filtered = (data as L1EventRow[]).filter((e) => e.channel_id === mvpDevId);
  if (filtered.length === 0) return null;

  if (!citedTime) return filtered[0]; // any from that day

  // Pick closest to centre time
  const centre = new Date(`${citedDate}T${citedTime}:00+03:00`).getTime();
  filtered.sort((a, b) =>
    Math.abs(new Date(a.event_at).getTime() - centre) -
    Math.abs(new Date(b.event_at).getTime() - centre),
  );
  return filtered[0];
}

let _mvpDevChannelId: string | null | undefined = undefined;
async function getMvpDevChannelId(sb: SupabaseClient): Promise<string | null> {
  if (_mvpDevChannelId !== undefined) return _mvpDevChannelId;
  const { data, error } = await sb
    .from('channels')
    .select('id')
    .eq('tenant_id', TENANT_ID)
    .eq('identifier', 'mvp-dev')
    .single();
  if (error || !data) { _mvpDevChannelId = null; return null; }
  _mvpDevChannelId = (data as { id: string }).id;
  return _mvpDevChannelId;
}

/** Find the closest Jeffrey transcription event in meeting-YYYY-MM-DD-* channels on that date. */
async function findMeetingEvent(
  sb: SupabaseClient,
  citedDate: string,
  citedTime: string | null,
): Promise<L1EventRow | null> {
  let lo: string, hi: string;
  if (citedTime) {
    const centre = new Date(`${citedDate}T${citedTime}:00+03:00`);
    lo = new Date(centre.getTime() - MATCH_WINDOW_MS).toISOString();
    hi = new Date(centre.getTime() + MATCH_WINDOW_MS).toISOString();
  } else {
    lo = `${citedDate}T00:00:00+03:00`;
    hi = `${citedDate}T23:59:59+03:00`;
  }

  // Jeffrey transcription events on matching date across all meeting channels
  const { data, error } = await sb
    .from('l1_events')
    .select('id, event_at, facet, channel_id, actor_id')
    .eq('tenant_id', TENANT_ID)
    .eq('actor_id', JEFFREY_PRINCIPAL_ID)
    .eq('facet', 'transcription')
    .gte('event_at', lo)
    .lte('event_at', hi)
    .order('event_at', { ascending: true })
    .limit(50);

  if (error) throw new Error(`Meeting query failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  if (!citedTime) return (data as L1EventRow[])[0];

  const centre = new Date(`${citedDate}T${citedTime}:00+03:00`).getTime();
  (data as L1EventRow[]).sort((a, b) =>
    Math.abs(new Date(a.event_at).getTime() - centre) -
    Math.abs(new Date(b.event_at).getTime() - centre),
  );
  return (data as L1EventRow[])[0];
}

/** Look up a commit_message l1_event by SHA (from metadata or content). */
async function findCommitEvent(sb: SupabaseClient, sha: string): Promise<L1EventRow | null> {
  const { data, error } = await sb
    .from('l1_events')
    .select('id, event_at, facet, channel_id, actor_id')
    .eq('tenant_id', TENANT_ID)
    .eq('facet', 'commit_message')
    .filter('metadata->>commit_sha', 'eq', sha)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Commit event query failed: ${error.message}`);
  return data as L1EventRow | null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[link-commits-to-jeffrey] ${DRY_RUN ? 'DRY RUN — ' : ''}starting\n`);

  // 1. Parse git log
  const raw = execSync(
    `git -C ${VITER_REPO} log --no-merges --format="---COMMIT---\n%H\n%as\n%s\n%b" -200`,
    { encoding: 'utf-8' },
  );
  const citations = parseCommits(raw);
  console.log(`Found ${citations.length} Per-Jeffrey citations across git log\n`);

  const sb = makeClient();

  let nInserted = 0;
  let nDup = 0;
  let nNoMatch = 0;
  let nNoCommitEvent = 0;

  for (const cite of citations) {
    const tag = `  [${cite.sha.slice(0, 8)}]`;
    const timeLabel = cite.citedTime ?? 'no-time';

    // 2. Find the Jeffrey source event
    let sourceEvent: L1EventRow | null = null;
    if (cite.channel === 'whatsapp') {
      sourceEvent = await findWhatsAppEvent(sb, cite.citedDate, cite.citedTime);
    } else {
      // meeting or call → Jeffrey transcription
      sourceEvent = await findMeetingEvent(sb, cite.citedDate, cite.citedTime);
      // fallback: if no Jeffrey transcription found, try WhatsApp for 'call' citations
      // (some "call" refs are actually voice/WhatsApp)
      if (!sourceEvent && cite.channel === 'call') {
        sourceEvent = await findWhatsAppEvent(sb, cite.citedDate, cite.citedTime);
      }
    }

    if (!sourceEvent) {
      nNoMatch++;
      console.log(`${tag} NO_MATCH  ${cite.citedDate} ${timeLabel} ${cite.channel}  "${cite.subject.slice(0, 60)}"`);
      continue;
    }

    // 3. Look for commit_message event
    const commitEvent = await findCommitEvent(sb, cite.sha);
    if (!commitEvent) {
      nNoCommitEvent++;
      // Per spec: skip row if no commit event yet
      console.log(`${tag} NO_COMMIT_EVENT  from=${sourceEvent.id.slice(0, 8)} ${cite.citedDate} ${timeLabel}  "${cite.subject.slice(0, 60)}"`);
      continue;
    }

    // 4. Insert relation
    const metadata = {
      commit_sha: cite.sha,
      commit_subject: cite.subject,
      cite_text: cite.citeText,
      jeffrey_event_ts: sourceEvent.event_at,
    };

    if (DRY_RUN) {
      console.log(`${tag} DRY_RUN  from=${sourceEvent.id.slice(0, 8)} → to=${commitEvent.id.slice(0, 8)}  ${cite.citedDate} ${timeLabel} [${cite.channel}]`);
      nInserted++;
      continue;
    }

    const { error } = await sb.from('l1_relations').insert({
      tenant_id: TENANT_ID,
      from_event_id: sourceEvent.id,
      to_event_id: commitEvent.id,
      relation_type: 'implements',
      confidence: 0.99,
      method: 'regex_cite',
      metadata,
    });

    if (error) {
      if (error.code === '23505') {
        // duplicate — unique constraint
        nDup++;
        console.log(`${tag} DUP  from=${sourceEvent.id.slice(0, 8)} → to=${commitEvent.id.slice(0, 8)}`);
      } else {
        console.error(`${tag} ERROR  ${error.message}`);
      }
    } else {
      nInserted++;
      console.log(`${tag} INSERTED  from=${sourceEvent.id.slice(0, 8)} → to=${commitEvent.id.slice(0, 8)}  ${cite.citedDate} ${timeLabel} [${cite.channel}]`);
    }
  }

  console.log(`
╔═══════════════════════════════════════════════════╗
║  link-commits-to-jeffrey — REPORT                 ║
╠═══════════════════════════════════════════════════╣
║  Citations parsed       : ${String(citations.length).padEnd(24)}║
║  No source match        : ${String(nNoMatch).padEnd(24)}║
║  No commit_message event: ${String(nNoCommitEvent).padEnd(24)}║
║  Inserted               : ${String(nInserted).padEnd(24)}║
║  Duplicates (skipped)   : ${String(nDup).padEnd(24)}║
╚═══════════════════════════════════════════════════╝`);
}

main().catch((err) => {
  console.error('[link-commits-to-jeffrey] fatal:', err);
  process.exit(1);
});
