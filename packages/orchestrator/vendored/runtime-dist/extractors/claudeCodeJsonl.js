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
const EXTRACTOR_NAME = 'jsonl-turns-v1';
export const claudeCodeJsonl = async function* (artifact, run, ctx) {
    const raw = await ctx.fetchContent(artifact);
    const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
    const lines = text.split('\n');
    const channelKind = 'claude-code';
    const channelIdentifier = artifact.metadata?.channel_identifier ??
        deriveChannelIdentifier(artifact);
    const channelId = await ctx.resolveChannel(channelKind, channelIdentifier);
    // Owner principal — whoever ran Claude Code. Streamers should set
    // artifact.metadata.user_canonical_id; default to 'mordechai-potash' for v0.1.
    const userCanonical = artifact.metadata?.user_canonical_id ??
        'mordechai-potash';
    let position = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        if (lineText === undefined || !lineText.trim())
            continue;
        let entry;
        try {
            entry = JSON.parse(lineText);
        }
        catch {
            continue; // skip malformed lines
        }
        const role = entry.message?.role ?? entry.type;
        if (!role)
            continue;
        const eventAt = entry.timestamp ?? artifact.origin_at;
        const lineNo = i + 1;
        // ── Facet: turn_text ───────────────────────────────────────────────
        if (run.facet === 'turn_text' && (role === 'user' || role === 'assistant')) {
            const textContent = extractText(entry.message?.content);
            if (!textContent)
                continue;
            const actorCanonical = role === 'user'
                ? userCanonical
                : modelToCanonical(entry.message?.model);
            const actorId = await ctx.resolveActor(actorCanonical);
            yield {
                facet: 'turn_text',
                event_at: eventAt,
                position: position++,
                actor_id: actorId,
                channel_id: channelId,
                modality: 'text',
                content: textContent,
                ts_start_s: null,
                ts_end_s: null,
                byte_offset: null,
                line_no: lineNo,
                page: null,
                confidence: null,
                extraction_method: EXTRACTOR_NAME,
                metadata: {
                    uuid: entry.uuid,
                    parent_uuid: entry.parentUuid,
                    message_id: entry.message?.id,
                    model: entry.message?.model,
                    stop_reason: entry.message?.stop_reason,
                    usage: entry.message?.usage,
                    session_id: entry.sessionId,
                },
            };
        }
        // ── Facet: tool_calls ──────────────────────────────────────────────
        if (run.facet === 'tool_calls' && role === 'assistant') {
            const toolUses = extractToolUses(entry.message?.content);
            if (toolUses.length === 0)
                continue;
            const actorId = await ctx.resolveActor(modelToCanonical(entry.message?.model));
            for (const tu of toolUses) {
                yield {
                    facet: 'tool_calls',
                    event_at: eventAt,
                    position: position++,
                    actor_id: actorId,
                    channel_id: channelId,
                    modality: 'tool_call',
                    content: tu.name ?? null,
                    ts_start_s: null,
                    ts_end_s: null,
                    byte_offset: null,
                    line_no: lineNo,
                    page: null,
                    confidence: null,
                    extraction_method: EXTRACTOR_NAME,
                    metadata: {
                        tool_use_id: tu.id,
                        tool_name: tu.name,
                        tool_input: tu.input,
                        uuid: entry.uuid,
                        message_id: entry.message?.id,
                        model: entry.message?.model,
                    },
                };
            }
        }
    }
};
// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
function extractText(content) {
    if (typeof content === 'string')
        return content.trim() || null;
    if (!Array.isArray(content))
        return null;
    const texts = content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .filter((t) => t.trim().length > 0);
    return texts.length > 0 ? texts.join('\n').trim() : null;
}
function extractToolUses(content) {
    if (!Array.isArray(content))
        return [];
    return content.filter((b) => b?.type === 'tool_use');
}
function modelToCanonical(model) {
    if (!model)
        return 'claude-opus-4-7';
    const m = model.toLowerCase();
    if (m.includes('opus-4-7') || m.includes('opus-4.7'))
        return 'claude-opus-4-7';
    if (m.includes('sonnet-4-6') || m.includes('sonnet-4.6'))
        return 'claude-sonnet-4-6';
    if (m.includes('opus'))
        return 'claude-opus-4-7';
    if (m.includes('sonnet'))
        return 'claude-sonnet-4-6';
    if (m.includes('gpt-5'))
        return 'gpt-5';
    if (m.includes('gemini'))
        return 'gemini-3-pro';
    return 'claude-opus-4-7'; // fallback
}
/**
 * Best-effort: derive channel identifier from a Claude Code session path.
 * e.g. ~/.claude/projects/-Users-mordechai-viter-workspace-Vita-Platform/abc.jsonl
 *      → 'viter-platform' (last meaningful path segment)
 *
 * Streamers SHOULD set artifact.metadata.channel_identifier explicitly to
 * avoid relying on this derivation.
 */
function deriveChannelIdentifier(artifact) {
    const m = artifact.source_uri.match(/\.claude\/projects\/(-?[^/]+)\//);
    if (!m || m[1] === undefined)
        return 'unknown';
    const slug = m[1].replace(/^-/, '');
    // pick last 2 path segments as identifier
    const parts = slug.split('-');
    return parts.slice(-2).join('-') || slug;
}
//# sourceMappingURL=claudeCodeJsonl.js.map