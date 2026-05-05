/**
 * Citation parser — extracts [eN] tags from LLM output and maps them back to event UUIDs.
 *
 * Why short codes instead of UUIDs: LLMs reliably emit [e23], [e24]; they hallucinate UUIDs.
 * We give the model short codes in the prompt, then translate.
 */
/** Match patterns like [e23], [e23, e24], [e23,e24,e25]. Captures the inner code list. */
const CITATION_PATTERN = /\[((?:e\d+)(?:\s*,\s*e\d+)*)\]/g;
/** Match a single eN code. */
const SINGLE_CODE_PATTERN = /e\d+/g;
export function extractCodes(body) {
    const seen = new Set();
    for (const match of body.matchAll(CITATION_PATTERN)) {
        const inner = match[1];
        if (!inner)
            continue;
        for (const m of inner.matchAll(SINGLE_CODE_PATTERN)) {
            if (m[0])
                seen.add(m[0]);
        }
    }
    return Array.from(seen).sort(byCodeNumeric);
}
export function resolveCitations(body, map) {
    const all_codes = extractCodes(body);
    const cited_event_ids = [];
    const cited_extraction_runs_set = new Set();
    const unresolved = [];
    const seenIds = new Set();
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
        if (runId)
            cited_extraction_runs_set.add(runId);
    }
    return {
        cited_event_ids,
        cited_extraction_runs: Array.from(cited_extraction_runs_set),
        unresolved_codes: unresolved,
        all_codes,
    };
}
function byCodeNumeric(a, b) {
    const an = parseInt(a.slice(1), 10);
    const bn = parseInt(b.slice(1), 10);
    return an - bn;
}
//# sourceMappingURL=citation-parser.js.map