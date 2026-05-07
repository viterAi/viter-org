/**
 * Meeting synthesis prompt builder.
 *
 * Produces a structured meeting brief: decisions, action items, key moments,
 * open threads, and a speaker breakdown. Every factual claim must cite [eN].
 *
 * Same citation discipline as the day prompt — [eN] codes map back to event
 * UUIDs via the codeMap; the citation parser resolves them post-LLM.
 */
import type { CitedEventMap } from '../citation-parser.js';
import type { L1EventForPrompt } from '../types.js';
export interface BuiltMeetingPrompt {
    systemPrompt: string;
    userPrompt: string;
    codeMap: CitedEventMap;
    totalChars: number;
}
export declare function buildMeetingPrompt(scopeKey: string, events: L1EventForPrompt[]): BuiltMeetingPrompt;
//# sourceMappingURL=meeting.d.ts.map