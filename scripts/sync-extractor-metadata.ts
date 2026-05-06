/**
 * Sync the TS extractor CATALOG into vita Supabase's `extractor_metadata` table.
 *
 * Source of truth: packages/runtime/src/extractors/catalog.ts
 * Target:          public.extractor_metadata in vita Supabase
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/sync-extractor-metadata.ts [--dry-run]
 *
 * On --dry-run, prints the diff without writing.
 *
 * Idempotent:
 *   - Each catalog entry → upsert by id (insert-or-update)
 *   - Rows in DB not in catalog → marked deprecated (status=deprecated, deprecated_at=now())
 *   - Rows already deprecated stay deprecated
 *
 * Run after editing catalog.ts, OR in CI on main-branch merge.
 */

import { CATALOG, type CatalogEntry } from '../packages/runtime/src/extractors/catalog.js';
import { createServiceRoleClient } from '../packages/runtime/src/db.js';

const DRY_RUN = process.argv.includes('--dry-run');

interface DbRow {
  id: string;
  family: string;
  facet: string;
  source_types: string[];
  intended_status: string;
  provider: string | null;
  pricing_model: unknown;
  benchmark_data: unknown;
  notes: string | null;
  superseded_by: string | null;
  deprecated_at: string | null;
}

function entryToRow(e: CatalogEntry): Omit<DbRow, 'deprecated_at'> {
  return {
    id: e.id,
    family: e.family,
    facet: e.facet,
    source_types: e.source_types,
    intended_status: e.intended_status,
    provider: e.provider,
    pricing_model: e.pricing_model,
    benchmark_data: e.benchmark_data ?? null,
    notes: e.notes,
    superseded_by: e.superseded_by ?? null,
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffRow(catalog: ReturnType<typeof entryToRow>, db: DbRow): string[] {
  const fields: Array<keyof typeof catalog> = ['family', 'facet', 'source_types', 'intended_status', 'provider', 'pricing_model', 'benchmark_data', 'notes', 'superseded_by'];
  const changes: string[] = [];
  for (const f of fields) {
    if (!deepEqual(catalog[f], (db as unknown as Record<string, unknown>)[f])) {
      changes.push(f);
    }
  }
  return changes;
}

async function main() {
  const db = createServiceRoleClient();
  console.log(`[sync] catalog has ${CATALOG.length} entries`);
  console.log(`[sync] mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write)'}`);

  // Fetch current DB state
  const { data: current, error: fetchErr } = await db
    .from('extractor_metadata')
    .select('*');
  if (fetchErr) throw new Error(`fetch extractor_metadata: ${fetchErr.message}`);
  const currentById = new Map<string, DbRow>(
    (current ?? []).map((r) => [(r as DbRow).id, r as DbRow]),
  );

  console.log(`[sync] DB has ${currentById.size} existing rows`);

  let toInsert = 0, toUpdate = 0, toDeprecate = 0, unchanged = 0;
  const ops: Array<{ op: 'insert' | 'update' | 'deprecate'; id: string; details?: string[] }> = [];

  for (const entry of CATALOG) {
    const row = entryToRow(entry);
    const existing = currentById.get(entry.id);

    if (!existing) {
      ops.push({ op: 'insert', id: entry.id });
      toInsert++;
      continue;
    }

    const changes = diffRow(row, existing);
    if (changes.length === 0) {
      unchanged++;
      continue;
    }
    ops.push({ op: 'update', id: entry.id, details: changes });
    toUpdate++;
  }

  // Deprecate: rows in DB that aren't in CATALOG and aren't already deprecated
  const catalogIds = new Set(CATALOG.map((e) => e.id));
  for (const [id, existing] of currentById) {
    if (catalogIds.has(id)) continue;
    if (existing.intended_status === 'deprecated') continue;
    ops.push({ op: 'deprecate', id });
    toDeprecate++;
  }

  console.log(`[sync] plan:`);
  console.log(`  inserts:    ${toInsert}`);
  console.log(`  updates:    ${toUpdate}`);
  console.log(`  deprecates: ${toDeprecate}`);
  console.log(`  unchanged:  ${unchanged}`);
  console.log();
  for (const op of ops) {
    const detail = op.details ? ` [${op.details.join(', ')}]` : '';
    console.log(`  ${op.op.padEnd(10)} ${op.id}${detail}`);
  }

  if (DRY_RUN) {
    console.log(`\n[sync] DRY RUN — no writes. Re-run without --dry-run to apply.`);
    return;
  }

  // Execute
  for (const entry of CATALOG) {
    const row = entryToRow(entry);
    const { error } = await db.from('extractor_metadata').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`upsert ${entry.id}: ${error.message}`);
  }
  for (const op of ops) {
    if (op.op !== 'deprecate') continue;
    const { error } = await db
      .from('extractor_metadata')
      .update({ intended_status: 'deprecated', deprecated_at: new Date().toISOString() })
      .eq('id', op.id);
    if (error) throw new Error(`deprecate ${op.id}: ${error.message}`);
  }

  console.log(`\n[sync] DONE — ${toInsert} inserted, ${toUpdate} updated, ${toDeprecate} deprecated`);
}

main().catch((err) => {
  console.error('[sync] fatal:', err);
  process.exit(1);
});
