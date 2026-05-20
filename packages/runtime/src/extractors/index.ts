/**
 * Extractor registry — maps source_type → default extractor for each facet.
 *
 * The runner dispatches an extraction run by looking up
 * `(run.source_type, run.facet)` in this registry.
 *
 * Adding a new source type = adding rows here + writing the extractor module.
 */

import type { Extractor } from '../types';
import { claudeCodeJsonl } from './claudeCodeJsonl';
import { clawdbotJsonl, EXTRACTOR_NAME as CLAWDBOT_NAME, EXTRACTOR_VERSION as CLAWDBOT_VERSION } from './clawdbotJsonl';

export interface ExtractorEntry {
  extractor: Extractor;
  /** Stable identifier for the extractor (matches l1_extraction_runs.extractor) */
  name: string;
  /** Semver of the extractor code (matches l1_extraction_runs.version) */
  version: string;
  is_deterministic: boolean;
  default_parameters: Record<string, unknown>;
}

/** Keyed by `${source_type}:${facet}` */
export const REGISTRY: Record<string, ExtractorEntry> = {
  'claude_code_jsonl:turn_text': {
    extractor: claudeCodeJsonl,
    name: 'jsonl-turns-v1',
    version: '0.1.0',
    is_deterministic: true,
    default_parameters: {},
  },
  'claude_code_jsonl:tool_calls': {
    extractor: claudeCodeJsonl,
    name: 'jsonl-turns-v1',
    version: '0.1.0',
    is_deterministic: true,
    default_parameters: {},
  },
  'clawdbot_jsonl:turn_text': {
    extractor: clawdbotJsonl,
    name: CLAWDBOT_NAME,
    version: CLAWDBOT_VERSION,
    is_deterministic: true,
    default_parameters: {},
  },
};

export function getExtractor(sourceType: string, facet: string): ExtractorEntry | null {
  return REGISTRY[`${sourceType}:${facet}`] ?? null;
}

export { claudeCodeJsonl };
export { clawdbotJsonl };
