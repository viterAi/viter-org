/**
 * Day synthesis prompt builder.
 *
 * Produces (systemPrompt, userPrompt, codeMap). The codeMap lets the parser translate
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

const SYSTEM_PROMPT = `You are an L2 synthesizer for the vita substrate.

Your job: produce a tight, scannable markdown brief of one calendar day's chat-log activity, citing every claim back to specific events.

## Hard rules

1. **Citation discipline.** Every factual claim must cite at least one event by its tag (e.g., \`[e23]\`, \`[e23, e24]\`). No claim without a citation. If you don't have evidence for it, leave it out.
2. **Quote verbatim** when capturing decisions, framework moves, or signature lines. Use markdown blockquotes.
3. **Tight, no filler.** This brief is read fast. Cut every sentence that doesn't add information.
4. **Honesty over coverage.** It's fine to leave a section empty. Don't pad to fill structure.

## Output structure

Use these sections (omit any that have no content):

- **State shift** — one sentence: what changed today
- **Decisions** — bulleted, each with citation
- **Open threads** — bulleted, each with citation
- **Quotable lines** — verbatim quotes, attributed
- **Tools / artifacts** — what got built, ran, or shipped

End with no summary or sign-off. The reader picks up the next section themselves.`;

export function buildDayPrompt(
  date: string,
  events: L1EventForPrompt[],
): BuiltDayPrompt {
  const codeToId = new Map<string, string>();
  const codeToRunId = new Map<string, string>();

  const lines: string[] = [];
  lines.push(`Date: **${date}** (Asia/Jerusalem)`);
  lines.push(`Events in scope: **${events.length}**`);
  lines.push('');
  lines.push('## EVENTS (chronological)');
  lines.push('');

  events.forEach((e, i) => {
    const code = `e${i + 1}`;
    codeToId.set(code, e.id);
    codeToRunId.set(code, e.extraction_run_id);
    const t = e.event_at.replace('T', ' ').slice(0, 16);
    const actor = e.actor_canonical ?? 'unknown';
    const ch = e.channel_identifier ? ` · ${e.channel_kind}:${e.channel_identifier}` : '';
    const content = (e.content ?? '').replace(/\s+/g, ' ').trim();
    lines.push(`[${code}] ${t} ${actor}${ch}`);
    lines.push(content);
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push(`Synthesize the day above. Cite every claim with [eN] tags from the events.`);

  const userPrompt = lines.join('\n');
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    codeMap: { codeToId, codeToRunId },
    totalChars: SYSTEM_PROMPT.length + userPrompt.length,
  };
}
