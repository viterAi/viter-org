# vita

A personal knowledge platform built on SHELET — a four-layer architecture that enforces traceable, reproducible, citation-verified knowledge management at the database layer.

Ingest WhatsApp conversations, meeting audio, Claude/Cursor sessions, PDFs, and calendar events. Every output cites its sources. Every stale source automatically invalidates downstream syntheses. Every extraction is reproducible.

---

## SHELET Architecture

Most AI systems that ingest documents have the same quiet problem: you don't know where anything came from. A summary gets generated, a retrieval result surfaces, an answer appears — but the chain from raw source to rendered output is opaque, unverifiable, and invisible to debugging.

SHELET defines four layers that form a strict dependency chain. Each layer can only reference the layer below it. Staleness propagates automatically. Citations are enforced by triggers, not application code. Every extraction is a pure function: same inputs always produce the same row.

### L0 — Immutable Artifacts

The bottom of the stack. Raw source material: WhatsApp ZIPs, meeting audio, ChatGPT exports, PDFs, Cursor/Claude JSONL sessions.

**Key invariant: L0 artifacts are write-once.** Once ingested, they cannot be modified — only superseded. SHA256 deduplication ensures the same content is never stored twice.

```sql
UNIQUE (tenant_id, sha256)
```

The source type registry is an open table, not a PostgreSQL enum. New source types (`screenpipe_ocr`, `calendar_event`, `email_eml`) are an INSERT, not an ALTER TYPE.

### L1 — Extraction Runs

Deterministic processing of L0 artifacts. Each extraction run applies a specific extractor at a specific version with specific parameters to a specific artifact facet.

**Identity key = the entire input signature:**

```sql
UNIQUE (tenant_id, artifact_id, facet, extractor, version, parameters)
```

Same inputs → exactly one row, ever. Re-running an extractor finds the existing row or creates a new one — never duplicates.

For non-deterministic extractors (Whisper transcription, LLM summarization), an `is_deterministic = false` flag allows multiple runs. An active pointer tracks which run is current, with a full audit trail of every flip.

Source locators are typed columns, not free-text:

```
ts_start_s   float    -- audio/video: seconds from start
byte_offset  bigint   -- binary: byte position  
line_no      int      -- text: line number
page         int      -- PDF: page number
```

Typed coordinates enable "go to source" links in the UI — not just "around page 4."

### L2 — Syntheses

Summaries, analyses, entity extractions, topic models — anything that synthesizes across multiple L1 events.

**Every L2 synthesis must cite the L1 events it depends on.** A database trigger enforces this:

```sql
-- Raises EXCEPTION if any cited event_id doesn't exist in l1_extraction_events
CREATE TRIGGER enforce_l2_citation_integrity
BEFORE INSERT ON l2_syntheses
FOR EACH ROW EXECUTE FUNCTION check_l2_citation_integrity();
```

You cannot insert an L2 synthesis that cites a non-existent event. This is enforced at the database layer — it cannot be bypassed by a bug, a rushed deployment, or a new service that doesn't know the rules.

**Staleness propagation:** When an L1 active pointer flips (new extraction becomes current), every L2 synthesis that cited that extraction is automatically marked stale — no application code, no cron job.

### L3 — Rendered Surfaces

Dashboards, reports, chat responses, embeddings — anything shown to users or consumed by downstream systems.

L3 references L2 syntheses, never L0/L1 directly. The same staleness cascade applies: L2 stale → L3 stale, automatically.

Helper views `l2_current` and `l3_current` filter to non-stale rows, giving application code a clean interface without thinking about staleness management.

---

## Access Control

Informed by how Palantir approaches data authorization. Three principles:

1. **Membership is derived from participation** — if you sent a message in a channel, you're a member. Not admin-granted.
2. **Access is computed at request time** — no pre-computed ACL tables that go stale.
3. **Default-CLOSED** — channels are private unless explicitly opened.

The core function has a stable signature with an evolvable body:

```sql
CREATE FUNCTION user_can_read_channel(p_channel_id uuid)
RETURNS boolean STABLE SECURITY DEFINER ...

-- v1: direct membership check
-- v2: time-bounded access (add valid_until to memberships)  
-- v3: marking-based clearance (add classification level)
-- v4: on-behalf-of delegation
```

Upgrading from v1 to v2 changes exactly one function body. RLS policies, application code, and views don't move.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + React 19 + Tailwind v4 |
| AI | Vercel AI SDK v6, Claude Sonnet 4.6 via OpenRouter |
| Jobs | Trigger.dev cloud (Whisper transcription, ingest pipelines) |
| Database | Supabase PostgreSQL — RLS on all tables from line 1 |
| Embeddings | `vector(1536)`, ivfflat index on L1 embeddings |
| Hosting | Vercel (UI) + Railway (runtime, adapters) |

## Repo Layout

```
apps/
  web/                 Next.js 16 + React 19 + Tailwind v4 → Vercel

packages/
  spec/                JSON Schema → typed manifest contract
  runtime/             dispatch · audit · policy · sign
  orchestrator/        agent loop · planning · streaming
  ontology/            MD axioms compiled to TS exports
  ui/                  shadcn-style primitives

adapters/              http · browser (Playwright) · desktop · hil · mcp

infra/
  supabase/            migrations · seed · edge functions
    20260504100000_l0_substrate.sql
    20260504100100_l1_extraction_runs.sql
    20260504100200_l2_l3_with_staleness.sql
    20260504200000_channel_access.sql
```

## Hosting

| Service | Where | Why |
|---------|-------|-----|
| `viter.ai` (Next.js UI) | Vercel | Edge cache · per-branch previews |
| `api.viter.ai` (chat streaming) | Vercel Functions Fluid | 800s SSE · `waitUntil()` |
| `substrate.viter.ai` (runtime + adapters) | Railway | Always-on · no timeout |
| Data (manifests · audit · chat · finance) | Supabase us-west-1 | One Postgres · RLS multi-tenant |

## Companion Repos

- [`viterAi/viter`](https://github.com/viterAi/viter) — production recon app (Insperanto / Jeffrey)
- [`viterAi/viter-ontology`](https://github.com/viterAi/viter-ontology) — worldview spec, consumed by `packages/ontology/`
- [`viterAi/Knowledge-Agent`](https://github.com/viterAi/Knowledge-Agent) — Python/FastAPI, porting to `packages/orchestrator/`

---

*v0.1 scaffold — created 2026-05-04. SHELET migrations: ~600 lines SQL, written in one day.*
