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

const SYSTEM_PROMPT = `You are an L2 synthesizer for the vita substrate.

Your job: produce a **deep, narrative day-brief** of one calendar day's chat-log activity, with every factual claim cited back to specific events. Match the depth and texture of a hand-written analyst's day note — not a checklist.

## Hard rules

1. **Citation discipline.** Every factual claim must cite at least one event by its tag (e.g., \`[e23]\`, \`[e23, e24]\`). No claim without a citation. Embed citations inline at the end of each claim or alongside quotes.
2. **Quote verbatim** when capturing decisions, framework moves, contradictions, or signature lines. Use markdown blockquotes with attribution and citation. Lift exact wording — do not paraphrase quotes.
3. **Narrative form, not a list.** Walk the day as a *causal arc* (Seed → Response → Lockin/Breakthrough → Close). Group related events into named phases with their own headings. Each phase is heading + 2-5 paragraphs of prose with embedded citations.
4. **Before/After framing for state shifts.** For the day's main state shift, write explicit "Before:" and "After:" bullet lists.
5. **Surface contradictions explicitly.** If two events contradict each other, name the contradiction in its own \`## Tensions / contradictions\` section. Do not paper over disagreement.
6. **Honesty over coverage.** It's fine to leave a section empty. Don't pad to fill structure. If no strategic decisions were made, write "None — exploratory day."
7. **Tag quotes by type:**
   - \`[seed]\` — a one-line idea that could become a real deliverable
   - \`[framework]\` — how the speaker thinks (architecture, principles)
   - \`[mode-invoke]\` — instruction telling the AI how to work
   - \`[self-correction]\` — speaker reframing or catching themselves
   - \`[decision]\` — a verbal commitment with binding intent
   - \`[blocker]\` — explicit "this is in the way" statement
8. **Tag open threads by severity:**
   - \`[blocker]\` — nothing ships without this
   - \`[open]\` — real unresolved, should resurface tomorrow
   - \`[philosophical]\` — framework-level, no immediate action needed
9. **Skip tactical noise.** Don't synthesize formatting, filenames, markdown escaping, retry attempts. Only strategic decisions: scope, direction, pricing, architecture, partner-level calls.
10. **End with the load-bearing quote.** A single verbatim sentence that captures what changed today. Place it as the final block, no commentary.

## Output structure

Begin with YAML front-matter, then the markdown body:

\`\`\`yaml
---
date: <YYYY-MM-DD>
sessions: [<list of distinct session UUIDs from event metadata, abbreviated to 8 chars>]
sessions_note: <one line: dedup/parallel/relationship notes, only if non-obvious>
duration_active: <e.g. "10h22m">
duration_blocks: ["HH:MM–HH:MM", ...]
turns: {user: <n>, ai_text: <n>}
decisions_strategic: <count>
artifacts_shipped: <count>
state_shift: "<one sentence: before → after, present tense>"
---
\`\`\`

Then markdown sections (omit any with no content):

\`\`\`
# <DATE> — <one-line subject capturing the day>

## State shift

**Before:** <bulleted or semicolon-separated. What was true at start of day. Unresolved, uncertain, or assumed.>

**After:** <bulleted. What was true at end of day. Proven, decided, or newly open.>

## TL;DR

<2-3 sentence shape-of-the-day. Lead with the state shift, not chronology.>

## What happened

<Causal arc, not clock. Adapt phases to the actual day — some days are exploration, some single-thread execution, some have mid-day pivot.>

### Seed — <trigger or carry-forward>
<paragraph(s) with embedded quotes + citations>

### <middle phase> — <subject>
<paragraph(s)>

### Close — <how the day ended>
<paragraph(s)>

## Tensions / contradictions

<If any. Name the two events that contradict, quote both, cite both.>

## Decisions made (strategic)

<bulleted, each with citation. If none: "None — exploratory day.">

## Artifacts touched

<files created/edited/shipped, with path + brief purpose + citation>

## Open threads

<questions raised and not resolved; TODOs. Each with severity tag and citation.>

### Carry-forward

<One line per prior-day thread that surfaced today: closed / still-open / deferred / superseded. Skip if none.>

## Quotes worth preserving

<3-7 verbatim blockquotes, each prefixed with backticked tag (\`[seed]\`/\`[framework]\`/\`[mode-invoke]\`/\`[self-correction]\`/\`[decision]\`/\`[blocker]\`) and attributed. Citation at end.>

## The load-bearing quote of the day

> *"<the single sentence that captures what changed today>"* — <Speaker> [eN]
\`\`\`

The reader will pick up the next section themselves. Do not write a closing summary or sign-off.`;

export function buildDayPrompt(
  date: string,
  events: L1EventForPrompt[],
): BuiltDayPrompt {
  const codeToId = new Map<string, string>();
  const codeToRunId = new Map<string, string>();

  // Pre-compute summary stats for the prompt header
  const sessionIds = new Set<string>();
  const channelKeys = new Set<string>();
  let userTurns = 0;
  let assistantTurns = 0;
  for (const e of events) {
    const sid = (e.metadata?.session_id as string | undefined);
    if (sid) sessionIds.add(sid.slice(0, 8));
    if (e.channel_kind && e.channel_identifier) {
      channelKeys.add(`${e.channel_kind}:${e.channel_identifier}`);
    }
    if (e.actor_canonical === 'mordechai-potash') userTurns++;
    else if (e.actor_canonical?.startsWith('claude-') || e.actor_canonical === 'gpt-5') assistantTurns++;
  }

  const lines: string[] = [];
  lines.push(`Date: **${date}** (Asia/Jerusalem)`);
  lines.push(`Events in scope: **${events.length}** (active extraction runs only)`);
  lines.push(`Sessions: ${Array.from(sessionIds).join(', ') || '(none)'}`);
  lines.push(`Channels: ${Array.from(channelKeys).join(' · ') || '(none)'}`);
  lines.push(`Counted turns: user=${userTurns} · ai=${assistantTurns}`);
  lines.push('');
  lines.push('## EVENTS (chronological — full content, no truncation)');
  lines.push('');

  events.forEach((e, i) => {
    const code = `e${i + 1}`;
    codeToId.set(code, e.id);
    codeToRunId.set(code, e.extraction_run_id);
    const t = e.event_at.replace('T', ' ').slice(0, 16);
    const actor = e.actor_canonical ?? 'unknown';
    const ch = e.channel_identifier
      ? ` · ${e.channel_kind}:${e.channel_identifier}`
      : '';
    const sid = (e.metadata?.session_id as string | undefined);
    const sidTag = sid ? ` · sid=${sid.slice(0, 8)}` : '';
    const content = (e.content ?? '').replace(/\s+/g, ' ').trim();
    lines.push(`### [${code}] ${t} · ${actor}${ch}${sidTag}`);
    lines.push(content);
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push(`Synthesize the day above per the rules in the system prompt.`);
  lines.push(`Do not omit the YAML front-matter. Do not omit the load-bearing quote.`);

  const userPrompt = lines.join('\n');
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    codeMap: { codeToId, codeToRunId },
    totalChars: SYSTEM_PROMPT.length + userPrompt.length,
  };
}
