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

import type { SupabaseClient } from '@supabase/supabase-js';
import type { L1EventForPrompt, ScoperInput } from '../types.js';

export async function scopeByMeeting(
  input: ScoperInput,
  db: SupabaseClient,
): Promise<L1EventForPrompt[]> {
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
  if (chErr || !channel) throw new Error(`meeting scoper: channel '${channelIdentifier}' not found`);

  const channelId = channel.id as string;
  const speakersMap = (channel.metadata as Record<string, unknown>)?.speakers as
    | Record<string, { name?: string; confidence?: number }>
    | null
    | undefined;

  // Resolve active extraction run for this channel's artifacts
  const { data: events, error: evErr } = await db
    .from('l1_events')
    .select('id, extraction_run_id, event_at, facet, modality, content, position, artifact_id, actor_id, metadata')
    .eq('tenant_id', input.tenantId)
    .eq('channel_id', channelId)
    .eq('facet', 'transcription')
    .order('ts_start_s', { ascending: true })
    .order('position', { ascending: true });

  if (evErr) throw new Error(`meeting scoper: ${evErr.message}`);
  if (!events || events.length === 0) return [];

  // Filter to active runs only
  const artifactIds = [...new Set(events.map((e: any) => e.artifact_id as string))];
  const { data: activeRows } = await db
    .from('l1_active_extraction')
    .select('artifact_id, facet, active_run_id')
    .eq('tenant_id', input.tenantId)
    .in('artifact_id', artifactIds)
    .eq('facet', 'transcription');

  const activeKey = new Set(
    (activeRows ?? []).map((a: any) => `${a.artifact_id}::${a.facet}::${a.active_run_id}`),
  );

  // Collect actor_ids that need display name resolution
  const actorIds = [...new Set(
    events.map((e: any) => e.actor_id as string | null).filter(Boolean)
  )] as string[];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: principals } = await db
      .from('principals')
      .select('id, display_name')
      .in('id', actorIds);
    for (const p of principals ?? []) {
      actorNames.set(p.id as string, p.display_name as string);
    }
  }

  return events
    .filter((e: any) => activeKey.has(`${e.artifact_id}::transcription::${e.extraction_run_id}`))
    .map((e: any) => {
      // Prefer actor_id (MacWhisper backfill path) over metadata.speaker (AssemblyAI path)
      const actorId = e.actor_id as string | null;
      const speakerCode = (e.metadata?.speaker as string | null) ?? null;
      const speakerName = actorId && actorNames.has(actorId)
        ? actorNames.get(actorId)!
        : (e.metadata?.speaker_name as string | null)
          ?? (speakerCode && speakersMap?.[speakerCode]?.name
            ? speakersMap[speakerCode]!.name!
            : speakerCode
              ? `Speaker ${speakerCode}`
              : 'Unknown');

      return {
        id: e.id as string,
        extraction_run_id: e.extraction_run_id as string,
        event_at: e.event_at as string,
        facet: e.facet as string,
        modality: e.modality as string,
        content: e.content as string | null,
        position: e.position as number,
        artifact_id: e.artifact_id as string,
        actor_id: actorId,
        actor_canonical: actorId ?? (speakerCode ? `speaker-${speakerCode.toLowerCase()}` : null),
        actor_display: speakerName,
        channel_kind: 'meeting',
        channel_identifier: channelIdentifier,
        metadata: (e.metadata ?? {}) as Record<string, unknown>,
      };
    });
}
