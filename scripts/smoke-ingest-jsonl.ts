/**
 * scripts/smoke-ingest-jsonl.ts
 *
 * End-to-end smoke test for the Claude Code JSONL → vita substrate path.
 *
 * Usage:
 *   tsx scripts/smoke-ingest-jsonl.ts <jsonl-path> [--channel <kind:identifier>]
 *
 * Output: JSON to stdout, shape:
 *   {
 *     artifact: { sha256, source_uri, bytes, origin_at, inline_text, metadata },
 *     runs:     [{ facet, extractor, version, parameters, is_deterministic }],
 *     events:   { turn_text: L1EventInsert[], tool_calls: L1EventInsert[] }
 *   }
 *
 * The caller (or the MCP executor) is responsible for inserting the rows into Supabase.
 * This keeps the extractor free of DB coupling and makes the smoke test reproducible.
 */

import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { claudeCodeJsonl } from '../packages/runtime/src/extractors/claudeCodeJsonl.ts';
import type {
  ExtractionRun,
  ExtractorContext,
  L0Artifact,
  L1EventInsert,
} from '../packages/runtime/src/types.ts';

// ────────────────────────────────────────────────────────────────────
// Hardcoded ID map (smoke-test only; production runner queries Supabase)
// ────────────────────────────────────────────────────────────────────

const TENANT_ID            = 'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa';
const PRINCIPAL_MORDECHAI  = 'c42a9ba5-0aa7-4426-82e8-712db87f9710';
const PRINCIPAL_OPUS_47    = '3ddf2b4f-fdad-4e0c-a989-bae8565e78c4';
const PRINCIPAL_SONNET_46  = '88c38f65-1a04-4555-a9b5-7d7c426c496b';

const CHANNELS: Record<string, string> = {
  'claude-code:viter-platform': '5d973059-6f27-4331-ac9c-8867767fe724',
  'claude-code:vita':           '544eafef-2532-49fb-8e54-ff8f23991aa7',
};

const PRINCIPAL_MAP: Record<string, string> = {
  'mordechai-potash':  PRINCIPAL_MORDECHAI,
  'claude-opus-4-7':   PRINCIPAL_OPUS_47,
  'claude-sonnet-4-6': PRINCIPAL_SONNET_46,
};

// ────────────────────────────────────────────────────────────────────
// CLI parse
// ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { jsonlPath: string; channelKind: string; channelIdentifier: string } {
  const positional: string[] = [];
  let channelArg: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--channel') {
      channelArg = argv[++i] ?? null;
    } else if (a !== undefined) {
      positional.push(a);
    }
  }
  const jsonlPath = positional[0];
  if (!jsonlPath) {
    console.error('Usage: tsx scripts/smoke-ingest-jsonl.ts <jsonl-path> [--channel <kind:identifier>]');
    process.exit(2);
  }
  const [channelKind, channelIdentifier] = (channelArg ?? 'claude-code:viter-platform').split(':') as [string, string];
  return { jsonlPath, channelKind, channelIdentifier };
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

async function main() {
  const { jsonlPath, channelKind, channelIdentifier } = parseArgs(process.argv);

  const fileStat = await stat(jsonlPath);
  const inlineText = await readFile(jsonlPath, 'utf-8');
  const sha256 = createHash('sha256').update(inlineText).digest('hex');

  // origin_at: file mtime as a stand-in for "when content was created in the world"
  const originAt = fileStat.mtime.toISOString();

  // Synthetic artifact (id is placeholder; the SQL inserter generates it via gen_random_uuid)
  const artifact: L0Artifact = {
    id: '00000000-0000-0000-0000-000000000000',
    tenant_id: TENANT_ID,
    source_type: 'claude_code_jsonl',
    source_uri: jsonlPath,
    sha256,
    bytes: fileStat.size,
    origin_at: originAt,
    captured_at: new Date().toISOString(),
    storage_url: null,
    inline_text: inlineText,
    metadata: {
      channel_identifier: channelIdentifier,
      user_canonical_id: 'mordechai-potash',
    },
  };

  const ctx: ExtractorContext = {
    async resolveActor(canonicalId) {
      return PRINCIPAL_MAP[canonicalId] ?? null;
    },
    async resolveChannel(kind, identifier) {
      return CHANNELS[`${kind}:${identifier}`] ?? null;
    },
    async fetchContent(art) {
      return art.inline_text ?? '';
    },
  };

  // Build runs (deterministic for jsonl)
  const runs: Array<Pick<ExtractionRun, 'facet' | 'extractor' | 'version' | 'parameters' | 'is_deterministic'>> = [
    { facet: 'turn_text',  extractor: 'jsonl-turns-v1', version: '0.1.0', parameters: {}, is_deterministic: true },
    { facet: 'tool_calls', extractor: 'jsonl-turns-v1', version: '0.1.0', parameters: {}, is_deterministic: true },
  ];

  const events: Record<string, L1EventInsert[]> = { turn_text: [], tool_calls: [] };

  for (const r of runs) {
    const fakeRun: ExtractionRun = {
      id: '00000000-0000-0000-0000-000000000000',
      tenant_id: TENANT_ID,
      artifact_id: artifact.id,
      facet: r.facet,
      extractor: r.extractor,
      version: r.version,
      parameters: r.parameters,
      is_deterministic: r.is_deterministic,
      status: 'running',
    };
    for await (const ev of claudeCodeJsonl(artifact, fakeRun, ctx)) {
      const bucket = events[r.facet];
      if (bucket) bucket.push(ev);
    }
  }

  const summary = {
    artifact: {
      tenant_id: TENANT_ID,
      source_type: artifact.source_type,
      source_uri: artifact.source_uri,
      sha256,
      bytes: artifact.bytes,
      origin_at: originAt,
      metadata: artifact.metadata,
      inline_text_length: inlineText.length,
      jsonl_lines: inlineText.split('\n').filter(l => l.trim()).length,
    },
    runs: runs.map((r) => ({
      facet: r.facet,
      extractor: r.extractor,
      version: r.version,
      is_deterministic: r.is_deterministic,
      n_events: events[r.facet]?.length ?? 0,
    })),
    n_events_total: Object.values(events).reduce((a, b) => a + b.length, 0),
    sample_events: {
      turn_text:  (events.turn_text  ?? []).slice(0, 3),
      tool_calls: (events.tool_calls ?? []).slice(0, 3),
    },
    events,
  };

  process.stdout.write(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('smoke ingest failed:', err);
  process.exit(1);
});
