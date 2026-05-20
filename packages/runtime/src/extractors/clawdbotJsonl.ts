/**
 * Extractor: Clawdbot JSONL session files → L1 events.
 *
 * Source: ~/.clawdbot/agents/main/sessions/<session-uuid>.jsonl
 *
 * Clawdbot sessions differ from Claude Code JSONL in several key ways:
 *   - Object types: 'session' | 'message' | 'compaction' | 'model_change' |
 *                   'thinking_level_change' | 'custom'  (only 'message' matters)
 *   - Content block types: 'text' | 'thinking' | 'toolCall' | 'image'
 *     (Claude Code uses 'tool_use' — here it's 'toolCall', skip both)
 *   - User messages arrive via Discord relay with a prefix:
 *       [Discord Guild #<channel> channel id:<id> +<delta> <date> <time> GMT<offset>]
 *       <username> (<discord_id>): <actual text>
 *       [from: <username> (<id>)]
 *       [message_id: <id>]
 *     The real timestamp lives inside this prefix, not on the outer obj.timestamp.
 *   - Three user message categories to skip:
 *       1. System: [datetime] Exec failed/completed ...  (tool feedback)
 *       2. [Queued announce messages ...]  (background task completions)
 *       3. [cron:<id> ...]  (automated cron jobs)
 *
 * Facets produced:
 *   - 'turn_text' : one event per real user/assistant text turn
 */

import type {
  Extractor,
  ExtractionRun,
  ExtractorContext,
  L0Artifact,
  L1EventInsert,
} from '../types';

export const EXTRACTOR_NAME = 'clawdbot-turns-v1';
export const EXTRACTOR_VERSION = '0.1.0';

// ── Discord prefix regex ─────────────────────────────────────────────────────
// Matches: [Discord Guild #epic channel id:1470... +4m 2026-03-28 19:58 GMT+3]
const DISCORD_HDR = /^\[Discord Guild #(\S+) channel id:(\d+)[^\]]*?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) GMT([+-]\d+)\]\s*/;
// Matches the "username (discord_id): " part after the header
const DISCORD_SENDER = /^\S.*?\s\([^)]+\):\s*/;

// Trailing noise lines appended by clawdbot relay
const TRAILING_NOISE = /\n\[from:[^\]]+\](\n\[message_id:[^\]]+\])?$/;
const MESSAGE_ID_ONLY = /\[message_id:[^\]]+\]$/;

// Skip patterns for user content
const SKIP_PREFIXES = [
  'System:',
  '[Queued announce messages',
  '[Queued messages while agent',
  '[cron:',
  'A background task',
  '[Chat messages since',
];

interface ClawdbotEntry {
  type: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
  message?: {
    role?: 'user' | 'assistant';
    content?: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: 'text' | 'thinking' | 'toolCall' | 'image' | string;
  text?: string;
}

// ── Exported extractor ───────────────────────────────────────────────────────

export const clawdbotJsonl: Extractor = async function* (
  artifact: L0Artifact,
  run: ExtractionRun,
  ctx: ExtractorContext,
): AsyncIterable<L1EventInsert> {
  const raw = await ctx.fetchContent(artifact);
  const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
  const lines = text.split('\n');

  const channelKind = 'clawdbot';
  const channelIdentifier =
    (artifact.metadata?.channel_identifier as string | undefined) ?? 'unknown';
  const channelId = await ctx.resolveChannel(channelKind, channelIdentifier);

  const userCanonical =
    (artifact.metadata?.user_canonical_id as string | undefined) ?? 'mordechai-potash';

  let position = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (!lineText?.trim()) continue;

    let entry: ClawdbotEntry;
    try {
      entry = JSON.parse(lineText);
    } catch {
      continue;
    }

    if (entry.type !== 'message') continue;
    if (run.facet !== 'turn_text') continue;

    const role = entry.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const rawText = extractText(entry.message?.content);
    if (!rawText) continue;

    if (role === 'user') {
      const parsed = parseUserMessage(rawText, entry.timestamp);
      if (!parsed) continue; // noise / system message

      const actorId = await ctx.resolveActor(userCanonical);
      yield {
        facet: 'turn_text',
        event_at: parsed.eventAt,
        position: position++,
        actor_id: actorId,
        channel_id: channelId,
        modality: 'text',
        content: parsed.text,
        ts_start_s: null,
        ts_end_s: null,
        byte_offset: null,
        line_no: i + 1,
        page: null,
        confidence: null,
        extraction_method: EXTRACTOR_NAME,
        metadata: {
          discord_channel: parsed.discordChannel,
          session_entry_id: entry.id,
          parent_entry_id: entry.parentId,
          source_session_id: artifact.metadata?.session_id,
        },
      };
    } else {
      // assistant
      const cleanText = rawText.trim();
      if (!cleanText) continue;

      const actorId = await ctx.resolveActor('steve-clawdbot');
      yield {
        facet: 'turn_text',
        event_at: entry.timestamp ?? artifact.origin_at,
        position: position++,
        actor_id: actorId,
        channel_id: channelId,
        modality: 'text',
        content: cleanText,
        ts_start_s: null,
        ts_end_s: null,
        byte_offset: null,
        line_no: i + 1,
        page: null,
        confidence: null,
        extraction_method: EXTRACTOR_NAME,
        metadata: {
          session_entry_id: entry.id,
          parent_entry_id: entry.parentId,
          source_session_id: artifact.metadata?.session_id,
        },
      };
    }
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const texts = (content as ContentBlock[])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .filter((t) => t.trim().length > 0);
  return texts.length > 0 ? texts.join('\n').trim() : null;
}

interface ParsedUserMessage {
  text: string;
  eventAt: string;
  discordChannel: string | null;
}

function parseUserMessage(raw: string, fallbackTs?: string): ParsedUserMessage | null {
  // Strip trailing [from: ...] and [message_id: ...] noise
  let body = raw.replace(TRAILING_NOISE, '').replace(MESSAGE_ID_ONLY, '').trim();

  // Skip system / cron / queue noise
  for (const prefix of SKIP_PREFIXES) {
    if (body.startsWith(prefix)) return null;
  }

  let eventAt = fallbackTs ?? new Date().toISOString();
  let discordChannel: string | null = null;

  // Try to parse Discord header
  const hdrMatch = body.match(DISCORD_HDR);
  if (hdrMatch) {
    discordChannel = hdrMatch[1] ?? null;
    const dateStr = hdrMatch[3]!;      // "2026-03-28 19:58"
    const offset = hdrMatch[4]!;       // "+3" or "-5"
    const offsetH = parseInt(offset, 10);
    const offsetStr = offsetH >= 0 ? `+${String(offsetH).padStart(2, '0')}:00` : `-${String(-offsetH).padStart(2, '0')}:00`;
    eventAt = `${dateStr.replace(' ', 'T')}:00${offsetStr}`;

    // Strip the Discord header
    body = body.slice(hdrMatch[0].length);
    // Strip "username (id): " sender line
    body = body.replace(DISCORD_SENDER, '').trim();
  }

  // After stripping, check for nested queued Discord messages
  if (body.startsWith('[Queued')) return null;

  // Must have meaningful content
  if (body.length < 3) return null;

  return { text: body, eventAt, discordChannel };
}
