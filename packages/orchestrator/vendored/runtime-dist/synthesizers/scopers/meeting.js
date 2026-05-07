/**
 * Meeting scoper — return all transcription utterances for a given meeting channel.
 *
 * scope_key format: 'meeting:{channel_identifier}'
 * e.g. 'meeting:meeting-2026-05-07-1000'
 *
 * Speaker resolution: meeting utterances have actor_id=null; speaker is in
 * metadata->>'speaker' ('A', 'B', 'C'). We resolve real names from
 * channels.metadata.speakers (set by speaker naming UI or auto-detect).
 * Falls back to 'Speaker A' when the map is absent.
 *
 * Only pulls from the active extraction run — same discipline as the day scoper.
 */
export async function scopeByMeeting(input, db) {
    const prefix = 'meeting:';
    if (!input.scopeKey.startsWith(prefix)) {
        throw new Error(`meeting scoper: scopeKey must start with 'meeting:', got '${input.scopeKey}'`);
    }
    const channelIdentifier = input.scopeKey.slice(prefix.length);
    // Resolve channel + speaker map
    const { data: channel, error: chErr } = await db
        .from('channels')
        .select('id, metadata')
        .eq('tenant_id', input.tenantId)
        .eq('identifier', channelIdentifier)
        .eq('kind', 'meeting')
        .single();
    if (chErr || !channel)
        throw new Error(`meeting scoper: channel '${channelIdentifier}' not found`);
    const channelId = channel.id;
    const speakersMap = channel.metadata?.speakers;
    // Resolve active extraction run for this channel's artifacts
    const { data: events, error: evErr } = await db
        .from('l1_events')
        .select('id, extraction_run_id, event_at, facet, modality, content, position, artifact_id, metadata')
        .eq('tenant_id', input.tenantId)
        .eq('channel_id', channelId)
        .eq('facet', 'transcription')
        .order('ts_start_s', { ascending: true })
        .order('position', { ascending: true });
    if (evErr)
        throw new Error(`meeting scoper: ${evErr.message}`);
    if (!events || events.length === 0)
        return [];
    // Filter to active runs only
    const artifactIds = [...new Set(events.map((e) => e.artifact_id))];
    const { data: activeRows } = await db
        .from('l1_active_extraction')
        .select('artifact_id, facet, active_run_id')
        .eq('tenant_id', input.tenantId)
        .in('artifact_id', artifactIds)
        .eq('facet', 'transcription');
    const activeKey = new Set((activeRows ?? []).map((a) => `${a.artifact_id}::${a.facet}::${a.active_run_id}`));
    return events
        .filter((e) => activeKey.has(`${e.artifact_id}::transcription::${e.extraction_run_id}`))
        .map((e) => {
        const speakerCode = e.metadata?.speaker ?? null;
        const speakerName = speakerCode && speakersMap?.[speakerCode]?.name
            ? speakersMap[speakerCode].name
            : speakerCode
                ? `Speaker ${speakerCode}`
                : 'Unknown';
        return {
            id: e.id,
            extraction_run_id: e.extraction_run_id,
            event_at: e.event_at,
            facet: e.facet,
            modality: e.modality,
            content: e.content,
            position: e.position,
            artifact_id: e.artifact_id,
            actor_canonical: speakerCode ? `speaker-${speakerCode.toLowerCase()}` : null,
            actor_display: speakerName,
            channel_kind: 'meeting',
            channel_identifier: channelIdentifier,
            metadata: (e.metadata ?? {}),
        };
    });
}
//# sourceMappingURL=meeting.js.map