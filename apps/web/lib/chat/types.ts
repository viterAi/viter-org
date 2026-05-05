/**
 * Shared chat types — UI-side projections of l1_events / channels.
 */

export interface Channel {
  id: string;
  identifier: string;          // 'wa-972583246058'
  display_name: string | null;
  kind: string;                // 'whatsapp' | 'meeting' | 'email' | …
  metadata: Record<string, unknown>;
  /** computed in queries */
  latest_event_at: string | null;
  /** computed in queries */
  latest_preview: string | null;
  /** computed in queries */
  unread_count?: number;
}

export interface ChannelGroup {
  kind: string;                // 'whatsapp', 'meeting', etc.
  label: string;               // human label for the section header
  channels: Channel[];
}

export interface MessageEvent {
  id: string;
  event_at: string;
  facet: string;               // 'messages' | 'transcription' | 'reaction' | 'edit' | 'doc_text' | 'image_caption'
  modality: string;            // 'text' | 'voice' | 'image' | 'file'
  content: string | null;
  channel_id: string;
  artifact_id: string | null;
  metadata: Record<string, unknown>;
  /** convenience flags computed once */
  from_me: boolean;
  push_name: string | null;
}
