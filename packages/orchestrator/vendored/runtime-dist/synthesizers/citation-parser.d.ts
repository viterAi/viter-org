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
export declare function extractCodes(body: string): string[];
export declare function resolveCitations(body: string, map: CitedEventMap): ParsedCitations;
//# sourceMappingURL=citation-parser.d.ts.map