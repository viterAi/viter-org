# T-023 — genUI ingest: Arcade relay, job queue, and `genui_channels`

**Wave:** 5 — Month 3+ (can start once schema ownership is clear)  
**Estimate:** 2–3 days  
**Depends on:** Existing `public.genui_l2` in `vita-compare` (see migration `20260511084339_genui_l2.sql`)  
**Blocks:** Automated genUI freshness from GitHub (and later other sources)

---

## Context

genUI synthesis rows live in **`public.genui_l2`** (`tenant_id`, optional `view_id`, `payload`, `generator`, timestamps). There is no durable notion of an external **channel** (GitHub repo, inbox, etc.), and nothing today turns **webhooks** or **scheduled polls** into **append-only** L2 rows under **Supabase Auth + RLS**.

**Product goal:** **event-first** where GitHub supports webhooks, **reconciliation** to heal gaps, **last N** from existing **`genui_l2`** rows for that channel, **one agent** run, then **one new `genui_l2` insert** per completed job.

**Control plane (locked):**

1. **GitHub → Arcade** — Arcade receives the repo webhook (Arcade is the configured webhook URL).
2. **Arcade → your HTTPS** — Arcade **transparently forwards** the **raw body** and **GitHub signature / delivery headers** (`X-Hub-Signature-256`, `X-GitHub-*`, etc.). **Do not ship** until docs + smoke test prove byte-stable relay (**v1 gate**).
3. **Fast handler** — Verifies **GitHub HMAC** on the raw payload, authenticates the **Arcade→you** hop (shared secret / mTLS), **enqueues** a row in **`genui_ingest_jobs`**, returns **2xx within seconds** so Arcade can satisfy GitHub’s delivery window. **No LLM** on this path.
4. **Polling worker** — Claims **`pending`** jobs (`FOR UPDATE SKIP LOCKED` or equivalent), uses the **per-tenant machine user** JWT (refresh per job) for **RLS**: resolve `genui_channels`, **select** last **N** `genui_l2`, run **one** LLM, **insert** one `genui_l2` row, mark job **`done` / `failed`**.
5. **Split auth (locked):** the **handler** may use **`service_role`** or a **narrow `SECURITY DEFINER` RPC** **only** to insert **`genui_ingest_jobs`** (and optionally resolve `tenant_id` / `genui_channel_id`). The **worker** uses **machine user + RLS** for all tenant reads/writes on `genui_l2` / `genui_channels` / job updates the machine role is allowed to perform.
6. **Reconciliation** — Same **`genui_ingest_jobs`** pipeline: scheduler inserts **`pending`** jobs with **`ingest_kind: "reconciliation"`**; worker is **one codebase** for webhook- and reconciliation-driven work.
7. **Arcade MCP (separate concern)** — Interactive agents may call **Arcade MCP** for tools; **ingest LLM** runs on **your** worker, not inside Arcade’s agent step for this ticket.

---

## Scope

**In scope**

- **`genui_channels`** + **`genui_l2.genui_channel_id`** (+ indexes, RLS).
- **`genui_ingest_jobs`** queue table (`genui_` prefix): `status`, `tenant_id` / `genui_channel_id`, idempotency key, `ingest_kind`, payload metadata, timestamps; RLS and/or definer RPC for **handler insert**; policies for **worker** claim/update as designed.
- **HTTPS handler** + **polling worker** + **reconciliation scheduler** as above.
- **Idempotency** for GitHub duplicate deliveries.
- **`genui_l2.payload`** contract (`ingest_kind`, version, optional `external_event_id`).

**Out of scope**

- Second parallel model per event.
- Email / other sources unless added explicitly.
- Using **service role** for **bulk** `genui_l2` writes (worker stays **machine user + RLS**).

---

## Deliverables

1. Supabase migrations: **`genui_channels`**, **`genui_l2.genui_channel_id`**, **`genui_ingest_jobs`**, RLS + **narrow** handler path (RPC or documented service-role use).
2. **Arcade** config: webhook → **raw forward** to your URL; **secrets** for Arcade→you auth.
3. **Handler + worker** implementation (repo location TBD) with runbooks: token rotation, add channel, replay failed jobs.
4. **Smoke test evidence** that HMAC verification passes through Arcade’s forward.

---

## Schema (sketch — finalize in migration)

```sql
-- genui_channels (unchanged intent)
CREATE TABLE public.genui_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_key TEXT NOT NULL,
  display_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, external_key)
);

ALTER TABLE public.genui_l2
  ADD COLUMN genui_channel_id UUID REFERENCES public.genui_channels(id) ON DELETE SET NULL;

-- genui_ingest_jobs: durable queue (columns to finalize)
CREATE TABLE public.genui_ingest_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  genui_channel_id UUID REFERENCES public.genui_channels(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  ingest_kind TEXT NOT NULL,               -- webhook | reconciliation
  idempotency_key TEXT,
  raw_event_storage TEXT,                   -- or FK to object storage / JSONB per size limits
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)      -- partial unique when key present — tune per product
);
```

Store **raw body** policy: if bodies are large, **store pointer** or truncated hash + object storage; handler must retain enough for **worker** to resolve repo/event without re-fetching if that’s required.

---

## Acceptance criteria

### Schema & RLS

- [ ] **`genui_channels`**, **`genui_l2.genui_channel_id`**, **`genui_ingest_jobs`** migrated; **`genui_`** prefix on all new tables.
- [ ] **RLS** on `genui_channels` / `genui_l2` / `genui_ingest_jobs` for tenant + machine user; **`genui_l2`** bot path remains **insert-only** (no bot update/delete on L2).
- [ ] **Handler path** documented: **shared secret** (or equivalent) for Arcade→you; **job insert** via **definer RPC** and/or **service_role** **only** for that narrow write.

### Arcade & GitHub

- [ ] Arcade receives GitHub webhooks and **forwards raw body + signature headers** to your URL; **documented proof** (test log or runbook) before production.
- [ ] Your handler **verifies GitHub HMAC** on received raw body; rejects otherwise.

### Handler & worker

- [ ] Handler **enqueues** and returns **2xx fast** (no LLM); meets GitHub deadline via Arcade’s upstream response chain.
- [ ] **Polling worker** claims jobs safely; uses **per-tenant machine user JWT** for **claim + last N + insert**; retries / `failed` state documented.
- [ ] **Reconciliation** enqueues **`genui_ingest_jobs`** with **`ingest_kind: "reconciliation"`**; **same worker** as webhooks.
- [ ] **Idempotency** for duplicate GitHub deliveries implemented (unique key or no-op second job).

### Contract & ops

- [ ] **`genui_l2.payload`** contract documented; **`ingest_kind`** on L2 rows aligned with job kind.
- [ ] **Runbook:** channel setup, machine-user rotation, failed job replay, Arcade forward troubleshooting.

### Deferrals

- [ ] Email / other sources explicitly listed as out of v1 or follow-up ticket.

---

## Notes for the agent

- Migrations: **`vita-compare/infra/supabase/migrations/`**; mirror **`genui_l2`** RLS style from `20260511084339_genui_l2.sql`.
- **Last-N-from-GenUI-only** still implies reconciliation matters—same job pipeline keeps one observability story.
- **Arcade MCP** is **not** required for the ingest worker’s LLM; keep MCP for **other** agent surfaces if needed.

---

## Implemented (repo)

| Piece | Location |
|--------|-----------|
| Schema + RLS + `genui_claim_next_job` | `vita-compare/infra/supabase/migrations/20260512090000_genui_channels_ingest_jobs.sql` |
| GitHub HMAC helpers | `vita-compare/apps/web/lib/genui/github-webhook.ts` |
| Fast enqueue HTTP handler | `vita-compare/apps/web/app/api/integrations/github/genui/route.ts` (`POST`) |
| Polling worker (one job per run) | `vita-compare/packages/runtime/scripts/genui-ingest-worker.ts` — `pnpm --filter @vita/runtime genui-ingest-worker` |
| Env template | `vita-compare/.env.example` (`GENUI_*`, `GITHUB_WEBHOOK_SECRET`) |
| **UI:** repo + webhook secret + agent goal | **Primary:** View Builder **Corn jobs** (`app/components/GenUIIngestJobsPanel.tsx` + `CornJobsCanvas`). **Also:** `vita-compare/apps/web/app/settings/genui/` (vita web). |

**Ops:** Create a Supabase Auth user, add it to `tenant_members` for the target tenant, set `GENUI_WORKER_*` envs. Apply migrations. Users configure each GitHub repo (and signing secret + prompt) in **Settings → genUI ingest** before webhooks are accepted (`unknown_repo` otherwise).

**Reconciliation:** Same job table — insert `genui_ingest_jobs` rows with `ingest_kind = 'reconciliation'` (via service role / SQL / small internal route) and run the worker; not yet automated as a cron in code.

---

## Open questions

- **Raw payload size** vs job row: store full JSON in DB vs object storage vs worker re-fetch from GitHub API using stored delivery id.
- **`genui_l2.payload`** JSON schema for renderer.
- **`view_id`** optional vs required for ingest-only L2 rows.
