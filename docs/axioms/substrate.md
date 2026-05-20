# Axiom family VTA — Vita Substrate
# Owner: Vita platform · Layer: substrate · Prefix: VTA-*

---
layer: substrate
owner: viter-org
depends_on:
  - SHL0-1@shelet    # L0 immutability
  - SHL1-1@shelet    # L1 identity = input signature
  - SHL2-1@shelet    # L2 must cite L1
---

## The opinion

Vita is not a generic data platform — it is a SHELET implementation with opinions. Those opinions are encoded here as VTA-* axioms. Every OBL-*, RCG-*, TRU-*, PAT-* domain axiom operates *on top of* these substrate axioms. Without VTA-*, domain axioms have nothing to run on.

> *"SHELET defines four layers that form a strict dependency chain. Each layer can only reference the layer below it. Staleness propagates automatically. Citations are enforced by triggers, not application code."*
> — viter-org/README.md

---

## Axioms

> **VTA-1:** Every L1 extraction carries two independent scalars:
> - `confidence ∈ [0,1]` — how sure are we the extraction is *correct*? (model quality, source legibility, agreement across evidence)
> - `representation: string[]` — what modality and fidelity is the source material? (e.g. `text/structured`, `text/ocr`, `image/vision`, `audio/whisper`, `schedule/derived`)
>
> These are independent dimensions. An OCR extraction can have high confidence if the document is clean; an LLM extraction from plain text can have low confidence if the model disagreed with itself. Separating them lets the system diagnose failure modes precisely.

> **VTA-2 (cost-as-ontology):** Tool selection minimizes cost subject to `confidence ≥ benchmark`. The cheapest tool that hits the bar wins. Cost is a first-class constraint in the type system — not an optimization layer applied after correctness. Benchmark is declared per extraction task, not globally.

> **VTA-3 (non-destructive tooling):** Tools never replace; they accumulate. A new extractor version runs alongside the old. The system measures `(Δcost, Δconfidence)` before retiring the old version. Rollback is always possible because the old version's L1 rows are preserved.

> **VTA-4 (MCP tools as typed projections):** MCP tools exposed to agents are typed projections of domain axioms, not CRUD wrappers. `get_obligation()` returns a result typed by OBL-*, not by SQL columns. The tool signature is derived from the axiom, not from the schema. Schema is downstream of axioms (per the ontology contract).

> **VTA-5 (tenant isolation):** Every table is partitioned by `tenant_id` via RLS. No cross-tenant data access is possible without an explicit declared cross-tenant axiom. Tenant slug is the primary partitioning key for all L0/L1/L2/L3 data and all derived projections.

> **VTA-6 (artifact identity):** An L0 artifact's identity is `(tenant_id, sha256)`. Same content ingested twice = one row. Source type is open (INSERT, not ALTER TYPE) — new source types (`screenpipe_ocr`, `calendar_event`, `patent_filing_pdf`) are additions, not schema changes.

> **VTA-7 (extraction identity):** An L1 extraction's identity is the full input signature: `(tenant_id, artifact_id, facet, extractor, version, parameters)`. Same inputs → exactly one row, ever. This makes re-runs idempotent. A changed parameter = a new L1 row, not a mutation.

---

## What SHELET provides that VTA-* builds on

VTA-* axioms implement SHELET. They don't restate it — they specialize it:

| SHELET (abstract) | VTA-* (Vita-concrete) |
|---|---|
| L0 is immutable | L0 identity = `(tenant_id, sha256)` |
| L1 identity = input signature | L1 identity = 6-tuple (artifact, facet, extractor, version, params, tenant) |
| L2 must cite L1 | Enforced by DB trigger on `l2_syntheses.cites_l1` |
| Staleness propagates | RLS + trigger chain marks downstream rows stale |
| Tool selection is explicit | VTA-2: cost-as-ontology specifies the selection rule |

SHELET is the law. VTA-* is the implementation of the law in TypeScript + PostgreSQL + Hono.
