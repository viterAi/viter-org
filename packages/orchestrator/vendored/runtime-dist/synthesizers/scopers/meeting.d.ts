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
export declare function scopeByMeeting(input: ScoperInput, db: SupabaseClient): Promise<L1EventForPrompt[]>;
//# sourceMappingURL=meeting.d.ts.map