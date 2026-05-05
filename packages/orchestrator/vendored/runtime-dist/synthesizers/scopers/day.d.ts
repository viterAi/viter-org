/**
 * Day scoper — return all L1 turn_text events for a given calendar day (Asia/Jerusalem).
 *
 * Critical: filters to ACTIVE extraction runs only. Without that join, superseded runs'
 * events would appear in the synthesis (history pollution).
 *
 * Tool calls (facet='tool_calls') are excluded by default — they're noisy and rarely
 * what an L2 day synthesis wants. Pass {includeToolCalls: true} to include.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { L1EventForPrompt, ScoperInput } from '../types.js';
interface DayScoperOptions {
    /** YYYY-MM-DD scopeKey is interpreted in this timezone. Default Asia/Jerusalem. */
    timezone?: string;
    includeToolCalls?: boolean;
}
export declare function scopeByDay(input: ScoperInput, db: SupabaseClient, opts?: DayScoperOptions): Promise<L1EventForPrompt[]>;
export {};
//# sourceMappingURL=day.d.ts.map