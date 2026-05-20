/**
 * scripts/ingest-structured-requirements.ts
 *
 * Ingest Jeffrey's product requirements into vita Supabase as l1_events
 * with facet='structured_requirement'. Creates the semantic layer for
 * embedding and requirement-to-commit linking.
 *
 * Steps:
 *   1. Upsert channel 'jeffrey-requirements' (kind: 'backlog')
 *   2. Upsert l0_artifact for the master backlog document
 *   3. Upsert l1_extraction_run (facet: 'structured_requirement')
 *   4. Insert l1_events (one per requirement) — deduped by metadata.requirement_id
 *
 * Idempotent: re-runs skip already-inserted requirement_ids.
 *
 * Usage (from vita root):
 *   npx --prefix packages/orchestrator tsx --env-file=.env.local scripts/ingest-structured-requirements.ts
 *
 * Env required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID    = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';
const JEFFREY_ID   = 'da66f06e-7e64-48af-9564-daab1ad3e9b5';
const FACET        = 'structured_requirement';
const EXTRACTOR    = 'human:classification@2026';
const EXTRACTOR_VER = '1';
const SOURCE_TYPE  = 'backlog_document';

// ── Requirements data ────────────────────────────────────────────────────────

interface Requirement {
  requirement_id: string;
  category: string;
  priority: string;
  event_at: string;
  source_channel: string;
  original_quote: string;
  content: string;
}

const requirements: Requirement[] = [
  // DOMAIN RULES
  { requirement_id: 'R01', category: 'rule', priority: 'p0', event_at: '2026-04-16', source_channel: 'whatsapp', original_quote: 'If the invoice number and amount match, then date differences should be ignored or treated as non-critical.', content: 'RULE: Invoice number and amount exact match auto-approves the reconciliation item regardless of date difference.' },
  { requirement_id: 'R02', category: 'rule', priority: 'p0', event_at: '2026-05-04', source_channel: 'whatsapp', original_quote: 'The variance includes the paid invoices which are not a variance per say but should be identified as Invoices paid but still reflected on Statement', content: 'RULE: Paid invoices still appearing on supplier statement are not a variance — they are a separate category called paid-but-still-on-statement.' },
  { requirement_id: 'R03', category: 'rule', priority: 'p0', event_at: '2026-03-31', source_channel: 'whatsapp', original_quote: 'it could be you are including Sales Invoices which needs to excluded', content: 'RULE: Sales invoices (AR) must be excluded from AP supplier reconciliation balance calculations.' },
  { requirement_id: 'R04', category: 'rule', priority: 'p1', event_at: '2026-04-16', source_channel: 'whatsapp', original_quote: 'Rule - last update is King', content: 'RULE: When multiple statements exist for a supplier, the most recently uploaded statement supersedes all previous ones.' },
  { requirement_id: 'R05', category: 'rule', priority: 'p1', event_at: '2026-04-19', source_channel: 'whatsapp', original_quote: 'ignore timing differences - please note that during a month we settle invoices, so the amount owed is lower by these invoices paid', content: 'RULE: Timing differences — invoices settled within the current payment cycle — must be excluded from variance calculations.' },
  { requirement_id: 'R06', category: 'rule', priority: 'p1', event_at: '2026-04-19', source_channel: 'whatsapp', original_quote: 'the variance should be the value in Source currency of missing invoices, and incorrect invoice amounts', content: 'RULE: Variance is defined as the sum of missing invoices plus amount mismatches only, displayed in source currency not GBP.' },
  { requirement_id: 'R07', category: 'rule', priority: 'p1', event_at: '2026-04-16', source_channel: 'whatsapp', original_quote: 'For supplier Recon it is 100%, GBP is an estimate', content: 'RULE: GBP currency conversions are estimates only. Source currency reconciliation targets 100% accuracy.' },
  { requirement_id: 'R08', category: 'rule', priority: 'p1', event_at: '2026-04-27', source_channel: 'meeting', original_quote: 'the way I did work in progress was — when basically when I have a cost but no invoice', content: 'RULE: Work in progress is defined as cost present with no sales invoice raised. Projects invoiced at a loss are not WIP.' },
  { requirement_id: 'R09', category: 'rule', priority: 'p1', event_at: '2026-04-30', source_channel: 'meeting', original_quote: 'Just so we have a fixed date — 25th of May, the 25th of each month we have a payment run', content: 'RULE: Payment run occurs on the 25th of each month as a fixed cadence.' },
  { requirement_id: 'R10', category: 'rule', priority: 'p1', event_at: '2026-04-27', source_channel: 'meeting', original_quote: 'No, they are both supplier and a customer.', content: 'RULE: A supplier can simultaneously be a customer. AP and AR balances must not cross-contaminate for such entities.' },
  { requirement_id: 'R11', category: 'rule', priority: 'p2', event_at: '2026-04-27', source_channel: 'meeting', original_quote: 'Anything with INS is a post-prosecution in the old system. Put a P in front of every post-prosecution in those numbers.', content: 'RULE: Invoice numbers with INS- prefix indicate post-prosecution work from the legacy system. New system uses P- prefix.' },
  { requirement_id: 'R12', category: 'rule', priority: 'p2', event_at: '2026-04-27', source_channel: 'meeting', original_quote: "if it's a 700 job which is like over a year old, that has to be by definition", content: 'RULE: Post-prosecution detection by job number age: job numbers 700+ indicate over one year old, therefore post-prosecution by definition.' },
  { requirement_id: 'R14', category: 'rule', priority: 'p1', event_at: '2026-04-27', source_channel: 'meeting', original_quote: 'Spend is sales less official fees. We call it spend.', content: 'RULE: Spend equals Sales minus Official Fees. This is the margin base for gross profit calculations, not total sales.' },
  { requirement_id: 'R16', category: 'rule', priority: 'p0', event_at: '2026-04-20', source_channel: 'whatsapp', original_quote: 'No reconciliation → no payment', content: 'RULE: A supplier cannot enter the payment queue until their reconciliation is complete and confirmed.' },
  { requirement_id: 'R17', category: 'rule', priority: 'p1', event_at: '2026-04-27', source_channel: 'meeting', original_quote: "For us it's closed when it's invoiced.", content: 'RULE: A job is marked closed when the client invoice is raised, not when the work is delivered.' },
  // P0 BUGS
  { requirement_id: 'B03', category: 'bug', priority: 'p0', event_at: '2026-04-16', source_channel: 'whatsapp', original_quote: 'KHIP (does not appear at all despite the statement being uploaded)', content: 'BUG: Supplier alias name mapping fails — statement uploads do not attach to the correct supplier when the statement company name differs from the Xero contact name.' },
  { requirement_id: 'B04', category: 'bug', priority: 'p0', event_at: '2026-04-29', source_channel: 'whatsapp', original_quote: 'I just uploaded Hepworth - there are two currencies - Euro is fully aligned and the GBP has a few strange items', content: 'BUG: Multi-currency supplier statements — when a supplier has invoices in both EUR and GBP, the system mixes currencies instead of tracking separate per-currency balances.' },
  { requirement_id: 'B06', category: 'bug', priority: 'p0', event_at: '2026-05-05', source_channel: 'whatsapp', original_quote: 'should be a global refresh after upload', content: 'BUG: The supplier reconciliation dashboard does not auto-refresh when a background reconciliation completes — user must manually reload.' },
  { requirement_id: 'B07', category: 'bug', priority: 'p0', event_at: '2026-04-23', source_channel: 'whatsapp', original_quote: 'also need date of invoice, and the invoice amount in number not text', content: 'BUG: Excel export is missing project reference column, and descriptions/references are not surfaced per line item.' },
  { requirement_id: 'B08', category: 'bug', priority: 'p0', event_at: '2026-04-28', source_channel: 'whatsapp', original_quote: 'keep data only from 1 Jan 26', content: 'BUG: Suppliers missing-in-Xero count includes pre-2026 data — needs date filter to only show reconciliation gaps from January 2026 onward.' },
  // P1 FEATURES
  { requirement_id: 'F01', category: 'feature', priority: 'p1', event_at: '2026-04-30', source_channel: 'meeting', original_quote: 'maybe you can have another column: your date paid', content: 'FEATURE: Add a date_paid column to the reconciliation view showing when each invoice was last paid.' },
  { requirement_id: 'F02', category: 'feature', priority: 'p1', event_at: '2026-04-30', source_channel: 'meeting', original_quote: 'I should get a button — the payment run, tickable action to pay. I say to pay in the next round', content: 'FEATURE: Payment run button with per-supplier tickable selection. User marks suppliers for the next monthly payment run on the 25th.' },
  { requirement_id: 'F03', category: 'feature', priority: 'p1', event_at: '2026-04-30', source_channel: 'meeting', original_quote: "statement total is 57, what's showing Xero 48, difference is 17. I want to see it almost in the Excel. It should be zero.", content: 'FEATURE: Variance breakdown panel showing: statement total / Xero total / post-statement items / explained difference / unexplained difference (target: zero).' },
  { requirement_id: 'F04', category: 'feature', priority: 'p1', event_at: '2026-04-16', source_channel: 'whatsapp', original_quote: 'have a list of service providers in the page - and there will be a flag if no statement received', content: 'FEATURE: Supplier watchlist with no-statement-received flag. Suppliers without an uploaded statement are flagged prominently.' },
  { requirement_id: 'F05', category: 'feature', priority: 'p1', event_at: '2026-04-16', source_channel: 'whatsapp', original_quote: 'We need to have override - mark as reconciled feature for difficult cases', content: 'FEATURE: Manual mark-as-reconciled override for difficult cases where automatic matching fails but the CFO has verified agreement.' },
  { requirement_id: 'F06', category: 'feature', priority: 'p1', event_at: '2026-04-16', source_channel: 'document', original_quote: 'Ideally, there are two outputs when reconciling — request missing invoices, and payment. Also, need email template to request missing invoices.', content: 'FEATURE: Auto-generate request-missing-invoices email to supplier after reconciliation identifies unrecorded items, with a standard template.' },
  { requirement_id: 'F07', category: 'feature', priority: 'p1', event_at: '2026-04-16', source_channel: 'document', original_quote: 'add another column: suggested payment. From this, we start to build out the payment, and column for date of last payment', content: 'FEATURE: Suggested payment column on supplier list showing calculated payment amount with date of last payment.' },
  { requirement_id: 'F08', category: 'feature', priority: 'p1', event_at: '2026-05-07', source_channel: 'whatsapp', original_quote: 'would it be possible to write on the supplier portal - comments or I can mark this reconciled reviewed', content: 'FEATURE: Free-text comments and status flag (completed/pending/reviewed) per supplier reconciliation on the portal.' },
  { requirement_id: 'F13', category: 'feature', priority: 'p1', event_at: '2026-04-28', source_channel: 'whatsapp', original_quote: 'Show Total Suppliers Owed, Suggested Payments Due, No of Invoices Not Received, Number of Statements Not Received - more meaningful KPIs', content: 'FEATURE: Replace current supplier KPI tiles with four operational metrics: Total Suppliers Owed / Suggested Payments Due / Invoices Not Received / Statements Not Received.' },
  // STRATEGIC / ARCHITECTURE
  { requirement_id: 'S13', category: 'strategic', priority: 'p0', event_at: '2026-05-10', source_channel: 'whatsapp', original_quote: 'Pause all Plunet-related work for now. Our immediate priority should be validating the Xero logic, solving real operational pain points', content: 'DECISION: Pause Plunet integration. Focus exclusively on Xero reconciliation logic validation and operational pain points.' },
  { requirement_id: 'A01', category: 'architecture', priority: 'p0', event_at: '2026-05-05', source_channel: 'document', original_quote: 'Every record must include client_id', content: 'DECISION: Multi-tenant architecture — every database record must include client_id before any other work proceeds.' },
  { requirement_id: 'A02', category: 'architecture', priority: 'p0', event_at: '2026-05-05', source_channel: 'document', original_quote: 'Xero = CORE (always required); Plunet = OPTIONAL MODULE (separately deployable)', content: 'DECISION: Xero is the required core integration. Plunet is an optional separately-deployable module. Light version (Xero-only) is Stage 1 commercial product.' },
];

// ── Supabase client ──────────────────────────────────────────────────────────

function makeClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Step 1: Ensure source_type ───────────────────────────────────────────────

async function ensureSourceType(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.from('l0_source_types').upsert(
    {
      source_type: SOURCE_TYPE,
      description: 'Backlog document — manually classified requirements from a client or stakeholder',
      default_facets: ['structured_requirement'],
      metadata: {},
    },
    { onConflict: 'source_type', ignoreDuplicates: true },
  );
  if (error) throw new Error(`ensureSourceType: ${error.message}`);
  console.log(`  source_type '${SOURCE_TYPE}' ready`);
}

// ── Step 2: Upsert channel ───────────────────────────────────────────────────

async function ensureChannel(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from('channels')
    .upsert(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        kind: 'backlog',
        identifier: 'jeffrey-requirements',
        display_name: 'Jeffrey Requirements (structured)',
        scope: 'tenant',
        metadata: { source: 'human:classification@2026', owner: 'jeffrey' },
      },
      { onConflict: 'tenant_id,kind,identifier', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) throw new Error(`ensureChannel: ${error.message}`);
  const channelId = (data as { id: string }).id;
  console.log(`  channel 'jeffrey-requirements' → ${channelId}`);
  return channelId;
}

// ── Step 3: Upsert l0_artifact ───────────────────────────────────────────────

async function ensureArtifact(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from('l0_artifacts')
    .upsert(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        source_type: SOURCE_TYPE,
        source_uri: 'vita://backlog/jeffrey-master-backlog',
        sha256: 'jeffrey-master-backlog-v1',
        origin_at: '2026-05-10T00:00:00Z',
        captured_at: new Date().toISOString(),
        creator: JEFFREY_ID,
        upstream_status: 'live',
        promoted: false,
        metadata: {
          description: 'Jeffrey master backlog — structured requirements v1',
          version_key: 'jeffrey-master-backlog-v1',
        },
      },
      { onConflict: 'tenant_id,sha256', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) throw new Error(`ensureArtifact: ${error.message}`);
  const artifactId = (data as { id: string }).id;
  console.log(`  l0_artifact 'jeffrey-master-backlog-v1' → ${artifactId}`);
  return artifactId;
}

// ── Step 4: Upsert l1_extraction_run ────────────────────────────────────────

async function ensureExtractionRun(sb: SupabaseClient, artifactId: string): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await sb
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
        representation: ['text/requirement'],
        started_at: now,
        completed_at: now,
        metrics: { total_requirements: requirements.length },
      },
      {
        onConflict: 'tenant_id,artifact_id,facet,extractor,version,parameters',
        ignoreDuplicates: false,
      },
    )
    .select('id')
    .single();

  if (error) throw new Error(`ensureExtractionRun: ${error.message}`);
  const runId = (data as { id: string }).id;
  console.log(`  l1_extraction_run → ${runId}`);
  return runId;
}

// ── Step 5: Fetch existing requirement_ids ───────────────────────────────────

async function fetchExistingRequirementIds(
  sb: SupabaseClient,
  artifactId: string,
): Promise<Set<string>> {
  const { data, error } = await sb
    .from('l1_events')
    .select('metadata')
    .eq('tenant_id', TENANT_ID)
    .eq('artifact_id', artifactId)
    .eq('facet', FACET);

  if (error) throw new Error(`fetchExistingRequirementIds: ${error.message}`);

  const ids = new Set<string>();
  for (const row of data ?? []) {
    const rid = (row.metadata as Record<string, unknown>)?.requirement_id;
    if (typeof rid === 'string') ids.add(rid);
  }
  return ids;
}

// ── Step 6: Insert l1_events ─────────────────────────────────────────────────

interface InsertResult {
  inserted: string[];
  skipped: string[];
  errors: Array<{ requirement_id: string; error: string }>;
}

async function insertEvents(
  sb: SupabaseClient,
  channelId: string,
  artifactId: string,
  runId: string,
  existingIds: Set<string>,
): Promise<InsertResult> {
  const result: InsertResult = { inserted: [], skipped: [], errors: [] };

  for (const req of requirements) {
    if (existingIds.has(req.requirement_id)) {
      result.skipped.push(req.requirement_id);
      continue;
    }

    const { error } = await sb.from('l1_events').insert({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      artifact_id: artifactId,
      extraction_run_id: runId,
      facet: FACET,
      event_at: `${req.event_at}T00:00:00Z`,
      position: 0,
      actor_id: JEFFREY_ID,
      channel_id: channelId,
      modality: 'text',
      content: req.content,
      extraction_method: EXTRACTOR,
      metadata: {
        requirement_id: req.requirement_id,
        category: req.category,
        priority: req.priority,
        source_channel: req.source_channel,
        source_date: req.event_at,
        original_quote: req.original_quote,
      },
    });

    if (error) {
      // 23505 = unique violation — race condition, treat as duplicate
      if (error.code === '23505') {
        result.skipped.push(req.requirement_id);
      } else {
        result.errors.push({ requirement_id: req.requirement_id, error: error.message });
      }
    } else {
      result.inserted.push(req.requirement_id);
    }
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[ingest-structured-requirements] starting\n');

  const sb = makeClient();

  console.log('Bootstrap:');
  await ensureSourceType(sb);
  const channelId = await ensureChannel(sb);
  const artifactId = await ensureArtifact(sb);
  const runId = await ensureExtractionRun(sb, artifactId);
  console.log('');

  console.log('Dedup check:');
  const existingIds = await fetchExistingRequirementIds(sb, artifactId);
  console.log(`  ${existingIds.size} requirement(s) already present → will skip`);
  console.log('');

  console.log(`Inserting ${requirements.length} requirement(s)...`);
  const result = await insertEvents(sb, channelId, artifactId, runId, existingIds);
  console.log('');

  // Summary
  console.log('── Summary ──────────────────────────────────────────────────────');
  console.log(`  inserted : ${result.inserted.length}`);
  if (result.inserted.length > 0) {
    console.log(`    ${result.inserted.join(', ')}`);
  }
  console.log(`  skipped  : ${result.skipped.length} (already existed)`);
  if (result.skipped.length > 0) {
    console.log(`    ${result.skipped.join(', ')}`);
  }
  console.log(`  errors   : ${result.errors.length}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      console.error(`    [${e.requirement_id}] ${e.error}`);
    }
    process.exit(1);
  }

  console.log('');
  console.log('[ingest-structured-requirements] done');
}

main().catch((err) => {
  console.error('[ingest-structured-requirements] fatal:', err);
  process.exit(1);
});
