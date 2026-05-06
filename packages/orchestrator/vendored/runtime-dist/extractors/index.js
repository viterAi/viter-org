/**
 * Extractor registry — maps source_type → default extractor for each facet.
 *
 * The runner dispatches an extraction run by looking up
 * `(run.source_type, run.facet)` in this registry.
 *
 * Adding a new source type = adding rows here + writing the extractor module.
 */
import { claudeCodeJsonl } from './claudeCodeJsonl';
/** Keyed by `${source_type}:${facet}` */
export const REGISTRY = {
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
};
export function getExtractor(sourceType, facet) {
    return REGISTRY[`${sourceType}:${facet}`] ?? null;
}
export { claudeCodeJsonl };
//# sourceMappingURL=index.js.map