/**
 * Extractor: Claude Code JSONL session files → L1 events.
 *
 * Source: ~/.claude/projects/<project-slug>/<session-uuid>.jsonl
 *   Each line is a JSON object representing one entry in the session timeline:
 *   user / assistant / system / tool_result / etc.
 *
 * Facets produced:
 *   - 'turn_text'  : one event per user/assistant text turn (modality='text')
 *   - 'tool_calls' : one event per tool_use block inside an assistant turn (modality='tool_call')
 *
 * This extractor is `is_deterministic = true` — same JSONL input ⇒ same events out.
 */
import type { Extractor } from '../types';
export declare const claudeCodeJsonl: Extractor;
//# sourceMappingURL=claudeCodeJsonl.d.ts.map