/**
 * scripts/synthesize.ts
 *
 * CLI for running an L2 synthesizer against vita.
 *
 * Usage:
 *   tsx scripts/synthesize.ts day 2026-04-29
 *   tsx scripts/synthesize.ts day 2026-04-29 --dry-run
 *   tsx scripts/synthesize.ts day 2026-04-29 --model claude-opus-4-5
 *
 * Env required: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY
 */

import { createServiceRoleClient } from '../packages/runtime/src/db.js';
import { createLLMClient, synthesize } from '../packages/runtime/src/synthesizers/index.js';
import type { ScopeKind } from '../packages/runtime/src/synthesizers/types.js';

interface Args {
  scopeKind: ScopeKind;
  scopeKey: string;
  dryRun: boolean;
  model: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let dryRun = false;
  let model: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--model') model = argv[++i] ?? undefined;
    else if (a !== undefined) positional.push(a);
  }
  const scopeKind = positional[0] as ScopeKind | undefined;
  const scopeKey = positional[1];
  if (!scopeKind || !scopeKey) {
    console.error('Usage: tsx scripts/synthesize.ts <scope_kind> <scope_key> [--dry-run] [--model X]');
    console.error('Example: tsx scripts/synthesize.ts day 2026-04-29');
    process.exit(2);
  }
  return { scopeKind, scopeKey, dryRun, model };
}

async function main() {
  const args = parseArgs(process.argv);
  const db = createServiceRoleClient();
  const llm = createLLMClient();

  // Resolve viter tenant_id
  const { data: tenantRow, error: tenantErr } = await db
    .from('tenants')
    .select('id')
    .eq('slug', 'viter')
    .single();
  if (tenantErr || !tenantRow) throw new Error(`tenant 'viter' not found: ${tenantErr?.message}`);

  console.log(`[synth] ${args.scopeKind}=${args.scopeKey}${args.dryRun ? ' (DRY RUN)' : ''}`);

  const result = await synthesize(
    { db, llm, tenantId: tenantRow.id as string },
    { scopeKind: args.scopeKind, scopeKey: args.scopeKey, dryRun: args.dryRun, modelOverride: args.model },
  );

  console.log(`\n[synth] events in scope: ${result.events_in_scope}`);
  console.log(`[synth] events cited:    ${result.events_cited}`);
  console.log(`[synth] generator:       ${result.generator}`);
  console.log(`[synth] inserted_id:     ${result.inserted_id ?? '(dry run / empty scope)'}`);
  if (result.unresolved_codes.length > 0) {
    console.warn(`[synth] ⚠ unresolved citation codes: ${result.unresolved_codes.join(', ')}`);
  }
  console.log('\n────── BODY ──────');
  console.log(result.body);
  console.log('──────────────────');
}

main().catch((err) => {
  console.error('[synth] fatal:', err);
  process.exit(1);
});
