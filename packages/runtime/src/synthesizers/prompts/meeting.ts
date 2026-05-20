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

const SYSTEM_PROMPT = `You are an L2 synthesizer for the vita knowledge substrate.

Input: a chronological list of utterances from a meeting, each tagged [eN] with speaker and timestamp.
Output: a structured meeting brief that a participant could act from without rewatching.

## Laws

1. **Cite or die.** Every factual claim carries at least one [eN]. No citation = no claim. If you can't cite it, cut it.
2. **Comma-separated only.** Always write [e23, e24, e25]. Never use ranges like [e23-e25] — those are unparseable.
3. **Minimum 2 citations per section.** Sections with fewer than 2 citations are not grounded — expand or cut.
3. **Verbatim for load-bearing moments.** Decisions, commitments, corrections, and key reframes must be quoted exactly, not paraphrased.
4. **Name over code.** Use real names (Shaul, Mordechai). Never "Speaker A".
5. **Sharp over complete.** 3 real bullets beat 10 vague ones. Skip greetings, filler, and tech-check noise.
6. **State shifts over status updates.** What *changed* in this meeting? Lead with that.
7. **Surface the tension.** Where did speakers push back, correct themselves, or talk past each other? Quote both sides verbatim.

## Output format

Start your response with the opening ---, then YAML fields, then closing ---, then markdown body immediately after. No code fences. Example opening:

---
meeting: <identifier>
speakers: [name, name]
duration_min: <N>
utterances: <N>
state_shift: <one sentence — what changed because this meeting happened>
decisions: <count>
open_threads: <count>
---

# <Title — what this meeting *did*, not just what it covered>

## State shift
<The single most important thing that changed because this meeting happened. 1-2 sentences max.>

## Decisions
<Each decision: who made it, what exactly was decided, timestamp, verbatim quote, citation.>
> *"exact words"* — Speaker [eN]

## Commitments
<Named owner → specific action → deadline if stated → citation. Use → format.>

## Turning points
<2-4 moments where the conversation shifted direction. What triggered it, what it resolved.>

## Tension map
<Where did speakers diverge, push back, or correct? Quote both sides.>

## Open threads
<Unresolved questions. Tag each [blocker] or [open]. Citation required.>

## The load-bearing quote
<The one sentence that, if you only remembered one thing, would be this.>
> *"exact words"* — Speaker [eN]`;

export function buildMeetingPrompt(
  scopeKey: string,
  events: L1EventForPrompt[],
): BuiltMeetingPrompt {
  const codeToId = new Map<string, string>();
  const codeToRunId = new Map<string, string>();

  // Stats
  const speakerSet = new Set<string>();
  let durationSec = 0;
  for (const e of events) {
    if (e.actor_display) speakerSet.add(e.actor_display);
    const end = (e.metadata?.utterance_end_ms as number | undefined) ??
                (e.metadata?.chunk_end_s != null ? (e.metadata.chunk_end_s as number) * 1000 : 0);
    if (end / 1000 > durationSec) durationSec = end / 1000;
  }
  const durationMin = Math.round(durationSec / 60);
  const channelId = scopeKey.replace(/^meeting:/, '');

  const lines: string[] = [];
  lines.push(`Meeting: **${channelId}**`);
  lines.push(`Speakers: ${Array.from(speakerSet).join(', ') || '(unknown)'}`);
  lines.push(`Duration: ~${durationMin} min`);
  lines.push(`Utterances in scope: **${events.length}** (active extraction runs only)`);
  lines.push('');
  lines.push('## UTTERANCES (chronological — full content)');
  lines.push('');

  events.forEach((e, i) => {
    const code = `e${i + 1}`;
    codeToId.set(code, e.id);
    codeToRunId.set(code, e.extraction_run_id);

    // Timestamp: prefer ms-level from AssemblyAI, fall back to ts_start_s in metadata
    const startMs = (e.metadata?.utterance_start_ms as number | undefined) ??
                    (e.metadata?.chunk_start_s != null ? (e.metadata.chunk_start_s as number) * 1000 : null);
    const tsLabel = startMs != null ? formatMs(startMs) : formatEventAt(e.event_at, events[0]?.event_at);

    const speaker = e.actor_display ?? 'Unknown';
    const content = (e.content ?? '').replace(/\s+/g, ' ').trim();
    lines.push(`### [${code}] ${tsLabel} · ${speaker}`);
    lines.push(content);
    lines.push('');
  });

  lines.push('---');
  lines.push('');
  lines.push('Synthesize the meeting above per the rules in the system prompt.');
  lines.push('Include the YAML front-matter. Include the load-bearing quote.');

  const userPrompt = lines.join('\n');
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    codeMap: { codeToId, codeToRunId },
    totalChars: SYSTEM_PROMPT.length + userPrompt.length,
  };
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatEventAt(eventAt: string, firstEventAt?: string): string {
  if (!firstEventAt) return '0:00';
  const offsetMs = new Date(eventAt).getTime() - new Date(firstEventAt).getTime();
  return formatMs(Math.max(0, offsetMs));
}
