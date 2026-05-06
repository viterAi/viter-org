/**
 * Day synthesis prompt builder — DEEP narrative form.
 *
 * Models the existing viter-workspace `synthesize-chat-l2` skill prompt that produces
 * 200-400 line L2s with before/after state shifts, causal arc walks, and tagged quotes.
 *
 * Returns (systemPrompt, userPrompt, codeMap). The codeMap lets the parser translate
 * [eN] back to event UUIDs after the LLM responds.
 */
import type { CitedEventMap } from '../citation-parser.js';
import type { L1EventForPrompt } from '../types.js';
export interface BuiltDayPrompt {
    systemPrompt: string;
    userPrompt: string;
    codeMap: CitedEventMap;
    totalChars: number;
}
export declare function buildDayPrompt(date: string, events: L1EventForPrompt[]): BuiltDayPrompt;
//# sourceMappingURL=day.d.ts.map