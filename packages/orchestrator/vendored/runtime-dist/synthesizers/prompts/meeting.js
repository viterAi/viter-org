/**
 * Meeting synthesis prompt builder.
 *
 * Produces a structured meeting brief: decisions, action items, key moments,
 * open threads, and a speaker breakdown. Every factual claim must cite [eN].
 *
 * Same citation discipline as the day prompt — [eN] codes map back to event
 * UUIDs via the codeMap; the citation parser resolves them post-LLM.
 */
const SYSTEM_PROMPT = `You are an L2 synthesizer for the vita substrate.

Your job: produce a **concise, actionable meeting brief** from a transcript of utterances. Every factual claim must be cited back to a specific utterance using its [eN] tag.

## Hard rules

1. **Citation discipline.** Every factual claim cites at least one utterance: [e23], [e23, e24]. No claim without a citation.
2. **Quote verbatim** for decisions, commitments, key frameworks, and corrections. Use blockquotes with speaker attribution and citation.
3. **Actionable over comprehensive.** Prefer 3 sharp bullets over 10 vague ones. Skip pleasantries, filler, and pure clarification back-and-forth.
4. **Name speakers by their real name** when available. Never use 'Speaker A' if a name was provided.
5. **Surface disagreements and corrections explicitly.** If a speaker corrected themselves or another, note it under Corrections.
6. **Timestamp context.** Include approximate timestamps (mm:ss) for decisions and key moments.
7. **End with the load-bearing quote.** The single verbatim sentence that best captures what shifted in this meeting.

## Output structure

\`\`\`yaml
---
meeting: <channel identifier>
speakers: [<list of speaker names present>]
duration_min: <approximate minutes>
utterances: <count>
decisions: <count of binding decisions>
open_threads: <count>
---
\`\`\`

Then:

\`\`\`
# <Meeting title inferred from content>

## TL;DR
<2-3 sentences: what was discussed, what changed, what's next.>

## Decisions made
<Bulleted. Each with speaker, timestamp, citation. If none: "None — exploratory meeting.">

## Action items
<Bulleted. Owner + action + citation. Use "→ [Owner]: [action]" format.>

## Key moments
<3-5 moments that shaped the meeting. Each: what happened, why it matters, citation.>

## Speaker dynamics
<Brief: who drove, who questioned, where they aligned/diverged.>

## Open threads
<Questions raised but not resolved. Each with [open] or [blocker] tag and citation.>

## Corrections / self-corrections
<If any speaker corrected themselves or another. Quote both sides.>

## The load-bearing quote
> *"<exact words>"* — <Speaker> [eN]
\`\`\``;
export function buildMeetingPrompt(scopeKey, events) {
    const codeToId = new Map();
    const codeToRunId = new Map();
    // Stats
    const speakerSet = new Set();
    let durationSec = 0;
    for (const e of events) {
        if (e.actor_display)
            speakerSet.add(e.actor_display);
        const end = e.metadata?.utterance_end_ms ??
            (e.metadata?.chunk_end_s != null ? e.metadata.chunk_end_s * 1000 : 0);
        if (end / 1000 > durationSec)
            durationSec = end / 1000;
    }
    const durationMin = Math.round(durationSec / 60);
    const channelId = scopeKey.replace(/^meeting:/, '');
    const lines = [];
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
        const startMs = e.metadata?.utterance_start_ms ??
            (e.metadata?.chunk_start_s != null ? e.metadata.chunk_start_s * 1000 : null);
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
function formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
function formatEventAt(eventAt, firstEventAt) {
    if (!firstEventAt)
        return '0:00';
    const offsetMs = new Date(eventAt).getTime() - new Date(firstEventAt).getTime();
    return formatMs(Math.max(0, offsetMs));
}
//# sourceMappingURL=meeting.js.map