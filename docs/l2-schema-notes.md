# L2 Schema Notes — Vita Supabase

**Last updated:** May 7, 2026  
**Purpose:** Reference for View Builder integration — what data exists, how to read it, how to trace source.

---

## Layer Overview

```
l0_artifacts        raw ingested data        1,974 rows
      ↓
l1_events           extracted events          576 rows
l1_extraction_runs  processing runs            61 rows
      ↓
l2_syntheses        AI-generated syntheses      2 rows (pipeline early)
      ↓
l3_surfaces         ToM-curated outputs         0 rows (not yet running)
```

---

## What's in L0 — Source Types

| source_type | count |
|---|---|
| `whatsapp_message` | 1,273 |
| `whatsapp_message_live` | 346 |
| `whatsapp_attachment` | 296 |
| `claude_code_jsonl` | 59 |
| `meeting_audio` | 5 |

The platform is currently almost entirely **WhatsApp data** — messages, live messages, and attachments — plus some Cursor/Claude agent transcripts and a few meeting recordings.

---

## WhatsApp Chat Grouping (L0)

WhatsApp messages are grouped by `chat_slug` stored in `metadata->>'chat_slug'` on each `l0_artifacts` row. Each `chat_slug` represents one conversation — either a direct message or a group chat.

### All chats (as of May 7, 2026)

| chat_slug | messages | senders | first message | last message | notes |
|---|---|---|---|---|---|
| `shaul-direct` | 599 | 2 | Feb 25 | May 5 | Historical export |
| `mvp-dev` | 296 | 4 | Mar 31 | May 5 | Historical export, group |
| `group-group` | 283 | 4 | Feb 25 | May 5 | Historical export, group |
| `yitzchak-direct` | 95 | 2 | Feb 25 | May 3 | Historical export |
| `wa-group-120363417998577992` | 86 | — | May 5 | May 6 | Live GOWA feed |
| `wa-972533145330` | 74 | — | May 5 | May 7 | Live GOWA feed, DM |
| `wa-group-120363425543175451` | 46 | — | May 5 | May 7 | Live GOWA feed |
| `wa-972552631180` | 35 | — | May 6 | May 7 | Live GOWA feed, DM |
| `wa-972583246058` | 20 | — | May 5 | May 6 | Live GOWA feed, DM |
| *(8 more low-volume chats)* | <20 each | — | May 5–7 | — | Live GOWA feed |

**Two tiers of data:**
- **Named historical exports** — friendly `chat_slug`, sender names populated, full chat history imported from backup
- **Live GOWA feed** — raw IDs (`wa-group-...` / `wa-972...`), no `sender_raw` yet, streaming from May 5 onward

### Key metadata fields per message

```json
{
  "chat_slug": "mvp-dev",
  "sender_raw": "~ Jeffrey Levine",
  "ts_raw": "04/05/2026, 14:35:18",
  "kind": "text",
  "line_no": 1351,
  "tenant_slug": "viter",
  "attachment_filenames": []
}
```

### SQL to fetch all messages for a chat

```sql
SELECT inline_text, metadata->>'sender_raw' as sender, origin_at
FROM l0_artifacts
WHERE source_type IN ('whatsapp_message', 'whatsapp_message_live')
  AND metadata->>'chat_slug' = 'mvp-dev'
ORDER BY origin_at ASC;
```

---

## View Builder — Planned UI Source Model

Each WhatsApp `chat_slug` becomes one **source** in the left sidebar. The View Builder reads L0 messages for the selected chat and feeds them to the AI to generate a view.

```
WhatsApp
  ├── shaul-direct        (599 messages)
  ├── mvp-dev             (296 messages, 4 people)
  ├── group-group         (283 messages, 4 people)
  ├── yitzchak-direct     (95 messages)
  └── wa-group-...        (live — 86 messages)
```

This is decided. The next build step is to replace `/api/sources` with a Supabase query that returns distinct `chat_slug` values as sources, and update the canvas route to pull L0 messages for the selected chat.

---

## What's in Channels

| kind | count |
|---|---|
| `whatsapp` | 24 |
| `meeting` | 6 |
| `claude-code` | 5 |
| `email` | 1 |
| `vita-chat` | 1 |

37 channels total. 24 are WhatsApp groups/contacts.

---

## The L2 Table — `l2_syntheses`

### Schema

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `tenant_id` | uuid | Scopes to tenant |
| `scope_kind` | text | What type of scope (e.g. `"day"`, `"channel"`) |
| `scope_key` | text | The specific scope value (e.g. `"2026-04-29"`, a channel UUID) |
| `body` | text | The synthesis content — AI-generated, likely markdown |
| `generator` | text | Which model generated it (e.g. `"claude-opus-4-7"`) |
| `is_stale` | bool | Whether this synthesis needs regenerating |
| `stale_reason` | text | Why it's stale |
| `superseded_by` | uuid | Points to newer synthesis if replaced |
| `cites_event_ids` | uuid[] | Array of `l1_events.id` this synthesis was built from |
| `cites_extraction_runs` | uuid[] | Array of `l1_extraction_runs.id` used |
| `generated_at` | timestamptz | When it was generated |

### Current data (as of May 7, 2026)

5 rows:

| scope_kind | scope_key | notes |
|---|---|---|
| `day` | `2026-04-29` | Daily brief (×2 rows — two versions) |
| `meeting` | `meeting:meeting-2026-05-07-1100` | 24 min, Mordechai + Yitzchak |
| `meeting` | `meeting:meeting-2026-05-07-1000` | 47 min, Mordechai + Shaul |
| `meeting` | `meeting:smoke-prod-211738` | 1 min smoke test |

Two `scope_kind` values confirmed: `"day"` and `"meeting"`. No per-chat scope kind yet.

---

## How to Trace Source from L2

### Path 1 — via `scope_kind` / `scope_key` (fastest, when scope is a channel)

```sql
-- If scope_kind = 'channel', scope_key is a channel UUID
SELECT c.kind, c.identifier, c.display_name
FROM channels c
WHERE c.id = '<scope_key>'::uuid
```

### Path 2 — via `cites_event_ids` (most detailed)

```sql
-- Get source artifacts from cited events
SELECT DISTINCT a.source_type, a.source_uri, a.origin_at
FROM l1_events e
JOIN l0_artifacts a ON a.id = e.artifact_id
WHERE e.id = ANY('<cites_event_ids>'::uuid[])
```

### Path 3 — via channel on the event

```sql
-- Get channels from cited events
SELECT DISTINCT c.kind, c.identifier, c.display_name
FROM l1_events e
JOIN channels c ON c.id = e.channel_id
WHERE e.id = ANY('<cites_event_ids>'::uuid[])
```

---

## What This Means for View Builder

1. **Source layer:** `l0_artifacts` grouped by `metadata->>'chat_slug'` — each chat is one source in the sidebar
2. **Content for AI:** all L0 messages for the selected `chat_slug`, formatted as a conversation transcript
3. **L2 role (future):** when Mrodchi adds per-chat syntheses (`scope_kind: "chat"`), the View Builder can switch to reading the pre-synthesised `body` instead of raw messages — no UI change needed
4. **L2 role (current):** daily briefs (`scope_kind: "day"`) and meeting summaries (`scope_kind: "meeting"`) can be separate source types in the sidebar alongside the per-chat sources
5. **Freshness:** for live GOWA chats (`wa-...`), messages are streaming — canvas should always pull latest on open

---

## Open Questions for Mrodchi

1. What `scope_kind` values will exist beyond `"day"`? (e.g. `"channel"`, `"contact"`, `"topic"`, `"project"`)
2. What is the format of `body`? Always markdown? Structured JSON? Both?
3. Will there be a `scope_kind` per WhatsApp channel, or always rolled up to `"day"`?
4. When will `l3_surfaces` start being populated and what will `surface_key` look like?
