# `@vita/orchestrator`

Trigger.dev tasks that run the substrate ingest pipeline in the cloud.

## Topology

```
[zip lands in supabase storage `inbox/<tenant>/<chat>/<filename>.zip`]
        ↓ Storage webhook (object created)
[inbox-webhook Edge Function — ~50ms]
        ↓ POST trigger.dev /tasks/ingest-zip/trigger
[ingestZip orchestrator]
   ├── uploadZip          — phase 1 (download, unzip, upload, l0 inserts, _chat.txt merge)
   ├── parseChat          — phase 2 (regex parse, l0_messages + l1_events)
   └── extractAttachment  — phases 3+4+5 (one task per file, fan-out)
        - audio  → openai/whisper-large-v3-turbo
        - image  → google/gemini-3.1-flash-lite-preview   ← phase 5 default
        - pdf    → google/gemini-2.5-flash-lite
        - docx   → mammoth (in-process)
        - xlsx   → sheetjs (in-process)
        - html   → regex-strip (in-process)
        - md/json/txt → identity (in-process)
        ↓ all rows live in supabase postgres
[supabase realtime → viter.ai UI]
```

## Tasks

| File | Task ID | Purpose |
|---|---|---|
| `src/trigger/ingest-zip.ts` | `ingest-zip` | Top-level orchestrator |
| `src/trigger/upload-zip.ts` | `upload-zip` | Phase 1 — bytes + l0 + chat merge |
| `src/trigger/parse-chat.ts` | `parse-chat` | Phase 2 — `_chat.txt` → events |
| `src/trigger/extract-attachment.ts` | `extract-attachment` | Phases 3+4+5 — per-file fan-out target |

## Env (set in Trigger.dev dashboard, per environment)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY
```

## Env (set as Supabase Edge function secrets)

```
TRIGGER_SECRET_KEY     # cloud.trigger.dev → project test-JeHj → API keys
```

## Local dev

```bash
# from this package
pnpm trigger:dev          # starts the v4 dev server, hot-reloads tasks
                          # opens https://cloud.trigger.dev with run console
```

The dev server connects to your Trigger.dev project (`test-JeHj`) on the `dev` env.
You can fire a task by hand from the dashboard — payload shape matches the zod schema
on each task.

## Deploy

```bash
pnpm trigger:deploy       # deploys current branch to Trigger.dev `prod` env
```

After deploy, set the env vars in the dashboard (Project → Environments → prod)
and verify the `ffmpeg` build extension is active in the deploy log.

## Edge function

`infra/supabase/functions/inbox-webhook/index.ts`

```bash
# from repo root
supabase functions deploy inbox-webhook
supabase secrets set TRIGGER_SECRET_KEY=tr_dev_xxx --env-file ./infra/supabase/.env
```

Then in the Supabase dashboard:
- **Storage → Webhooks → New**
- Bucket: `inbox`
- Events: `ObjectCreated:*`
- Filter: `*.zip`
- HTTP endpoint: this function's URL

## Migrations to apply

- `infra/supabase/migrations/20260504230000_inbox_bucket.sql` — creates the `inbox`
  bucket and the RLS policies that let channel members drop zips.

## Why this layout

Per [`/Users/mordechai/viter-workspace/ontology/00-stack-decision.md`](../../../ontology/00-stack-decision.md)
the Vita stack splits work between Vercel (UI), Trigger.dev (bursty / fan-out
substrate), Railway (stateful adapters when they land), and Supabase
(Postgres + Storage + Edge webhook receivers).

The 4-phase WhatsApp ingest is bursty and fan-outs heavily — it's the canonical
Trigger.dev workload. Railway stays reserved for the future Plunet Playwright
adapter, persistent MCP servers, and warm agent loops.
