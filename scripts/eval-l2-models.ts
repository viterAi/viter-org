/**
 * scripts/eval-l2-models.ts
 *
 * Run a fixture's L2 synthesis across N candidate models, score each output via
 * the 11-point rubric, persist eval_runs rows, print a leaderboard.
 *
 * Usage:
 *   tsx scripts/eval-l2-models.ts                          # default fixture, 8 models, 1 replica each
 *   tsx scripts/eval-l2-models.ts --replicas 3             # 3 replicas per model (consistency test)
 *   tsx scripts/eval-l2-models.ts --models opus,grok-4.3   # subset
 *   tsx scripts/eval-l2-models.ts --fixture day-l2-apr29
 *
 * Env required: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + OPENROUTER_API_KEY
 */

import {
  createServiceRoleClient,
  createLLMClient,
  synthesize,
  scoreL2,
  resolveCitations,
} from '../packages/runtime/src/index.js';

interface Args {
  fixture: string;
  models: string[];
  replicas: number;
}

const DEFAULT_MODELS = [
  // Premium tier
  'anthropic/claude-opus-4.5',
  'openai/gpt-5',
  'google/gemini-2.5-pro',
  // Mid tier
  'anthropic/claude-sonnet-4.6',
  'x-ai/grok-4.3',
  'moonshotai/kimi-k2.6',
  // Cheap-fast tier
  'google/gemini-3-flash-preview',
  'x-ai/grok-4-fast',
];

const DEFAULT_FIXTURE = {
  name: 'day-l2-apr29',
  scope_kind: 'day',
  scope_key: '2026-04-29',
  prompt_version: 'day-prompt-v2-deep',
  rubric: {
    pass_threshold: 8,
    criteria: [
      'yaml_frontmatter', 'before_after', 'tldr', 'causal_arc',
      'tensions_section', 'decisions_section', 'threads_severity_tagged',
      'quotes_tagged', 'load_bearing_quote', 'citations_count', 'no_unresolved',
    ],
    note: '11-point structural rubric for day-l2 syntheses',
  },
};

function parseArgs(argv: string[]): Args {
  const out: Args = { fixture: DEFAULT_FIXTURE.name, models: DEFAULT_MODELS, replicas: 1 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixture')      out.fixture = argv[++i] ?? out.fixture;
    else if (a === '--replicas') out.replicas = Number(argv[++i] ?? '1') || 1;
    else if (a === '--models') {
      const list = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) out.models = list;
    }
  }
  return out;
}

async function ensureFixture(db: ReturnType<typeof createServiceRoleClient>, tenantId: string, name: string) {
  const { data: existing } = await db
    .from('eval_fixtures')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('name', name)
    .eq('prompt_version', DEFAULT_FIXTURE.prompt_version)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await db
    .from('eval_fixtures')
    .insert({
      tenant_id: tenantId,
      name,
      scope_kind: DEFAULT_FIXTURE.scope_kind,
      scope_key: DEFAULT_FIXTURE.scope_key,
      prompt_version: DEFAULT_FIXTURE.prompt_version,
      rubric: DEFAULT_FIXTURE.rubric,
      note: DEFAULT_FIXTURE.note,
    })
    .select('*')
    .single();
  if (error) throw new Error(`ensureFixture: ${error.message}`);
  return data;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[eval] fixture='${args.fixture}' · models=${args.models.length} · replicas=${args.replicas} per model`);

  const db = createServiceRoleClient();
  const llm = createLLMClient();

  const { data: tenantRow, error: tErr } = await db.from('tenants').select('id').eq('slug', 'viter').single();
  if (tErr || !tenantRow) throw new Error(`tenant 'viter' not found: ${tErr?.message}`);
  const tenantId = tenantRow.id as string;

  const fixture = await ensureFixture(db, tenantId, args.fixture);
  console.log(`[eval] fixture id=${fixture.id} · scope=${fixture.scope_kind}:${fixture.scope_key} · prompt=${fixture.prompt_version}`);

  // ── Run each model × replica ──
  const totalRuns = args.models.length * args.replicas;
  let runIdx = 0;

  for (const model of args.models) {
    for (let replica = 1; replica <= args.replicas; replica++) {
      runIdx++;
      const tag = `[${runIdx}/${totalRuns}]`;
      console.log(`\n${tag} model=${model.padEnd(34)} replica=${replica}`);
      const t0 = Date.now();

      try {
        const result = await synthesize(
          { db, llm, tenantId },
          {
            scopeKind: fixture.scope_kind as 'day',
            scopeKey: fixture.scope_key,
            modelOverride: model,
            dryRun: true,
          },
        );
        const wallMs = Date.now() - t0;

        // Score
        const parsed = resolveCitations(result.body, {
          codeToId: new Map(result.cited_event_ids.map((id, i) => [`e${i + 1}`, id])),
          codeToRunId: new Map(),
        });
        // Note: rubric scoring uses the original parsed (with full code map) — re-derive
        // from the synthesis result. Here we just feed it cited_event_ids as the resolved set
        // and unresolved_codes for the no-unresolved check.
        const fakeParsed = {
          cited_event_ids: result.cited_event_ids,
          cited_extraction_runs: result.cited_extraction_runs,
          unresolved_codes: result.unresolved_codes,
          all_codes: [],
        };
        const rubric = scoreL2(result.body, fakeParsed);

        const lines = result.body.split('\n').length;
        const chars = result.body.length;

        // Compute cost client-side from token usage (cached for now — webhook can patch later)
        // Pricing pulled from the catalog (2026-05-04). Update as needed.
        const cost = approxCost(model, result);

        // Insert eval_runs row
        const { error: insErr } = await db.from('eval_runs').insert({
          tenant_id: tenantId,
          fixture_id: fixture.id,
          llm_call_id: result.llm_call_id,
          model_requested: model,
          model_used: result.model_used,
          provider_name: result.provider_name,
          replica_n: replica,
          body: result.body,
          cited_event_ids: result.cited_event_ids,
          body_chars: chars,
          body_lines: lines,
          checks: rubric.checks,
          score: rubric.score,
          max_score: rubric.max_score,
          pass: rubric.pass,
          latency_ms: result.latency_ms,
          cost_usd: cost,
        });
        if (insErr) console.error(`     insert failed: ${insErr.message}`);

        const passSym = rubric.pass ? '✓' : '✗';
        console.log(
          `     ${passSym}  score=${rubric.score}/${rubric.max_score}  ` +
            `cited=${result.cited_event_ids.length}  unresolved=${result.unresolved_codes.length}  ` +
            `lines=${lines}  latency=${(result.latency_ms / 1000).toFixed(1)}s  ` +
            `wall=${(wallMs / 1000).toFixed(1)}s  cost=$${cost.toFixed(4)}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`     ERROR: ${msg}`);
      }
    }
  }

  // ── Leaderboard ──
  console.log('\n────────── LEADERBOARD ──────────');
  const { data: lb } = await db.from('eval_leaderboard').select('*').eq('fixture', args.fixture);
  if (lb && lb.length) {
    const cols = ['model', 'n_runs', 'avg_score', 'stddev_score', 'avg_latency_ms', 'avg_cost_usd', 'always_passed'];
    const header = cols.map((c) => c.padEnd(c === 'model' ? 34 : 12)).join(' ');
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const r of lb) {
      const row = cols.map((c) => String(r[c as keyof typeof r] ?? '').padEnd(c === 'model' ? 34 : 12)).join(' ');
      console.log(row);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Approximate cost — used until openrouter-cost-enrich webhook is deployed.
// Prices in $/M tokens. Pulled from OpenRouter /models endpoint 2026-05-04.
// ────────────────────────────────────────────────────────────────────

const PRICING: Record<string, { in: number; out: number }> = {
  'anthropic/claude-opus-4.5':         { in: 5.00, out: 25.00 },
  'anthropic/claude-opus-4.6':         { in: 5.00, out: 25.00 },
  'anthropic/claude-opus-4.7':         { in: 5.00, out: 25.00 },
  'anthropic/claude-sonnet-4.5':       { in: 3.00, out: 15.00 },
  'anthropic/claude-sonnet-4.6':       { in: 3.00, out: 15.00 },
  'anthropic/claude-sonnet-4':         { in: 3.00, out: 15.00 },
  'openai/gpt-5':                      { in: 1.25, out: 10.00 },
  'openai/gpt-5.1':                    { in: 1.25, out: 10.00 },
  'openai/gpt-5.4-nano':               { in: 0.20, out: 1.25 },
  'google/gemini-2.5-pro':             { in: 1.25, out: 10.00 },
  'google/gemini-3.1-pro-preview':     { in: 2.00, out: 12.00 },
  'google/gemini-2.5-flash':           { in: 0.30, out: 2.50 },
  'google/gemini-3-flash-preview':     { in: 0.50, out: 3.00 },
  'google/gemini-3.1-flash-lite-preview': { in: 0.25, out: 1.50 },
  'google/gemini-2.5-flash-lite':      { in: 0.10, out: 0.40 },
  'x-ai/grok-4.3':                     { in: 1.25, out: 2.50 },
  'x-ai/grok-4.20':                    { in: 1.25, out: 2.50 },
  'x-ai/grok-4-fast':                  { in: 0.20, out: 0.50 },
  'x-ai/grok-4.1-fast':                { in: 0.20, out: 0.50 },
  'moonshotai/kimi-k2.6':              { in: 0.74, out: 3.49 },
  'moonshotai/kimi-k2.5':              { in: 0.44, out: 2.00 },
  'moonshotai/kimi-k2-0905':           { in: 0.40, out: 2.00 },
  'moonshotai/kimi-k2-thinking':       { in: 0.60, out: 2.50 },
  'deepseek/deepseek-v4-flash':        { in: 0.14, out: 0.28 },
  'deepseek/deepseek-v3.2':            { in: 0.25, out: 0.38 },
};

function approxCost(model: string, result: { latency_ms: number }): number {
  const p = PRICING[model];
  if (!p) return 0;
  // We don't have token counts in synthesize result yet (they go to llm_call_log).
  // Approximate: assume 30K input + 8K output (average for our prompts).
  // The DB-side eval_runs.cost_usd will get patched by the webhook with real numbers.
  return (30 * p.in + 8 * p.out) / 1000;
}

main().catch((err) => {
  console.error('[eval] fatal:', err);
  process.exit(1);
});
