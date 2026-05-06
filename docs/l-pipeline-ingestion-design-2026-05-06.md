# L1/L2/L3 file → Supabase ingestion design (2026-05-06)

**Trigger:** May 5 ontology brainstorm (jsonl `d37801bd`) Supabase agent finding —
> *"`l1_extractions` / `l2_syntheses` / `l3_fusions` exist at zero rows — the file-system pipeline (chat-log/whatsapp/transcripts) hasn't been pushed into DB yet. **Aspirational** — DB mirror of the L0→L3 file pipeline, not yet running."*

**Goal:** close the file-system ↔ DB gap. The markdown pipeline that already produces 19+ L2 files and 8+ L3 surfaces every SessionEnd should mirror into Supabase so the DB-side `l1`/`l2`/`l3` tables (and downstream MCP tools, full-text search via `body_tsvector`, RLS-scoped read access) become real.

This is **not** a re-architecture. The file-system pipeline stays the source of truth. Supabase becomes a *mirror* that's a pure function of the filesystem — re-derivable at any time. Per Chidush 019: filesystem is L0 / L1+ for the substrate; Supabase tables are downstream projections, RLS-scoped per substrate boundary.

---

## Schema map (existing, confirmed via `information_schema`)

```
l0_artifacts                     l0_chat_turns                       l1_extractions
─────────────────────────        ────────────────────────────        ─────────────────────────
id           uuid                id                  uuid            id                 uuid
tenant_id    uuid                tenant_id           uuid            tenant_id          uuid
owner_user_id uuid               owner_user_id       uuid            l0_id              uuid  ──┐
kind         text  ←─ "chat-jsonl" / "whatsapp-zip" / "meeting-audio"                            │
visibility   text                l0_id           uuid  ──┐           extraction_type    text     │
bucket_name  text                l1_extraction_id uuid                extractor          text     │ FK to
bucket_path  text                source           text                extractor_version  text     │ l0_artifacts
sha256       text                session_id       text                extracted_at       tstz     │
mime_type    text                turn_index       int                 output_rowcount    int      │
size_bytes   bigint              turn_uuid        text                output_bucket_path text    ─┘
metadata     jsonb               role             text                output_body        text
ingested_at  tstz                ts               tstz                metadata           jsonb
ingested_by  text                content          jsonb
                                 content_text     text
                                 tsv              tsvector
                                 visibility       text

l2_syntheses                                                          l3_fusions
──────────────────────────                                            ─────────────────────────
id                  uuid                                              id                  uuid
tenant_id           uuid                                              tenant_id           uuid
owner_user_id       uuid                                              surface             text  ←─ "_now" / "_decisions" / etc.
visibility          text                                              scope               text  ←─ "global" / "concept:<slug>" / "person:<slug>"
stream              text  ←─ "chat-log" / "whatsapp" / "transcripts"  scope_owner_id      uuid
date                date                                              generated_at        tstz
sessions            text[]                                            generator           text
duration_active     interval                                          generator_version   text
turns_user          int                                               body_markdown       text
turns_ai_text       int                                               body_tsvector       tsvector
decisions_strategic int                                               body_path           text
artifacts_shipped   int                                               source_l2_ids       uuid[]
state_shift         text                                              metadata            jsonb
tags                text[]
body_markdown       text
body_tsvector       tsvector
body_path           text
citations           jsonb
created_at          tstz
updated_at          tstz
```

The schema is **well-designed** — it already enforces the substrate-conservation-law structurally:
- Every `l1_extractions` row carries an `l0_id` (citation downward)
- Every `l2_syntheses` row carries `citations jsonb` (citation downward, free-form)
- Every `l3_fusions` row carries `source_l2_ids[]` (citation downward, typed array)
- Every layer has `body_tsvector` for FTS without materializing the body twice
- Every layer has `tenant_id` + `owner_user_id` + `visibility` for RLS

What's missing is **the loader**. That's this design.

---

## Per-stream filesystem layout (input)

```
viter-workspace/
├── chat-log/
│   ├── by-day/
│   │   ├── 2026-05-05-L1.md    ← per-day chat-log L1 extract
│   │   ├── 2026-05-05-L2.md    ← per-day chat-log L2 synthesis
│   │   └── ...
│
├── whatsapp/
│   ├── canonical-chat.jsonl    ← unified message stream (L0)
│   ├── shaul-me/canonical-chat.jsonl
│   ├── viter-internal/canonical-chat.jsonl
│   ├── yitzchak-me/canonical-chat.jsonl
│   └── by-day/
│       ├── 2026-05-05-L1.md    ← per-day whatsapp L1 extract
│       ├── 2026-05-05-L2.md    ← per-day whatsapp L2 synthesis
│       └── ...
│
├── transcripts/
│   ├── by-day/
│   │   ├── 2026-05-05-L1.md    ← per-day transcript L1 extract (screenpipe-derived)
│   │   └── ...
│   └── by-meeting/
│       ├── 2026-05-05_<slug>-L2.md  ← per-meeting L2 synthesis
│       └── ...
│
└── l3/
    ├── _now.md
    ├── _morning-brief.md
    ├── _decisions.md
    ├── _quotes.md
    ├── _deliverables.md
    ├── _index.md
    ├── _concepts/<slug>.md
    └── _people/<slug>.md
```

L0 sources outside the workspace:
- `~/.claude/projects/<project>/<session_uuid>.jsonl` — Claude Code session logs
- `~/Downloads/WhatsApp Chat - viter*.zip` — WhatsApp exports (ingested into `whatsapp/canonical-chat.jsonl`)
- `~/.screenpipe/db.sqlite` — screenpipe capture
- `viter-workspace/meetings/YYYY-MM-DD/*.m4a` + `*.tsv` — meeting recordings + transcripts

---

## Ingestion phases (idempotent at every step)

### Phase A — register L0 artifacts

For each L0 source:

| Source | l0_artifacts row |
|---|---|
| `~/.claude/projects/.../<sessionUUID>.jsonl` | `kind='chat-jsonl'`, `bucket_path='~/.claude/projects/.../<sessionUUID>.jsonl'`, `sha256=hash(file)`, `metadata={"session_uuid": ..., "project": ...}` |
| `whatsapp/canonical-chat.jsonl` | `kind='whatsapp-canonical'`, `bucket_path='whatsapp/canonical-chat.jsonl'`, `sha256`, `metadata={"chat_scope": "all"}` |
| `whatsapp/<chat>/canonical-chat.jsonl` | `kind='whatsapp-canonical'`, `bucket_path=<rel>`, `sha256`, `metadata={"chat_scope": "<chat>"}` |
| `meetings/YYYY-MM-DD/<slug>.m4a` | `kind='meeting-audio'`, `bucket_path=<rel>`, `sha256`, `metadata={"date": ..., "slug": ...}` |

**Idempotency key:** `(tenant_id, kind, bucket_path)` UNIQUE.

**Re-ingestion rule:** if `sha256` changed, mark the existing row's `metadata.superseded_by=<new_id>` rather than mutating in place. The substrate-conservation-law's L0 immutability is honored by *append-only* L0 records.

### Phase B — stream-specific L0 expansion (chat only, in v1)

For each `chat-jsonl` artifact registered in Phase A, parse the JSONL and upsert into `l0_chat_turns`:
- `l0_id` = the `l0_artifacts.id`
- `session_id` = filename uuid
- one row per turn, `turn_index = i`, `role = user|assistant`, `ts`, `content_text`, `content`

For whatsapp and transcripts, **defer**. v1 ingests their L1/L2 markdown bodies without per-message expansion. Future migration adds `l0_whatsapp_messages` and `l0_transcript_segments` if needed.

### Phase C — L1 extraction registration

For each `<stream>/by-day/YYYY-MM-DD-L1.md`:

```python
l1_extraction = {
  "tenant_id": MORDECHAI_TENANT,
  "l0_id": <id of the l0_artifacts row this L1 derives from — for chat, the JSONL session it summarizes; for whatsapp, the canonical-chat.jsonl artifact>,
  "extraction_type": "<stream>-L1-per-day",  # e.g. "chat-log-L1-per-day"
  "extractor": "extract-<stream>-l1",         # e.g. "extract-chat-l1"
  "extractor_version": <git_sha_of_skill>,
  "extracted_at": <mtime of file>,
  "output_rowcount": <line count of file>,
  "output_bucket_path": <relpath>,
  "output_body": <full file contents>,
  "metadata": {"date": "YYYY-MM-DD", "stream": "<stream>"}
}
```

**Idempotency key:** `(tenant_id, extraction_type, output_bucket_path)` UNIQUE. On re-run with unchanged sha256(body), no-op. On changed body, update in place (this is L1 — pure function of L0; recomputable; not append-only at this level).

**Citation:** L1 cites L0 via the `l0_id` foreign key. Hard-required (NOT NULL).

### Phase D — L2 synthesis registration

For each `<stream>/by-day/YYYY-MM-DD-L2.md` (and `transcripts/by-meeting/YYYY-MM-DD_<slug>-L2.md`):

```python
l2_synthesis = {
  "tenant_id": MORDECHAI_TENANT,
  "owner_user_id": MORDECHAI_USER,
  "visibility": "private",  # default per Chidush 019 component 5: L2 sharing is attributed perspective, default-private
  "stream": "<stream>",     # "chat-log" | "whatsapp" | "transcripts"
  "date": <date from filename>,
  "body_markdown": <full file contents>,
  "body_path": <relpath>,
  "body_tsvector": to_tsvector('english', body_markdown),  # generated column or computed at insert
  "citations": <parsed_citations>,
  "sessions": <list of session_ids cited>,
  "duration_active": <parsed from body if present>,
  "turns_user": <count from body>,
  "turns_ai_text": <count from body>,
  "decisions_strategic": <count from body>,
  "artifacts_shipped": <count from body>,
  "state_shift": <extracted from "## state_shift" or "_State shift:" block>,
  "tags": <extracted from frontmatter or "## Tags" section>,
}
```

**Citation:** L2 cites L1/L0 via the `citations` jsonb. Free-form but conventionally:
```json
{
  "l1_extraction_id": "<uuid>",
  "l0_artifact_ids": ["<uuid>", "..."],
  "session_ids": ["<sid>", "..."],
  "external_pointers": [{"kind": "youtube", "id": "Zwq_5jvFZH8"}, ...]  // Chidush 019 component 2
}
```

The `external_pointers` field is the implementation of Chidush 019 component 2 (pointer-backed L0): when a citation references an external L0 (a YouTube video, a tweet), it lives here, not as a foreign key to a missing local L0 row. The substrate boundary is preserved.

**Idempotency key:** `(tenant_id, stream, date, owner_user_id)` UNIQUE for per-day; `(tenant_id, body_path)` UNIQUE as a fallback (handles per-meeting which doesn't fit the day key).

### Phase E — L3 fusion registration

For each `l3/<surface>.md` (top-level: `_now.md`, `_morning-brief.md`, ...) and each `l3/_concepts/<slug>.md`, `l3/_people/<slug>.md`:

```python
l3_fusion = {
  "tenant_id": MORDECHAI_TENANT,
  "surface": <slug>,            # "_now" | "_decisions" | "_concepts/level-architecture" | etc.
  "scope": <derived>,           # "global" | "concept" | "person"
  "scope_owner_id": <person_id if applicable>,
  "generated_at": <mtime>,
  "generator": "index-l3",
  "generator_version": <git_sha>,
  "body_markdown": <file contents>,
  "body_path": <relpath>,
  "source_l2_ids": <parsed L2 references>,
  "metadata": {"surface_kind": "_underscore" | "_concept" | "_person"}
}
```

**Citation:** L3 cites L2 via `source_l2_ids` UUID array. The cross-stream-fusion property is implemented by the array containing IDs from multiple `l2_syntheses.stream` values.

**Idempotency key:** `(tenant_id, surface, scope_owner_id)` UNIQUE.

---

## RLS / multi-tenancy notes

The schema already has `tenant_id` everywhere. v1 ingests as a single tenant (Mordechai personal). When Shaul/Yitzhak/Jeffrey come online with their own substrates:

- Each gets own `tenant_id`
- Each ingests their own filesystem L1/L2/L3 (their own pyramid)
- `visibility` field on `l2_syntheses` and `l0_artifacts` controls who-sees-what across tenants
- Cross-tenant queries (e.g. *"all L2s about Jeffrey across all team substrates"*) require explicit grant + a federated query view layer not yet built

This is **Chidush 019 component 5** in production form: L0/L1 → low subjectivity → high cross-tenant share economics → broad RLS read defaults; L2 → medium → attributed perspective with explicit visibility flags; L3 → high subjectivity → private by default, occasional explicit shares.

---

## What this loader DOES NOT do

- **Replace the filesystem.** Filesystem stays source of truth. DB is mirror.
- **Re-derive L2 with an LLM.** L2 in DB = byte-for-byte copy of L2 markdown file. The LLM ran when the file was written; the loader doesn't re-run it.
- **Build embeddings.** `body_tsvector` is FTS, not vector. Embeddings are a separate downstream pipeline (already exists per `l0_chat_turns.tsv`).
- **Handle deletes.** If a markdown file is deleted from disk, the DB row stays — it's now a *promoted* L0 (Chidush 019 component 1) since the upstream is gone. Surface this state explicitly with a `metadata.upstream_status='missing'` flag during the loader's reconciliation pass.
- **Cross-stream synthesis.** L3 fusion happens in `index-l3` on the filesystem. Loader copies the result; doesn't compute it.

---

## Operational shape

- **Trigger:** runs as part of SessionEnd hook, *after* `index-l3` completes. The loader sees a freshly-built filesystem state.
- **Mode:** incremental. Tracks last-run timestamp in `~/viter-workspace/.l-pipeline.state.json`; only processes files with `mtime > last_run`.
- **Backfill:** a `--full` flag walks every file and upserts. Idempotency keys above guarantee re-running is safe.
- **Failure:** per-file try/except. One corrupt L2 doesn't break ingestion of others. Failures logged to `~/viter-workspace/.l-pipeline.log` with file path + traceback.
- **Verification:** after each phase, the loader runs sanity counts and writes them to the log:
  ```
  Phase A: 138 l0_artifacts inserted/updated, 0 errors
  Phase C: 56 l1_extractions inserted/updated (chat-log:14, whatsapp:18, transcripts:24)
  Phase D: 21 l2_syntheses inserted/updated
  Phase E: 12 l3_fusions inserted/updated
  ```

---

## Skeleton script

See [`scripts/ingest-l-pipeline.py`](../scripts/ingest-l-pipeline.py) — sibling to this design. The skeleton is callable but most parsing functions are TODO-marked; first run end-to-end after filling them in.

The script's structure mirrors this doc — one function per phase, each phase a pure function over the filesystem state + the existing DB state.

---

## Open questions

1. **Tenant identity for personal corpus.** `MORDECHAI_TENANT` UUID needs to be assigned. Reuse one of the existing 2 tenants? Create a third for personal? Lean: third (separation of concerns — Persofi pack ≠ personal substrate).

2. **Visibility default for `l2_syntheses`.** v1 sets `private`. But the May 5 brainstorm + Chidush 019 component 5 suggests default `team` for synthesized perspective sharing. Decide before populating.

3. **Streaming vs batch.** Today the loader is batch (runs at SessionEnd). Future: live ingestion via the existing `viter-sync` daemon (per `INF` capabilities row *"viter-sync daemon (chat-logs → Supabase)"*). v1 = batch; v2 considers daemon integration.

4. **The `external_pointers` schema in `citations`.** Per Chidush 019 component 2, this is where pointer-backed L0 lives. Spec the typed shape: `{kind, id, fetched_at, upstream_status}`. Likely needs its own jsonb migration to enforce structure.

5. **Embedding pipeline.** `body_tsvector` is FTS-only. The existing screenpipe + youtube-pipeline have embedding tables. Should `l2_syntheses` get an `embedding vector(768)` column for semantic search across the corpus? Lean: yes, future migration. v1 ships FTS-only.

6. **L3 surface visibility.** `l3_fusions` doesn't have `visibility` or `owner_user_id`. Per Chidush 019 component 5, L3 is the most personal layer — should have `owner_user_id` minimum. Schema gap; needs a migration before multi-tenant L3 sharing is sensible.
