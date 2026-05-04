/**
 * Citation parser — extracts [eN] tags from LLM output and maps them back to event UUIDs.
 *
 * Why short codes instead of UUIDs: LLMs reliably emit [e23], [e24]; they hallucinate UUIDs.
 * We give the model short codes in the prompt, then translate.
 */

import type { UUID } from '../types.js';

export interface CitedEventMap {
  /** code (e.g. 'e23') → event UUID */
  codeToId: Map<string, UUID>;
  /** code → extraction_run UUID (for cites_extraction_runs array) */
  codeToRunId: Map<string, UUID>;
}

export interface ParsedCitations {
  /** Unique event UUIDs cited in the body */
  cited_event_ids: UUID[];
  /** Unique extraction_run UUIDs cited (parallel to events) */
  cited_extraction_runs: UUID[];
  /** [eN] codes the LLM emitted but we couldn't resolve (hallucinations or out-of-scope) */
  unresolved_codes: string[];
  /** All distinct codes the LLM emitted (for diagnostics) */
  all_codes: string[];
}

/** Match patterns like [e23], [e23, e24], [e23,e24,e25]. Captures the inner code list. */
const CITATION_PATTERN = /\[((?:e\d+)(?:\s*,\s*e\d+)*)\]/g;

/** Match a single eN code. */
const SINGLE_CODE_PATTERN = /e\d+/g;

export function extractCodes(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(CITATION_PATTERN)) {
    const inner = match[1];
    if (!inner) continue;
    for (const m of inner.matchAll(SINGLE_CODE_PATTERN)) {
      if (m[0]) seen.add(m[0]);
    }
  }
  return Array.from(seen).sort(byCodeNumeric);
}

export function resolveCitations(body: string, map: CitedEventMap): ParsedCitations {
  const all_codes = extractCodes(body);

  const cited_event_ids: UUID[] = [];
  const cited_extraction_runs_set = new Set<UUID>();
  const unresolved: string[] = [];

  const seenIds = new Set<UUID>();
  for (const code of all_codes) {
    const id = map.codeToId.get(code);
    if (!id) {
      unresolved.push(code);
      continue;
    }
    if (!seenIds.has(id)) {
      seenIds.add(id);
      cited_event_ids.push(id);
    }
    const runId = map.codeToRunId.get(code);
    if (runId) cited_extraction_runs_set.add(runId);
  }

  return {
    cited_event_ids,
    cited_extraction_runs: Array.from(cited_extraction_runs_set),
    unresolved_codes: unresolved,
    all_codes,
  };
}

function byCodeNumeric(a: string, b: string): number {
  const an = parseInt(a.slice(1), 10);
  const bn = parseInt(b.slice(1), 10);
  return an - bn;
}
