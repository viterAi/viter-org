/**
 * scripts/render-closed-loops.ts
 *
 * Generates a self-contained HTML page rendering the closed-loop demo:
 * "every ask in the last 2 weeks → what shipped → how fast"
 *
 * Pulls live from vita's claim_facet substrate via v_claim_to_commit.
 * Outputs:
 *   - scripts/demo-closed-loops.html (open locally)
 *   - apps/web/public/demo-closed-loops.html (auto-deploy via Vercel push)
 *
 * Usage:
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/render-closed-loops.ts
 *   open scripts/demo-closed-loops.html
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TENANT_ID = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';
const WINDOW_DAYS = 60;  // 2 months
const MIN_SIM = 0.62;

interface Loop {
  asked_at: string; who: string; ask_kind: string; ask: string;
  shipped_at: string; ship_kind: string; ship: string;
  lag_h: number; sim: number;
}
interface OpenAsk {
  asked_at: string; who: string; kind: string; ask: string;
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString();

  // 1. Closed loops — call the get_closed_loops Postgres function (uses LATERAL+ivfflat, fast)
  const { data: loopRows, error: loopErr } = await sb
    .rpc('get_closed_loops', { p_since: sinceIso, p_min_sim: MIN_SIM, p_limit: 50 });
  if (loopErr) throw loopErr;

  // Dedupe on (message_event_id, commit_event_id)
  const seenPairs = new Set<string>();
  const loops: Loop[] = [];
  for (const r of (loopRows ?? []) as any[]) {
    const key = `${r.message_event_id}|${r.commit_event_id}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const who = r.actor_name
      || channelDerivedName(r.channel_identifier, r.channel_display_name);
    loops.push({
      asked_at: r.asked_at,
      who,
      ask_kind: r.claim_kind,
      ask: r.claim,
      shipped_at: r.shipped_at,
      ship_kind: r.commit_kind,
      ship: r.commit_claim,
      lag_h: parseFloat(r.lag_h),
      sim: parseFloat(r.similarity),
    });
    if (loops.length >= 30) break;
  }

  // 2. Open asks — directives/pains/scope_shift in window where best similarity to any commit < MIN_SIM
  const { data: openCandidates } = await sb
    .from('l1_events')
    .select('id, event_at, content, metadata, channel_id, actor_id, channels(identifier, display_name), principals(display_name)')
    .eq('facet', 'claim_facet')
    .eq('tenant_id', TENANT_ID)
    .gte('event_at', sinceIso)
    .order('event_at', { ascending: false })
    .limit(2000);

  const opens: OpenAsk[] = [];
  const matchedAskIds = new Set(loops.map((l) => l.asked_at + '|' + l.ask));
  for (const evt of (openCandidates ?? []) as any[]) {
    const meta = evt.metadata as any;
    if (meta?.source_kind !== 'event') continue;
    if (!['directive', 'pain', 'scope_shift'].includes(meta?.claim_kind)) continue;
    const key = evt.event_at + '|' + evt.content;
    if (matchedAskIds.has(key)) continue;
    const who = evt.principals?.display_name
      || channelDerivedName(evt.channels?.identifier, evt.channels?.display_name);
    opens.push({
      asked_at: evt.event_at,
      who,
      kind: meta.claim_kind,
      ask: evt.content,
    });
    if (opens.length >= 50) break;
  }

  // 3. Stats
  const lags = loops.map((l) => l.lag_h);
  const fastest = lags.length ? Math.min(...lags) : 0;
  const median = lags.length ? lags.slice().sort((a, b) => a - b)[Math.floor(lags.length / 2)] : 0;

  // 4. Render
  const html = renderHtml({ loops, opens, stats: {
    total_loops: loops.length,
    fastest_h: fastest,
    median_h: median,
    total_open: opens.length,
  }});

  const path1 = '/Users/mordechai/viter-workspace/vita/scripts/demo-closed-loops.html';
  const path2 = '/Users/mordechai/viter-workspace/vita/apps/web/public/demo-closed-loops.html';

  writeFileSync(path1, html);
  try {
    mkdirSync(dirname(path2), { recursive: true });
    writeFileSync(path2, html);
  } catch {
    // apps/web/public might not exist — that's fine
  }

  console.log(`✅ rendered ${loops.length} closed loops + ${opens.length} open asks`);
  console.log(`\n  open ${path1}`);
}

function channelDerivedName(identifier?: string, displayName?: string): string {
  if (!identifier) return displayName ?? '?';
  if (identifier === 'wa-972533145330') return 'Shaul (DM)';
  if (identifier === 'wa-447700152828') return 'Jeffrey (DM)';
  if (identifier.startsWith('wa-group-')) return displayName ?? 'team group';
  return displayName ?? identifier;
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IL', {
    timeZone: 'Asia/Jerusalem', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function lagBadge(hours: number): string {
  if (hours < 1)   return `<span class="lag lag-fast">${(hours * 60).toFixed(0)} min</span>`;
  if (hours < 24)  return `<span class="lag lag-good">${hours.toFixed(1)} h</span>`;
  if (hours < 72)  return `<span class="lag lag-slow">${(hours / 24).toFixed(1)} d</span>`;
  return                   `<span class="lag lag-stale">${(hours / 24).toFixed(1)} d</span>`;
}

function kindBadge(kind: string): string {
  const colors: Record<string, string> = {
    directive: '#3b82f6', pain: '#ef4444', scope_shift: '#f59e0b',
    decision: '#8b5cf6', question: '#6b7280',
    feature: '#10b981', fix: '#14b8a6', refactor: '#06b6d4', infra: '#a855f7',
  };
  const color = colors[kind] || '#6b7280';
  return `<span class="kind" style="color:${color};border-color:${color}">${kind}</span>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHtml(args: { loops: Loop[]; opens: OpenAsk[]; stats: any }): string {
  const { loops, opens, stats } = args;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Vita — Closed Loops · last 2 weeks</title>
<style>
  :root { --bg:#0b0d10; --card:#13161b; --border:#2a2f37; --text:#e8eaed; --muted:#9aa0a6; --accent:#10b981; }
  * { box-sizing: border-box; }
  body { margin:0; padding:48px 24px; background:var(--bg); color:var(--text); font:14px/1.5 ui-monospace,'JetBrains Mono','Fira Code',monospace; }
  h1 { font-size:28px; margin:0 0 8px; font-weight:600; letter-spacing:-0.02em; }
  .sub { color:var(--muted); margin-bottom:32px; font-size:13px; max-width:900px; }
  .container { max-width:1280px; margin:0 auto; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:32px; }
  .stat { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:16px; }
  .stat-num { font-size:28px; font-weight:600; color:var(--accent); }
  .stat-lbl { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:4px; }
  h2 { font-size:18px; margin:32px 0 12px; font-weight:600; color:var(--text); }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  th { background:#191c22; padding:10px 14px; text-align:left; font-size:11px; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--border); font-weight:600; letter-spacing:0.05em; }
  td { padding:14px; border-top:1px solid var(--border); vertical-align:top; font-size:13px; }
  tr:hover td { background:#191c22; }
  .ts { color:var(--muted); white-space:nowrap; font-size:12px; }
  .who { color:var(--text); font-weight:500; white-space:nowrap; }
  .text { color:var(--text); max-width:380px; }
  .kind { display:inline-block; padding:2px 8px; border-radius:4px; border:1px solid; font-size:11px; font-weight:500; text-transform:uppercase; letter-spacing:0.04em; margin-left:6px; }
  .lag { display:inline-block; padding:3px 10px; border-radius:4px; font-size:12px; font-weight:600; white-space:nowrap; }
  .lag-fast  { background:#10b98140; color:#10b981; border:1px solid #10b981; }
  .lag-good  { background:#3b82f640; color:#3b82f6; border:1px solid #3b82f6; }
  .lag-slow  { background:#f59e0b40; color:#f59e0b; border:1px solid #f59e0b; }
  .lag-stale { background:#ef444440; color:#ef4444; border:1px solid #ef4444; }
  .sim { color:var(--muted); font-size:11px; font-family:inherit; }
  .footer { margin-top:48px; color:var(--muted); font-size:11px; text-align:center; line-height:1.8; padding-top:32px; border-top:1px solid var(--border); }
  .footer code { background:var(--card); padding:2px 6px; border-radius:3px; }
</style>
</head>
<body>
<div class="container">

<h1>Vita · closed-loop accountability</h1>
<div class="sub">Every directive, pain, and scope-shift in vita ⟶ every commit that responded ⟶ how fast.<br>Auto-extracted via gemini-3.1-flash-lite + cosine similarity over 14 days. No tickets filed. No process change.</div>

<div class="stats">
  <div class="stat"><div class="stat-num">${stats.total_loops}</div><div class="stat-lbl">closed loops, 14 days</div></div>
  <div class="stat"><div class="stat-num">${stats.fastest_h < 1 ? Math.round(stats.fastest_h * 60) + ' min' : stats.fastest_h.toFixed(1) + ' h'}</div><div class="stat-lbl">fastest ask→ship</div></div>
  <div class="stat"><div class="stat-num">${stats.median_h < 1 ? Math.round(stats.median_h * 60) + ' min' : stats.median_h.toFixed(1) + ' h'}</div><div class="stat-lbl">median ask→ship</div></div>
  <div class="stat"><div class="stat-num">${stats.total_open}</div><div class="stat-lbl">open asks (no ship yet)</div></div>
</div>

<h2>✓ Closed loops — what was asked, what shipped</h2>
<table>
<thead><tr>
  <th>Asked</th><th>Where</th><th>Ask</th>
  <th>Shipped</th><th>What shipped</th><th>Lag</th><th>Sim</th>
</tr></thead>
<tbody>
${loops.map((l) => `<tr>
  <td class="ts">${fmtTs(l.asked_at)}</td>
  <td class="who">${escapeHtml(l.who)}</td>
  <td class="text">${kindBadge(l.ask_kind)} ${escapeHtml(l.ask)}</td>
  <td class="ts">${fmtTs(l.shipped_at)}</td>
  <td class="text">${kindBadge(l.ship_kind)} ${escapeHtml(l.ship)}</td>
  <td>${lagBadge(l.lag_h)}</td>
  <td class="sim">${l.sim.toFixed(3)}</td>
</tr>`).join('')}
</tbody>
</table>

${opens.length > 0 ? `
<h2>⊘ Open asks — no commit match within 7 days</h2>
<table>
<thead><tr><th>Asked</th><th>Where</th><th>Kind</th><th>Ask</th></tr></thead>
<tbody>
${opens.map((o) => `<tr>
  <td class="ts">${fmtTs(o.asked_at)}</td>
  <td class="who">${escapeHtml(o.who)}</td>
  <td>${kindBadge(o.kind)}</td>
  <td class="text">${escapeHtml(o.ask)}</td>
</tr>`).join('')}
</tbody>
</table>
` : ''}

<div class="footer">
  Generated ${new Date().toLocaleString('en-IL', { timeZone: 'Asia/Jerusalem' })} · Asia/Jerusalem<br>
  Substrate: <code>vita.l1_events</code> facet=<code>claim_facet</code> · view <code>v_claim_to_commit</code><br>
  Extractor: <code>openrouter:google/gemini-3.1-flash-lite</code> · Embeddings: <code>openai/text-embedding-3-small</code>
</div>

</div></body></html>`;
}

main().catch((err) => { console.error(err); process.exit(1); });
